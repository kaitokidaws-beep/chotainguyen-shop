// Chợ Tài Nguyên Mmo — backend Express + SQLite (node:sqlite).
// Chạy: npm install && npm start  →  http://localhost:3000
const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const { db, setting, setSetting } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- tiện ích ----------
const fmt = (n) => Number(n || 0).toLocaleString('vi-VN') + 'đ';
function maskName(name) {
  const s = String(name || '').trim();
  if (s.length <= 2) return s[0] + '***';
  return s[0] + 'i***'.slice(0, 0) + s.slice(1, 2) + '***';
}
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function newCode(prefix) {
  return prefix + crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 8);
}
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  const sess = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(token, Date.now());
  if (!sess) return res.status(401).json({ error: 'Phiên đã hết hạn, đăng nhập lại' });
  const user = db.prepare('SELECT id, full_name, username, is_owner, balance FROM users WHERE id = ?').get(sess.user_id);
  if (!user) return res.status(401).json({ error: 'Tài khoản không tồn tại' });
  req.user = user; req.token = token; next();
}
function optionalAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (token) {
    const sess = db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?').get(token, Date.now());
    if (sess) req.user = db.prepare('SELECT id, full_name, username, is_owner, balance FROM users WHERE id = ?').get(sess.user_id) || null;
  }
  next();
}
function requireOwner(req, res, next) {
  if (!req.user || !req.user.is_owner) return res.status(403).json({ error: 'Chỉ chủ shop mới dùng được mục này' });
  next();
}
function publicUser(u) { return { id: u.id, full_name: u.full_name, username: u.username, is_owner: !!u.is_owner, balance: u.balance }; }

