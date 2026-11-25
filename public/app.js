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
  const t = localStorage.getItem('ctn_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
  $('themeBtn').textContent = t === 'dark' ? '🌙' : '☀️';
}
$('themeBtn').onclick = () => { localStorage.setItem('ctn_theme', (localStorage.getItem('ctn_theme') || 'dark') === 'dark' ? 'light' : 'dark'); applyTheme(); };
$('menuBtn').onclick = () => { $('mainMenu').hidden = !$('mainMenu').hidden; };

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
  showTab('shop');
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
  Facebook: { c: '#1877F2', l: 'f' },
  TikTok: { c: '#111111', l: '♪' },
  Instagram: { c: '#cc2366', l: '◎' },
  YouTube: { c: '#FF0000', l: '▶' },
  Telegram: { c: '#229ED9', l: '✈' },
  Gmail: { c: '#EA4335', l: '✉' },
  X: { c: '#000000', l: 'X' },
  Zalo: { c: '#0068FF', l: 'Z' },
};
function showHome() { showTab('shop'); }
function showProducts() { showTab('shop'); setTimeout(() => { const g = document.getElementById('productGrid'); if (g) g.scrollIntoView({ behavior: 'smooth' }); }, 80); }
async function loadProducts() {
  const j = await api('/api/products'); products = j.products;
  const stats = await api('/api/stats');
  $('statSold').textContent = stats.sold_30d; $('statProducts').textContent = stats.total_products;
  const platforms = ['Tất cả', ...new Set(products.map(p => p.platform))];
  $('platformFilters').innerHTML = platforms.map(p => `<button class="${p === platformFilter ? 'active' : ''}" onclick="setFilter('${p}')">${p === 'Tất cả' ? '⭐ Tất cả' : p} ${p === 'Tất cả' ? products.length : products.filter(x => x.platform === p).length}</button>`).join('');
  const list = products.filter(p => platformFilter === 'Tất cả' || p.platform === platformFilter);
  $('emptyProducts').hidden = list.length > 0;
  const order = [];
  list.forEach(p => { if (!order.includes(p.platform)) order.push(p.platform); });
  $('productGrid').innerHTML = order.map(pl => {
    const items = list.filter(p => p.platform === pl);
    const st = PLATFORM_STYLE[pl] || { c: '#0b7a52', l: pl[0] };
    return `<div class="platform-panel">
      <div class="panel-head"><span class="panel-logo" style="background:${st.c}">${st.l}</span><b>${esc(pl)}</b><span class="muted small">${items.length} sản phẩm</span></div>
      <div class="platform-grid">${items.map(p => `
        <div class="product-card compact" onclick="openProduct(${p.id})">
          <div class="p-banner" style="background:${st.c}"><span>${esc(pl)}</span><i class="stock-badge ${p.stock > 0 ? 'in' : 'out'}">${p.stock > 0 ? 'Còn hàng' : 'Hết hàng'}</i></div>
          <div class="p-body">
            <b class="p-name">${esc(p.name)}</b>
            <span class="warranty-chip">🛡️ ${esc(p.warranty)}</span>
            <span class="price">${fmt(p.price)}</span>
            <span class="muted small">Còn ${p.stock} tài khoản</span>
            <div class="p-actions">
              <button class="btn-primary" onclick="event.stopPropagation();buyNow(${p.id})">Mua ngay</button>
              <button class="btn-ghost add-cart" onclick="event.stopPropagation();addToCart(${p.id})">+ Giỏ</button>
            </div>
          </div>
        </div>`).join('')}</div>
    </div>`;
  }).join('');
  updateCartBadge();
}
function setFilter(p) { platformFilter = p; loadProducts(); }
function openProduct(id) {
  const p = products.find(x => x.id === id); if (!p) return;
  $('productModalBox').innerHTML = `<button class="x" style="float:right;background:none;border:none;font-size:18px" onclick="closeModal()">✕</button>
    <span class="platform-tag">${esc(p.platform)}</span><h2>${esc(p.name)}</h2>
    <p class="muted">${esc(p.description)}</p><p class="price">${fmt(p.price)}</p>
    <p class="stock">Còn ${p.stock} tài khoản</p><p class="warranty">🛡️ ${esc(p.warranty)}</p>
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
function showTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.hidden = true);
  const map = { shop: 'tab-shop', wallet: 'tab-wallet', leaderboard: 'tab-leaderboard', lookup: 'tab-lookup', account: 'tab-account', cart: 'tab-cart', admin: 'tab-admin', orders: 'tab-account' };
  const id = map[tab] || 'tab-shop';
  $(id).hidden = false;
  $('mainMenu').hidden = true;
  document.querySelectorAll('.bottom-nav button').forEach(b => b.classList.remove('active'));
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
