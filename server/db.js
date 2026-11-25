// Database SQLite (Node 22+ dùng node:sqlite có sẵn, không cần cài thêm).
// File dữ liệu: shop.db (tạo tự động lần chạy đầu, kèm seed 12 sản phẩm mẫu).
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const db = new DatabaseSync(path.join(__dirname, '..', 'shop.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  is_owner INTEGER NOT NULL DEFAULT 0,
  balance INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  warranty TEXT NOT NULL DEFAULT 'Bảo hành 1 đổi 1',
  description TEXT NOT NULL DEFAULT '',
  old_price INTEGER NOT NULL DEFAULT 0,
  sold INTEGER NOT NULL DEFAULT 0,
  is_hot INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  user_id INTEGER,
  buyer_name TEXT NOT NULL,
  contact TEXT NOT NULL,
  items_json TEXT NOT NULL,
  total INTEGER NOT NULL,
  pay_method TEXT NOT NULL DEFAULT 'wallet',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tx_code TEXT,
  tx_time TEXT,
  card_carrier TEXT,
  card_serial TEXT,
  card_code TEXT,
  bank_tx_id TEXT,
  created_at INTEGER NOT NULL,
  verified_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
`);


// Migration: thêm giá cũ / đã bán / hot cho DB đã seed trước đây (không đụng users/orders/deposits).
for (const col of ['old_price INTEGER NOT NULL DEFAULT 0', 'sold INTEGER NOT NULL DEFAULT 0', 'is_hot INTEGER NOT NULL DEFAULT 0']) {
  try { db.exec(`ALTER TABLE products ADD COLUMN ${col}`); } catch {}
}
// Đồng bộ 2 sản phẩm flagship theo ảnh mẫu của shop (giá/g giá cũ/đã bán/tồn kho).
const fixSeed = [
  ['Page Facebook 10K Like — Đủ điều kiện bật kiếm tiền', 450000, 650000, 1, 5, 1],
  ['Facebook Clone US — Avatar đầy đủ, tương tác thật', 35000, 60000, 2, 118, 0],
];
for (const [nm, pr, op, sd, st, hot] of fixSeed) {
  db.prepare('UPDATE products SET price = ?, old_price = ?, sold = ?, stock = ?, is_hot = ? WHERE name = ?').run(pr, op, sd, st, hot, nm);
}
db.prepare("UPDATE products SET old_price = CASE WHEN old_price IS NULL OR old_price = 0 THEN CAST(price * 1.5 AS INTEGER) ELSE old_price END WHERE old_price IS NULL OR old_price = 0").run();

function setting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value ?? '');
}

// Seed 12 sản phẩm mẫu (chỉ chạy khi bảng products đang trống)
const count = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
if (count === 0) {
  const now = Date.now();
  const seed = [
    ['Facebook', 'Facebook Clone US — Avatar đầy đủ, tương tác thật', 35000, 60000, 2, 118, 'Bảo hành 1 đổi 1 trong 7 ngày', 'Clone US, avatar đầy đủ, có 2FA, email gốc.', 0],
    ['Facebook', 'Page Facebook 10K Like — Đủ điều kiện bật kiếm tiền', 450000, 650000, 1, 5, 'Bảo hành 1 đổi 1 trong 30 ngày', 'Page 10K like thật, đủ điều kiện bật kiếm tiền.', 1],
    ['Facebook', 'Facebook Clone Việt — Tương tác cao', 45000, 69000, 2, 40, 'Bảo hành 1 đổi 1 trong 7 ngày', 'Clone Việt, bạn bè thật, tương tác cao.', 0],
    ['TikTok', 'TikTok 1K Follow — Tăng nhanh', 129000, 199000, 1, 30, 'Bảo hành 1 đổi 1 trong 7 ngày', 'Tài khoản TikTok 1.000 follow, tăng nhanh trong 24h.', 0],
    ['TikTok', 'TikTok Cổ 2020 — Live đủ điều kiện', 259000, 399000, 2, 6, 'Bảo hành 1 đổi 1 trong 30 ngày', 'Tài khoản cổ 2020, đã bật live, đủ điều kiện kiếm tiền.', 0],
    ['Instagram', 'Instagram 1K Follow — Follow thật', 149000, 229000, 1, 20, 'Bảo hành 1 đổi 1 trong 7 ngày', 'Instagram 1.000 follow thật, tương tác ổn định.', 0],
    ['Instagram', 'Instagram Clone US — Email gốc, 2FA', 79000, 119000, 0, 35, 'Bảo hành 1 đổi 1 trong 7 ngày', 'Clone US, email gốc, đã bật 2FA.', 0],
    ['YouTube', 'YouTube 1K Sub — Kênh bật kiếm tiền', 299000, 459000, 1, 10, 'Bảo hành 1 đổi 1 trong 30 ngày', 'Kênh YouTube 1.000 sub, đủ điều kiện bật kiếm tiền.', 0],
    ['Telegram', 'Telegram Premium 1 năm', 189000, 289000, 2, 15, 'Bảo hành 1 đổi 1 trong 30 ngày', 'Telegram Premium 12 tháng, kích hoạt nhanh.', 0],
    ['Gmail', 'Gmail Cổ 2019 — Email gốc', 69000, 99000, 1, 50, 'Bảo hành 1 đổi 1 trong 7 ngày', 'Gmail cổ 2019, email gốc, dùng được ngay.', 0],
    ['X', 'X (Twitter) Cổ 2018 — Có email gốc, 2FA', 249000, 379000, 0, 7, 'Bảo hành 1 đổi 1 trong 30 ngày', 'Tài khoản X cổ 2018, email gốc, đã bật 2FA.', 0],
    ['Zalo', 'Zalo Cổ — Bạn bè đầy, tương tác thật', 99000, 149000, 1, 12, 'Bảo hành 1 đổi 1 trong 7 ngày', 'Zalo cổ, bạn bè đầy, tương tác thật.', 0],
  ];
  const ins = db.prepare('INSERT INTO products (platform, name, price, old_price, sold, stock, warranty, description, is_hot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const p of seed) ins.run(...p, now);
}

module.exports = { db, setting, setSetting };
