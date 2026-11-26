/* Chợ Tài Nguyên Mmo — storefront logic (vanilla JS, written from scratch) */
(function () {
  'use strict';

  /* ---------------- helpers ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  }
  function fmtMoney(n) {
    n = Number(n) || 0;
    return n.toLocaleString('vi-VN') + 'đ';
  }
  function fmtDate(s) {
    if (!s) return '';
    var d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    function p(x) { return String(x).padStart(2, '0'); }
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function maskName(name) {
    name = String(name || '').trim();
    if (!name) return 'Khách';
    var parts = name.split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0) + '***';
    return parts[0].charAt(0) + '*** ' + parts[parts.length - 1].charAt(0) + '***';
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  /* ---------------- state ---------------- */
  var TOKEN_KEY = 'ctn_token';
  var CART_KEY = 'ctn_cart';
  var PAGE_SIZE = 12;
  var PLATFORMS = ['Facebook', 'TikTok', 'Instagram', 'YouTube', 'Telegram', 'Gmail', 'X', 'Zalo'];
  var PLATFORM_CLASS = {
    'Facebook': 'fb', 'TikTok': 'tt', 'Instagram': 'ig', 'YouTube': 'yt',
    'Telegram': 'tg', 'Gmail': 'gm', 'X': 'x', 'Zalo': 'zl'
  };
  var PLATFORM_DOT = {
    'Facebook': '#1877F2', 'TikTok': '#111111', 'Instagram': '#C13584', 'YouTube': '#FF0000',
    'Telegram': '#229ED9', 'Gmail': '#D93025', 'X': '#000000', 'Zalo': '#0068FF'
  };
  var PLATFORM_LETTER = {
    'Facebook': 'FB', 'TikTok': 'TT', 'Instagram': 'IG', 'YouTube': 'YT',
    'Telegram': 'TG', 'Gmail': 'GM', 'X': 'X', 'Zalo': 'ZL'
  };

  var products = [];
  var user = null;
  var token = localStorage.getItem(TOKEN_KEY) || '';
  var cart = loadCart();
  var platformFilter = 'Tất cả';
  var searchQuery = '';
  var sortMode = 'best';
  var filterOpts = { inStock: false, hotOnly: false, min: null, max: null };
  var visibleCount = PAGE_SIZE;
  var detailId = null;
  var detailQty = 1;
  var pendingAfterLogin = null;
  var tickerItems = [];
  var tickerIdx = 0;
  var tickerTimer = null;
  var currentDepositCode = null;

  function loadCart() {
    try {
      var raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter(function (i) { return i && i.id != null; }) : [];
    } catch (e) { return []; }
  }
  function saveCart() { localStorage.setItem(CART_KEY, JSON.stringify(cart)); }

  /* ---------------- api ---------------- */
  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error((data && data.error) || 'Có lỗi xảy ra, thử lại sau.');
        return data;
      });
    });
  }

  /* ---------------- overlays ---------------- */
  var OVERLAY_IDS = ['productModal', 'cartDrawer', 'checkoutSheet', 'authSheet', 'walletSheet',
    'ordersSheet', 'renameSheet', 'filterSheet', 'policySheet', 'adminPanel'];
  function openOverlay(id) {
    var el = $(id);
    if (!el) return;
    el.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeOverlay(id) {
    var el = $(id);
    if (!el) return;
    el.hidden = true;
    if (!OVERLAY_IDS.some(function (x) { return !$(x).hidden; }) && $('botPanel').hidden) {
      document.body.style.overflow = '';
    }
  }
  function closeAllOverlays() {
    OVERLAY_IDS.forEach(function (id) { $(id).hidden = true; });
    $('botPanel').hidden = true;
    $('accountMenu').hidden = true;
    document.body.style.overflow = '';
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('accountMenu').hidden) { $('accountMenu').hidden = true; return; }
    if (!$('botPanel').hidden) { $('botPanel').hidden = true; document.body.style.overflow = ''; return; }
    var open = OVERLAY_IDS.filter(function (id) { return !$(id).hidden; });
    if (open.length) closeOverlay(open[open.length - 1]);
  });
  OVERLAY_IDS.forEach(function (id) {
    $(id).addEventListener('click', function (e) {
      if (e.target === $(id)) closeOverlay(id);
    });
  });
  document.addEventListener('click', function (e) {
    var closer = e.target.closest('[data-close]');
    if (closer) closeOverlay(closer.getAttribute('data-close'));
  });

  /* ---------------- platform helpers ---------------- */
  function platformClass(p) { return PLATFORM_CLASS[p] || 'df'; }
  function platformTile(p, size) {
    var letter = PLATFORM_LETTER[p] || String(p || '?').charAt(0).toUpperCase();
    return '<span class="platform-tile ' + platformClass(p) + '">' + esc(letter) + '</span>';
  }
  function findProduct(id) {
    for (var i = 0; i < products.length; i++) if (String(products[i].id) === String(id)) return products[i];
    return null;
  }

  /* ---------------- filtering / sorting ---------------- */
  function filteredProducts() {
    var q = norm(searchQuery.trim());
    var list = products.filter(function (p) {
      if (p.active === false) return false;
      if (platformFilter !== 'Tất cả' && p.platform !== platformFilter) return false;
      if (q && norm(p.name + ' ' + p.platform).indexOf(q) === -1) return false;
      if (filterOpts.inStock && !(Number(p.stock) > 0)) return false;
      if (filterOpts.hotOnly && !p.is_hot) return false;
      if (filterOpts.min != null && Number(p.price) < filterOpts.min) return false;
      if (filterOpts.max != null && Number(p.price) > filterOpts.max) return false;
      return true;
    });
    if (sortMode === 'price-asc') list.sort(function (a, b) { return a.price - b.price; });
    else if (sortMode === 'price-desc') list.sort(function (a, b) { return b.price - a.price; });
    else if (sortMode === 'newest') list.sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); });
    else list.sort(function (a, b) { return (b.sold || 0) - (a.sold || 0); });
    return list;
  }

  function cardHtml(p) {
    var out = Number(p.stock) <= 0;
    var discount = (p.old_price && p.old_price > p.price)
      ? Math.round((1 - p.price / p.old_price) * 100) : 0;
    var low = !out && Number(p.stock) < 10;
    return '<article class="product-card' + (out ? ' out' : '') + '" data-product-id="' + esc(p.id) + '">' +
      '<div class="card-top">' + platformTile(p.platform) +
      '<span class="platform-name">' + esc(p.platform) + '</span></div>' +
      '<h3 class="card-name">' + esc(p.name) + '</h3>' +
      '<div class="card-badges">' +
        '<span class="pill pill-warranty">' + esc(p.warranty || 'BH 1 đổi 1') + '</span>' +
        (p.is_hot ? '<span class="pill pill-hot">HOT</span>' : '') +
        (out ? '<span class="pill pill-out">Hết hàng</span>' : '') +
      '</div>' +
      '<div class="card-price-row"><span class="price">' + fmtMoney(p.price) + '</span>' +
        (p.old_price && p.old_price > p.price ? '<span class="old-price">' + fmtMoney(p.old_price) + '</span>' : '') +
        (discount ? '<span class="discount">-' + discount + '%</span>' : '') +
      '</div>' +
      '<div class="card-meta"><span>Đã bán ' + (Number(p.sold) || 0) + '</span>' +
      '<span class="' + (low ? 'low' : '') + '">Còn ' + (Number(p.stock) || 0) + '</span></div>' +
      '<div class="card-actions">' +
        (out
          ? '<button type="button" class="btn btn-disabled" disabled>Hết hàng</button>'
          : '<button type="button" class="btn btn-outline" data-action="add-cart" data-id="' + esc(p.id) + '">+ Giỏ</button>' +
            '<button type="button" class="btn btn-primary" data-action="buy-now" data-id="' + esc(p.id) + '">Mua ngay</button>') +
      '</div>' +
    '</article>';
  }

  function renderChips() {
    var counts = { 'Tất cả': 0 };
    products.forEach(function (p) {
      if (p.active === false) return;
      counts['Tất cả']++;
      counts[p.platform] = (counts[p.platform] || 0) + 1;
    });
    var all = ['Tất cả'].concat(PLATFORMS);
    $('chipRail').innerHTML = all.map(function (name) {
      var dot = name === 'Tất cả'
        ? '<span class="dot" style="background:#0284c7"></span>'
        : '<span class="dot" style="background:' + (PLATFORM_DOT[name] || '#0284c7') + '"></span>';
      return '<button type="button" class="chip' + (platformFilter === name ? ' active' : '') + '" data-platform="' + esc(name) + '">' +
        dot + esc(name) + ' <span class="count">' + (counts[name] || 0) + '</span></button>';
    }).join('');
  }

  function renderCatalog() {
    var list = filteredProducts();
    $('resultCount').textContent = 'Có ' + list.length + ' sản phẩm';
    var shown = list.slice(0, visibleCount);
    $('catalogGrid').innerHTML = shown.map(cardHtml).join('');
    $('catalogEmpty').hidden = list.length !== 0;
    $('loadMoreBtn').hidden = list.length <= visibleCount;
    $('catalogSub').textContent = platformFilter === 'Tất cả'
      ? 'Chọn tài khoản phù hợp với bạn'
      : 'Nền tảng: ' + platformFilter;
    $('filterDot').hidden = !(filterOpts.inStock || filterOpts.hotOnly || filterOpts.min != null || filterOpts.max != null);
    renderRows();
  }

  function browseIsFiltered() {
    return searchQuery.trim() !== '' || platformFilter !== 'Tất cả' ||
      filterOpts.inStock || filterOpts.hotOnly || filterOpts.min != null || filterOpts.max != null ||
      sortMode !== 'best';
  }

  function renderRows() {
    /* Rails follow search/sort/filter: while the visitor is searching, sorting
       or filtering, the curated "Bán chạy" / "Mới về" rails are hidden so the
       catalog results are the only products on screen (previously the rails
       kept showing unrelated products during a search). */
    var filtered = browseIsFiltered();
    $('hotSection').hidden = filtered;
    $('newSection').hidden = filtered;
    if (filtered) { $('hotRow').innerHTML = ''; $('newRow').innerHTML = ''; return; }
    var active = products.filter(function (p) { return p.active !== false; });
    var hot = active.filter(function (p) { return p.is_hot; });
    if (hot.length < 4) {
      var bySold = active.slice().sort(function (a, b) { return (b.sold || 0) - (a.sold || 0); });
      bySold.forEach(function (p) { if (hot.indexOf(p) === -1 && hot.length < 8) hot.push(p); });
    }
    $('hotRow').innerHTML = hot.slice(0, 10).map(cardHtml).join('') ||
      '<p class="sheet-note">Chưa có sản phẩm hot.</p>';
    var newest = active.slice().sort(function (a, b) { return new Date(b.created_at || 0) - new Date(a.created_at || 0); });
    $('newRow').innerHTML = newest.slice(0, 10).map(cardHtml).join('') ||
      '<p class="sheet-note">Chưa có sản phẩm mới.</p>';
  }

  /* ---------------- load: products / stats / activity / leaderboard / ticker ---------------- */
  function loadProducts() {
    return api('/api/products').then(function (data) {
      products = Array.isArray(data.products) ? data.products : [];
      renderChips();
      renderRows();
      renderCatalog();
    }).catch(function (err) {
      $('catalogGrid').innerHTML = '';
      $('catalogEmpty').hidden = false;
      $('catalogEmpty').querySelector('p').textContent = 'Không tải được sản phẩm: ' + err.message;
      toast(err.message);
    });
  }
  function loadStats() {
    api('/api/stats').then(function (d) {
      var sold = d.sold_30d != null ? d.sold_30d : (d.sold_raw && d.sold_raw.n != null ? d.sold_raw.n : 0);
      $('statsLine').innerHTML = 'Đã bán <b>' + esc(sold) + ' acc</b> &middot; <b>' +
        esc(d.total_products != null ? d.total_products : products.length) + ' sản phẩm</b>';
    }).catch(function () { $('statsLine').textContent = ''; });
  }
  function loadActivity() {
    api('/api/activity?limit=6').then(function (d) {
      var list = d.activity || [];
      $('activityList').innerHTML = list.length ? list.map(function (a) {
        return '<li><div><span class="act-name">' + esc(maskName(a.name)) + '</span>' +
          '<span class="act-desc">' + esc(a.desc || a.type || '') + '</span></div>' +
          '<time>' + esc(fmtDate(a.created_at)) + '</time></li>';
      }).join('') : '<li>Chưa có hoạt động nào.</li>';
    }).catch(function () { $('activityList').innerHTML = '<li>Không tải được hoạt động.</li>'; });
  }
  function loadLeaderboard() {
    api('/api/leaderboard').then(function (d) {
      var top = d.top || [];
      $('leaderboardList').innerHTML = top.length ? top.map(function (t) {
        return '<li><span><span class="lb-rank">' + esc(t.rank) + '</span>' +
          '<span class="lb-name">' + esc(maskName(t.name)) + '</span></span>' +
          '<span class="lb-total">' + fmtMoney(t.total) + '</span></li>';
      }).join('') : '<li>Chưa có bảng xếp hạng tháng này.</li>';
    }).catch(function () { $('leaderboardList').innerHTML = '<li>Không tải được bảng xếp hạng.</li>'; });
    if (user) {
      api('/api/leaderboard/mine').then(function (d) {
        if (d && d.rank != null) {
          $('myRank').hidden = false;
          $('myRank').innerHTML = 'Hạng của bạn: <b>#' + esc(d.rank) + '</b> — tổng chi ' + fmtMoney(d.total);
        }
      }).catch(function () {});
    } else { $('myRank').hidden = true; }
  }
  function loadTicker() {
    api('/api/notifications').then(function (d) {
      tickerItems = (d.notifications || []).map(function (n) {
        return maskName(n.buyer) + ' vừa mua ' + (n.product || 'tài khoản') +
          (n.count > 1 ? ' ×' + n.count : '') + ' — ' + fmtDate(n.created_at);
      });
      if (!tickerItems.length) { $('ticker').hidden = true; return; }
      $('ticker').hidden = false;
      tickerIdx = 0;
      $('tickerText').textContent = tickerItems[0];
      clearInterval(tickerTimer);
      tickerTimer = setInterval(function () {
        tickerIdx = (tickerIdx + 1) % tickerItems.length;
        $('tickerText').textContent = tickerItems[tickerIdx];
      }, 6000);
    }).catch(function () { $('ticker').hidden = true; });
  }

  /* ---------------- product detail ---------------- */
  function openProduct(id) {
    var p = findProduct(id);
    if (!p) return;
    detailId = p.id;
    detailQty = 1;
    renderDetail();
    openOverlay('productModal');
  }
  function renderDetail() {
    var p = findProduct(detailId);
    if (!p) return;
    var out = Number(p.stock) <= 0;
    var discount = (p.old_price && p.old_price > p.price)
      ? Math.round((1 - p.price / p.old_price) * 100) : 0;
    var low = !out && Number(p.stock) < 10;
    var related = products.filter(function (x) {
      return x.platform === p.platform && String(x.id) !== String(p.id) && x.active !== false;
    }).slice(0, 4);
    $('productDetail').innerHTML =
      '<div class="detail-platform">' + platformTile(p.platform) +
      '<span class="platform-name">' + esc(p.platform) + '</span>' +
      (p.is_hot ? '<span class="pill pill-hot">HOT</span>' : '') + '</div>' +
      '<h2 class="detail-name">' + esc(p.name) + '</h2>' +
      '<div class="card-badges"><span class="pill pill-warranty">' + esc(p.warranty || 'BH 1 đổi 1') + '</span></div>' +
      '<div class="detail-price-row"><span class="price">' + fmtMoney(p.price) + '</span>' +
        (p.old_price && p.old_price > p.price ? '<span class="old-price">' + fmtMoney(p.old_price) + '</span>' : '') +
        (discount ? '<span class="discount">-' + discount + '%</span>' : '') + '</div>' +
      '<div class="detail-meta"><span>Đã bán ' + (Number(p.sold) || 0) + '</span>' +
      '<span class="' + (low ? 'low' : '') + '">Còn ' + (Number(p.stock) || 0) + '</span>' +
      '<span>' + esc(p.warranty || 'Bảo hành 1 đổi 1') + '</span></div>' +
      (p.description ? '<p class="detail-desc">' + esc(p.description) + '</p>' : '') +
      '<div class="detail-warranty"><strong>Bảo hành 1 đổi 1</strong> — acc lỗi trong thời gian bảo hành được đổi acc khác tương đương. Đổi mật khẩu ngay sau khi nhận acc.</div>' +
      '<div class="qty-stepper"><span><strong>Số lượng</strong></span>' +
        '<button type="button" class="qty-btn" id="detailQtyMinus" aria-label="Giảm số lượng">−</button>' +
        '<span class="qty-num" id="detailQtyNum">1</span>' +
        '<button type="button" class="qty-btn" id="detailQtyPlus" aria-label="Tăng số lượng">+</button>' +
        '<span class="sheet-note">Tối đa ' + (Number(p.stock) || 0) + ' acc</span></div>' +
      '<div class="card-actions">' +
        (out
          ? '<button type="button" class="btn btn-disabled" disabled>Hết hàng</button>'
          : '<button type="button" class="btn btn-outline" id="detailAddCart">Thêm vào giỏ</button>' +
            '<button type="button" class="btn btn-primary" id="detailBuyNow">Mua ngay</button>') +
      '</div>' +
      (related.length ? '<h3 class="related-head">Cùng nền tảng ' + esc(p.platform) + '</h3><div class="related-list">' +
        related.map(function (r) {
          return '<button type="button" class="related-item" data-related-id="' + esc(r.id) + '">' +
            '<span class="rel-name">' + esc(r.name) + '</span>' +
            '<span class="rel-price">' + fmtMoney(r.price) + '</span></button>';
        }).join('') + '</div>' : '');
    var minus = $('detailQtyMinus'), plus = $('detailQtyPlus');
    if (minus) minus.addEventListener('click', function () {
      detailQty = Math.max(1, detailQty - 1);
      $('detailQtyNum').textContent = detailQty;
    });
    if (plus) plus.addEventListener('click', function () {
      var max = Number(p.stock) || 1;
      detailQty = Math.min(max, detailQty + 1);
      $('detailQtyNum').textContent = detailQty;
    });
    var addBtn = $('detailAddCart');
    if (addBtn) addBtn.addEventListener('click', function () {
      addToCart(p.id, detailQty);
      closeOverlay('productModal');
      openCart();
    });
    var buyBtn = $('detailBuyNow');
    if (buyBtn) buyBtn.addEventListener('click', function () {
      addToCart(p.id, detailQty, true);
      closeOverlay('productModal');
      openCheckout();
    });
  }

  /* card clicks: delegation (open detail, or the two card buttons) */
  ['hotRow', 'catalogGrid', 'newRow'].forEach(function (id) {
    $(id).addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (btn) {
        e.stopPropagation();
        var pid = btn.getAttribute('data-id');
        if (btn.getAttribute('data-action') === 'add-cart') { addToCart(pid, 1); toast('Đã thêm vào giỏ.'); }
        else if (btn.getAttribute('data-action') === 'buy-now') { addToCart(pid, 1, true); openCheckout(); }
        return;
      }
      var card = e.target.closest('[data-product-id]');
      if (card) openProduct(card.getAttribute('data-product-id'));
    });
  });
  $('productDetail').addEventListener('click', function (e) {
    var rel = e.target.closest('[data-related-id]');
    if (rel) openProduct(rel.getAttribute('data-related-id'));
  });

  /* ---------------- cart ---------------- */
  function cartCount() {
    return cart.reduce(function (s, i) { return s + (Number(i.qty) || 0); }, 0);
  }
  function cartTotal() {
    return cart.reduce(function (s, i) {
      var p = findProduct(i.id);
      return s + (p ? p.price * (Number(i.qty) || 0) : 0);
    }, 0);
  }
  function addToCart(id, qty, replace) {
    var p = findProduct(id);
    if (!p || Number(p.stock) <= 0) { toast('Sản phẩm đã hết hàng.'); return; }
    qty = Math.max(1, Math.min(Number(qty) || 1, Number(p.stock) || 1));
    var line = null;
    cart.forEach(function (i) { if (String(i.id) === String(id)) line = i; });
    if (line) {
      line.qty = replace ? qty : Math.min((Number(p.stock) || 1), (Number(line.qty) || 0) + qty);
    } else cart.push({ id: p.id, qty: qty });
    saveCart();
    renderCartBadge();
  }
  function renderCartBadge() {
    var n = cartCount();
    $('cartCount').textContent = n;
    $('cartCount').hidden = n === 0;
  }
  function renderCart() {
    var box = $('cartItems');
    if (!cart.length) {
      box.innerHTML = '<p class="cart-empty">Giỏ hàng đang trống.<br>Chọn tài khoản bạn thích rồi thêm vào giỏ nhé.</p>';
      $('cartSubtotal').textContent = '0đ';
      return;
    }
    box.innerHTML = cart.map(function (i) {
      var p = findProduct(i.id);
      if (!p) return '';
      return '<div class="cart-line" data-line-id="' + esc(p.id) + '">' + platformTile(p.platform) +
        '<div class="cart-line-info"><div class="cart-line-name">' + esc(p.name) + '</div>' +
        '<div class="cart-line-price">' + fmtMoney(p.price) + ' × ' + (Number(i.qty) || 0) + ' = <b>' + fmtMoney(p.price * (Number(i.qty) || 0)) + '</b></div>' +
        '<div class="qty-row">' +
          '<button type="button" class="qty-btn" data-cart="minus">−</button>' +
          '<span class="qty-num">' + (Number(i.qty) || 0) + '</span>' +
          '<button type="button" class="qty-btn" data-cart="plus">+</button>' +
          '<button type="button" class="cart-remove" data-cart="remove">Xóa</button>' +
        '</div></div></div>';
    }).join('');
    $('cartSubtotal').textContent = fmtMoney(cartTotal());
  }
  function openCart() { renderCart(); openOverlay('cartDrawer'); }
  $('cartBtn').addEventListener('click', openCart);
  $('cartItems').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-cart]');
    if (!btn) return;
    var lineEl = e.target.closest('[data-line-id]');
    if (!lineEl) return;
    var id = lineEl.getAttribute('data-line-id');
    var p = findProduct(id);
    var act = btn.getAttribute('data-cart');
    cart = cart.filter(function (i) { return String(i.id) !== String(id) || act !== 'remove' ? true : false; });
    if (act !== 'remove') {
      cart.forEach(function (i) {
        if (String(i.id) === String(id)) {
          if (act === 'plus') i.qty = Math.min(Number(p.stock) || 1, (Number(i.qty) || 0) + 1);
          if (act === 'minus') i.qty = Math.max(1, (Number(i.qty) || 0) - 1);
        }
      });
    }
    saveCart(); renderCartBadge(); renderCart();
  });
  $('continueShoppingBtn').addEventListener('click', function () { closeOverlay('cartDrawer'); });
  $('checkoutBtn').addEventListener('click', function () {
    if (!cart.length) { toast('Giỏ hàng đang trống.'); return; }
    closeOverlay('cartDrawer');
    openCheckout();
  });

  /* ---------------- checkout ---------------- */
  function renderCheckoutSummary() {
    var lines = cart.map(function (i) {
      var p = findProduct(i.id);
      if (!p) return '';
      return '<div class="sum-line"><span>' + esc(p.name) + ' × ' + (Number(i.qty) || 0) + '</span><span>' + fmtMoney(p.price * (Number(i.qty) || 0)) + '</span></div>';
    }).join('');
    $('checkoutSummary').innerHTML = lines +
      '<div class="sum-line sum-total"><span>Tổng thanh toán</span><span>' + fmtMoney(cartTotal()) + '</span></div>';
  }
  function openCheckout() {
    if (!cart.length) { toast('Giỏ hàng đang trống.'); return; }
    renderCheckoutSummary();
    $('checkoutSuccess').hidden = true;
    if (user) {
      $('checkoutAuth').hidden = true;
      $('checkoutBuyer').hidden = false;
      $('buyerName').value = user.full_name || '';
      $('buyerContact').value = user.username || '';
      $('walletBalanceInCheckout').textContent = fmtMoney(user.balance || 0);
      $('insufficientNote').hidden = !(Number(user.balance || 0) < cartTotal());
    } else {
      $('checkoutAuth').hidden = false;
      $('checkoutBuyer').hidden = true;
      setAuthTab('login', 'checkout');
    }
    openOverlay('checkoutSheet');
  }
  function setAuthTab(tab, scope) {
    var loginForm, regForm, tabLogin, tabReg;
    if (scope === 'checkout') {
      loginForm = $('loginForm'); regForm = $('registerForm');
      tabLogin = $('tabLogin'); tabReg = $('tabRegister');
    } else {
      loginForm = $('standaloneLoginForm'); regForm = $('standaloneRegisterForm');
      tabLogin = null; tabReg = null;
    }
    var isLogin = tab === 'login';
    loginForm.hidden = !isLogin;
    regForm.hidden = isLogin;
    if (tabLogin) { tabLogin.classList.toggle('active', isLogin); tabReg.classList.toggle('active', !isLogin); }
    document.querySelectorAll('[data-auth-tab][data-auth-scope="standalone"]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-auth-tab') === tab);
    });
  }
  document.querySelectorAll('[data-auth-tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      setAuthTab(b.getAttribute('data-auth-tab'), b.getAttribute('data-auth-scope') === 'standalone' ? 'standalone' : 'checkout');
    });
  });

  function handleAuthSuccess(data) {
    token = data.token || '';
    user = data.user || null;
    if (token) localStorage.setItem(TOKEN_KEY, token);
    renderAuthState();
    closeOverlay('authSheet');
    toast('Xin chào, ' + (user && user.full_name ? user.full_name : 'bạn') + '!');
    if (!$('checkoutSheet').hidden) { openCheckout(); return; }
    if (pendingAfterLogin === 'wallet') { pendingAfterLogin = null; openWallet(); return; }
    if (pendingAfterLogin === 'orders') { pendingAfterLogin = null; openOrders(); return; }
    pendingAfterLogin = null;
  }
  function doLogin(username, password) {
    return api('/api/login', { method: 'POST', body: { username: username, password: password } });
  }
  function doRegister(fullName, username, password) {
    return api('/api/register', { method: 'POST', body: { full_name: fullName, username: username, password: password } });
  }
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    doLogin($('loginUsername').value.trim(), $('loginPassword').value)
      .then(handleAuthSuccess).catch(function (err) { toast(err.message); });
  });
  $('registerForm').addEventListener('submit', function (e) {
    e.preventDefault();
    doRegister($('regFullName').value.trim(), $('regUsername').value.trim(), $('regPassword').value)
      .then(handleAuthSuccess).catch(function (err) { toast(err.message); });
  });
  $('standaloneLoginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    doLogin($('standaloneLoginUsername').value.trim(), $('standaloneLoginPassword').value)
      .then(handleAuthSuccess).catch(function (err) { toast(err.message); });
  });
  $('standaloneRegisterForm').addEventListener('submit', function (e) {
    e.preventDefault();
    doRegister($('standaloneRegFullName').value.trim(), $('standaloneRegUsername').value.trim(), $('standaloneRegPassword').value)
      .then(handleAuthSuccess).catch(function (err) { toast(err.message); });
  });
  $('googleSignupBtn').addEventListener('click', function (e) {
    e.preventDefault();
    toast('Đăng nhập bằng Google chưa được bật.');
  });

  $('placeOrderBtn').addEventListener('click', function () {
    if (!user) { toast('Vui lòng đăng nhập để đặt hàng.'); return; }
    var buyerName = $('buyerName').value.trim();
    var contact = $('buyerContact').value.trim();
    if (!buyerName || !contact) { toast('Vui lòng nhập họ tên và liên hệ.'); return; }
    var payMethod = (document.querySelector('input[name="payMethod"]:checked') || {}).value || 'wallet';
    if (payMethod === 'wallet' && Number(user.balance || 0) < cartTotal()) {
      toast('Số dư ví không đủ, vui lòng nạp thêm.');
      return;
    }
    var items = cart.map(function (i) { return { product_id: i.id, qty: Number(i.qty) || 1 }; });
    api('/api/orders', {
      method: 'POST',
      body: { items: items, buyer_name: buyerName, contact: contact, pay_method: payMethod }
    }).then(function (data) {
      cart = [];
      saveCart(); renderCartBadge();
      $('checkoutBuyer').hidden = true;
      $('checkoutAuth').hidden = true;
      $('checkoutSuccess').hidden = false;
      $('successOrderCode').textContent = data.code || '—';
      $('successOrderMsg').textContent = data.message || '';
      refreshMe();
      loadStats(); loadActivity();
    }).catch(function (err) { toast(err.message); });
  });
  $('viewMyOrderBtn').addEventListener('click', function () {
    closeOverlay('checkoutSheet');
    openOrders();
  });
  $('successContinueBtn').addEventListener('click', function () { closeOverlay('checkoutSheet'); });

  /* ---------------- wallet ---------------- */
  function openWallet() {
    if (!user) {
      pendingAfterLogin = 'wallet';
      setAuthTab('login', 'standalone');
      openOverlay('authSheet');
      toast('Đăng nhập để nạp tiền vào ví.');
      return;
    }
    $('depositResult').hidden = true;
    $('checkDepositMsg').textContent = '';
    loadWallet();
    loadApiStatus();
    openOverlay('walletSheet');
  }
  function loadWallet() {
    api('/api/wallet').then(function (d) {
      $('walletBalance').textContent = fmtMoney(d.balance || 0);
      if (user) user.balance = d.balance || 0;
      var list = d.deposits || [];
      $('depositHistory').innerHTML = list.length ? list.map(function (dep) {
        return '<li><div><strong>' + esc(dep.code) + '</strong> — ' + fmtMoney(dep.amount) + '<br>' +
          '<span class="sheet-note">' + esc(dep.method || '') + ' · ' + esc(fmtDate(dep.created_at)) + '</span></div>' +
          '<span class="status status-' + esc(String(dep.status || '').toLowerCase()) + '">' + esc(dep.status || '') + '</span></li>';
      }).join('') : '<li>Chưa có giao dịch nạp nào.</li>';
    }).catch(function (err) { toast(err.message); });
  }
  function loadApiStatus() {
    api('/api/api-status').then(function (d) {
      $('apiStatus').textContent = d.connected
        ? 'Cổng nạp ' + (d.gateway || '') + ' đang kết nối — kiểm tra giao dịch tự động.'
        : 'Cổng nạp chưa kết nối — giao dịch được xác nhận thủ công.';
    }).catch(function () { $('apiStatus').textContent = ''; });
  }
  $('topupBtn').addEventListener('click', openWallet);
  $('topupFromCheckout').addEventListener('click', function () {
    closeOverlay('checkoutSheet');
    openWallet();
  });
  $('quickAmounts').addEventListener('click', function (e) {
    var b = e.target.closest('[data-amount]');
    if (!b) return;
    $('depositAmount').value = b.getAttribute('data-amount');
    document.querySelectorAll('#quickAmounts button').forEach(function (x) { x.classList.remove('active'); });
    b.classList.add('active');
  });
  $('depositMethod').addEventListener('change', function () {
    $('cardFields').hidden = $('depositMethod').value !== 'card';
  });
  $('depositForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var amount = Number($('depositAmount').value);
    if (!amount || amount < 10000) { toast('Số tiền nạp tối thiểu là 10.000đ.'); return; }
    var method = $('depositMethod').value;
    var body = { amount: amount, method: method };
    if (method === 'card') {
      body.card_carrier = $('cardCarrier').value;
      body.card_serial = $('cardSerial').value.trim();
      body.card_code = $('cardCode').value.trim();
      if (!body.card_serial || !body.card_code) { toast('Vui lòng nhập đủ seri và mã thẻ.'); return; }
    }
    api('/api/deposits', { method: 'POST', body: body }).then(function (data) {
      currentDepositCode = data.code;
      $('depositResult').hidden = false;
      $('depositCode').textContent = data.code || '—';
      $('depositAmountShow').textContent = fmtMoney(data.amount || amount);
      $('checkDepositMsg').textContent = data.message || '';
      loadReceivingInfo(method);
      loadWallet();
    }).catch(function (err) { toast(err.message); });
  });
  function loadReceivingInfo(method) {
    api('/api/receiving-info').then(function (d) {
      var html = '';
      if (method === 'momo' && d.momo) html = 'MoMo: <strong>' + esc(d.momo) + '</strong><br>Nội dung: <strong>' + esc(currentDepositCode || '') + '</strong>';
      else if (method === 'zalopay' && d.zalopay) html = 'ZaloPay: <strong>' + esc(d.zalopay) + '</strong><br>Nội dung: <strong>' + esc(currentDepositCode || '') + '</strong>';
      else if (method === 'card') html = 'Thẻ cào đã được ghi nhận. Shop sẽ kiểm tra và cộng tiền vào ví khi thẻ hợp lệ.';
      else html = 'Ngân hàng: <strong>' + esc(d.bank_name || '') + '</strong><br>Số tài khoản: <strong>' + esc(d.account_number || '') + '</strong><br>Chủ tài khoản: <strong>' + esc(d.account_holder || '') + '</strong><br>Nội dung chuyển khoản: <strong>' + esc(currentDepositCode || '') + '</strong>';
      $('receivingBox').innerHTML = html;
    }).catch(function () {
      $('receivingBox').innerHTML = 'Chuyển khoản với nội dung: <strong>' + esc(currentDepositCode || '') + '</strong>';
    });
  }
  $('checkDepositBtn').addEventListener('click', function () {
    if (!currentDepositCode) { toast('Chưa có mã nạp để kiểm tra.'); return; }
    api('/api/deposits/' + encodeURIComponent(currentDepositCode) + '/check-api', { method: 'POST' })
      .then(function (d) {
        $('checkDepositMsg').textContent = d.message || 'Đã kiểm tra xong.';
        toast(d.message || 'Đã kiểm tra xong.');
        loadWallet();
      })
      .catch(function (err) {
        $('checkDepositMsg').textContent = err.message;
        toast(err.message);
      });
  });

  /* ---------------- orders ---------------- */
  function orderItemsText(order) {
    var items = order.items;
    if (!items && order.items_json) {
      try { items = JSON.parse(order.items_json); } catch (e) { items = null; }
    }
    if (Array.isArray(items)) {
      return items.map(function (it) {
        var p = it.product_id ? findProduct(it.product_id) : null;
        var name = it.name || (p ? p.name : 'Sản phẩm #' + (it.product_id || ''));
        return esc(name) + ' × ' + (Number(it.qty) || 1);
      }).join('<br>');
    }
    return esc(order.items_json || '');
  }
  function orderCardHtml(order) {
    return '<div class="order-card"><div class="order-card-head"><code>' + esc(order.code) + '</code>' +
      '<span class="status status-' + esc(String(order.status || '').toLowerCase()) + '">' + esc(order.status || '') + '</span></div>' +
      '<div class="order-items">' + orderItemsText(order) + '</div>' +
      '<div>Tổng: <strong class="money">' + fmtMoney(order.total) + '</strong> · <time>' + esc(fmtDate(order.created_at)) + '</time></div></div>';
  }
  function openOrders() {
    if (!user) {
      pendingAfterLogin = 'orders';
      setAuthTab('login', 'standalone');
      openOverlay('authSheet');
      toast('Đăng nhập để xem đơn của bạn.');
      return;
    }
    $('myOrdersList').innerHTML = '<p class="sheet-note">Đang tải đơn hàng…</p>';
    openOverlay('ordersSheet');
    api('/api/orders/mine').then(function (d) {
      var list = d.orders || [];
      $('myOrdersList').innerHTML = list.length
        ? list.map(orderCardHtml).join('')
        : '<p class="sheet-note">Bạn chưa có đơn hàng nào.</p>';
    }).catch(function (err) {
      $('myOrdersList').innerHTML = '<p class="sheet-note">' + esc(err.message) + '</p>';
    });
  }
  $('lookupForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var code = $('lookupCode').value.trim();
    var contact = $('lookupContact').value.trim();
    if (!code || !contact) { toast('Nhập đủ mã đơn và liên hệ.'); return; }
    $('lookupResult').hidden = false;
    $('lookupResult').innerHTML = '<p class="sheet-note">Đang tra cứu…</p>';
    api('/api/orders/lookup', { method: 'POST', body: { code: code, contact: contact } })
      .then(function (d) {
        $('lookupResult').innerHTML = orderCardHtml(d.order);
        document.querySelector('.lookup-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
      })
      .catch(function (err) {
        $('lookupResult').innerHTML = '<p class="sheet-note">' + esc(err.message) + '</p>';
      });
  });

  /* ---------------- account menu / auth state ---------------- */
  function renderAuthState() {
    if (user) {
      $('authBtn').hidden = true;
      $('accountWrap').hidden = false;
      $('avatarInitial').textContent = String(user.full_name || user.username || '?').trim().charAt(0).toUpperCase();
      $('menuFullName').textContent = user.full_name || user.username || '';
      $('menuBalance').textContent = fmtMoney(user.balance || 0);
      $('menuAdmin').hidden = !user.is_owner;
    } else {
      $('authBtn').hidden = false;
      $('accountWrap').hidden = true;
      $('accountMenu').hidden = true;
      $('menuAdmin').hidden = true;
    }
  }
  $('authBtn').addEventListener('click', function () {
    setAuthTab('login', 'standalone');
    openOverlay('authSheet');
  });
  $('accountBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    $('accountMenu').hidden = !$('accountMenu').hidden;
  });
  document.addEventListener('click', function (e) {
    if (!$('accountMenu').hidden && !e.target.closest('#accountWrap')) $('accountMenu').hidden = true;
  });
  $('accountMenu').addEventListener('click', function (e) {
    var item = e.target.closest('[data-menu]');
    if (!item) return;
    var action = item.getAttribute('data-menu');
    $('accountMenu').hidden = true;
    if (action === 'wallet') openWallet();
    else if (action === 'orders') openOrders();
    else if (action === 'rename') {
      $('renameInput').value = user ? (user.full_name || '') : '';
      openOverlay('renameSheet');
    } else if (action === 'admin') openAdmin();
    else if (action === 'logout') {
      api('/api/logout', { method: 'POST' }).catch(function () {});
      token = ''; user = null;
      localStorage.removeItem(TOKEN_KEY);
      renderAuthState();
      loadLeaderboard();
      toast('Đã đăng xuất.');
    }
  });
  $('renameForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('renameInput').value.trim();
    if (!name) { toast('Vui lòng nhập tên mới.'); return; }
    api('/api/me/rename', { method: 'POST', body: { full_name: name } })
      .then(function () {
        user.full_name = name;
        renderAuthState();
        closeOverlay('renameSheet');
        toast('Đã đổi tên thành công.');
      })
      .catch(function (err) { toast(err.message); });
  });
  function refreshMe() {
    if (!token) return Promise.resolve();
    return api('/api/me').then(function (d) {
      user = d.user || null;
      renderAuthState();
    }).catch(function () {
      token = ''; user = null;
      localStorage.removeItem(TOKEN_KEY);
      renderAuthState();
    });
  }

  /* ---------------- search / chips / sort / filter ---------------- */
  $('searchInput').addEventListener('input', function () {
    searchQuery = $('searchInput').value;
    $('searchClear').hidden = !searchQuery;
    visibleCount = PAGE_SIZE;
    renderCatalog();
  });
  $('searchClear').addEventListener('click', function () {
    $('searchInput').value = '';
    searchQuery = '';
    $('searchClear').hidden = true;
    visibleCount = PAGE_SIZE;
    renderCatalog();
    $('searchInput').focus();
  });
  $('chipRail').addEventListener('click', function (e) {
    var chip = e.target.closest('[data-platform]');
    if (!chip) return;
    platformFilter = chip.getAttribute('data-platform');
    visibleCount = PAGE_SIZE;
    renderChips();
    renderCatalog();
  });
  $('sortSelect').addEventListener('change', function () {
    sortMode = $('sortSelect').value;
    visibleCount = PAGE_SIZE;
    renderCatalog();
  });
  $('filterBtn').addEventListener('click', function () {
    $('filterInStock').checked = filterOpts.inStock;
    $('filterHot').checked = filterOpts.hotOnly;
    $('filterMin').value = filterOpts.min != null ? filterOpts.min : '';
    $('filterMax').value = filterOpts.max != null ? filterOpts.max : '';
    openOverlay('filterSheet');
  });
  $('applyFilterBtn').addEventListener('click', function () {
    filterOpts.inStock = $('filterInStock').checked;
    filterOpts.hotOnly = $('filterHot').checked;
    var min = Number($('filterMin').value);
    var max = Number($('filterMax').value);
    filterOpts.min = $('filterMin').value === '' || isNaN(min) ? null : min;
    filterOpts.max = $('filterMax').value === '' || isNaN(max) ? null : max;
    visibleCount = PAGE_SIZE;
    closeOverlay('filterSheet');
    renderCatalog();
  });
  $('resetFilterBtn').addEventListener('click', function () {
    filterOpts = { inStock: false, hotOnly: false, min: null, max: null };
    $('filterInStock').checked = false;
    $('filterHot').checked = false;
    $('filterMin').value = '';
    $('filterMax').value = '';
    visibleCount = PAGE_SIZE;
    closeOverlay('filterSheet');
    renderCatalog();
  });
  $('clearFiltersBtn').addEventListener('click', function () {
    searchQuery = '';
    $('searchInput').value = '';
    $('searchClear').hidden = true;
    platformFilter = 'Tất cả';
    filterOpts = { inStock: false, hotOnly: false, min: null, max: null };
    visibleCount = PAGE_SIZE;
    renderChips();
    renderCatalog();
  });
  $('loadMoreBtn').addEventListener('click', function () {
    visibleCount += PAGE_SIZE;
    renderCatalog();
  });
  $('brandHome').addEventListener('click', function (e) {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ---------------- bot ---------------- */
  function botSay(text, who) {
    var div = document.createElement('div');
    div.className = 'bot-msg ' + who;
    div.textContent = text;
    $('botMessages').appendChild(div);
    $('botMessages').scrollTop = $('botMessages').scrollHeight;
  }
  function botSend(message) {
    message = (message || '').trim();
    if (!message) return;
    botSay(message, 'user');
    api('/api/bot', { method: 'POST', body: { message: message } })
      .then(function (d) { botSay(d.reply || 'Shop sẽ trả lời bạn sớm.', 'bot'); })
      .catch(function (err) { botSay(err.message, 'bot'); });
  }
  $('botBtn').addEventListener('click', function () {
    var panel = $('botPanel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) $('botInput').focus();
  });
  $('botForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('botInput').value;
    $('botInput').value = '';
    botSend(v);
  });
  $('botChips').addEventListener('click', function (e) {
    var chip = e.target.closest('[data-chip]');
    if (chip) botSend(chip.getAttribute('data-chip'));
  });

  /* ---------------- footer + policy ---------------- */
  var POLICIES = {
    'policy-warranty': ['Chính sách bảo hành', 'Tất cả tài khoản đều được bảo hành 1 đổi 1 trong thời gian ghi trên từng sản phẩm. Acc lỗi đăng nhập hoặc bị khóa trong thời gian bảo hành sẽ được đổi acc khác tương đương. Bạn nên đổi mật khẩu và thông tin ngay sau khi nhận acc.'],
    'policy-refund': ['Đổi trả', 'Acc không dùng được ngay từ đầu được đổi mới trong thời gian bảo hành. Acc đã dùng bình thường sau khi đổi thông tin thì không áp dụng đổi trả. Tiền nạp vào ví không hoàn lại, chỉ dùng để mua tài khoản trên shop.'],
    'policy-privacy': ['Bảo mật thông tin', 'Shop chỉ dùng họ tên và liên hệ của bạn để giao tài khoản và hỗ trợ đơn hàng, không chia sẻ cho bên thứ ba. Mật khẩu tài khoản của bạn được lưu an toàn, đừng chia sẻ mật khẩu cho bất kỳ ai.']
  };
  document.querySelectorAll('[data-footer]').forEach(function (b) {
    b.addEventListener('click', function () {
      var key = b.getAttribute('data-footer');
      if (key === 'lookup') {
        document.querySelector('.lookup-section').scrollIntoView({ behavior: 'smooth' });
        $('lookupCode').focus();
      } else if (key === 'bot') {
        $('botPanel').hidden = false;
        $('botInput').focus();
      } else if (key === 'wallet') openWallet();
      else if (POLICIES[key]) {
        $('policyTitle').textContent = POLICIES[key][0];
        $('policyBody').innerHTML = '<p class="sheet-note">' + esc(POLICIES[key][1]) + '</p>';
        openOverlay('policySheet');
      }
    });
  });

  /* ---------------- admin ---------------- */
  function openAdmin() {
    if (!user || !user.is_owner) { toast('Bạn không có quyền quản lý shop.'); return; }
    openOverlay('adminPanel');
    loadAdminOverview();
    loadAdminProducts();
    loadAdminOrders();
    loadAdminDeposits();
    loadAdminSettings();
  }
  function loadAdminOverview() {
    api('/api/admin/overview').then(function (d) {
      $('adminOverview').innerHTML =
        '<div class="admin-stat"><strong>' + esc(d.pending_deposits != null ? d.pending_deposits : 0) + '</strong><span>Nạp chờ duyệt</span></div>' +
        '<div class="admin-stat"><strong>' + esc(d.total_orders != null ? d.total_orders : 0) + '</strong><span>Tổng đơn</span></div>' +
        '<div class="admin-stat"><strong>' + fmtMoney(d.revenue || 0) + '</strong><span>Doanh thu</span></div>';
    }).catch(function (err) { $('adminOverview').innerHTML = '<p class="sheet-note">' + esc(err.message) + '</p>'; });
  }
  function loadAdminProducts() {
    api('/api/admin/products').then(function (d) {
      var list = d.products || [];
      $('adminProductsTable').innerHTML = '<tr><th>Sản phẩm</th><th>Giá</th><th>Kho</th><th>Đã bán</th><th>Trạng thái</th><th></th></tr>' +
        list.map(function (p) {
          return '<tr><td><strong>' + esc(p.name) + '</strong><br><span class="sheet-note">' + esc(p.platform) + '</span></td>' +
            '<td>' + fmtMoney(p.price) + '</td><td>' + esc(p.stock) + '</td><td>' + esc(p.sold || 0) + '</td>' +
            '<td>' + (p.active === false ? 'Ẩn' : 'Đang bán') + (p.is_hot ? ' · HOT' : '') + '</td>' +
            '<td><button type="button" class="btn btn-outline" data-admin-edit="' + esc(p.id) + '">Sửa</button>' +
            '<button type="button" class="btn btn-outline" data-admin-del="' + esc(p.id) + '">Xóa</button></td></tr>';
        }).join('');
    }).catch(function (err) { toast(err.message); });
  }
  function loadAdminOrders() {
    api('/api/admin/orders').then(function (d) {
      var list = d.orders || [];
      $('adminOrdersTable').innerHTML = '<tr><th>Mã đơn</th><th>Tổng</th><th>Ngày</th><th>Trạng thái</th></tr>' +
        list.map(function (o) {
          return '<tr><td><code>' + esc(o.code) + '</code></td><td>' + fmtMoney(o.total) + '</td>' +
            '<td>' + esc(fmtDate(o.created_at)) + '</td>' +
            '<td><select data-order-status="' + esc(o.code) + '">' +
              ['pending', 'paid', 'delivered', 'cancelled'].map(function (s) {
                return '<option value="' + s + '"' + (o.status === s ? ' selected' : '') + '>' + s + '</option>';
              }).join('') + '</select></td></tr>';
        }).join('');
    }).catch(function (err) { toast(err.message); });
  }
  function loadAdminDeposits() {
    api('/api/admin/deposits').then(function (d) {
      var list = d.deposits || [];
      $('adminDepositsTable').innerHTML = '<tr><th>Mã nạp</th><th>Số tiền</th><th>Phương thức</th><th>Trạng thái</th><th></th></tr>' +
        list.map(function (dep) {
          return '<tr><td><code>' + esc(dep.code) + '</code></td><td>' + fmtMoney(dep.amount) + '</td>' +
            '<td>' + esc(dep.method || '') + '</td>' +
            '<td><span class="status status-' + esc(String(dep.status || '').toLowerCase()) + '">' + esc(dep.status || '') + '</span></td>' +
            '<td>' + (String(dep.status).toLowerCase() === 'pending'
              ? '<button type="button" class="btn btn-primary" data-deposit-confirm="' + esc(dep.code) + '">Xác nhận</button>' : '') + '</td></tr>';
        }).join('');
    }).catch(function (err) { toast(err.message); });
  }
  function loadAdminSettings() {
    api('/api/admin/settings').then(function (d) {
      var s = d.settings || d;
      $('setBankName').value = s.bank_name || '';
      $('setBankBin').value = s.bank_bin || '';
      $('setAccountNumber').value = s.account_number || '';
      $('setAccountHolder').value = s.account_holder || '';
      $('setMomo').value = s.momo || '';
      $('setZalopay').value = s.zalopay || '';
      $('setGateway').value = s.gateway || '';
      $('setApiKey').value = s.api_key || '';
    }).catch(function () {});
  }
  document.querySelectorAll('[data-admin-tab]').forEach(function (b) {
    b.addEventListener('click', function () {
      var tab = b.getAttribute('data-admin-tab');
      document.querySelectorAll('[data-admin-tab]').forEach(function (x) { x.classList.toggle('active', x === b); });
      $('adminTabProducts').hidden = tab !== 'products';
      $('adminTabOrders').hidden = tab !== 'orders';
      $('adminTabDeposits').hidden = tab !== 'deposits';
      $('adminTabSettings').hidden = tab !== 'settings';
    });
  });
  $('adminProductForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var id = $('adminProductId').value;
    var body = {
      platform: $('adminProductPlatform').value.trim(),
      name: $('adminProductName').value.trim(),
      price: Number($('adminProductPrice').value),
      old_price: $('adminProductOldPrice').value === '' ? null : Number($('adminProductOldPrice').value),
      stock: Number($('adminProductStock').value),
      warranty: $('adminProductWarranty').value.trim(),
      is_hot: $('adminProductHot').checked,
      active: $('adminProductActive').checked,
      description: $('adminProductDesc').value.trim()
    };
    var req = id
      ? api('/api/admin/products/' + encodeURIComponent(id), { method: 'PUT', body: body })
      : api('/api/admin/products', { method: 'POST', body: body });
    req.then(function () {
      toast(id ? 'Đã cập nhật sản phẩm.' : 'Đã thêm sản phẩm.');
      resetAdminProductForm();
      loadAdminProducts();
      loadProducts();
    }).catch(function (err) { toast(err.message); });
  });
  function resetAdminProductForm() {
    $('adminProductForm').reset();
    $('adminProductId').value = '';
    $('adminProductActive').checked = true;
    $('adminProductSubmit').textContent = 'Thêm sản phẩm';
    $('adminProductCancelEdit').hidden = true;
  }
  $('adminProductCancelEdit').addEventListener('click', resetAdminProductForm);
  $('adminProductsTable').addEventListener('click', function (e) {
    var editBtn = e.target.closest('[data-admin-edit]');
    var delBtn = e.target.closest('[data-admin-del]');
    if (editBtn) {
      var p = findProduct(editBtn.getAttribute('data-admin-edit'));
      if (!p) return;
      $('adminProductId').value = p.id;
      $('adminProductPlatform').value = p.platform || '';
      $('adminProductName').value = p.name || '';
      $('adminProductPrice').value = p.price || 0;
      $('adminProductOldPrice').value = p.old_price || '';
      $('adminProductStock').value = p.stock || 0;
      $('adminProductWarranty').value = p.warranty || '';
      $('adminProductHot').checked = !!p.is_hot;
      $('adminProductActive').checked = p.active !== false;
      $('adminProductDesc').value = p.description || '';
      $('adminProductSubmit').textContent = 'Lưu thay đổi';
      $('adminProductCancelEdit').hidden = false;
      $('adminProductForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (delBtn) {
      var id = delBtn.getAttribute('data-admin-del');
      if (!window.confirm('Xóa sản phẩm này?')) return;
      api('/api/admin/products/' + encodeURIComponent(id), { method: 'DELETE' })
        .then(function () { toast('Đã xóa sản phẩm.'); loadAdminProducts(); loadProducts(); })
        .catch(function (err) { toast(err.message); });
    }
  });
  $('adminOrdersTable').addEventListener('change', function (e) {
    var sel = e.target.closest('[data-order-status]');
    if (!sel) return;
    api('/api/admin/orders/' + encodeURIComponent(sel.getAttribute('data-order-status')) + '/status',
      { method: 'PUT', body: { status: sel.value } })
      .then(function () { toast('Đã đổi trạng thái đơn.'); loadAdminOverview(); })
      .catch(function (err) { toast(err.message); loadAdminOrders(); });
  });
  $('adminDepositsTable').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-deposit-confirm]');
    if (!btn) return;
    api('/api/admin/deposits/' + encodeURIComponent(btn.getAttribute('data-deposit-confirm')) + '/confirm', { method: 'POST' })
      .then(function () { toast('Đã xác nhận nạp tiền.'); loadAdminDeposits(); loadAdminOverview(); })
      .catch(function (err) { toast(err.message); });
  });
  $('adminSettingsForm').addEventListener('submit', function (e) {
    e.preventDefault();
    api('/api/admin/settings', {
      method: 'POST',
      body: {
        bank_name: $('setBankName').value.trim(),
        bank_bin: $('setBankBin').value.trim(),
        account_number: $('setAccountNumber').value.trim(),
        account_holder: $('setAccountHolder').value.trim(),
        momo: $('setMomo').value.trim(),
        zalopay: $('setZalopay').value.trim(),
        gateway: $('setGateway').value.trim(),
        api_key: $('setApiKey').value.trim()
      }
    }).then(function () { toast('Đã lưu cài đặt.'); })
      .catch(function (err) { toast(err.message); });
  });

  /* ---------------- boot ---------------- */
  renderCartBadge();
  renderAuthState();
  loadProducts();
  loadStats();
  loadActivity();
  loadLeaderboard();
  loadTicker();
  if (token) {
    refreshMe().then(function () { loadLeaderboard(); });
  }
})();
