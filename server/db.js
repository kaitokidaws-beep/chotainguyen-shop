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
    ['Facebook', 'Facebook Clone US — Avatar đầy đủ, tương tác thật', 59000, 25, 'Bảo hành 1 đổi 1 trong 7 ngày', 'Clone US, avatar đầy đủ, có 2FA, email gốc.'],
    ['Facebook', 'Page Facebook 10K Like — Đủ điều kiện bật kiếm tiền', 349000, 8, 'Bảo hành 1 đổi 1 trong 30 ngày', 'Page 10K like thật, đủ điều kiện bật kiếm tiền.'],
    ['Facebook', 'Facebook Clone Việt — Tương tác cao', 45000, 40, 'Bảo hành 1 đổi 1 trong 7 ngày', 'Clone Việt, bạn bè thật, tương tác cao.'],
    ['TikTok', 'TikTok 1K Follow — Tăng nhanh', 129000, 30, 'Bảo hành 1 đổi 1 trong 7 ngày', 'Tài khoản TikTok 1.000 follow, tăng nhanh trong 24h.'],
    ['TikTok', 'TikTok Cổ 2020 — Live đủ điều kiện', 259000, 6, 'Bảo hành 1 đổi 1 trong 30 ngày', 'Tài khoản cổ 2020, đã bật live, đủ điều kiện kiếm tiền.'],
    ['Instagram', 'Instagram 1K Follow — Follow thật', 149000, 20, 'Bảo hành 1 đổi 1 trong 7 ngày', 'Instagram 1.000 follow thật, tương tác ổn định.'],
    ['Instagram', 'Instagram Clone US — Email gốc, 2FA', 79000, 35, 'Bảo hành 1 đổi 1 trong 7 ngày', 'Clone US, email gốc, đã bật 2FA.'],
    ['YouTube', 'YouTube 1K Sub — Kênh bật kiếm tiền', 299000, 10, 'Bảo hành 1 đổi 1 trong 30 ngày', 'Kênh YouTube 1.000 sub, đủ điều kiện bật kiếm tiền.'],
    ['Telegram', 'Telegram Premium 1 năm', 189000, 15, 'Bảo hành 1 đổi 1 trong 30 ngày', 'Telegram Premium 12 tháng, kích hoạt nhanh.'],
    ['Gmail', 'Gmail Cổ 2019 — Email gốc', 69000, 50, 'Bảo hành 1 đổi 1 trong 7 ngày', 'Gmail cổ 2019, email gốc, dùng được ngay.'],
    ['X', 'X (Twitter) Cổ 2018 — Có email gốc, 2FA', 249000, 7, 'Bảo hành 1 đổi 1 trong 30 ngày', 'Tài khoản X cổ 2018, email gốc, đã bật 2FA.'],
    ['Zalo', 'Zalo Cổ — Bạn bè đầy, tương tác thật', 99000, 12, 'Bảo hành 1 đổi 1 trong 7 ngày', 'Zalo cổ, bạn bè đầy, tương tác thật.'],
  ];
  const ins = db.prepare('INSERT INTO products (platform, name, price, stock, warranty, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const p of seed) ins.run(...p, now);
}

module.exports = { db, setting, setSetting };
