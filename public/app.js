// Chợ Tài Nguyên Mmo — frontend (gọi API /api/*, token lưu localStorage, 30 ngày)
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('vi-VN') + 'đ';
let me = null, products = [], cart = JSON.parse(localStorage.getItem('ctn_cart') || '[]');
let platformFilter = 'Tất cả', authMode = 'register', selectedAmount = 0;

const token = () => localStorage.getItem('ctn_token');
const headers = () => ({ 'Content-Type': 'application/json', ...(token() ? { Authorization: 'Bearer ' + token() } : {}) });
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: headers() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Có lỗi xảy ra');
  return j;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- theme ----------
function applyTheme() {
  const t = localStorage.getItem('ctn_theme_v2') || 'light';
  document.documentElement.setAttribute('data-theme', t);
}
$('themeBtn').onclick = () => { localStorage.setItem('ctn_theme_v2', (localStorage.getItem('ctn_theme_v2') || 'light') === 'light' ? 'dark' : 'light'); applyTheme(); };
$('menuBtn').onclick = () => { $('mainMenu').hidden = !$('mainMenu').hidden; $('menuBtn').classList.toggle('open', !$('mainMenu').hidden); };

// ---------- gate / auth ----------
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
  $('authSwitch').innerHTML = mode === 'register'
    ? 'Đã có tài khoản? <a href="#" onclick="switchAuthMode(event)">Đăng nhập</a>'
    : 'Chưa có tài khoản? <a href="#" onclick="switchAuthMode(event)">Đăng ký</a>';
}
function switchAuthMode(e) { e.preventDefault(); setAuthMode(authMode === 'register' ? 'login' : 'register'); }
async function submitAuth(e) {
  e.preventDefault(); $('authError').textContent = '';
  try {
    const body = { username: $('authUser').value.trim(), password: $('authPass').value };
    if (authMode === 'register') body.full_name = $('authName').value.trim();
    const j = await api(authMode === 'register' ? '/api/register' : '/api/login', { method: 'POST', body: JSON.stringify(body) });
    localStorage.setItem('ctn_token', j.token);
    if (j.note) alert(j.note);
    await enterShop();
  } catch (err) { $('authError').textContent = err.message; }
}
function googleLogin() { alert('Shop chưa bật đăng nhập bằng Google. Bạn đăng ký bằng tên đăng nhập và mật khẩu nhé.'); }
async function logout() { try { await api('/api/logout', { method: 'POST' }); } catch {} localStorage.removeItem('ctn_token'); me = null; location.reload(); }
async function rename() {
  try { await api('/api/me/rename', { method: 'POST', body: JSON.stringify({ full_name: $('newName').value.trim() }) }); alert('Đã lưu tên mới.'); await loadMe(); } catch (e) { alert(e.message); }
}

// ---------- vào shop ----------
async function enterShop() {
  $('gate').hidden = true; $('shop').hidden = false; $('walletRow').hidden = false;
  await loadMe(); await loadProducts(); await loadNotifs(); await loadWallet();
  showTab('shop', 'home');
}
async function loadMe() {
  try {
    const j = await api('/api/me'); me = j.user;
    $('avatarBtn').textContent = (me.full_name || 'M')[0].toUpperCase();
    $('accountInfo').textContent = `${me.full_name} (@${me.username}) — Số dư ví: ${fmt(me.balance)}${me.is_owner ? ' — Bạn là chủ shop.' : ''}`;
    $('newName').value = me.full_name; $('orderName').value = me.full_name;
    $('adminMenuBtn').hidden = !me.is_owner;
    const mine = await api('/api/orders/mine');
    $('myOrders').innerHTML = mine.orders.map(o => `<li><span><b>${o.code}</b> — ${o.items.map(i => esc(i.name)).join(', ')}</span><span>${fmt(o.total)} — <b class="status-${o.status}">${statusText(o.status)}</b></span></li>`).join('') || '<li>Chưa có đơn hàng nào.</li>';
  } catch { me = null; }
}
function statusText(s) { return { pending: 'Chờ xử lý', paid: 'Đã thanh toán', delivered: 'Đã giao', cancelled: 'Đã hủy', verified: 'Đã xác minh' }[s] || s; }