// ---------- auth ----------
app.post('/api/register', (req, res) => {
  const fullName = String(req.body.full_name || '').trim();
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!fullName) return res.status(400).json({ error: 'Nhập họ tên' });
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return res.status(400).json({ error: 'Tên đăng nhập 3–40 ký tự: chữ thường, số, . _ -' });
  if (password.length < 4) return res.status(400).json({ error: 'Mật khẩu ít nhất 4 ký tự' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) return res.status(400).json({ error: 'Tên đăng nhập đã có người dùng' });
  const isOwner = db.prepare('SELECT COUNT(*) AS c FROM users').get().c === 0 ? 1 : 0; // tài khoản đầu tiên là chủ shop
  const salt = crypto.randomBytes(16).toString('hex');
  const info = db.prepare('INSERT INTO users (full_name, username, password_hash, salt, is_owner, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(fullName, username, hashPassword(password, salt), salt, isOwner, Date.now());
  const user = db.prepare('SELECT id, full_name, username, is_owner, balance FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, Date.now() + 30 * 24 * 3600 * 1000);
  res.json({ token, user: publicUser(user), is_owner: !!isOwner, note: isOwner ? 'Bạn là tài khoản đầu tiên nên là chủ shop.' : undefined });
});
app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row || hashPassword(password, row.salt) !== row.password_hash) return res.status(400).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, row.id, Date.now() + 30 * 24 * 3600 * 1000);
  res.json({ token, user: publicUser(row) });
});
app.post('/api/logout', auth, (req, res) => { db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));
app.post('/api/me/rename', auth, (req, res) => {
  const name = String(req.body.full_name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nhập họ tên mới' });
  db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(name, req.user.id);
  res.json({ ok: true });
});

// ---------- sản phẩm ----------
app.get('/api/products', (req, res) => {
  const rows = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY id').all();
  res.json({ products: rows });
});
app.get('/api/stats', (req, res) => {
  const since = Date.now() - 30 * 24 * 3600 * 1000;
  const sold = db.prepare("SELECT COALESCE(SUM(json_each.value), 0) AS n FROM orders, json_each(orders.items_json, '$.qty') WHERE orders.status IN ('paid','delivered') AND orders.created_at > ?").get(since);
  // đếm số tài khoản đã bán = tổng số lượng trong đơn paid/delivered 30 ngày qua
  let soldCount = 0;
  try {
    const rows = db.prepare("SELECT items_json FROM orders WHERE status IN ('paid','delivered') AND created_at > ?").all(since);
    for (const r of rows) for (const it of JSON.parse(r.items_json)) soldCount += Number(it.qty || 0);
  } catch { soldCount = 0; }
  const totalProducts = db.prepare('SELECT COUNT(*) AS c FROM products WHERE active = 1').get().c;
  res.json({ sold_30d: soldCount, total_products: totalProducts, sold_raw: sold });
});

// ---------- giỏ / đặt hàng ----------
app.post('/api/orders', optionalAuth, (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const buyerName = String(req.body.buyer_name || req.user?.full_name || '').trim();
  const contact = String(req.body.contact || '').trim();
  const payMethod = req.body.pay_method === 'manual' ? 'manual' : 'wallet';
  if (!items.length) return res.status(400).json({ error: 'Giỏ hàng trống' });
  if (!buyerName || !contact) return res.status(400).json({ error: 'Nhập họ tên và SĐT / Zalo / Telegram để nhận tài khoản' });
  let total = 0; const lines = [];
  for (const it of items) {
    const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(Number(it.product_id));
    if (!p) return res.status(400).json({ error: 'Có sản phẩm không còn bán' });
    const qty = Math.max(1, Number(it.qty || 1));
    if (p.stock < qty) return res.status(400).json({ error: `Sản phẩm "${p.name}" chỉ còn ${p.stock} cái` });
    total += p.price * qty;
    lines.push({ product_id: p.id, platform: p.platform, name: p.name, price: p.price, qty });
  }
  const userId = req.user ? req.user.id : null;
  if (payMethod === 'wallet') {
    if (!req.user) return res.status(401).json({ error: 'Thanh toán bằng ví cần đăng nhập' });
    if (req.user.balance < total) return res.status(400).json({ error: `Ví chỉ còn ${fmt(req.user.balance)}, cần ${fmt(total)}. Nạp thêm tiền rồi đặt lại.` });
    db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(total, req.user.id);
  }
  for (const l of lines) db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(l.qty, l.product_id);
  const code = newCode('DH');
  db.prepare('INSERT INTO orders (code, user_id, buyer_name, contact, items_json, total, pay_method, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(code, userId, buyerName, contact, JSON.stringify(lines), total, payMethod, payMethod === 'wallet' ? 'paid' : 'pending', Date.now());
  res.json({ code, total, pay_method: payMethod, message: payMethod === 'wallet' ? 'Đã thanh toán bằng ví. Lưu mã đơn để tra cứu.' : 'Đã tạo đơn. Lưu mã đơn để tra cứu.' });
});
app.get('/api/orders/mine', auth, (req, res) => {
  const rows = db.prepare('SELECT code, items_json, total, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json({ orders: rows.map(r => ({ ...r, items: JSON.parse(r.items_json) })) });
});
app.post('/api/orders/lookup', (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase();
  const contact = String(req.body.contact || '').trim();
  if (!code || !contact) return res.status(400).json({ error: 'Nhập mã đơn và thông tin liên hệ lúc đặt hàng' });
  const row = db.prepare('SELECT code, items_json, total, status, created_at FROM orders WHERE code = ? AND contact = ?').get(code, contact);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy đơn với mã và liên hệ này' });
  res.json({ order: { ...row, items: JSON.parse(row.items_json) } });
});
app.get('/api/notifications', (req, res) => {
  const rows = db.prepare("SELECT buyer_name, items_json, status, created_at FROM orders WHERE status IN ('paid','delivered','pending') ORDER BY created_at DESC LIMIT 8").all();
  res.json({ notifications: rows.map(r => {
    const items = JSON.parse(r.items_json);
    return { buyer: maskName(r.buyer_name), product: items[0]?.name || '', count: items.length, status: r.status, created_at: r.created_at };
  }) });
});
// ---------- hoạt động gần đây (đơn đã trả + đơn mới đặt + nạp đã xác minh + đăng ký mới) ----------
app.get('/api/activity', (req, res) => {
  const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 6));
  const items = [];
  for (const r of db.prepare("SELECT buyer_name, items_json, total, created_at FROM orders WHERE status IN ('paid','delivered') ORDER BY created_at DESC LIMIT ?").all(limit)) {
    const it = JSON.parse(r.items_json);
    items.push({ type: 'purchase', name: maskName(r.buyer_name), desc: 'Thanh toán thành công · ' + (it[0]?.name || 'Tài khoản'), amount: -r.total, created_at: r.created_at });
  }
  for (const r of db.prepare("SELECT buyer_name, items_json, created_at FROM orders WHERE status = 'pending' ORDER BY created_at DESC LIMIT ?").all(limit)) {
    const it = JSON.parse(r.items_json);
    items.push({ type: 'order', name: maskName(r.buyer_name), desc: 'Đặt hàng · ' + (it[0]?.name || 'Tài khoản'), amount: null, created_at: r.created_at });
  }
  const methodText = { bank: 'Chuyển khoản ngân hàng', momo: 'MoMo', zalopay: 'ZaloPay', card: 'Thẻ cào' };
  for (const r of db.prepare("SELECT d.amount, d.method, d.created_at, u.full_name FROM deposits d JOIN users u ON u.id = d.user_id WHERE d.status = 'verified' ORDER BY d.created_at DESC LIMIT ?").all(limit)) {
    items.push({ type: 'topup', name: maskName(r.full_name), desc: 'Nạp tiền thành công · ' + (methodText[r.method] || 'Chuyển khoản'), amount: r.amount, created_at: r.created_at });
  }
  for (const r of db.prepare('SELECT full_name, created_at FROM users ORDER BY created_at DESC LIMIT ?').all(limit)) {
    items.push({ type: 'register', name: maskName(r.full_name), desc: 'Đăng ký tài khoản mới · Gia nhập nền tảng', amount: null, created_at: r.created_at });
  }
  items.sort((a, b) => b.created_at - a.created_at);
  res.json({ activity: items.slice(0, limit) });
});

// ---------- ví / nạp tiền ----------
app.get('/api/wallet', auth, (req, res) => {
  const u = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id);
  const rows = db.prepare('SELECT code, amount, method, status, created_at, verified_at FROM deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  res.json({ balance: u.balance, deposits: rows });
});
app.get('/api/receiving-info', (req, res) => {
  res.json({
    bank_name: setting('recv_bank_name'), bank_bin: setting('recv_bank_bin'),
    account_number: setting('recv_account_number'), account_holder: setting('recv_account_holder'),
    momo: setting('recv_momo'), zalopay: setting('recv_zalopay'),
  });
});
app.post('/api/deposits', auth, (req, res) => {
  const amount = Number(req.body.amount);
  const method = String(req.body.method || 'bank');
  if (!Number.isFinite(amount) || amount < 10000) return res.status(400).json({ error: 'Số tiền nạp tối thiểu 10.000đ' });
  if (!['bank', 'momo', 'zalopay', 'card'].includes(method)) return res.status(400).json({ error: 'Chọn phương thức nạp' });
  const code = newCode('NAP');
  db.prepare('INSERT INTO deposits (code, user_id, amount, method, status, card_carrier, card_serial, card_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    code, req.user.id, amount, method, 'pending',
    req.body.card_carrier || null, req.body.card_serial || null, req.body.card_code || null, Date.now());
  res.json({ code, amount, method, message: 'Đã tạo yêu cầu nạp. Chuyển tiền đúng nội dung mã này rồi bấm kiểm tra giao dịch qua API.' });
});
app.get('/api/deposits/:code', auth, (req, res) => {
  const row = db.prepare('SELECT * FROM deposits WHERE code = ? AND user_id = ?').get(String(req.params.code).toUpperCase(), req.user.id);
  if (!row) return res.status(404).json({ error: 'Không tìm thấy yêu cầu nạp này' });
  res.json({ deposit: row });
});

// ---------- kiểm tra giao dịch qua API (SePay / Casso) — chỉ cộng tiền khi khớp thật ----------
// SePay: GET https://my.sepay.vn/userapi/transactions/list (header Authorization: Bearer <API key>)
// Casso:  GET https://oauth.casso.vn/v2/transactions (header Authorization: Apikey <API key>)
// Khớp khi: số tiền đúng + nội dung chuyển khoản chứa mã NAP…, và giao dịch chưa dùng cho lần nạp khác.
async function fetchBankTransactions() {
  const gateway = setting('api_gateway', '');
  const key = setting('api_key', '');
  if (!gateway || !key) return { connected: false, transactions: [] };
  try {
    if (gateway === 'sepay') {
      const r = await fetch('https://my.sepay.vn/userapi/transactions/list?limit=100', { headers: { Authorization: 'Bearer ' + key } });
      if (!r.ok) return { connected: false, error: 'SePay trả lỗi HTTP ' + r.status };
      const j = await r.json();
      const list = (j.transactions || []).map(t => ({ id: String(t.id || t.reference_number || ''), amount: Number(t.amount_in || t.amount || 0), content: String(t.transaction_content || t.content || ''), time: t.transaction_date || '' }));
      return { connected: true, transactions: list };
    }
    if (gateway === 'casso') {
      const r = await fetch('https://oauth.casso.vn/v2/transactions?limit=100', { headers: { Authorization: 'Apikey ' + key } });
      if (!r.ok) return { connected: false, error: 'Casso trả lỗi HTTP ' + r.status };
      const j = await r.json();
      const list = (j.data?.records || []).map(t => ({ id: String(t.id || t.tid || ''), amount: Number(t.amount || 0), content: String(t.description || ''), time: t.when || '' }));
      return { connected: true, transactions: list };
    }
  } catch (e) { return { connected: false, error: String(e.message || e) }; }
  return { connected: false, transactions: [] };
}
app.post('/api/deposits/:code/check-api', auth, async (req, res) => {
  const code = String(req.params.code).toUpperCase();
  const dep = db.prepare('SELECT * FROM deposits WHERE code = ? AND user_id = ?').get(code, req.user.id);
  if (!dep) return res.status(404).json({ error: 'Không tìm thấy yêu cầu nạp này' });
  if (dep.status === 'verified') return res.json({ ok: true, message: 'Yêu cầu này đã được cộng tiền rồi.' });
  if (dep.method === 'card') return res.status(400).json({ error: 'Nạp bằng thẻ cào không kiểm tra qua API ngân hàng được. Chủ shop xác nhận thẻ trong Quản lý shop.' });
  const { connected, transactions, error } = await fetchBankTransactions();
  if (!connected) return res.status(400).json({ error: error || 'Shop chưa kết nối API SePay/Casso. Chủ shop vào Quản lý shop → API nạp tiền qua QR để kết nối.' });
  const match = transactions.find(t => t.amount === dep.amount && t.content.toUpperCase().includes(code) && !db.prepare('SELECT id FROM deposits WHERE bank_tx_id = ?').get(t.id));
  if (!match) return res.status(404).json({ error: 'Chưa thấy giao dịch khớp (đúng số tiền + đúng nội dung mã ' + code + '). Kiểm tra lại nội dung chuyển khoản rồi thử lại.' });
  db.prepare("UPDATE deposits SET status = 'verified', bank_tx_id = ?, verified_at = ? WHERE id = ?").run(match.id, Date.now(), dep.id);
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(dep.amount, dep.user_id);
  res.json({ ok: true, message: `Đã khớp giao dịch và cộng ${fmt(dep.amount)} vào ví.` });
});
app.get('/api/api-status', (req, res) => {
  res.json({ connected: !!(setting('api_gateway') && setting('api_key')), gateway: setting('api_gateway') || null });
});
app.get('/api/leaderboard', (req, res) => {
  const rows = db.prepare(`
    SELECT u.full_name AS name, COALESCE(SUM(d.amount), 0) AS total
    FROM deposits d JOIN users u ON u.id = d.user_id
    WHERE d.status = 'verified' GROUP BY d.user_id ORDER BY total DESC LIMIT 20`).all();
  const mine = req.headers.authorization ? null : null;
  res.json({ top: rows.map((r, i) => ({ rank: i + 1, name: maskName(r.name), total: r.total })) });
});
app.get('/api/leaderboard/mine', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, COALESCE(SUM(d.amount), 0) AS total FROM deposits d JOIN users u ON u.id = d.user_id
    WHERE d.status = 'verified' GROUP BY d.user_id ORDER BY total DESC`).all();
  const idx = rows.findIndex(r => r.id === req.user.id);
  res.json({ rank: idx >= 0 ? idx + 1 : null, total: idx >= 0 ? rows[idx].total : 0 });
});

// ---------- bot hỗ trợ 24/7 (trả lời tự động theo catalog thật) ----------
app.post('/api/bot', optionalAuth, (req, res) => {
  const q = String(req.body.message || '').toLowerCase();
  const reply = (async () => {
    if (/giá|bao nhiêu|mua/.test(q)) {
      const rows = db.prepare('SELECT platform, name, price FROM products WHERE active = 1 ORDER BY price LIMIT 5').all();
      return 'Giá tham khảo: ' + rows.map(r => `${r.name} — ${fmt(r.price)}`).join(' | ') + '. Chọn sản phẩm rồi bấm Mua ngay nhé.';
    }
    if (/nạp|nap|ví|nap tien/.test(q)) return 'Nạp tiền: vào tab Nạp tiền, chọn số tiền (tối thiểu 10.000đ), chuyển đúng nội dung mã NAP… rồi bấm "Kiểm tra giao dịch qua API". Tiền chỉ cộng khi khớp đúng số tiền + mã.';
    if (/bảo hành|doi|đổi/.test(q)) return 'Shop bảo hành 1 đổi 1 theo thời hạn ghi trên từng sản phẩm. Gửi mã đơn (DH…) để mình kiểm tra.';
    if (/đơn|tra cứu|dh/.test(q)) {
      const m = q.match(/dh[0-9a-f]{4,}/i);
      if (m) {
        const row = db.prepare('SELECT status, total FROM orders WHERE code = ?').get(m[0].toUpperCase());
        if (row) return `Đơn ${m[0].toUpperCase()}: ${row.status === 'paid' ? 'đã thanh toán' : row.status === 'delivered' ? 'đã giao' : row.status === 'cancelled' ? 'đã hủy' : 'chờ xử lý'}, tổng ${fmt(row.total)}.`;
        return 'Không tìm thấy đơn này. Nhập đúng mã DH… và thông tin liên hệ lúc đặt hàng ở mục Tra cứu đơn.';
      }
      return 'Gửi mã đơn DH… để mình kiểm tra, hoặc vào mục Tra cứu đơn nhập mã + thông tin liên hệ.';
    }
    if (/chào|hello|hi/.test(q)) return 'Chào bạn, mình là bot hỗ trợ của Chợ Tài Nguyên Mmo, online 24/7. Bạn cần hỏi giá, nạp tiền, bảo hành hay tra cứu đơn?';
    return 'Mình là bot hỗ trợ 24/7 của Chợ Tài Nguyên Mmo. Bạn hỏi về giá, nạp tiền, bảo hành 1 đổi 1 hay tra cứu đơn (gửi mã DH…) nhé.';
  })();
  Promise.resolve(reply).then(text => res.json({ reply: text }));
});

// ---------- chủ shop ----------
app.get('/api/admin/overview', auth, requireOwner, (req, res) => {
  const pending = db.prepare("SELECT COUNT(*) AS c FROM deposits WHERE status = 'pending'").get().c;
  const orders = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
  const revenue = db.prepare("SELECT COALESCE(SUM(total),0) AS s FROM orders WHERE status IN ('paid','delivered')").get().s;
  res.json({ pending_deposits: pending, total_orders: orders, revenue });
});
app.get('/api/admin/products', auth, requireOwner, (req, res) => {
  res.json({ products: db.prepare('SELECT * FROM products ORDER BY id').all() });
});
app.post('/api/admin/products', auth, requireOwner, (req, res) => {
  const { platform, name, price, stock, warranty, description } = req.body;
  if (!name || !platform || !Number.isFinite(Number(price))) return res.status(400).json({ error: 'Nhập đủ nền tảng, tên và giá' });
  const info = db.prepare('INSERT INTO products (platform, name, price, stock, warranty, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(platform, name, Number(price), Number(stock || 0), warranty || 'Bảo hành 1 đổi 1', description || '', Date.now());
  res.json({ id: info.lastInsertRowid });
});
app.put('/api/admin/products/:id', auth, requireOwner, (req, res) => {
  const { platform, name, price, stock, warranty, description, active } = req.body;
  db.prepare('UPDATE products SET platform = ?, name = ?, price = ?, stock = ?, warranty = ?, description = ?, active = ? WHERE id = ?').run(platform, name, Number(price), Number(stock), warranty, description, active ? 1 : 0, Number(req.params.id));
  res.json({ ok: true });
});
app.delete('/api/admin/products/:id', auth, requireOwner, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});
app.get('/api/admin/orders', auth, requireOwner, (req, res) => {
  const rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100').all();
  res.json({ orders: rows.map(r => ({ ...r, items: JSON.parse(r.items_json) })) });
});
app.put('/api/admin/orders/:code/status', auth, requireOwner, (req, res) => {
  const status = String(req.body.status || '');
  if (!['pending', 'paid', 'delivered', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Trạng thái không hợp lệ' });
  db.prepare('UPDATE orders SET status = ? WHERE code = ?').run(status, String(req.params.code).toUpperCase());
  res.json({ ok: true });
});
app.get('/api/admin/deposits', auth, requireOwner, (req, res) => {
  const rows = db.prepare('SELECT d.*, u.username FROM deposits d JOIN users u ON u.id = d.user_id ORDER BY d.created_at DESC LIMIT 100').all();
  res.json({ deposits: rows });
});
// Chủ shop xác nhận thủ công (chỉ dùng cho thẻ cào / trường hợp ngoại lệ, không phải tự động cộng khi chưa kiểm tra)
app.post('/api/admin/deposits/:code/confirm', auth, requireOwner, (req, res) => {
  const dep = db.prepare('SELECT * FROM deposits WHERE code = ?').get(String(req.params.code).toUpperCase());
  if (!dep) return res.status(404).json({ error: 'Không tìm thấy' });
  if (dep.status === 'verified') return res.json({ ok: true, message: 'Đã cộng tiền rồi.' });
  db.prepare("UPDATE deposits SET status = 'verified', verified_at = ? WHERE id = ?").run(Date.now(), dep.id);
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(dep.amount, dep.user_id);
  res.json({ ok: true, message: `Đã cộng ${fmt(dep.amount)} vào ví của ${dep.user_id}.` });
});
app.get('/api/admin/settings', auth, requireOwner, (req, res) => {
  res.json({
    recv_bank_name: setting('recv_bank_name'), recv_bank_bin: setting('recv_bank_bin'),
    recv_account_number: setting('recv_account_number'), recv_account_holder: setting('recv_account_holder'),
    recv_momo: setting('recv_momo'), recv_zalopay: setting('recv_zalopay'),
    api_gateway: setting('api_gateway'), api_connected: !!(setting('api_gateway') && setting('api_key')),
  });
});
app.post('/api/admin/settings', auth, requireOwner, (req, res) => {
  const allowed = ['recv_bank_name', 'recv_bank_bin', 'recv_account_number', 'recv_account_holder', 'recv_momo', 'recv_zalopay', 'api_gateway'];
  for (const k of allowed) if (req.body[k] !== undefined) setSetting(k, String(req.body[k]));
  if (req.body.api_key) setSetting('api_key', String(req.body.api_key)); // chỉ lưu, không bao giờ trả lại cho client
  res.json({ ok: true });
});

// ---------- SPA fallback ----------
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.listen(PORT, () => console.log(`Chợ Tài Nguyên Mmo chạy tại http://localhost:${PORT}`));
