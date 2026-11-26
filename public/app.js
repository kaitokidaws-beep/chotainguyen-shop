// ==========================================================================
// Chợ Tài Nguyên Mmo — frontend viết mới hoàn toàn.
// Một file duy nhất: gọi API /api/*, token lưu localStorage (30 ngày).
// Static markup được nối bằng addEventListener; chỉ HTML sinh động mới dùng
// onclick gọi hàm toàn cục. Không còn code chết, không còn lớp vá.
// ==========================================================================
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('vi-VN') + 'đ';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let me = null;
let products = [];
let cart = [];
try { cart = JSON.parse(localStorage.getItem('ctn_cart') || '[]'); } catch (e) { cart = []; }
let platformFilter = 'Tất cả';
let authMode = 'register';
let selectedAmount = 0;
let searchQuery = '';
let sortMode = 'foryou';
let viewMode = 'grid';
let activityExpanded = false;

const token = () => localStorage.getItem('ctn_token');
function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (token()) h.Authorization = 'Bearer ' + token();
  return h;
}
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: headers() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Có lỗi xảy ra');
  return j;
}

// ---------------------------------------------------------------------------
// Kiểu giao diện: 3 thiết kế trong 1 site, chung 1 stylesheet.
// Chỉ đổi body[data-design] — CSS lo phần còn lại. Đổi tức thì, không tải
// lại trang, giỏ / ví / phiên đăng nhập không động tới.
// ---------------------------------------------------------------------------
const DESIGNS = {
  sang: { theme: 'light', color: '#f4f8fc' },
  dem: { theme: 'dark', color: '#0a0d16' },
  ruc: { theme: 'light', color: '#fff7ed' },
};
const DESIGN_KEY = 'ctn_design';
function currentDesign() {
  try {
    const d = localStorage.getItem(DESIGN_KEY);
    return DESIGNS[d] ? d : 'sang';
  } catch (e) { return 'sang'; }
}
function applyDesign(name, persist) {
  if (!DESIGNS[name]) name = 'sang';
  const d = DESIGNS[name];
  document.body.setAttribute('data-design', name);
  document.documentElement.setAttribute('data-design', name);
  document.documentElement.setAttribute('data-theme', d.theme);
  const meta = $('themeColorMeta');
  if (meta) meta.content = d.color;
  document.querySelectorAll('.design-pills button[data-design]').forEach((b) => {
    const on = b.dataset.design === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  if (persist) { try { localStorage.setItem(DESIGN_KEY, name); } catch (e) {} }
}
function setDesign(name) { applyDesign(name, true); }

// ---------------------------------------------------------------------------
// Cổng đăng ký / đăng nhập
// ---------------------------------------------------------------------------
function toggleAuthPanel(show, mode) {
  if (mode) setAuthMode(mode);
  $('authPanel').hidden = !show;
  if (show) $('authPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function setAuthMode(mode) {
  authMode = mode;
  $('authChip').textContent = mode === 'register' ? 'Đăng Ký Miễn Phí' : 'Đăng Nhập An Toàn';
  $('authSubmit').textContent = mode === 'register' ? 'Đăng ký' : 'Đăng nhập';
  $('nameField').style.display = mode === 'register' ? '' : 'none';
  $('authName').required = mode === 'register';
  $('authPass').autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  const sw = $('authSwitch');
  if (sw) {
    sw.childNodes[0].textContent = mode === 'register' ? 'Đã có tài khoản? ' : 'Chưa có tài khoản? ';
    $('authSwitchLink').textContent = mode === 'register' ? 'Đăng nhập' : 'Đăng ký';
  }
}
function switchAuthMode(e) {
  e.preventDefault();
  setAuthMode(authMode === 'register' ? 'login' : 'register');
}
async function submitAuth(e) {
  e.preventDefault();
  $('authError').textContent = '';
  try {
    const body = { username: $('authUser').value.trim(), password: $('authPass').value };
    if (authMode === 'register') body.full_name = $('authName').value.trim();
    const j = await api(authMode === 'register' ? '/api/register' : '/api/login', { method: 'POST', body: JSON.stringify(body) });
    localStorage.setItem('ctn_token', j.token);
    if (j.note) alert(j.note);
    await enterShop();
  } catch (err) { $('authError').textContent = err.message; }
}
function googleLogin() {
  alert('Shop chưa bật đăng nhập bằng Google. Bạn đăng ký bằng tên đăng nhập và mật khẩu nhé.');
}
async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
  localStorage.removeItem('ctn_token');
  me = null;
  location.reload();
}
async function rename() {
  try {
    await api('/api/me/rename', { method: 'POST', body: JSON.stringify({ full_name: $('newName').value.trim() }) });
    alert('Đã lưu tên mới.');
    await loadMe();
  } catch (e) { alert(e.message); }
}

// ---------------------------------------------------------------------------
// Vào shop + phiên đăng nhập
// ---------------------------------------------------------------------------
let __saveT = 0;
window.addEventListener('scroll', () => {
  const now = Date.now();
  if (now - __saveT < 300) return;
  __saveT = now;
  try { sessionStorage.setItem('ctn_scroll', String(window.scrollY)); } catch (e) {}
}, { passive: true });
function restoreScroll() {
  try {
    const y = Number(sessionStorage.getItem('ctn_scroll') || 0);
    if (y > 0) window.scrollTo({ top: y, behavior: 'auto' });
  } catch (e) {}
}
async function enterShop() {
  $('gate').hidden = true;
  $('shop').hidden = false;
  $('walletRow').hidden = false;
  $('headerUser').hidden = false;
  await loadMe();
  await Promise.all([loadProducts(), loadActivity(), loadWallet(), loadNotifications()]);
  showTab('shop', 'home');
  restoreScroll();
}
async function loadMe() {
  try {
    const j = await api('/api/me');
    me = j.user;
    $('avatarBtn').textContent = (me.full_name || 'M')[0].toUpperCase();
    $('accountInfo').textContent = `${me.full_name} (@${me.username}) — Số dư ví: ${fmt(me.balance)}${me.is_owner ? ' — Bạn là chủ shop.' : ''}`;
    $('newName').value = me.full_name;
    $('orderName').value = me.full_name;
    $('adminMenuBtn').hidden = !me.is_owner;
    const mine = await api('/api/orders/mine');
    $('myOrders').innerHTML = mine.orders.map((o) =>
      `<li><span><b>${o.code}</b> — ${o.items.map((i) => esc(i.name)).join(', ')}</span><span>${fmt(o.total)} — <b class="status-${o.status}">${statusText(o.status)}</b></span></li>`
    ).join('') || '<li>Chưa có đơn hàng nào.</li>';
  } catch (e) { me = null; }
}
function statusText(s) {
  return { pending: 'Chờ xử lý', paid: 'Đã thanh toán', delivered: 'Đã giao', cancelled: 'Đã hủy', verified: 'Đã xác minh' }[s] || s;
}

// ---------------------------------------------------------------------------
// Sản phẩm: logo thương hiệu, lọc, tìm kiếm, sắp xếp, xem lưới/danh sách
// ---------------------------------------------------------------------------
const PLATFORM_STYLE = {
  Facebook: { c: '#1877F2', svg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>' },
  TikTok: { c: '#111111', svg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.23-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>' },
  Instagram: { c: '#E1306C', svg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.3" cy="6.7" r="1.3" fill="#fff" stroke="none"/></svg>' },
  YouTube: { c: '#FF0000', svg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M8 5.5v13l11-6.5z"/></svg>' },
  Telegram: { c: '#229ED9', svg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>' },
  Gmail: { c: '#EA4335', svg: '<svg width="22" height="22" viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="#fff"/><path d="M4.5 7.5 L12 13 L19.5 7.5" fill="none" stroke="#EA4335" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  X: { c: '#000000', svg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>' },
  Zalo: { c: '#0068FF', svg: '<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M6 7h12v3L9.2 14H18v3H6v-3l8.8-4H6z"/></svg>' },
};
function brandOf(p) {
  return PLATFORM_STYLE[p.platform] || {
    c: '#0284c7',
    svg: '<svg width="22" height="22" viewBox="0 0 24 24"><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="900" fill="#fff">' + esc(p.platform[0]) + '</text></svg>',
  };
}
function showHome() {
  if ($('shop').hidden) { setActiveNav('home'); window.scrollTo({ top: 0, behavior: 'auto' }); return; }
  showTab('shop', 'home', { top: true });
}
function showProducts() {
  if ($('shop').hidden) { setActiveNav('products'); toggleAuthPanel(true, 'register'); return; }
  showTab('shop', 'products');
  setTimeout(() => { const g = $('productGrid'); if (g) g.scrollIntoView({ behavior: 'smooth' }); }, 80);
}
function onSearch(scroll) {
  searchQuery = ($('searchInput') ? $('searchInput').value : '').trim();
  renderProducts();
  if (scroll) { const g = $('productGrid'); if (g) g.scrollIntoView({ behavior: 'smooth' }); }
}
function setSort(mode) {
  sortMode = mode;
  document.querySelectorAll('#sortPills button').forEach((b) => b.classList.toggle('active', b.dataset.sort === mode));
  renderProducts();
}
function setView(mode) {
  viewMode = mode;
  $('viewGridBtn').classList.toggle('active', mode === 'grid');
  $('viewListBtn').classList.toggle('active', mode === 'list');
  $('productGrid').dataset.view = mode;
  renderProducts();
}
function setFilter(p) {
  platformFilter = p;
  document.querySelectorAll('#platformFilters .cat-tile').forEach((b) => b.classList.toggle('active', b.dataset.platform === p));
  renderProducts();
}
function sortList(list) {
  const l = [...list];
  if (sortMode === 'popular') l.sort((a, b) => (b.sold || 0) - (a.sold || 0));
  else if (sortMode === 'newest') l.sort((a, b) => (b.created_at || 0) - (a.created_at || 0) || b.id - a.id);
  else if (sortMode === 'price-low') l.sort((a, b) => a.price - b.price);
  else if (sortMode === 'price-high') l.sort((a, b) => b.price - a.price);
  return l;
}
async function loadProducts() {
  const [j, stats] = await Promise.all([api('/api/products'), api('/api/stats')]);
  products = j.products;
  $('statSold').textContent = stats.sold_30d;
  $('statProducts').textContent = stats.total_products;
  $('heroSold').textContent = stats.sold_30d;
  $('heroProducts').textContent = stats.total_products;
  const platforms = ['Tất cả', ...new Set(products.map((p) => p.platform))];
  $('platformFilters').innerHTML = platforms.map((p) => {
    const items = p === 'Tất cả' ? products : products.filter((x) => x.platform === p);
    const min = items.length ? Math.min(...items.map((x) => x.price)) : 0;
    const st = p === 'Tất cả' ? { c: '#0369a1', svg: '★' } : (PLATFORM_STYLE[p] || { c: '#0369a1', svg: esc(p[0]) });
    return `<button type="button" class="cat-tile${p === platformFilter ? ' active' : ''}" data-platform="${esc(p)}"><span class="cat-top" style="background:${st.c}">${st.svg}</span><span class="cat-body"><span class="cat-name">${esc(p)}</span><span class="cat-meta">${items.length} sản phẩm · từ ${fmt(min)}</span></span></button>`;
  }).join('');
  renderCoverStory();
  renderFeatured();
  renderProducts();
}
function renderCoverStory() {
  const box = $('coverStory');
  if (!box) return;
  const hot = products.find((p) => p.is_hot);
  const top = hot || [...products].sort((a, b) => (b.sold || 0) - (a.sold || 0))[0];
  if (!top) { box.style.display = 'none'; return; }
  box.style.display = '';
  const st = brandOf(top);
  const old = Number(top.old_price || 0);
  const disc = old > top.price ? Math.round((1 - top.price / old) * 100) : 0;
  box.innerHTML = `
    <div class="story-media" style="background:${st.c}">
      <span class="p-media-logo">${st.svg}</span>
      <span class="banner-badges">${top.is_hot ? '<span class="hot-badge">NỔI BẬT</span>' : ''}${disc ? `<span class="disc-badge">-${disc}%</span>` : ''}</span>
      <i class="stock-badge ${top.stock > 0 ? 'in' : 'out'}">${top.stock > 0 ? '● Còn hàng' : 'Hết hàng'}</i>
    </div>
    <div class="story-body">
      <span class="story-kicker">Sản phẩm nổi bật · ${esc(top.platform)}</span>
      <h2>${esc(top.name)}</h2>
      <p class="story-meta">${esc(top.description || top.warranty || '')}</p>
      <div class="story-price"><b>${fmt(top.price)}</b>${old > top.price ? `<s class="old-price">${fmt(old)}</s>` : ''}</div>
      <p class="story-sold">${Number(top.sold || 0)} đã bán • Còn ${top.stock} tài khoản · 🛡️ ${esc(top.warranty || '')}</p>
      <div class="story-btns">
        <button class="btn-primary" type="button" onclick="buyNow(${top.id})">Mua ngay</button>
        <button class="btn-ghost" type="button" onclick="openProduct(${top.id})">Xem chi tiết</button>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Carousel nổi bật + 1 hàm vẽ thẻ duy nhất cho carousel và lưới
// ---------------------------------------------------------------------------
let featTotal = 0;
let featNames = [];
let __featIdx = 0;
let __featRaf = 0;
let __featWired = false;
function renderFeatured() {
  const track = $('featTrack');
  if (!track) return;
  const hot = products.filter((p) => p.is_hot);
  const bySold = [...products].sort((a, b) => (b.sold || 0) - (a.sold || 0));
  const seen = new Set();
  const list = [];
  for (const p of [...hot, ...bySold]) {
    if (!seen.has(p.id)) { seen.add(p.id); list.push(p); }
    if (list.length >= 4) break;
  }
  featTotal = list.length;
  featNames = list.map((p) => p.name);
  track.innerHTML = list.map((p, i) => cardHTML(p, i, list.length)).join('');
  $('featMarkers').innerHTML = list.map((p, i) =>
    `<button type="button" data-feat="${i}" aria-label="Đi tới sản phẩm nổi bật ${i + 1}: ${esc(p.name)}"${i === 0 ? ' aria-current="true"' : ''}></button>`
  ).join('');
  updateFeatStatus(0);
}
function updateFeatStatus(idx) {
  __featIdx = idx;
  document.querySelectorAll('#featMarkers button').forEach((b, i) => {
    if (i === idx) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  });
  const st = $('featStatus');
  if (st && featTotal) st.textContent = `Sản phẩm nổi bật ${idx + 1} trên ${featTotal}: ${featNames[idx] || ''}`;
}
function featGo(i) {
  const track = $('featTrack');
  if (!track || !featTotal) return;
  const idx = ((i % featTotal) + featTotal) % featTotal;
  const slide = track.children[idx];
  if (!slide) return;
  updateFeatStatus(idx);
  slide.scrollIntoView({ behavior: isReducedMotion ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
}
function setupFeatCarousel() {
  if (__featWired) return;
  __featWired = true;
  const track = $('featTrack');
  if (!track) return;
  $('featPrev').onclick = () => featGo(__featIdx - 1);
  $('featNext').onclick = () => featGo(__featIdx + 1);
  $('featMarkers').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-feat]');
    if (b) featGo(Number(b.dataset.feat));
  });
  let settleT = 0;
  const sync = () => {
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = 0;
    let bestD = Infinity;
    [...track.children].forEach((c, i) => {
      const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best !== __featIdx) updateFeatStatus(best);
  };
  track.addEventListener('scroll', () => {
    if (__featRaf) return;
    __featRaf = requestAnimationFrame(() => { __featRaf = 0; sync(); });
  }, { passive: true });
  if ('onscrollend' in track) track.addEventListener('scrollend', sync);
  else track.addEventListener('scroll', () => { clearTimeout(settleT); settleT = setTimeout(sync, 120); }, { passive: true });
}
function cardHTML(p, i, slideTotal) {
  const st = brandOf(p);
  const old = Number(p.old_price || 0);
  const disc = old > p.price ? Math.round((1 - p.price / old) * 100) : 0;
  const bh = (String(p.warranty || '').match(/(\d+)\s*ngày/) || [])[1];
  const sold = Number(p.sold || 0);
  const delay = (i % 8) * 40;
  const slideAttr = slideTotal ? ` role="group" aria-roledescription="slide" aria-label="${i + 1} trên ${slideTotal}"` : '';
  return `
  <article class="p-card" data-id="${p.id}" style="animation-delay:${delay}ms"${slideAttr} tabindex="0">
    <div class="p-media" style="background:${st.c}">
      <span class="p-media-logo">${st.svg}</span>
      <span class="banner-badges">${p.is_hot ? '<span class="hot-badge">NỔI BẬT</span>' : ''}${disc ? `<span class="disc-badge">-${disc}%</span>` : ''}</span>
      <i class="stock-badge ${p.stock > 0 ? 'in' : 'out'}">${p.stock > 0 ? '● Còn hàng' : 'Hết hàng'}</i>
      ${bh ? `<span class="bh-pill">🛡️ BH ${bh} ngày</span>` : ''}
      <span class="p-price-overlay"><b>${fmt(p.price)}</b><span>${sold} đã bán</span></span>
    </div>
    <div class="p-body">
      <b class="p-name">${esc(p.name)}</b>
      <span class="p-meta">${esc(p.platform)} · ${esc(p.warranty || '')}</span>
      <hr class="p-divider">
      <span class="p-price-row"><span class="price-from">Từ</span><span class="p-price">${fmt(p.price)}</span>${old > p.price ? `<s class="old-price">${fmt(old)}</s>` : ''}</span>
      <span class="p-sold">${sold} đã bán • Còn ${p.stock}</span>
    </div>
  </article>`;
}
function renderProducts() {
  const q = norm(searchQuery);
  let list = products.filter((p) =>
    (platformFilter === 'Tất cả' || p.platform === platformFilter) &&
    (!q || norm(p.name).includes(q) || norm(p.platform).includes(q)));
  list = sortList(list);
  $('productCount').textContent = `Có ${list.length} sản phẩm`;
  $('emptyProducts').hidden = list.length > 0;
  $('emptyProducts').textContent = q
    ? 'Không tìm thấy sản phẩm nào. Thử từ khóa hoặc nền tảng khác.'
    : 'Không có sản phẩm. Thử chọn nền tảng khác.';
  $('productGrid').innerHTML = list.map((p, i) => cardHTML(p, i)).join('');
  if (viewMode === 'grid' && $('productGrid').firstElementChild) {
    $('productGrid').firstElementChild.classList.add('p-feature');
  }
  updateCartBadge();
}
function goFeatured(kind) {
  if (kind === 'pagelike') {
    const p = products.find((x) => /page/i.test(x.name) && /10\s*k/i.test(x.name));
    if (p) { openProduct(p.id); return; }
    kind = 'fb';
  }
  if (kind === 'fb') setFilter('Facebook');
  else if (kind === 'x') setFilter('X');
  else setFilter('Tất cả');
  const g = $('productGrid');
  if (g) g.scrollIntoView({ behavior: 'smooth' });
}

// ---------------------------------------------------------------------------
// Hộp chi tiết sản phẩm (native <dialog>, light-dismiss, view transition)
// ---------------------------------------------------------------------------
function setupDialogLightDismiss() {
  const dlg = $('productModal');
  if (!dlg || 'closedBy' in dlg) return;
  let downY = null;
  dlg.addEventListener('pointerdown', (e) => { if (e.target === dlg) downY = e.clientY; });
  dlg.addEventListener('pointerup', (e) => {
    if (e.target === dlg && downY !== null && Math.abs(e.clientY - downY) < 5) closeModal();
    downY = null;
  });
}
function openProduct(id) {
  const p = products.find((x) => x.id === id);
  if (!p) return;
  const st = brandOf(p);
  const box = $('productModalBox');
  const old = Number(p.old_price || 0);
  box.innerHTML = `<button class="x" type="button" onclick="closeModal()" aria-label="Đóng">✕</button>
    <span class="platform-tag">${esc(p.platform)}</span><h2 id="productModalTitle" tabindex="-1">${esc(p.name)}</h2>
    <div class="p-media" style="background:${st.c}"><span class="p-media-logo">${st.svg}</span></div>
    <p class="muted">${esc(p.description)}</p>
    <p class="price">${fmt(p.price)}${old > p.price ? ` <s class="old-price">${fmt(old)}</s> <span class="disc-badge">-${Math.round((1 - p.price / old) * 100)}%</span>` : ''}</p>
    <p class="stock">Đã bán ${Number(p.sold || 0)} • Còn ${p.stock} tài khoản</p>
    <p class="warranty">🛡️ ${esc(p.warranty)}</p>
    <button class="btn-primary" type="button" onclick="buyNow(${p.id}); closeModal()">Mua ngay</button>
    <button class="btn-ghost" type="button" onclick="addToCart(${p.id}); closeModal()">Thêm vào giỏ</button>`;
  const dlg = $('productModal');
  dlg.showModal();
  const h = $('productModalTitle');
  if (h) h.focus({ preventScroll: true });
}
function closeModal() {
  const m = $('productModal');
  if (m && m.open) m.close();
}

// ---------------------------------------------------------------------------
// Giỏ hàng + đặt hàng
// ---------------------------------------------------------------------------
function saveCart() { try { localStorage.setItem('ctn_cart', JSON.stringify(cart)); } catch (e) {} }
function addToCartSilent(id) {
  const it = cart.find((x) => x.product_id === id);
  if (it) it.qty++;
  else cart.push({ product_id: id, qty: 1 });
  saveCart();
  updateCartBadge();
}
function addToCart(id) { addToCartSilent(id); alert('Đã thêm vào giỏ hàng.'); }
function buyNow(id) { addToCartSilent(id); showTab('cart'); }
function updateCartBadge() {
  $('cartCount').textContent = cart.reduce((s, x) => s + x.qty, 0);
  renderCart();
}
function renderCart() {
  if (!$('cartList')) return;
  let total = 0;
  $('cartList').innerHTML = cart.map((c, i) => {
    const p = products.find((x) => x.id === c.product_id);
    if (!p) return '';
    total += p.price * c.qty;
    return `<li><span>${esc(p.name)} × ${c.qty}</span><span>${fmt(p.price * c.qty)} <button type="button" onclick="removeCart(${i})">✕</button></span></li>`;
  }).join('') || '<li>Giỏ hàng trống.</li>';
  $('cartTotal').textContent = fmt(total);
}
function removeCart(i) { cart.splice(i, 1); saveCart(); updateCartBadge(); }
async function placeOrder() {
  try {
    const j = await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify({ items: cart, buyer_name: $('orderName').value, contact: $('orderContact').value, pay_method: $('payMethod').value }),
    });
    $('orderResult').innerHTML = `<p><b>Mã đơn của bạn: ${j.code}</b> — Tổng ${fmt(j.total)}. ${esc(j.message)}</p>`;
    cart = [];
    saveCart();
    updateCartBadge();
    await loadMe();
    await loadProducts();
    await loadActivity();
  } catch (e) { alert(e.message); }
}

// ---------------------------------------------------------------------------
// Hoạt động gần đây + thông báo mua hàng (dữ liệu thật, tên đã che)
// ---------------------------------------------------------------------------
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'vừa xong';
  const m = Math.floor(s / 60);
  if (m < 60) return m + ' phút trước';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' giờ trước';
  return Math.floor(h / 24) + ' ngày trước';
}
function actColorIdx(a) {
  let h = 0;
  const s = (a.name || '') + a.created_at;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 997;
  return h % 5;
}
function actInitials(name) {
  const t = String(name || 'K').replace(/\*+$/, '');
  return (t.slice(0, 2) || 'K').toUpperCase();
}
async function loadActivity(limit) {
  if (limit == null) limit = activityExpanded ? 20 : 4;
  try {
    const j = await api('/api/activity?limit=' + limit);
    const list = j.activity || [];
    const total = j.total != null ? j.total : list.length;
    $('actMoreBtn').style.display = total <= 4 ? 'none' : '';
    if (!list.length) { $('actList').innerHTML = '<p class="muted">Chưa có hoạt động nào.</p>'; return; }
    $('actList').innerHTML = list.map((a) => {
      const amt = a.amount == null ? '' : `<span class="act-amt">${a.amount < 0 ? '-' : ''}${fmt(Math.abs(a.amount))}</span>`;
      return `<div class="act-row act-c${actColorIdx(a)}"><span class="act-avatar">${esc(actInitials(a.name))}</span><div class="act-body"><div class="act-top"><b>${esc(a.name)}</b>${amt}</div><div class="act-desc">${esc(a.desc)}</div><div class="act-time">${timeAgo(a.created_at)}</div></div></div>`;
    }).join('');
  } catch (e) { $('actList').innerHTML = '<p class="muted">Không tải được hoạt động.</p>'; }
}
function toggleActivity() {
  activityExpanded = !activityExpanded;
  $('actMoreBtn').textContent = activityExpanded ? 'Thu gọn ↑' : 'Xem thêm hoạt động →';
  loadActivity(activityExpanded ? 20 : 4);
}
let __buysTimer = 0;
let __buysList = [];
let __buysIdx = 0;
async function loadNotifications() {
  try {
    const j = await api('/api/notifications');
    __buysList = j.notifications || [];
    if (!__buysList.length) { $('buysTicker').hidden = true; return; }
    $('buysTicker').hidden = false;
    __buysIdx = 0;
    showBuy(__buysIdx);
    clearInterval(__buysTimer);
    __buysTimer = setInterval(() => {
      __buysIdx = (__buysIdx + 1) % __buysList.length;
      showBuy(__buysIdx);
    }, 4000);
  } catch (e) { $('buysTicker').hidden = true; }
}
function showBuy(i) {
  const n = __buysList[i];
  if (!n) return;
  $('buysLine').textContent = `${n.buyer} vừa mua ${n.product}${n.count > 1 ? ` × ${n.count}` : ''} · ${timeAgo(n.created_at)}`;
}

// ---------------------------------------------------------------------------
// Ví / nạp tiền (VietQR chuẩn EMVCo/NAPAS, QR qua api.qrserver.com)
// ---------------------------------------------------------------------------
const QUICK = [20000, 50000, 100000, 200000, 500000, 1000000];
function renderQuickAmounts() {
  $('quickAmounts').innerHTML = QUICK.map((a) => `<button type="button" data-amount="${a}">${fmt(a)}</button>`).join('');
}
function pickAmount(a, btn) {
  selectedAmount = a;
  document.querySelectorAll('#quickAmounts button').forEach((b) => b.classList.remove('sel'));
  btn.classList.add('sel');
  $('customAmount').value = a;
}
async function loadWallet() {
  if (!me) return;
  try {
    const j = await api('/api/wallet');
    $('walletBalance').textContent = fmt(j.balance);
    $('walletBalance2').textContent = fmt(j.balance);
    $('depositHistory').innerHTML = j.deposits.map((d) =>
      `<li><span><b>${d.code}</b> — ${fmt(d.amount)} (${d.method})</span><span><b class="status-${d.status}">${statusText(d.status)}</b> ${d.status === 'pending' ? `<button type="button" onclick="checkApi('${d.code}')">Kiểm tra giao dịch qua API</button>` : ''}</span></li>`
    ).join('') || '<li>Chưa có lịch sử nạp.</li>';
  } catch (e) {}
}
function vietQR(amount, code, info) {
  const crc = (s) => {
    let c = 0xffff;
    for (let i = 0; i < s.length; i++) {
      c ^= s.charCodeAt(i) << 8;
      for (let k = 0; k < 8; k++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    }
    return c.toString(16).toUpperCase().padStart(4, '0');
  };
  const tlv = (id, v) => id + String(v.length).padStart(2, '0') + v;
  const gui = tlv('00', 'A000000727') + tlv('01', String(info.bank_bin || '').padStart(6, '0') + (info.account_number || '')) + tlv('02', 'QRIBFTTA');
  let p = tlv('00', '01') + tlv('01', '12') + tlv('38', gui) + tlv('52', '0000') + tlv('53', '704') + tlv('54', String(amount)) + tlv('58', 'VN') + tlv('62', tlv('08', code));
  p += '6304' + crc(p + '6304');
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(p)}`;
}
async function createDeposit() {
  const amount = Number($('customAmount').value || selectedAmount);
  const method = $('depositMethod').value;
  try {
    const j = await api('/api/deposits', {
      method: 'POST',
      body: JSON.stringify({ amount, method, card_carrier: $('cardCarrier').value, card_serial: $('cardSerial').value, card_code: $('cardCode').value }),
    });
    const info = await api('/api/receiving-info');
    const apiStatus = await api('/api/api-status');
    let html = `<p><b>Mã nạp của bạn: ${j.code}</b> — ${fmt(j.amount)} — Trạng thái: Chờ xác minh.</p>`;
    if (method === 'bank' && info.account_number) {
      html += `<p>Ngân hàng: ${esc(info.bank_name)} — STK: <b>${esc(info.account_number)}</b> — Chủ TK: ${esc(info.account_holder)}<br>Nội dung chuyển khoản: <b>${j.code}</b></p><img src="${vietQR(j.amount, j.code, info)}" alt="VietQR" style="border-radius:12px">`;
    } else if (method === 'momo' && info.momo) {
      html += `<p>MoMo nhận tiền: <b>${esc(info.momo)}</b> — Nội dung: <b>${j.code}</b></p>`;
    } else if (method === 'zalopay' && info.zalopay) {
      html += `<p>ZaloPay nhận tiền: <b>${esc(info.zalopay)}</b> — Nội dung: <b>${j.code}</b></p>`;
    } else if (method === 'card') {
      html += '<p>Đã ghi nhận thẻ cào. Chủ shop sẽ xác nhận thẻ rồi cộng tiền.</p>';
    } else {
      html += '<p class="error">Shop chưa nhập thông tin nhận tiền. Chủ shop vào Quản lý shop → Thông tin nhận tiền &amp; mã QR.</p>';
    }
    html += apiStatus.connected
      ? `<p><button class="btn-primary" type="button" onclick="checkApi('${j.code}')">Kiểm tra giao dịch qua API</button></p>`
      : '<p class="error">Shop chưa kết nối API SePay/Casso nên chưa kiểm tra tự động được. Chủ shop kết nối API trong Quản lý shop.</p>';
    $('depositResult').innerHTML = html;
    await loadWallet();
  } catch (e) { alert(e.message); }
}
async function checkApi(code) {
  try {
    const j = await api(`/api/deposits/${code}/check-api`, { method: 'POST' });
    alert(j.message);
    await loadWallet();
    await loadMe();
  } catch (e) { alert(e.message); }
}
async function lookupOrder() {
  try {
    const j = await api('/api/orders/lookup', {
      method: 'POST',
      body: JSON.stringify({ code: $('lookupCode').value, contact: $('lookupContact').value }),
    });
    const o = j.order;
    $('lookupResult').innerHTML = `<p><b>${o.code}</b> — <b class="status-${o.status}">${statusText(o.status)}</b> — Tổng ${fmt(o.total)}</p><ul class="list">${o.items.map((i) => `<li>${esc(i.name)} × ${i.qty} — ${fmt(i.price)}</li>`).join('')}</ul>`;
  } catch (e) { $('lookupResult').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

// ---------------------------------------------------------------------------
// BXH nạp
// ---------------------------------------------------------------------------
async function loadLeaderboard() {
  const j = await api('/api/leaderboard');
  $('leaderboardList').innerHTML = j.top.map((t) =>
    `<li><span>🥇 ${t.rank}. ${esc(t.name)}</span><b class="gold">${fmt(t.total)}</b></li>`
  ).join('') || '<li>Chưa có ai nạp tiền.</li>';
  if (me) {
    try {
      const m = await api('/api/leaderboard/mine');
      $('myRank').textContent = m.rank ? `Hạng của bạn: #${m.rank} — Tổng nạp: ${fmt(m.total)}` : 'Bạn chưa có lượt nạp nào được xác minh.';
    } catch (e) {}
  }
}

// ---------------------------------------------------------------------------
// Tab / điều hướng
// ---------------------------------------------------------------------------
function setActiveNav(key) {
  document.querySelectorAll('.bottom-nav button').forEach((b) => b.classList.toggle('active', key ? b.dataset.nav === key : false));
}
function showTab(tab, navKey, opts = {}) {
  if ($('shop').hidden) {
    if (tab === 'shop' && navKey === 'home') { setActiveNav('home'); window.scrollTo({ top: 0, behavior: 'auto' }); return; }
    setActiveNav(navKey || null);
    toggleAuthPanel(true, 'register');
    return;
  }
  document.querySelectorAll('.tab').forEach((t) => { t.hidden = true; });
  const map = { shop: 'tab-shop', wallet: 'tab-wallet', leaderboard: 'tab-leaderboard', lookup: 'tab-lookup', account: 'tab-account', cart: 'tab-cart', admin: 'tab-admin', orders: 'tab-account' };
  const id = map[tab] || 'tab-shop';
  $(id).hidden = false;
  $('mainMenu').hidden = true;
  const navMap = { shop: 'products', wallet: 'wallet', orders: 'orders', account: 'account' };
  setActiveNav(navKey || navMap[tab] || null);
  if (tab === 'wallet') loadWallet();
  if (tab === 'leaderboard') loadLeaderboard();
  if (tab === 'admin') loadAdmin();
  if (opts.top) window.scrollTo({ top: 0, behavior: 'auto' });
}

// ---------------------------------------------------------------------------
// Chính sách + bot hỗ trợ
// ---------------------------------------------------------------------------
const POLICIES = {
  purchase: 'Chính sách mua hàng\n\nChọn sản phẩm, bấm Mua ngay, nhập thông tin liên hệ để nhận tài khoản. Giá hiển thị là giá đang bán tại thời điểm bạn xem.',
  payment: 'Chính sách thanh toán\n\nThanh toán bằng số dư ví (trừ ngay khi đặt hàng) hoặc đặt trước rồi thanh toán sau. Nạp tiền tối thiểu 10.000đ, chuyển đúng nội dung mã NAP… rồi kiểm tra qua API SePay/Casso.',
  delivery: 'Chính sách giao hàng\n\nTài khoản được giao sau khi đơn thanh toán xong. Shop giao qua đúng SĐT / Zalo / Telegram bạn để lại khi đặt hàng.',
  privacy: 'Chính sách bảo mật\n\nShop chỉ dùng thông tin bạn để lại để giao tài khoản và tra cứu đơn. Mỗi tài khoản chỉ xem được đơn của mình; tra cứu công khai cần cả mã đơn và thông tin liên hệ khớp.',
  refund: 'Hoàn tiền & đổi trả\n\nBảo hành 1 đổi 1 rõ ràng theo thời hạn ghi trên từng sản phẩm. Tài khoản lỗi, sai thông tin: gửi mã đơn để được đổi hoặc hoàn tiền.',
  faq: 'Câu hỏi thường gặp\n\n1. Nạp tiền bao lâu thì cộng? Khi kiểm tra qua API khớp đúng số tiền + mã NAP… thì cộng ngay.\n2. Quên mã đơn thì sao? Vào Tài khoản → Đơn hàng của tôi (cần đăng nhập).\n3. Đăng nhập Google được không? Chưa. Shop chưa bật đăng nhập bằng Google.',
};
function showPolicy(key) {
  const box = $('policyBox');
  box.hidden = false;
  box.textContent = POLICIES[key] || '';
  box.scrollIntoView({ behavior: 'smooth' });
}
function openBot() { $('botPanel').hidden = !$('botPanel').hidden; }
async function sendBot() {
  const text = $('botText').value.trim();
  if (!text) return;
  $('botLog').innerHTML += `<p class="bot-msg"><b>Bạn:</b> ${esc(text)}</p>`;
  $('botText').value = '';
  try {
    const j = await api('/api/bot', { method: 'POST', body: JSON.stringify({ message: text }) });
    $('botLog').innerHTML += `<p class="bot-msg">${esc(j.reply)}</p>`;
  } catch (e) {
    $('botLog').innerHTML += '<p class="bot-msg">Bot đang bận, bạn thử lại sau nhé.</p>';
  }
  $('botLog').scrollTop = $('botLog').scrollHeight;
}

// ---------------------------------------------------------------------------
// Chủ shop
// ---------------------------------------------------------------------------
async function loadAdmin() {
  if (!me || !me.is_owner) { alert('Chỉ chủ shop mới vào được mục này.'); showTab('shop'); return; }
  try {
    const ov = await api('/api/admin/overview');
    $('adminOverview').textContent = `Yêu cầu nạp đang chờ: ${ov.pending_deposits} • Tổng đơn: ${ov.total_orders} • Doanh thu (đã thanh toán/giao): ${fmt(ov.revenue)}`;
    const s = await api('/api/admin/settings');
    $('sBankName').value = s.recv_bank_name || '';
    $('sBankBin').value = s.recv_bank_bin || '';
    $('sAccNum').value = s.recv_account_number || '';
    $('sAccHolder').value = s.recv_account_holder || '';
    $('sMomo').value = s.recv_momo || '';
    $('sZalo').value = s.recv_zalopay || '';
    $('sGateway').value = s.api_gateway || '';
    $('apiStatus').textContent = s.api_connected
      ? `Đã kết nối API (${s.api_gateway}). Key đã lưu, không hiển thị lại.`
      : 'Chưa kết nối API. Nạp tiền qua QR sẽ không tự cộng được.';
    const prods = await api('/api/admin/products');
    $('adminProducts').innerHTML = prods.products.map((p) =>
      `<li><span>${esc(p.platform)} — ${esc(p.name)} — ${fmt(p.price)} — Còn ${p.stock} ${p.active ? '' : '(đang ẩn)'}</span><span><button type="button" onclick="editProduct(${p.id})">Sửa</button> <button type="button" onclick="deleteProduct(${p.id})">Xóa</button></span></li>`
    ).join('');
    const orders = await api('/api/admin/orders');
    $('adminOrders').innerHTML = orders.orders.map((o) =>
      `<li><span><b>${o.code}</b> — ${fmt(o.total)} — ${o.buyer_name}</span><span><select onchange="setOrderStatus('${o.code}', this.value)">${['pending', 'paid', 'delivered', 'cancelled'].map((st) => `<option value="${st}" ${o.status === st ? 'selected' : ''}>${statusText(st)}</option>`).join('')}</select></span></li>`
    ).join('') || '<li>Chưa có đơn nào.</li>';
    const deps = await api('/api/admin/deposits');
    $('adminDeposits').innerHTML = deps.deposits.filter((d) => d.status === 'pending').map((d) =>
      `<li><span><b>${d.code}</b> — ${fmt(d.amount)} — ${d.method} — @${esc(d.username)}</span><span><button type="button" onclick="confirmDeposit('${d.code}')">Xác nhận cộng tiền</button></span></li>`
    ).join('') || '<li>Không có yêu cầu nạp đang chờ.</li>';
  } catch (e) { alert(e.message); }
}
async function saveReceiving() {
  try {
    await api('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({ recv_bank_name: $('sBankName').value, recv_bank_bin: $('sBankBin').value, recv_account_number: $('sAccNum').value, recv_account_holder: $('sAccHolder').value, recv_momo: $('sMomo').value, recv_zalopay: $('sZalo').value }),
    });
    alert('Đã lưu thông tin nhận tiền.');
  } catch (e) { alert(e.message); }
}
async function saveApi() {
  try {
    await api('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({ api_gateway: $('sGateway').value, api_key: $('sApiKey').value }),
    });
    alert('Đã lưu API. Key chỉ lưu trên máy chủ, không hiển thị lại.');
    $('sApiKey').value = '';
    await loadAdmin();
  } catch (e) { alert(e.message); }
}
async function addProduct() {
  try {
    await api('/api/admin/products', {
      method: 'POST',
      body: JSON.stringify({ platform: $('pPlatform').value, name: $('pName').value, price: Number($('pPrice').value), stock: Number($('pStock').value), warranty: $('pWarranty').value || 'Bảo hành 1 đổi 1', description: $('pDesc').value }),
    });
    alert('Đã thêm sản phẩm.');
    await loadAdmin();
    await loadProducts();
  } catch (e) { alert(e.message); }
}
async function editProduct(id) {
  const p = products.find((x) => x.id === id) || (await api('/api/admin/products')).products.find((x) => x.id === id);
  const price = prompt('Giá mới (VNĐ):', p.price);
  if (price === null) return;
  const stock = prompt('Tồn kho mới:', p.stock);
  if (stock === null) return;
  try {
    await api(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify({ ...p, price: Number(price), stock: Number(stock) }) });
    await loadAdmin();
    await loadProducts();
  } catch (e) { alert(e.message); }
}
async function deleteProduct(id) {
  if (!confirm('Xóa sản phẩm này?')) return;
  try {
    await api(`/api/admin/products/${id}`, { method: 'DELETE' });
    await loadAdmin();
    await loadProducts();
  } catch (e) { alert(e.message); }
}
async function setOrderStatus(code, status) {
  try { await api(`/api/admin/orders/${code}/status`, { method: 'PUT', body: JSON.stringify({ status }) }); }
  catch (e) { alert(e.message); }
}
async function confirmDeposit(code) {
  if (!confirm(`Xác nhận cộng tiền cho yêu cầu ${code}? Chỉ bấm khi đã kiểm tra tiền/thẻ thật.`)) return;
  try {
    const j = await api(`/api/admin/deposits/${code}/confirm`, { method: 'POST' });
    alert(j.message);
    await loadAdmin();
  } catch (e) { alert(e.message); }
}

// ---------------------------------------------------------------------------
// Nối sự kiện + khởi động
// ---------------------------------------------------------------------------
function wireEvents() {
  const on = (id, ev, fn) => $(id).addEventListener(ev, fn);
  const onClick = (id, fn) => on(id, 'click', fn);
  onClick('menuBtn', () => {
    $('mainMenu').hidden = !$('mainMenu').hidden;
    $('menuBtn').classList.toggle('open', !$('mainMenu').hidden);
    $('menuBtn').setAttribute('aria-expanded', String(!$('mainMenu').hidden));
  });
  $('brandHome').addEventListener('click', (e) => { e.preventDefault(); showHome(); });
  $('topSearchForm').addEventListener('submit', (e) => { e.preventDefault(); onSearch(true); });
  on('searchInput', 'input', () => onSearch());
  onClick('avatarBtn', () => showTab('account'));
  onClick('cartBtn', () => showTab('cart'));
  onClick('walletChip', () => showTab('wallet'));
  onClick('walletTopupBtn', () => showTab('wallet'));
  onClick('gateRegisterBtn', () => toggleAuthPanel(true, 'register'));
  onClick('gateLoginBtn', () => toggleAuthPanel(true, 'login'));
  onClick('authCloseBtn', () => toggleAuthPanel(false));
  on('authForm', 'submit', submitAuth);
  on('authSwitchLink', 'click', switchAuthMode);
  onClick('googleBtn', googleLogin);
  onClick('logoutBtn', logout);
  onClick('renameBtn', rename);
  onClick('actMoreBtn', toggleActivity);
  onClick('createDepositBtn', createDeposit);
  on('depositMethod', 'change', () => { $('cardFields').hidden = $('depositMethod').value !== 'card'; });
  onClick('lookupBtn', lookupOrder);
  onClick('placeOrderBtn', placeOrder);
  onClick('saveReceivingBtn', saveReceiving);
  onClick('saveApiBtn', saveApi);
  onClick('addProductBtn', addProduct);
  onClick('botFab', openBot);
  onClick('botCloseBtn', openBot);
  onClick('botSendBtn', sendBot);
  on('botText', 'keydown', (e) => { if (e.key === 'Enter') sendBot(); });
  onClick('footerBotBtn', openBot);
  onClick('footerLookupBtn', () => showTab('lookup'));
  onClick('viewGridBtn', () => setView('grid'));
  onClick('viewListBtn', () => setView('list'));

  const each = (sel, fn) => document.querySelectorAll(sel).forEach(fn);
  each('.design-pills button[data-design]', (b) => b.addEventListener('click', () => setDesign(b.dataset.design)));
  each('#mainMenu button[data-goto]', (b) => b.addEventListener('click', () => showTab(b.dataset.goto)));
  each('#sortPills button[data-sort]', (b) => b.addEventListener('click', () => setSort(b.dataset.sort)));
  each('.bottom-nav button[data-nav]', (b) => b.addEventListener('click', () => {
    const nav = b.dataset.nav;
    if (nav === 'home') showHome();
    else if (nav === 'products') showProducts();
    else showTab(nav);
  }));
  each('.btn-back[data-back]', (b) => b.addEventListener('click', () => showTab('shop', 'products')));
  each('[data-policy]', (b) => b.addEventListener('click', () => showPolicy(b.dataset.policy)));
  each('.service-tile[data-service]', (b) => b.addEventListener('click', () => goFeatured(b.dataset.service)));
  $('quickAmounts').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-amount]');
    if (b) pickAmount(Number(b.dataset.amount), b);
  });

  // Ủy quyền click cho nội dung sinh động: ô danh mục + thẻ sản phẩm.
  $('platformFilters').addEventListener('click', (e) => {
    const b = e.target.closest('.cat-tile');
    if (b) setFilter(b.dataset.platform);
  });
  const openFromCard = (e) => {
    const card = e.target.closest('.p-card');
    if (card) openProduct(Number(card.dataset.id));
  };
  $('productGrid').addEventListener('click', openFromCard);
  $('featTrack').addEventListener('click', openFromCard);
  const openOnEnter = (e) => {
    if (e.key !== 'Enter') return;
    const card = e.target.closest('.p-card');
    if (card) openProduct(Number(card.dataset.id));
  };
  $('productGrid').addEventListener('keydown', openOnEnter);
  $('featTrack').addEventListener('keydown', openOnEnter);
}

try { localStorage.removeItem('ctn_theme'); localStorage.removeItem('ctn_theme_v2'); } catch (e) {}
applyDesign(currentDesign(), false);
wireEvents();
renderQuickAmounts();
(async () => {
  const stats = await api('/api/stats').catch(() => null);
  if (stats) {
    $('statSold').textContent = stats.sold_30d;
    $('statProducts').textContent = stats.total_products;
  }
  if (token()) {
    try { await enterShop(); } catch (e) { $('gate').hidden = false; }
  }
  updateCartBadge();
  setupDialogLightDismiss();
  setupFeatCarousel();
})();