// ---------- sản phẩm ----------
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
function showHome() { if ($('shop').hidden) { setActiveNav('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); return; } showTab('shop', 'home'); }
function showProducts() {
  if ($('shop').hidden) { setActiveNav('products'); toggleAuthPanel(true, 'register'); return; }
  showTab('shop', 'products'); setTimeout(() => { const g = document.getElementById('productGrid'); if (g) g.scrollIntoView({ behavior: 'smooth' }); }, 80);
}
async function loadProducts() {
  const j = await api('/api/products'); products = j.products;
  const stats = await api('/api/stats');
  $('statSold').textContent = stats.sold_30d; $('statProducts').textContent = stats.total_products;
  const platforms = ['Tất cả', ...new Set(products.map(p => p.platform))];
  $('platformFilters').innerHTML = platforms.map(p => {
    const n = p === 'Tất cả' ? products.length : products.filter(x => x.platform === p).length;
    const st = p === 'Tất cả' ? { c: '#111111', svg: '★' } : (PLATFORM_STYLE[p] || { c: '#0b7a52', svg: '<svg width="22" height="22" viewBox="0 0 24 24"><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="900" fill="#fff">' + p[0] + '</text></svg>' });
    return `<button class="${p === platformFilter ? 'active' : ''}" onclick="setFilter('${p}')"><span class="filter-logo" style="background:${st.c}">${st.svg}</span>${p} ${n}</button>`;
  }).join('');
  const list = products.filter(p => platformFilter === 'Tất cả' || p.platform === platformFilter);
  $('emptyProducts').hidden = list.length > 0;
  const order = [];
  list.forEach(p => { if (!order.includes(p.platform)) order.push(p.platform); });
  $('productGrid').innerHTML = order.map(pl => {
    const items = list.filter(p => p.platform === pl);
    const st = PLATFORM_STYLE[pl] || { c: '#0b7a52', svg: '<svg width="22" height="22" viewBox="0 0 24 24"><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="900" fill="#fff">' + pl[0] + '</text></svg>' };
    return `<div class="platform-panel">
      <div class="panel-head"><span class="panel-logo" style="background:${st.c}">${st.svg}</span><b>${esc(pl)}</b><span class="muted small"><span class="dot"></span> ${items.length} sản phẩm</span></div>
      <div class="platform-grid">${items.map(p => {
        const old = Number(p.old_price || 0);
        const disc = old > p.price ? Math.round((1 - p.price / old) * 100) : 0;
        const bh = (String(p.warranty || '').match(/(\d+)\s*ngày/) || [])[1];
        const sold = Number(p.sold || 0);
        return `
        <div class="product-card compact" onclick="openProduct(${p.id})">
          <div class="p-banner" style="background:${st.c}">
            <span class="p-banner-logo">${st.svg}</span>
            ${disc ? `<span class="disc-badge">-${disc}%</span>` : ''}
            <i class="stock-badge ${p.stock > 0 ? 'in' : 'out'}">${p.stock > 0 ? '● Còn hàng' : 'Hết hàng'}</i>
            ${bh ? `<span class="bh-pill">🛡️ BH ${bh} ngày</span>` : ''}
          </div>
          <div class="p-body">
            <b class="p-name">${esc(p.name)}</b>
            <span class="sold-line">Đã bán ${sold} • Còn ${p.stock}</span>
            ${p.is_hot ? '<span class="hot-pill">Hot</span>' : ''}
            <span class="price-row"><span class="price">${fmt(p.price)}</span>${old > p.price ? ` <s class="old-price">${fmt(old)}</s>` : ''}</span>
            <div class="p-actions">
              <button class="btn-primary" onclick="event.stopPropagation();buyNow(${p.id})">🛒 Mua ngay</button>
              <button class="btn-ghost detail-btn" onclick="event.stopPropagation();openProduct(${p.id})">Chi tiết sản phẩm</button>
            </div>
          </div>
        </div>`; }).join('')}</div>
    </div>`;
  }).join('');
  updateCartBadge();
}
function setFilter(p) { platformFilter = p; loadProducts(); }
function openProduct(id) {
  const p = products.find(x => x.id === id); if (!p) return;
  $('productModalBox').innerHTML = `<button class="x" style="float:right;background:none;border:none;font-size:18px" onclick="closeModal()">✕</button>
    <span class="platform-tag">${esc(p.platform)}</span><h2>${esc(p.name)}</h2>
    <p class="muted">${esc(p.description)}</p><p class="price">${fmt(p.price)}${Number(p.old_price || 0) > p.price ? ` <s class="old-price">${fmt(p.old_price)}</s> <span class="disc-badge">-${Math.round((1 - p.price / p.old_price) * 100)}%</span>` : ''}</p>
    <p class="stock">Đã bán ${Number(p.sold || 0)} • Còn ${p.stock} tài khoản</p><p class="warranty">🛡️ ${esc(p.warranty)}</p>
    <button class="btn-primary" onclick="buyNow(${p.id}); closeModal()">Mua ngay</button>
    <button class="btn-ghost" onclick="addToCart(${p.id}); closeModal()">Thêm vào giỏ</button>`;
  $('productModal').hidden = false;
}
function closeModal() { $('productModal').hidden = true; }
function addToCart(id) {
  const it = cart.find(x => x.product_id === id);
  if (it) it.qty++; else cart.push({ product_id: id, qty: 1 });
  localStorage.setItem('ctn_cart', JSON.stringify(cart)); updateCartBadge(); alert('Đã thêm vào giỏ hàng.');
}
function buyNow(id) { addToCartSilent(id); showTab('cart'); }
function addToCartSilent(id) {
  const it = cart.find(x => x.product_id === id);
  if (it) it.qty++; else cart.push({ product_id: id, qty: 1 });
  localStorage.setItem('ctn_cart', JSON.stringify(cart)); updateCartBadge();
}
function updateCartBadge() { $('cartCount').textContent = cart.reduce((s, x) => s + x.qty, 0); renderCart(); }
function renderCart() {
  if (!$('cartList')) return;
  let total = 0;
  $('cartList').innerHTML = cart.map((c, i) => {
    const p = products.find(x => x.id === c.product_id); if (!p) return '';
    total += p.price * c.qty;
    return `<li><span>${esc(p.name)} × ${c.qty}</span><span>${fmt(p.price * c.qty)} <button onclick="removeCart(${i})">✕</button></span></li>`;
  }).join('') || '<li>Giỏ hàng trống.</li>';
  $('cartTotal').textContent = fmt(total);
}
function removeCart(i) { cart.splice(i, 1); localStorage.setItem('ctn_cart', JSON.stringify(cart)); updateCartBadge(); }
async function placeOrder() {
  try {
    const j = await api('/api/orders', { method: 'POST', body: JSON.stringify({ items: cart, buyer_name: $('orderName').value, contact: $('orderContact').value, pay_method: $('payMethod').value }) });
    $('orderResult').innerHTML = `<p><b>Mã đơn của bạn: ${j.code}</b> — Tổng ${fmt(j.total)}. ${esc(j.message)}</p>`;
    cart = []; localStorage.setItem('ctn_cart', '[]'); updateCartBadge(); await loadMe(); await loadProducts(); await loadNotifs();
  } catch (e) { alert(e.message); }
}
let notifData = [], notifIdx = 0, notifTimer = null;
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'vừa xong';
  const m = Math.floor(s / 60); if (m < 60) return m + ' phút trước';
  const h = Math.floor(m / 60); if (h < 24) return h + ' giờ trước';
  return Math.floor(h / 24) + ' ngày trước';
}
function renderNotif() {
  const list = notifData;
  $('notifCount').textContent = list.length ? list.length + ' thông báo' : '';
  if (!list.length) { $('notifFeatured').innerHTML = ''; $('notifList').innerHTML = '<li>Chưa có đơn hàng nào.</li>'; $('notifDots').innerHTML = ''; return; }
  const cur = notifIdx % list.length;
  const n = list[cur];
  $('notifFeatured').innerHTML = `<div class="notif-featured"><span class="notif-avatar">${esc((n.buyer || 'K')[0])}</span><div class="notif-body"><b>${esc(n.buyer)}</b> ${n.status === 'paid' || n.status === 'delivered' ? 'vừa mua' : 'đã mua'} <b>${esc(n.product)}</b><div class="muted small">${timeAgo(n.created_at)} &nbsp;<span class="status-chip status-${n.status}">${statusText(n.status)}</span></div></div></div>`;
  $('notifList').innerHTML = list.filter((_, i) => i !== cur).slice(0, 3).map(x => `<li><span class="notif-avatar small">${esc((x.buyer || 'K')[0])}</span><span><b>${esc(x.buyer)}</b> đã mua <b>${esc(x.product)}</b> • ${timeAgo(x.created_at)} • <b class="status-${x.status}">${statusText(x.status)}</b></span></li>`).join('');
  $('notifDots').innerHTML = list.slice(0, 4).map((_, i) => `<i class="${i === cur ? 'on' : ''}" onclick="notifIdx=${i};renderNotif()"></i>`).join('');
}
async function loadNotifs() {
  try {
    const j = await api('/api/notifications');
    notifData = j.notifications || [];
    notifIdx = 0; renderNotif();
    if (notifTimer) clearInterval(notifTimer);
    if (notifData.length > 1) notifTimer = setInterval(() => { notifIdx = (notifIdx + 1) % notifData.length; renderNotif(); }, 5000);
  } catch {}
}
function showAllProducts() { if (typeof setFilter === 'function') setFilter('Tất cả'); const g = document.getElementById('productGrid'); if (g) g.scrollIntoView({ behavior: 'smooth' }); }

// ---------- ví / nạp tiền ----------
const QUICK = [20000, 50000, 100000, 200000, 500000, 1000000];
$('quickAmounts').innerHTML = QUICK.map(a => `<button onclick="pickAmount(${a}, this)">${fmt(a)}</button>`).join('');
function pickAmount(a, btn) { selectedAmount = a; document.querySelectorAll('#quickAmounts button').forEach(b => b.classList.remove('sel')); btn.classList.add('sel'); $('customAmount').value = a; }
$('depositMethod').onchange = () => { $('cardFields').hidden = $('depositMethod').value !== 'card'; };
async function loadWallet() {
  if (!me) return;
  try {
    const j = await api('/api/wallet');
    $('walletBalance').textContent = fmt(j.balance); $('walletBalance2').textContent = fmt(j.balance);
    $('depositHistory').innerHTML = j.deposits.map(d => `<li><span><b>${d.code}</b> — ${fmt(d.amount)} (${d.method})</span><span><b class="status-${d.status}">${statusText(d.status)}</b> ${d.status === 'pending' ? `<button onclick="checkApi('${d.code}')">Kiểm tra giao dịch qua API</button>` : ''}</span></li>`).join('') || '<li>Chưa có lịch sử nạp.</li>';
  } catch {}
}
function vietQR(amount, code, info) {
  // VietQR chuẩn EMVCo/NAPAS: tạo chuỗi payload, hiển thị bằng API ảnh QR công khai (api.qrserver.com)
  const crc = (s) => { let c = 0xffff; for (let i = 0; i < s.length; i++) { c ^= s.charCodeAt(i) << 8; for (let k = 0; k < 8; k++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; } return c.toString(16).toUpperCase().padStart(4, '0'); };
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
    const j = await api('/api/deposits', { method: 'POST', body: JSON.stringify({ amount, method, card_carrier: $('cardCarrier').value, card_serial: $('cardSerial').value, card_code: $('cardCode').value }) });
    const info = await api('/api/receiving-info');
    const apiStatus = await api('/api/api-status');
    let html = `<p><b>Mã nạp của bạn: ${j.code}</b> — ${fmt(j.amount)} — Trạng thái: Chờ xác minh.</p>`;
    if (method === 'bank' && info.account_number) {
      html += `<p>Ngân hàng: ${esc(info.bank_name)} — STK: <b>${esc(info.account_number)}</b> — Chủ TK: ${esc(info.account_holder)}<br>Nội dung chuyển khoản: <b>${j.code}</b></p><img src="${vietQR(j.amount, j.code, info)}" alt="VietQR" style="border-radius:12px">`;
    } else if (method === 'momo' && info.momo) html += `<p>MoMo nhận tiền: <b>${esc(info.momo)}</b> — Nội dung: <b>${j.code}</b></p>`;
    else if (method === 'zalopay' && info.zalopay) html += `<p>ZaloPay nhận tiền: <b>${esc(info.zalopay)}</b> — Nội dung: <b>${j.code}</b></p>`;
    else if (method === 'card') html += `<p>Đã ghi nhận thẻ cào. Chủ shop sẽ xác nhận thẻ rồi cộng tiền.</p>`;
    else html += `<p class="error">Shop chưa nhập thông tin nhận tiền. Chủ shop vào Quản lý shop → Thông tin nhận tiền &amp; mã QR.</p>`;
    html += apiStatus.connected
      ? `<p><button class="btn-primary" onclick="checkApi('${j.code}')">Kiểm tra giao dịch qua API</button></p>`
      : `<p class="error">Shop chưa kết nối API SePay/Casso nên chưa kiểm tra tự động được. Chủ shop kết nối API trong Quản lý shop.</p>`;
    $('depositResult').innerHTML = html;
    await loadWallet();
  } catch (e) { alert(e.message); }
}
async function checkApi(code) {
  try { const j = await api(`/api/deposits/${code}/check-api`, { method: 'POST' }); alert(j.message); await loadWallet(); await loadMe(); }
  catch (e) { alert(e.message); }
}
async function lookupOrder() {
  try {
    const j = await api('/api/orders/lookup', { method: 'POST', body: JSON.stringify({ code: $('lookupCode').value, contact: $('lookupContact').value }) });
    const o = j.order;
    $('lookupResult').innerHTML = `<p><b>${o.code}</b> — <b class="status-${o.status}">${statusText(o.status)}</b> — Tổng ${fmt(o.total)}</p><ul class="list">${o.items.map(i => `<li>${esc(i.name)} × ${i.qty} — ${fmt(i.price)}</li>`).join('')}</ul>`;
  } catch (e) { $('lookupResult').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}

// ---------- BXH ----------
async function loadLeaderboard() {
  const j = await api('/api/leaderboard');
  $('leaderboardList').innerHTML = j.top.map(t => `<li><span>🥇 ${t.rank}. ${esc(t.name)}</span><b class="gold">${fmt(t.total)}</b></li>`).join('') || '<li>Chưa có ai nạp tiền.</li>';
  if (me) { try { const m = await api('/api/leaderboard/mine'); $('myRank').textContent = m.rank ? `Hạng của bạn: #${m.rank} — Tổng nạp: ${fmt(m.total)}` : 'Bạn chưa có lượt nạp nào được xác minh.'; } catch {} }
}

// ---------- tab / điều hướng ----------
function setActiveNav(key) {
  document.querySelectorAll('.bottom-nav button').forEach(b => b.classList.toggle('active', key ? b.dataset.nav === key : false));
}
function showTab(tab, navKey) {
  // Chưa đăng nhập: các tab trong shop đều nằm sau cổng đăng ký — mở khung đăng ký/đăng nhập thay vì im lặng không làm gì.
  if ($('shop').hidden) {
    if (tab === 'shop' && navKey === 'home') { setActiveNav('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setActiveNav(navKey || null);
    toggleAuthPanel(true, 'register');
    return;
  }
  document.querySelectorAll('.tab').forEach(t => t.hidden = true);
  const map = { shop: 'tab-shop', wallet: 'tab-wallet', leaderboard: 'tab-leaderboard', lookup: 'tab-lookup', account: 'tab-account', cart: 'tab-cart', admin: 'tab-admin', orders: 'tab-account' };
  const id = map[tab] || 'tab-shop';
  $(id).hidden = false;
  $('mainMenu').hidden = true;
  const navMap = { shop: 'products', wallet: 'wallet', orders: 'orders', account: 'account' };
  setActiveNav(navKey || navMap[tab] || null);
  if (tab === 'wallet') loadWallet();
  if (tab === 'leaderboard') loadLeaderboard();
  if (tab === 'admin') loadAdmin();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- chính sách ----------
const POLICIES = {
  purchase: 'Chính sách mua hàng\n\nChọn sản phẩm, bấm Mua ngay, nhập thông tin liên hệ để nhận tài khoản. Giá hiển thị là giá đang bán tại thời điểm bạn xem.',
  payment: 'Chính sách thanh toán\n\nThanh toán bằng số dư ví (trừ ngay khi đặt hàng) hoặc đặt trước rồi thanh toán sau. Nạp tiền tối thiểu 10.000đ, chuyển đúng nội dung mã NAP… rồi kiểm tra qua API SePay/Casso.',
  delivery: 'Chính sách giao hàng\n\nTài khoản được giao sau khi đơn thanh toán xong. Shop giao qua đúng SĐT / Zalo / Telegram bạn để lại khi đặt hàng.',
  privacy: 'Chính sách bảo mật\n\nShop chỉ dùng thông tin bạn để lại để giao tài khoản và tra cứu đơn. Mỗi tài khoản chỉ xem được đơn của mình; tra cứu công khai cần cả mã đơn và thông tin liên hệ khớp.',
  refund: 'Hoàn tiền & đổi trả\n\nBảo hành 1 đổi 1 rõ ràng theo thời hạn ghi trên từng sản phẩm. Tài khoản lỗi, sai thông tin: gửi mã đơn để được đổi hoặc hoàn tiền.',
  faq: 'Câu hỏi thường gặp\n\n1. Nạp tiền bao lâu thì cộng? Khi kiểm tra qua API khớp đúng số tiền + mã NAP… thì cộng ngay.\n2. Quên mã đơn thì sao? Vào Tài khoản → Đơn hàng của tôi (cần đăng nhập).\n3. Đăng nhập Google được không? Chưa. Shop chưa bật đăng nhập bằng Google.',
};
function showPolicy(key) { const box = $('policyBox'); box.hidden = false; box.textContent = POLICIES[key] || ''; box.scrollIntoView({ behavior: 'smooth' }); }

// ---------- bot ----------
function openBot() { $('botPanel').hidden = !$('botPanel').hidden; }
async function sendBot() {
  const text = $('botText').value.trim(); if (!text) return;
  $('botLog').innerHTML += `<p class="bot-msg"><b>Bạn:</b> ${esc(text)}</p>`; $('botText').value = '';
  try { const j = await api('/api/bot', { method: 'POST', body: JSON.stringify({ message: text }) }); $('botLog').innerHTML += `<p class="bot-msg">${esc(j.reply)}</p>`; }
  catch { $('botLog').innerHTML += `<p class="bot-msg">Bot đang bận, bạn thử lại sau nhé.</p>`; }
  $('botLog').scrollTop = $('botLog').scrollHeight;
}

// ---------- chủ shop ----------
async function loadAdmin() {
  if (!me || !me.is_owner) { alert('Chỉ chủ shop mới vào được mục này.'); showTab('shop'); return; }
  try {
    const ov = await api('/api/admin/overview');
    $('adminOverview').textContent = `Yêu cầu nạp đang chờ: ${ov.pending_deposits} • Tổng đơn: ${ov.total_orders} • Doanh thu (đã thanh toán/giao): ${fmt(ov.revenue)}`;
    const s = await api('/api/admin/settings');
    $('sBankName').value = s.recv_bank_name || ''; $('sBankBin').value = s.recv_bank_bin || '';
    $('sAccNum').value = s.recv_account_number || ''; $('sAccHolder').value = s.recv_account_holder || '';
    $('sMomo').value = s.recv_momo || ''; $('sZalo').value = s.recv_zalopay || '';
    $('sGateway').value = s.api_gateway || '';
    $('apiStatus').textContent = s.api_connected ? `Đã kết nối API (${s.api_gateway}). Key đã lưu, không hiển thị lại.` : 'Chưa kết nối API. Nạp tiền qua QR sẽ không tự cộng được.';
    const prods = await api('/api/admin/products');
    $('adminProducts').innerHTML = prods.products.map(p => `<li><span>${esc(p.platform)} — ${esc(p.name)} — ${fmt(p.price)} — Còn ${p.stock} ${p.active ? '' : '(đang ẩn)'}</span><span><button onclick="editProduct(${p.id})">Sửa</button> <button onclick="deleteProduct(${p.id})">Xóa</button></span></li>`).join('');
    const orders = await api('/api/admin/orders');
    $('adminOrders').innerHTML = orders.orders.map(o => `<li><span><b>${o.code}</b> — ${fmt(o.total)} — ${o.buyer_name}</span><span><select onchange="setOrderStatus('${o.code}', this.value)">${['pending', 'paid', 'delivered', 'cancelled'].map(st => `<option value="${st}" ${o.status === st ? 'selected' : ''}>${statusText(st)}</option>`).join('')}</select></span></li>`).join('') || '<li>Chưa có đơn nào.</li>';
    const deps = await api('/api/admin/deposits');
    $('adminDeposits').innerHTML = deps.deposits.filter(d => d.status === 'pending').map(d => `<li><span><b>${d.code}</b> — ${fmt(d.amount)} — ${d.method} — @${esc(d.username)}</span><span><button onclick="confirmDeposit('${d.code}')">Xác nhận cộng tiền</button></span></li>`).join('') || '<li>Không có yêu cầu nạp đang chờ.</li>';
  } catch (e) { alert(e.message); }
}
async function saveReceiving() {
  try { await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({ recv_bank_name: $('sBankName').value, recv_bank_bin: $('sBankBin').value, recv_account_number: $('sAccNum').value, recv_account_holder: $('sAccHolder').value, recv_momo: $('sMomo').value, recv_zalopay: $('sZalo').value }) }); alert('Đã lưu thông tin nhận tiền.'); }
  catch (e) { alert(e.message); }
}
async function saveApi() {
  try { await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({ api_gateway: $('sGateway').value, api_key: $('sApiKey').value }) }); alert('Đã lưu API. Key chỉ lưu trên máy chủ, không hiển thị lại.'); $('sApiKey').value = ''; await loadAdmin(); }
  catch (e) { alert(e.message); }
}
async function addProduct() {
  try { await api('/api/admin/products', { method: 'POST', body: JSON.stringify({ platform: $('pPlatform').value, name: $('pName').value, price: Number($('pPrice').value), stock: Number($('pStock').value), warranty: $('pWarranty').value || 'Bảo hành 1 đổi 1', description: $('pDesc').value }) }); alert('Đã thêm sản phẩm.'); await loadAdmin(); await loadProducts(); }
  catch (e) { alert(e.message); }
}
async function editProduct(id) {
  const p = products.find(x => x.id === id) || (await api('/api/admin/products')).products.find(x => x.id === id);
  const price = prompt('Giá mới (VNĐ):', p.price); if (price === null) return;
  const stock = prompt('Tồn kho mới:', p.stock); if (stock === null) return;
  try { await api(`/api/admin/products/${id}`, { method: 'PUT', body: JSON.stringify({ ...p, price: Number(price), stock: Number(stock) }) }); await loadAdmin(); await loadProducts(); }
  catch (e) { alert(e.message); }
}
async function deleteProduct(id) { if (!confirm('Xóa sản phẩm này?')) return; try { await api(`/api/admin/products/${id}`, { method: 'DELETE' }); await loadAdmin(); await loadProducts(); } catch (e) { alert(e.message); } }
async function setOrderStatus(code, status) { try { await api(`/api/admin/orders/${code}/status`, { method: 'PUT', body: JSON.stringify({ status }) }); } catch (e) { alert(e.message); } }
async function confirmDeposit(code) { if (!confirm(`Xác nhận cộng tiền cho yêu cầu ${code}? Chỉ bấm khi đã kiểm tra tiền/thẻ thật.`)) return; try { const j = await api(`/api/admin/deposits/${code}/confirm`, { method: 'POST' }); alert(j.message); await loadAdmin(); } catch (e) { alert(e.message); } }

// ---------- khởi động ----------
applyTheme();
(async () => {
  const stats = await api('/api/stats').catch(() => null);
  if (stats) { $('statSold').textContent = stats.sold_30d; $('statProducts').textContent = stats.total_products; }
  if (token()) { try { await enterShop(); } catch { $('gate').hidden = false; } }
  updateCartBadge();
})();
