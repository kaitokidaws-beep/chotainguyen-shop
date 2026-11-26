/* Chợ Tài Nguyên Mmo — rebuilt from competitor research (RESEARCH.md).
   Structure: category sections of dense product rows (MCV / mmonhalam model).
   No hero banner, no rails. The deal lives ON the first product row. */
(function () {
  'use strict';

  /* ---------------- helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return (Number(n) || 0).toLocaleString('vi-VN') + 'đ'; }
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  }
  function timeAgo(ms) {
    var d = Date.now() - Number(ms || 0);
    if (d < 60000) return 'vừa xong';
    if (d < 3600000) return Math.floor(d / 60000) + ' phút trước';
    if (d < 86400000) return Math.floor(d / 3600000) + ' giờ trước';
    return Math.floor(d / 86400000) + ' ngày trước';
  }
  function discount(p) {
    if (!p.old_price || p.old_price <= p.price) return 0;
    return Math.round((1 - p.price / p.old_price) * 100);
  }
  var toastTO = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTO);
    toastTO = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* ---------------- state ---------------- */
  var TOKEN_KEY = 'ctn_token';   /* same key as v49-v51: live sessions survive */
  var CART_KEY = 'ctn_cart';
  var PLATFORMS = ['Facebook', 'TikTok', 'Instagram', 'YouTube', 'Telegram', 'Gmail', 'X', 'Zalo'];
  var PLAT_COLOR = {
    Facebook: '#1877f2', TikTok: '#0f172a', Instagram: '#e1306c', YouTube: '#ff0000',
    Telegram: '#229ed9', Gmail: '#ea4335', X: '#0f172a', Zalo: '#0068ff'
  };
  var PLAT_DESC = {
    Facebook: 'Clone, Page, Via — hàng bán chạy nhất shop',
    TikTok: 'Follow, acc cổ — live đủ điều kiện',
    Instagram: 'Follow thật, clone US',
    YouTube: 'Kênh sub — đủ điều kiện bật kiếm tiền',
    Telegram: 'Premium — kích hoạt nhanh',
    Gmail: 'Email gốc — dùng được ngay',
    X: 'Acc cổ — email gốc, 2FA',
    Zalo: 'Acc cổ — bạn bè đầy, tương tác thật'
  };
  var products = [];
  var user = null;
  var token = localStorage.getItem(TOKEN_KEY) || '';
  var cart = loadCart();
  var platformFilter = 'Tất cả';
  var searchQuery = '';
  var sortMode = 'best';
  var filterOpts = { inStock: false, hotOnly: false, min: null, max: null };
  var statsData = null;
  var notifications = [];
  var tickerIdx = 0;
  var tickerTimer = null;
  var detailProduct = null;
  var detailQty = 1;
  var checkoutItems = [];
  var depositMethod = 'bank';
  var depositCode = '';
  var currentAdminTab = 'overview';

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
  var OVERLAY_IDS = ['productSheet', 'cartDrawer', 'checkoutSheet', 'authSheet', 'walletSheet',
    'ordersSheet', 'renameSheet', 'filterSheet', 'adminPanel'];
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
    $(id).addEventListener('click', function (e) { if (e.target === $(id)) closeOverlay(id); });
  });
  document.addEventListener('click', function (e) {
    var closer = e.target.closest('[data-close]');
    if (closer) { var ov = closer.closest('.overlay'); if (ov) closeOverlay(ov.id); }
  });

  /* ---------------- boot / load ---------------- */
  function productById(id) {
    for (var i = 0; i < products.length; i++) if (products[i].id === id) return products[i];
    return null;
  }
  function bestDeal() {
    var best = null, bestPct = 0;
    products.forEach(function (p) {
      if (!p.active || p.stock <= 0) return;
      var d = discount(p);
      if (d > bestPct || (d === bestPct && best && p.sold > best.sold)) { best = p; bestPct = d; }
    });
    return best;
  }
  function refreshMe() {
    if (!token) { setLoggedOut(); return Promise.resolve(); }
    return api('/api/me').then(function (d) {
      user = d.user || null;
      setLoggedIn();
      return api('/api/wallet').then(function (w) {
        if (user) user.balance = w.balance;
        renderHeaderAuth();
      }).catch(function () {});
    }).catch(function () {
      token = ''; localStorage.removeItem(TOKEN_KEY); user = null; setLoggedOut();
    });
  }
  function setLoggedIn() { renderHeaderAuth(); }
  function setLoggedOut() { user = null; renderHeaderAuth(); }
  function renderHeaderAuth() {
    var logged = !!user;
    $('authBtn').hidden = logged;
    $('accountWrap').hidden = !logged;
    $('walletChip').hidden = !logged;
    $('topupBtn').hidden = logged;
    if (logged) {
      $('avatarInitial').textContent = (user.full_name || user.username || '?').trim().charAt(0).toUpperCase();
      $('menuFullName').textContent = user.full_name || user.username;
      $('menuBalance').textContent = fmt(user.balance || 0);
      $('walletBalance').textContent = fmt(user.balance || 0);
      $('menuAdmin').hidden = !user.is_owner;
    }
    renderCartBadge();
  }
  function loadAll() {
    return api('/api/products').then(function (d) {
      products = (d.products || []).filter(function (p) { return p.active; });
      renderChips();
      renderCatalog();
    }).catch(function () {
      $('catalog').innerHTML = '<p class="empty-state">Không tải được danh sách sản phẩm. Tải lại trang thử nhé.</p>';
    }).then(function () {
      api('/api/stats').then(function (s) {
        statsData = s;
        $('statsLine').innerHTML = 'Đã bán <strong>' + (s.sold_30d || 0) + ' acc</strong> · <strong>' +
          (s.total_products || products.length) + ' sản phẩm</strong> · Giao tự động 24/7 · Bảo hành 1 đổi 1';
      }).catch(function () {});
      api('/api/notifications').then(function (d) {
        notifications = d.notifications || [];
        startTicker();
      }).catch(function () {});
      api('/api/activity').then(function (d) { renderActivity(d.activity || []); }).catch(function () {});
      api('/api/leaderboard').then(function (d) { renderLeaderboard(d.top || []); }).catch(function () {});
      if (token) {
        api('/api/leaderboard/mine').then(function (d) {
          if (d && d.rank) $('myRank').hidden = false, $('myRank').textContent = 'Hạng của bạn: #' + d.rank + ' — tổng nạp ' + fmt(d.total || 0);
        }).catch(function () {});
      }
      return refreshMe();
    });
  }
  function startTicker() {
    if (!notifications.length) return;
    $('ticker').hidden = false;
    tickerIdx = 0;
    var show = function () {
      var n = notifications[tickerIdx % notifications.length];
      $('tickerText').innerHTML = '<b>' + esc(n.buyer || 'Khách') + '</b> vừa mua ' + esc(n.product || '') + ' · ' + timeAgo(n.created_at);
      tickerIdx++;
    };
    show();
    clearInterval(tickerTimer);
    tickerTimer = setInterval(show, 4000);
  }
  function renderActivity(list) {
    $('activityList').innerHTML = list.slice(0, 8).map(function (a) {
      var amt = a.amount == null ? '' : '<span class="amt ' + (a.amount < 0 ? 'neg' : 'pos') + '">' + (a.amount < 0 ? '−' : '+') + fmt(Math.abs(a.amount)) + '</span>';
      return '<li><span><b>' + esc(a.name || 'Khách') + '</b> — ' + esc(a.desc || '') + '</span>' + amt + '</li>';
    }).join('') || '<li>Chưa có hoạt động nào.</li>';
  }
  function renderLeaderboard(top) {
    $('leaderboardList').innerHTML = top.slice(0, 20).map(function (t) {
      return '<li><span class="rank">' + t.rank + '</span><span class="lb-name">' + esc(t.name) + '</span><span class="lb-total">' + fmt(t.total) + '</span></li>';
    }).join('') || '<li>Chưa có dữ liệu nạp tiền.</li>';
  }

  /* ---------------- catalog ---------------- */
  function platformCounts() {
    var counts = {};
    products.forEach(function (p) { counts[p.platform] = (counts[p.platform] || 0) + 1; });
    return counts;
  }
  function renderChips() {
    var counts = platformCounts();
    var html = '<button type="button" class="chip' + (platformFilter === 'Tất cả' ? ' active' : '') +
      '" data-platform="Tất cả">Tất cả <span class="n">(' + products.length + ')</span></button>';
    PLATFORMS.forEach(function (pl) {
      if (!counts[pl]) return;
      html += '<button type="button" class="chip' + (platformFilter === pl ? ' active' : '') +
        '" data-platform="' + esc(pl) + '">' + esc(pl) + ' <span class="n">(' + counts[pl] + ')</span></button>';
    });
    $('catNav').innerHTML = html;
  }
  function filterActive() {
    return searchQuery !== '' || platformFilter !== 'Tất cả' || sortMode !== 'best' ||
      filterOpts.inStock || filterOpts.hotOnly || filterOpts.min != null || filterOpts.max != null;
  }
  function applyFilters(list) {
    var q = norm(searchQuery);
    return list.filter(function (p) {
      if (q && norm(p.name + ' ' + p.platform + ' ' + (p.description || '')).indexOf(q) === -1) return false;
      if (platformFilter !== 'Tất cả' && p.platform !== platformFilter) return false;
      if (filterOpts.inStock && p.stock <= 0) return false;
      if (filterOpts.hotOnly && !p.is_hot) return false;
      if (filterOpts.min != null && p.price < filterOpts.min) return false;
      if (filterOpts.max != null && p.price > filterOpts.max) return false;
      return true;
    });
  }
  function sortRows(list) {
    var arr = list.slice();
    if (sortMode === 'low') arr.sort(function (a, b) { return a.price - b.price; });
    else if (sortMode === 'high') arr.sort(function (a, b) { return b.price - a.price; });
    else if (sortMode === 'new') arr.sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
    else if (sortMode === 'discount') arr.sort(function (a, b) { return discount(b) - discount(a) || b.sold - a.sold; });
    else arr.sort(function (a, b) { return b.sold - a.sold || a.id - b.id; });
    return arr;
  }
  function rowHtml(p, isDeal) {
    var d = discount(p);
    var out = p.stock <= 0;
    var color = PLAT_COLOR[p.platform] || '#0284c7';
    return '<article class="prow' + (isDeal ? ' prow-deal' : '') + '" data-open-detail="' + p.id + '">' +
      '<div class="prow-main">' +
        '<div class="prow-top">' +
          '<span class="plat-tag"><span class="plat-dot" style="background:' + color + '"></span>' + esc(p.platform) + '</span>' +
          (isDeal ? '<span class="badge-deal">🔥 GIẢM MẠNH NHẤT</span>' : '') +
          (p.is_hot && !isDeal ? '<span class="badge-hot">HOT</span>' : '') +
        '</div>' +
        '<h3 class="prow-name">' + esc(p.name) + '</h3>' +
        '<p class="prow-spec">' + esc(p.warranty || '') + (p.description ? ' · ' + esc(p.description) : '') + '</p>' +
        '<p class="prow-meta">' + (out ? '<span class="out">Tạm hết hàng</span>' : 'Còn <b>' + p.stock + '</b>') +
          ' · Đã bán <b>' + p.sold + '</b></p>' +
      '</div>' +
      '<div class="prow-side">' +
        (d ? '<span class="prow-old">' + fmt(p.old_price) + '</span>' : '') +
        '<span class="prow-price">' + fmt(p.price) + '</span>' +
        (d ? '<span class="prow-pct">−' + d + '%</span>' : '') +
        '<button type="button" class="btn-buy" data-act="buy" data-id="' + p.id + '"' + (out ? ' disabled' : '') + '>Mua ngay</button>' +
        '<button type="button" class="btn-addcart" data-act="add" data-id="' + p.id + '"' + (out ? ' disabled' : '') + '>＋ Giỏ</button>' +
      '</div>' +
    '</article>';
  }
  function renderCatalog() {
    var filtered = applyFilters(products);
    var flat = filterActive();
    $('resultCount').textContent = 'Có ' + filtered.length + ' sản phẩm';
    $('filterDot').hidden = !(filterOpts.inStock || filterOpts.hotOnly || filterOpts.min != null || filterOpts.max != null);
    $('catalogEmpty').hidden = filtered.length > 0;
    if (!filtered.length) { $('catalog').innerHTML = ''; return; }

    if (flat) {
      var rows = sortRows(filtered);
      $('catalog').innerHTML = '<section class="cat-sec flat"><div class="rows">' +
        rows.map(function (p) { return rowHtml(p, false); }).join('') + '</div></section>';
      return;
    }

    /* Default view: category sections (MCV model). First section = the platform
       of the best-deal product; the deal is the FIRST ROW of that section. */
    var deal = bestDeal();
    var groups = {};
    filtered.forEach(function (p) { (groups[p.platform] = groups[p.platform] || []).push(p); });
    var plats = Object.keys(groups).sort(function (a, b) {
      if (deal && a === deal.platform && b !== deal.platform) return -1;
      if (deal && b === deal.platform && a !== deal.platform) return 1;
      var soldA = groups[a].reduce(function (s, p) { return s + p.sold; }, 0);
      var soldB = groups[b].reduce(function (s, p) { return s + p.sold; }, 0);
      if (soldB !== soldA) return soldB - soldA;
      if (groups[b].length !== groups[a].length) return groups[b].length - groups[a].length;
      return a.localeCompare(b);
    });
    var html = plats.map(function (pl) {
      var rows = groups[pl].slice().sort(function (a, b) {
        if (deal && a.id === deal.id) return -1;
        if (deal && b.id === deal.id) return 1;
        return b.sold - a.sold || a.id - b.id;
      });
      var sold = rows.reduce(function (s, p) { return s + p.sold; }, 0);
      return '<section class="cat-sec">' +
        '<header class="cat-head"><h2>' + esc(pl) + '<span class="cat-count">' + rows.length + ' sản phẩm</span></h2>' +
        '<p class="cat-sub">' + esc(PLAT_DESC[pl] || '') + ' — Đã bán ' + sold + ' acc</p></header>' +
        '<div class="rows">' + rows.map(function (p) { return rowHtml(p, deal && p.id === deal.id); }).join('') + '</div>' +
      '</section>';
    }).join('');
    $('catalog').innerHTML = html;
  }

  /* ---------------- product detail ---------------- */
  function openDetail(id) {
    var p = productById(id);
    if (!p) return;
    detailProduct = p;
    detailQty = 1;
    renderDetail();
    openOverlay('productSheet');
  }
  function renderDetail() {
    var p = detailProduct;
    if (!p) return;
    var d = discount(p);
    var out = p.stock <= 0;
    var same = products.filter(function (x) { return x.platform === p.platform && x.id !== p.id; }).slice(0, 4);
    var deal = bestDeal();
    $('productDetail').innerHTML =
      '<div class="detail-top">' +
        '<span class="plat-tag"><span class="plat-dot" style="background:' + (PLAT_COLOR[p.platform] || '#0284c7') + '"></span>' + esc(p.platform) + '</span>' +
        ((deal && p.id === deal.id) ? '<span class="badge-deal">🔥 GIẢM MẠNH NHẤT</span>' : '') +
        (p.is_hot ? '<span class="badge-hot">HOT</span>' : '') +
      '</div>' +
      '<h3 style="margin:6px 0 4px;font-size:18px">' + esc(p.name) + '</h3>' +
      '<div><span class="detail-price">' + fmt(p.price) + '</span> ' +
        (d ? '<span class="detail-old">' + fmt(p.old_price) + '</span> <span class="prow-pct">−' + d + '%</span>' : '') + '</div>' +
      '<p class="detail-stock">' + (out ? 'Tạm hết hàng' : 'Còn ' + p.stock + ' tài khoản') + ' · Đã bán ' + p.sold + '</p>' +
      '<table class="spec-table">' +
        '<tr><td>Nền tảng</td><td><b>' + esc(p.platform) + '</b></td></tr>' +
        '<tr><td>Bảo hành</td><td>' + esc(p.warranty || '—') + '</td></tr>' +
        '<tr><td>Mô tả</td><td>' + esc(p.description || '—') + '</td></tr>' +
        '<tr><td>Giao hàng</td><td>Tự động 24/7 sau khi thanh toán</td></tr>' +
      '</table>' +
      '<div class="qty-stepper"><button type="button" id="detailMinus" aria-label="Giảm số lượng">−</button><b id="detailQtyNum">1</b><button type="button" id="detailPlus" aria-label="Tăng số lượng">+</button></div>' +
      '<div class="detail-actions">' +
        '<button type="button" class="btn btn-outline" id="detailAdd" ' + (out ? 'disabled' : '') + '>Thêm vào giỏ</button>' +
        '<button type="button" class="btn btn-primary" id="detailBuy" ' + (out ? 'disabled' : '') + '>Mua ngay — ' + fmt(p.price) + '</button>' +
      '</div>' +
      (same.length ? '<div class="mini-rows"><h3 class="sub-head">Cùng nền tảng ' + esc(p.platform) + '</h3>' +
        same.map(function (x) {
          return '<button type="button" class="mini-row" data-open-detail="' + x.id + '"><span>' + esc(x.name) + '<br><small style="color:#64748b;font-weight:400">Còn ' + x.stock + ' · Đã bán ' + x.sold + '</small></span><span>' + fmt(x.price) + '</span></button>';
        }).join('') + '</div>' : '');
    $('detailMinus').addEventListener('click', function () { if (detailQty > 1) { detailQty--; $('detailQtyNum').textContent = detailQty; } });
    $('detailPlus').addEventListener('click', function () { if (detailQty < p.stock) { detailQty++; $('detailQtyNum').textContent = detailQty; } else toast('Chỉ còn ' + p.stock + ' tài khoản.'); });
    $('detailAdd').addEventListener('click', function () { addToCart(p.id, detailQty, true); });
    $('detailBuy').addEventListener('click', function () { closeOverlay('productSheet'); startCheckout([{ product_id: p.id, qty: detailQty }]); });
  }

  /* ---------------- cart ---------------- */
  function cartCount() { return cart.reduce(function (s, i) { return s + (i.qty || 0); }, 0); }
  function cartTotal() {
    return cart.reduce(function (s, i) {
      var p = productById(i.id);
      return s + (p ? p.price * (i.qty || 0) : 0);
    }, 0);
  }
  function renderCartBadge() {
    var n = cartCount();
    $('cartCount').hidden = n === 0;
    $('cartCount').textContent = n;
  }
  function addToCart(id, qty, openDrawer) {
    var p = productById(id);
    if (!p) return;
    var line = cart.find(function (i) { return i.id === id; });
    var cur = line ? line.qty : 0;
    if (cur + qty > p.stock) { toast('Chỉ còn ' + p.stock + ' tài khoản.'); return; }
    if (line) line.qty += qty; else cart.push({ id: id, qty: qty });
    saveCart();
    renderCartBadge();
    if (openDrawer) { renderCart(); openOverlay('cartDrawer'); }
    toast('Đã thêm vào giỏ.');
  }
  function renderCart() {
    if (!cart.length) {
      $('cartItems').innerHTML = '<p style="color:#64748b">Giỏ hàng đang trống. Chọn sản phẩm ở danh sách bên trên nhé.</p>';
      $('cartSubtotal').textContent = fmt(0);
      $('checkoutBtn').disabled = true;
      return;
    }
    $('checkoutBtn').disabled = false;
    $('cartItems').innerHTML = cart.map(function (i) {
      var p = productById(i.id);
      if (!p) return '';
      return '<div class="cart-line">' +
        '<div class="cart-line-info"><b>' + esc(p.name) + '</b><span>' + fmt(p.price) + ' × ' + i.qty + '</span>' +
        '<br><span class="qty-stepper"><button type="button" data-cart-dec="' + p.id + '">−</button><b>' + i.qty + '</b><button type="button" data-cart-inc="' + p.id + '">+</button></span>' +
        '<br><button type="button" class="cart-line-remove" data-cart-del="' + p.id + '">Xóa</button></div>' +
        '<span class="cart-line-price">' + fmt(p.price * i.qty) + '</span></div>';
    }).join('');
    $('cartSubtotal').textContent = fmt(cartTotal());
  }

  /* ---------------- checkout ---------------- */
  function startCheckout(items) {
    checkoutItems = items;
    $('checkoutDone').hidden = true;
    $('checkoutForm').hidden = true;
    $('checkoutAuth').hidden = true;
    var lines = items.map(function (it) {
      var p = productById(it.product_id);
      if (!p) return '';
      return '<div class="sum-line"><span>' + esc(p.name) + ' × ' + it.qty + '</span><span>' + fmt(p.price * it.qty) + '</span></div>';
    }).join('');
    var total = items.reduce(function (s, it) {
      var p = productById(it.product_id);
      return s + (p ? p.price * it.qty : 0);
    }, 0);
    $('checkoutSummary').innerHTML = lines + '<div class="sum-total"><span>Tổng thanh toán</span><span>' + fmt(total) + '</span></div>';
    openOverlay('checkoutSheet');
    showCheckoutForm();
  }
  function showCheckoutForm() {
    if (!user) {
      $('checkoutAuth').hidden = false;
      $('checkoutForm').hidden = true;
      return;
    }
    $('checkoutAuth').hidden = true;
    $('checkoutForm').hidden = false;
    $('buyerName').value = user.full_name || '';
    if (!$('buyerContact').value) $('buyerContact').value = '';
    $('checkoutBalance').textContent = fmt(user.balance || 0);
    updateWalletShort();
  }
  function checkoutTotal() {
    return checkoutItems.reduce(function (s, it) {
      var p = productById(it.product_id);
      return s + (p ? p.price * it.qty : 0);
    }, 0);
  }
  function updateWalletShort() {
    var payWallet = document.querySelector('input[name="payMethod"]:checked').value === 'wallet';
    $('walletShort').hidden = !(payWallet && user && (user.balance || 0) < checkoutTotal());
  }
  function placeOrder() {
    var buyer = $('buyerName').value.trim();
    var contact = $('buyerContact').value.trim();
    if (!buyer) { toast('Nhập họ tên người mua.'); return; }
    if (!contact) { toast('Nhập SĐT / email để shop gửi tài khoản.'); return; }
    var payMethod = document.querySelector('input[name="payMethod"]:checked').value;
    if (payMethod === 'wallet' && (user.balance || 0) < checkoutTotal()) {
      toast('Số dư không đủ. Nạp thêm tiền rồi đặt lại.');
      return;
    }
    var btn = $('placeOrderBtn');
    btn.disabled = true;
    api('/api/orders', {
      method: 'POST',
      body: { items: checkoutItems, buyer_name: buyer, contact: contact, pay_method: payMethod }
    }).then(function (d) {
      $('checkoutForm').hidden = true;
      $('checkoutAuth').hidden = true;
      $('checkoutDone').hidden = false;
      $('checkoutDone').innerHTML =
        '<p style="font-size:18px;font-weight:800;color:#16a34a">✅ Đặt hàng thành công!</p>' +
        '<p>Mã đơn của bạn: <b style="font-size:18px">' + esc(d.code) + '</b></p>' +
        '<p>Tổng: <b>' + fmt(d.total) + '</b> — ' + esc(d.message || '') + '</p>' +
        '<p style="color:#64748b;font-size:13px">Lưu mã đơn này để tra cứu. Tài khoản sẽ được gửi theo liên hệ bạn đã nhập.</p>' +
        '<button type="button" class="btn btn-outline btn-block" id="copyCodeBtn">Sao chép mã đơn</button>' +
        '<button type="button" class="btn btn-primary btn-block" id="doneCloseBtn" style="margin-top:8px">Xong</button>';
      $('copyCodeBtn').addEventListener('click', function () {
        if (navigator.clipboard) navigator.clipboard.writeText(d.code).then(function () { toast('Đã sao chép mã đơn.'); });
        else toast('Mã đơn: ' + d.code);
      });
      $('doneCloseBtn').addEventListener('click', function () { closeAllOverlays(); });
      cart = cart.filter(function (i) {
        return !checkoutItems.some(function (it) { return it.product_id === i.id; });
      });
      saveCart(); renderCartBadge();
      api('/api/products').then(function (r) {
        products = (r.products || []).filter(function (p) { return p.active; });
        renderChips(); renderCatalog();
      }).catch(function () {});
      refreshMe();
    }).catch(function (err) { toast(err.message); })
      .finally(function () { btn.disabled = false; });
  }

  /* ---------------- auth ---------------- */
  function setAuthTab(tab, scope) {
    var prefix = scope === 'checkout' ? 'co' : '';
    var loginForm = $(prefix + (scope === 'checkout' ? 'LoginForm' : 'loginForm'));
    var regForm = $(prefix + (scope === 'checkout' ? 'RegisterForm' : 'registerForm'));
    document.querySelectorAll('#' + (scope === 'checkout' ? 'checkoutSheet' : 'authSheet') + ' .auth-tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-auth-tab') === tab);
    });
    loginForm.hidden = tab !== 'login';
    regForm.hidden = tab !== 'register';
    if (scope !== 'checkout') $('authTitle').textContent = tab === 'login' ? 'Đăng nhập' : 'Đăng ký';
  }
  function afterAuth(d) {
    token = d.token || '';
    localStorage.setItem(TOKEN_KEY, token);
    user = d.user || null;
    renderHeaderAuth();
    closeOverlay('authSheet');
    if (!$('checkoutSheet').hidden) showCheckoutForm();
    toast('Chào ' + (user.full_name || user.username) + '!');
    if (d.is_owner) toast('Bạn là chủ shop.');
    refreshMe();
  }
  function doLogin(username, password) {
    return api('/api/login', { method: 'POST', body: { username: username, password: password } })
      .then(afterAuth)
      .catch(function (err) { toast(err.message); throw err; });
  }
  function doRegister(fullName, username, password) {
    return api('/api/register', { method: 'POST', body: { full_name: fullName, username: username, password: password } })
      .then(afterAuth)
      .catch(function (err) { toast(err.message); throw err; });
  }
  function logout() {
    api('/api/logout', { method: 'POST' }).catch(function () {});
    token = ''; localStorage.removeItem(TOKEN_KEY); user = null;
    $('accountMenu').hidden = true;
    setLoggedOut();
    toast('Đã đăng xuất.');
  }

  /* ---------------- wallet ---------------- */
  var METHODS = [
    { id: 'bank', label: 'Ngân hàng' },
    { id: 'momo', label: 'MoMo' },
    { id: 'zalopay', label: 'ZaloPay' },
    { id: 'card', label: 'Thẻ cào' }
  ];
  function renderWallet() {
    if (!user) { openOverlay('authSheet'); setAuthTab('login'); return; }
    $('walletSheetBalance').textContent = fmt(user.balance || 0);
    $('quickAmounts').innerHTML = [20000, 50000, 100000, 200000, 500000, 1000000].map(function (a) {
      return '<button type="button" class="chip" data-amount="' + a + '">' + fmt(a) + '</button>';
    }).join('');
    $('methodTabs').innerHTML = METHODS.map(function (m) {
      return '<button type="button" class="method-tab' + (depositMethod === m.id ? ' active' : '') + '" data-method="' + m.id + '">' + m.label + '</button>';
    }).join('');
    $('cardFields').hidden = depositMethod !== 'card';
    $('depositResult').hidden = true;
    api('/api/receiving-info').then(function (info) {
      var lines = [];
      if (depositMethod === 'bank') {
        if (info.bank_name) lines.push('Ngân hàng: ' + info.bank_name);
        if (info.account_number) lines.push('Số tài khoản: ' + info.account_number);
        if (info.account_holder) lines.push('Chủ tài khoản: ' + info.account_holder);
      }
      if (depositMethod === 'momo' && info.momo) lines.push('MoMo: ' + info.momo);
      if (depositMethod === 'zalopay' && info.zalopay) lines.push('ZaloPay: ' + info.zalopay);
      if (depositMethod === 'card') lines.push('Nhập đúng seri + mã thẻ. Chủ shop xác nhận thẻ rồi cộng tiền.');
      $('receivingBox').textContent = lines.length
        ? 'Chuyển tiền đến:\n' + lines.join('\n') + (depositMethod !== 'card' ? '\nNội dung: mã NAP… hiện sau khi tạo yêu cầu.' : '')
        : 'Shop chưa cập nhật thông tin nhận tiền cho phương thức này.';
    }).catch(function () { $('receivingBox').textContent = 'Không tải được thông tin nhận tiền.'; });
    api('/api/wallet').then(function (w) {
      if (user) user.balance = w.balance;
      renderHeaderAuth();
      $('depositList').innerHTML = (w.deposits || []).map(function (dep) {
        var ok = dep.status === 'verified';
        return '<li><b>' + esc(dep.code) + '</b> — ' + fmt(dep.amount) + ' — ' + esc(dep.method) +
          ' <span class="st ' + (ok ? 'ok' : 'wait') + '">' + (ok ? 'Đã cộng' : 'Chờ xác minh') + '</span>' +
          (dep.created_at ? ' · ' + timeAgo(dep.created_at) : '') + '</li>';
      }).join('') || '<li>Chưa có lịch sử nạp tiền.</li>';
    }).catch(function () {});
    openOverlay('walletSheet');
  }
  function createDeposit() {
    var amount = Math.round(Number($('depositAmount').value) || 0);
    if (!amount || amount < 10000) { toast('Số tiền nạp tối thiểu 10.000đ.'); return; }
    var body = { amount: amount, method: depositMethod };
    if (depositMethod === 'card') {
      body.card_carrier = $('cardCarrier').value;
      body.card_serial = $('cardSerial').value.trim();
      body.card_code = $('cardCode').value.trim();
      if (!body.card_serial || !body.card_code) { toast('Nhập đủ seri và mã thẻ.'); return; }
    }
    api('/api/deposits', { method: 'POST', body: body }).then(function (d) {
      depositCode = d.code;
      var res = $('depositResult');
      res.hidden = false;
      res.innerHTML =
        '<p><b>Mã nạp tiền: ' + esc(d.code) + '</b> — Số tiền: <b>' + fmt(amount) + '</b></p><p>' + esc(d.message || '') + '</p>' +
        (depositMethod !== 'card'
          ? '<button type="button" class="btn btn-primary btn-block" id="checkApiBtn">Tôi đã chuyển khoản — Kiểm tra giao dịch</button>'
          : '<p style="color:#64748b;font-size:13px">Chủ shop sẽ xác nhận thẻ và cộng tiền.</p>');
      var checkBtn = $('checkApiBtn');
      if (checkBtn) checkBtn.addEventListener('click', function () {
        checkBtn.disabled = true;
        api('/api/deposits/' + encodeURIComponent(depositCode) + '/check-api', { method: 'POST' })
          .then(function (r) { toast(r.message || 'Đã kiểm tra.'); renderWallet(); })
          .catch(function (err) { toast(err.message); checkBtn.disabled = false; });
      });
      renderWalletRefresh();
    }).catch(function (err) { toast(err.message); });
  }
  function renderWalletRefresh() {
    api('/api/wallet').then(function (w) {
      if (user) user.balance = w.balance;
      renderHeaderAuth();
      $('walletSheetBalance').textContent = fmt(w.balance || 0);
    }).catch(function () {});
  }

  /* ---------------- orders + lookup ---------------- */
  function renderMyOrders() {
    if (!user) { openOverlay('authSheet'); setAuthTab('login'); return; }
    api('/api/orders/mine').then(function (d) {
      $('myOrdersList').innerHTML = (d.orders || []).map(function (o) {
        var items = (o.items || []).map(function (i) { return esc(i.name) + ' × ' + i.qty; }).join(', ');
        return '<li><b>' + esc(o.code) + '</b> <span class="st ' + (o.status === 'paid' ? 'paid' : o.status === 'cancelled' ? 'cancelled' : 'pending') + '">' +
          (o.status === 'paid' ? 'Đã thanh toán' : o.status === 'cancelled' ? 'Đã hủy' : 'Chờ thanh toán') + '</span><br>' +
          '<span style="color:#64748b">' + items + '</span><br>Tổng: <b>' + fmt(o.total) + '</b> · ' + timeAgo(o.created_at) + '</li>';
      }).join('') || '<li>Bạn chưa có đơn hàng nào.</li>';
    }).catch(function (err) { toast(err.message); });
    openOverlay('ordersSheet');
  }
  function orderResultHtml(o) {
    var items = (o.items || []).map(function (i) { return esc(i.name) + ' × ' + i.qty; }).join(', ');
    var st = o.status === 'paid' ? '<span class="ok">Đã thanh toán</span>' : '<span class="pend">Chờ thanh toán</span>';
    return '<p><b>' + esc(o.code) + '</b> — ' + st + '</p><p>' + items + '</p><p>Tổng: <b>' + fmt(o.total) + '</b></p>';
  }

  /* ---------------- admin ---------------- */
  var SETTING_LABELS = {
    recv_bank_name: 'Tên ngân hàng nhận tiền',
    recv_bank_bin: 'Mã BIN ngân hàng (6 số)',
    recv_account_number: 'Số tài khoản nhận tiền',
    recv_account_holder: 'Chủ tài khoản',
    recv_momo: 'Số MoMo nhận tiền',
    recv_zalopay: 'Số ZaloPay nhận tiền',
    api_gateway: 'Cổng API nạp tiền (sepay / casso)',
    api_connected: 'API đã kết nối (true/false)'
  };
  function openAdmin(tab) {
    if (!user || !user.is_owner) { toast('Chỉ chủ shop mới vào được mục này.'); return; }
    currentAdminTab = tab || 'overview';
    renderAdminTab();
    openOverlay('adminPanel');
  }
  function renderAdminTab() {
    document.querySelectorAll('.admin-tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-admin-tab') === currentAdminTab);
    });
    var box = $('adminContent');
    if (currentAdminTab === 'overview') {
      box.innerHTML = '<p class="admin-note">Đang tải…</p>';
      api('/api/admin/overview').then(function (d) {
        box.innerHTML = '<div class="admin-stats">' +
          '<div class="admin-stat"><strong>' + fmt(d.revenue || 0) + '</strong><span>Doanh thu</span></div>' +
          '<div class="admin-stat"><strong>' + (d.total_orders || 0) + '</strong><span>Tổng đơn</span></div>' +
          '<div class="admin-stat"><strong>' + (d.pending_deposits || 0) + '</strong><span>Nạp chờ duyệt</span></div></div>' +
          '<p class="admin-note">Sản phẩm đang bán: ' + products.length + '. Dùng tab Sản phẩm để sửa giá/tồn kho.</p>';
      }).catch(function (err) { box.innerHTML = '<p>' + esc(err.message) + '</p>'; });
    } else if (currentAdminTab === 'products') {
      api('/api/admin/products').then(function (d) {
        var rows = (d.products || []).map(function (p) {
          return '<tr><td><b>' + esc(p.name) + '</b><br><small>' + esc(p.platform) + '</small></td>' +
            '<td><input type="number" value="' + p.price + '" data-admin-price="' + p.id + '"></td>' +
            '<td><input type="number" value="' + p.stock + '" data-admin-stock="' + p.id + '"></td>' +
            '<td><select data-admin-active="' + p.id + '"><option value="1"' + (p.active ? ' selected' : '') + '>Bán</option><option value="0"' + (!p.active ? ' selected' : '') + '>Ẩn</option></select></td>' +
            '<td><button type="button" class="btn btn-primary" data-admin-save="' + p.id + '">Lưu</button></td></tr>';
        }).join('');
        box.innerHTML = '<table class="admin-table"><thead><tr><th>Sản phẩm</th><th>Giá</th><th>Tồn kho</th><th>Trạng thái</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' +
          '<h3 class="sub-head">Thêm sản phẩm mới</h3>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<label class="field"><span>Tên sản phẩm</span><input type="text" id="newProdName"></label>' +
          '<label class="field"><span>Nền tảng</span><select id="newProdPlatform">' + PLATFORMS.map(function (pl) { return '<option>' + pl + '</option>'; }).join('') + '</select></label>' +
          '<label class="field"><span>Giá bán</span><input type="number" id="newProdPrice"></label>' +
          '<label class="field"><span>Tồn kho</span><input type="number" id="newProdStock" value="10"></label>' +
          '<label class="field"><span>Giá gốc (để trống nếu không giảm)</span><input type="number" id="newProdOld"></label>' +
          '<label class="field"><span>Bảo hành</span><input type="text" id="newProdWarranty" value="Bảo hành 1 đổi 1 trong 7 ngày"></label></div>' +
          '<label class="field"><span>Mô tả</span><input type="text" id="newProdDesc"></label>' +
          '<button type="button" class="btn btn-primary" id="addProductBtn">Thêm sản phẩm</button>';
        $('addProductBtn').addEventListener('click', function () {
          var body = {
            name: $('newProdName').value.trim(),
            platform: $('newProdPlatform').value,
            price: Number($('newProdPrice').value) || 0,
            stock: Number($('newProdStock').value) || 0,
            old_price: Number($('newProdOld').value) || null,
            warranty: $('newProdWarranty').value.trim(),
            description: $('newProdDesc').value.trim()
          };
          if (!body.name || !body.price) { toast('Nhập tên và giá sản phẩm.'); return; }
          api('/api/admin/products', { method: 'POST', body: body }).then(function () {
            toast('Đã thêm sản phẩm.'); renderAdminTab(); loadAll();
          }).catch(function (err) { toast(err.message); });
        });
      }).catch(function (err) { box.innerHTML = '<p>' + esc(err.message) + '</p>'; });
    } else if (currentAdminTab === 'orders') {
      api('/api/admin/orders').then(function (d) {
        var rows = (d.orders || []).map(function (o) {
          var items = (o.items || []).map(function (i) { return esc(i.name) + ' × ' + i.qty; }).join(', ');
          return '<tr><td><b>' + esc(o.code) + '</b><br><small>' + esc(o.buyer_name || '') + ' · ' + esc(o.contact || '') + '</small><br><small>' + items + '</small></td>' +
            '<td>' + fmt(o.total) + '</td>' +
            '<td><select data-admin-order="' + esc(o.code) + '"><option value="pending"' + (o.status === 'pending' ? ' selected' : '') + '>Chờ thanh toán</option><option value="paid"' + (o.status === 'paid' ? ' selected' : '') + '>Đã thanh toán</option><option value="cancelled"' + (o.status === 'cancelled' ? ' selected' : '') + '>Đã hủy</option></select></td>' +
            '<td><button type="button" class="btn btn-primary" data-admin-order-save="' + esc(o.code) + '">Lưu</button></td></tr>';
        }).join('');
        box.innerHTML = '<table class="admin-table"><thead><tr><th>Đơn</th><th>Tổng</th><th>Trạng thái</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
      }).catch(function (err) { box.innerHTML = '<p>' + esc(err.message) + '</p>'; });
    } else if (currentAdminTab === 'deposits') {
      api('/api/admin/deposits').then(function (d) {
        var rows = (d.deposits || []).map(function (dep) {
          return '<tr><td><b>' + esc(dep.code) + '</b><br><small>' + esc(dep.method) + ' · ' + timeAgo(dep.created_at) + '</small></td>' +
            '<td>' + fmt(dep.amount) + '</td><td>' + esc(dep.status) + '</td>' +
            '<td>' + (dep.status === 'pending' ? '<button type="button" class="btn btn-primary" data-deposit-confirm="' + esc(dep.code) + '">Cộng tiền</button>' : '—') + '</td></tr>';
        }).join('');
        box.innerHTML = '<table class="admin-table"><thead><tr><th>Mã nạp</th><th>Số tiền</th><th>Trạng thái</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
      }).catch(function (err) { box.innerHTML = '<p>' + esc(err.message) + '</p>'; });
    } else if (currentAdminTab === 'settings') {
      api('/api/admin/settings').then(function (d) {
        var fields = Object.keys(d).map(function (k) {
          return '<label class="field"><span>' + esc(SETTING_LABELS[k] || k) + '</span><input type="text" data-setting="' + k + '" value="' + esc(String(d[k])) + '"></label>';
        }).join('');
        box.innerHTML = fields + '<button type="button" class="btn btn-primary" id="saveSettingsBtn">Lưu cài đặt</button>' +
          '<p class="admin-note">Lưu xong, mục Nạp tiền sẽ hiện đúng thông tin nhận tiền cho khách.</p>';
        $('saveSettingsBtn').addEventListener('click', function () {
          var body = {};
          document.querySelectorAll('[data-setting]').forEach(function (inp) { body[inp.getAttribute('data-setting')] = inp.value; });
          api('/api/admin/settings', { method: 'POST', body: body }).then(function () { toast('Đã lưu cài đặt.'); }).catch(function (err) { toast(err.message); });
        });
      }).catch(function (err) { box.innerHTML = '<p>' + esc(err.message) + '</p>'; });
    }
  }

  /* ---------------- bot ---------------- */
  function botSay(text, who) {
    var box = $('botMessages');
    var div = document.createElement('div');
    div.className = 'bot-msg ' + who;
    div.textContent = text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }
  function botAsk(msg) {
    if (!msg.trim()) return;
    botSay(msg, 'me');
    api('/api/bot', { method: 'POST', body: { message: msg } })
      .then(function (d) { botSay(d.reply || 'Shop sẽ trả lời bạn ngay.', 'bot'); })
      .catch(function () { botSay('Mạng lỗi, thử lại sau nhé.', 'bot'); });
  }
  function openBot() {
    $('botPanel').hidden = false;
    document.body.style.overflow = 'hidden';
    if (!$('botMessages').children.length) {
      botSay('Chào bạn! Mình là bot hỗ trợ 24/7. Hỏi giá, nạp tiền, bảo hành hay tra đơn đều được nhé.', 'bot');
      $('botChips').innerHTML = ['Giá rẻ nhất là bao nhiêu?', 'Nạp tiền như thế nào?', 'Bảo hành ra sao?', 'Tra cứu đơn bằng gì?'].map(function (c) {
        return '<button type="button" class="bot-chip">' + esc(c) + '</button>';
      }).join('');
    }
    $('botInput').focus();
  }

  /* ---------------- events ---------------- */
  $('catNav').addEventListener('click', function (e) {
    var chip = e.target.closest('[data-platform]');
    if (!chip) return;
    platformFilter = chip.getAttribute('data-platform');
    renderChips();
    renderCatalog();
  });
  $('searchInput').addEventListener('input', function () {
    searchQuery = $('searchInput').value.trim();
    $('searchClear').hidden = !searchQuery;
    renderCatalog();
  });
  $('searchClear').addEventListener('click', function () {
    $('searchInput').value = ''; searchQuery = ''; $('searchClear').hidden = true; renderCatalog();
  });
  $('sortSelect').addEventListener('change', function () { sortMode = $('sortSelect').value; renderCatalog(); });
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
    filterOpts.min = $('filterMin').value ? Number($('filterMin').value) : null;
    filterOpts.max = $('filterMax').value ? Number($('filterMax').value) : null;
    closeOverlay('filterSheet');
    renderCatalog();
  });
  $('resetFilterBtn').addEventListener('click', function () {
    filterOpts = { inStock: false, hotOnly: false, min: null, max: null };
    closeOverlay('filterSheet');
    renderCatalog();
  });
  $('clearFiltersBtn').addEventListener('click', function () {
    searchQuery = ''; $('searchInput').value = ''; $('searchClear').hidden = true;
    platformFilter = 'Tất cả'; sortMode = 'best'; $('sortSelect').value = 'best';
    filterOpts = { inStock: false, hotOnly: false, min: null, max: null };
    renderChips(); renderCatalog();
  });

  document.addEventListener('click', function (e) {
    var actEl = e.target.closest('[data-act]');
    if (actEl) {
      e.stopPropagation();
      var id = Number(actEl.getAttribute('data-id'));
      if (actEl.getAttribute('data-act') === 'buy') startCheckout([{ product_id: id, qty: 1 }]);
      if (actEl.getAttribute('data-act') === 'add') addToCart(id, 1, true);
      return;
    }
    var dec = e.target.closest('[data-cart-dec]');
    if (dec) {
      var id1 = Number(dec.getAttribute('data-cart-dec'));
      var line1 = cart.find(function (i) { return i.id === id1; });
      if (line1) { line1.qty--; if (line1.qty <= 0) cart = cart.filter(function (i) { return i.id !== id1; }); saveCart(); renderCartBadge(); renderCart(); }
      return;
    }
    var inc = e.target.closest('[data-cart-inc]');
    if (inc) {
      var id2 = Number(inc.getAttribute('data-cart-inc'));
      var line2 = cart.find(function (i) { return i.id === id2; });
      var p2 = productById(id2);
      if (line2 && p2) { if (line2.qty < p2.stock) { line2.qty++; saveCart(); renderCartBadge(); renderCart(); } else toast('Chỉ còn ' + p2.stock + ' tài khoản.'); }
      return;
    }
    var del = e.target.closest('[data-cart-del]');
    if (del) {
      var id3 = Number(del.getAttribute('data-cart-del'));
      cart = cart.filter(function (i) { return i.id !== id3; });
      saveCart(); renderCartBadge(); renderCart();
      return;
    }
    var det = e.target.closest('[data-open-detail]');
    if (det) { openDetail(Number(det.getAttribute('data-open-detail'))); return; }
    var menuBtn = e.target.closest('[data-menu]');
    if (menuBtn) {
      var action = menuBtn.getAttribute('data-menu');
      $('accountMenu').hidden = true;
      if (action === 'wallet') renderWallet();
      else if (action === 'orders') renderMyOrders();
      else if (action === 'rename') { $('renameInput').value = user ? user.full_name : ''; openOverlay('renameSheet'); }
      else if (action === 'admin') openAdmin('overview');
      else if (action === 'logout') logout();
      return;
    }
    var adminTab = e.target.closest('[data-admin-tab]');
    if (adminTab) { currentAdminTab = adminTab.getAttribute('data-admin-tab'); renderAdminTab(); return; }
    var saveProd = e.target.closest('[data-admin-save]');
    if (saveProd) {
      var pid = Number(saveProd.getAttribute('data-admin-save'));
      var price = document.querySelector('[data-admin-price="' + pid + '"]');
      var stock = document.querySelector('[data-admin-stock="' + pid + '"]');
      var act = document.querySelector('[data-admin-active="' + pid + '"]');
      api('/api/admin/products/' + pid, {
        method: 'PUT',
        body: { price: Number(price.value), stock: Number(stock.value), active: Number(act.value) }
      }).then(function () { toast('Đã lưu.'); loadAll(); }).catch(function (err) { toast(err.message); });
      return;
    }
    var saveOrder = e.target.closest('[data-admin-order-save]');
    if (saveOrder) {
      var code = saveOrder.getAttribute('data-admin-order-save');
      var sel = document.querySelector('[data-admin-order="' + code + '"]');
      api('/api/admin/orders/' + encodeURIComponent(code) + '/status', { method: 'PUT', body: { status: sel.value } })
        .then(function () { toast('Đã cập nhật đơn ' + code + '.'); renderAdminTab(); })
        .catch(function (err) { toast(err.message); });
      return;
    }
    var confirmDep = e.target.closest('[data-deposit-confirm]');
    if (confirmDep) {
      var dcode = confirmDep.getAttribute('data-deposit-confirm');
      api('/api/admin/deposits/' + encodeURIComponent(dcode) + '/confirm', { method: 'POST' })
        .then(function (r) { toast(r.message || 'Đã cộng tiền.'); renderAdminTab(); })
        .catch(function (err) { toast(err.message); });
      return;
    }
    var amountChip = e.target.closest('[data-amount]');
    if (amountChip) {
      document.querySelectorAll('#quickAmounts .chip').forEach(function (c) { c.classList.remove('active'); });
      amountChip.classList.add('active');
      $('depositAmount').value = amountChip.getAttribute('data-amount');
      return;
    }
    var methodTab = e.target.closest('[data-method]');
    if (methodTab) { depositMethod = methodTab.getAttribute('data-method'); renderWallet(); return; }
    var authTab = e.target.closest('[data-auth-tab]');
    if (authTab) {
      var scope = authTab.closest('#checkoutSheet') ? 'checkout' : 'main';
      setAuthTab(authTab.getAttribute('data-auth-tab'), scope);
      return;
    }
    var botChip = e.target.closest('.bot-chip');
    if (botChip) { botAsk(botChip.textContent); return; }
    if (!e.target.closest('#accountWrap')) $('accountMenu').hidden = true;
  });

  $('brandHome').addEventListener('click', function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  $('cartBtn').addEventListener('click', function () { renderCart(); openOverlay('cartDrawer'); });
  $('checkoutBtn').addEventListener('click', function () {
    if (!cart.length) return;
    closeOverlay('cartDrawer');
    startCheckout(cart.map(function (i) { return { product_id: i.id, qty: i.qty }; }));
  });
  $('authBtn').addEventListener('click', function () { setAuthTab('login'); openOverlay('authSheet'); });
  $('topupBtn').addEventListener('click', renderWallet);
  $('walletChip').addEventListener('click', renderWallet);
  $('accountBtn').addEventListener('click', function () { $('accountMenu').hidden = !$('accountMenu').hidden; });
  $('checkoutTopupBtn').addEventListener('click', function () { closeOverlay('checkoutSheet'); renderWallet(); });
  document.querySelectorAll('input[name="payMethod"]').forEach(function (r) { r.addEventListener('change', updateWalletShort); });
  $('checkoutForm').addEventListener('submit', function (e) { e.preventDefault(); placeOrder(); });
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    doLogin($('loginUser').value.trim(), $('loginPass').value).catch(function () {});
  });
  $('registerForm').addEventListener('submit', function (e) {
    e.preventDefault();
    doRegister($('regName').value.trim(), $('regUser').value.trim(), $('regPass').value).catch(function () {});
  });
  $('coLoginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    doLogin($('coLoginUser').value.trim(), $('coLoginPass').value).catch(function () {});
  });
  $('coRegisterForm').addEventListener('submit', function (e) {
    e.preventDefault();
    doRegister($('coRegName').value.trim(), $('coRegUser').value.trim(), $('coRegPass').value).catch(function () {});
  });
  $('renameForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('renameInput').value.trim();
    if (!name) return;
    api('/api/me/rename', { method: 'POST', body: { full_name: name } })
      .then(function () { toast('Đã đổi tên.'); closeOverlay('renameSheet'); refreshMe(); })
      .catch(function (err) { toast(err.message); });
  });
  $('depositForm').addEventListener('submit', function (e) { e.preventDefault(); createDeposit(); });
  $('lookupForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var code = $('lookupCode').value.trim().toUpperCase();
    var contact = $('lookupContact').value.trim();
    if (!code || !contact) return;
    $('lookupResult').hidden = false;
    $('lookupResult').innerHTML = 'Đang tra cứu…';
    api('/api/orders/lookup', { method: 'POST', body: { code: code, contact: contact } })
      .then(function (d) { $('lookupResult').innerHTML = orderResultHtml(d.order); })
      .catch(function (err) { $('lookupResult').innerHTML = '<p>' + esc(err.message) + '</p>'; });
  });
  $('botBtn').addEventListener('click', function () { $('botPanel').hidden ? openBot() : ($('botPanel').hidden = true, document.body.style.overflow = ''); });
  $('botClose').addEventListener('click', function () { $('botPanel').hidden = true; document.body.style.overflow = ''; });
  $('botForm').addEventListener('submit', function (e) { e.preventDefault(); botAsk($('botInput').value); $('botInput').value = ''; });
  $('footOrders').addEventListener('click', function (e) { e.preventDefault(); renderMyOrders(); });
  $('footWallet').addEventListener('click', function (e) { e.preventDefault(); renderWallet(); });
  $('footTop').addEventListener('click', function (e) { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); });

  /* ---------------- init ---------------- */
  renderCartBadge();
  loadAll();
})();
