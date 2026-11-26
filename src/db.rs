//! Database SQLite: cùng schema, cùng seed với server Node cũ
//! (server-node/db.js). File dữ liệu: $DB_PATH, mặc định ./shop.db.

use rusqlite::{Connection, params};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct Db {
    pub conn: Mutex<Connection>,
}

pub fn db_path() -> PathBuf {
    if let Ok(p) = std::env::var("DB_PATH") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    PathBuf::from("shop.db")
}

pub fn open() -> Db {
    let path = db_path();
    let conn = Connection::open(&path).expect("mở được shop.db");
    conn.execute_batch(
        "
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
        ",
    )
    .expect("tạo bảng");

    // Migration: thêm giá cũ / đã bán / hot cho DB đã seed trước đây.
    for col in [
        "old_price INTEGER NOT NULL DEFAULT 0",
        "sold INTEGER NOT NULL DEFAULT 0",
        "is_hot INTEGER NOT NULL DEFAULT 0",
    ] {
        let _ = conn.execute_batch(&format!("ALTER TABLE products ADD COLUMN {}", col));
    }

    // Đồng bộ 2 sản phẩm flagship theo ảnh mẫu của shop.
    let fix_seed: [(&str, i64, i64, i64, i64, i64); 2] = [
        (
            "Page Facebook 10K Like — Đủ điều kiện bật kiếm tiền",
            450000, 650000, 1, 5, 1,
        ),
        (
            "Facebook Clone US — Avatar đầy đủ, tương tác thật",
            35000, 60000, 2, 118, 0,
        ),
    ];
    for (nm, pr, op, sd, st, hot) in fix_seed {
        let _ = conn.execute(
            "UPDATE products SET price = ?, old_price = ?, sold = ?, stock = ?, is_hot = ? WHERE name = ?",
            params![pr, op, sd, st, hot, nm],
        );
    }
    let _ = conn.execute(
        "UPDATE products SET old_price = CASE WHEN old_price IS NULL OR old_price = 0 THEN CAST(price * 1.5 AS INTEGER) ELSE old_price END WHERE old_price IS NULL OR old_price = 0",
        [],
    );

    // Seed 12 sản phẩm mẫu (chỉ chạy khi bảng products đang trống).
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))
        .unwrap_or(0);
    if count == 0 {
        let now = crate::util::now_ms();
        // [platform, name, price, old_price, sold, stock, warranty, description, is_hot]
        let seed: [(&str, &str, i64, i64, i64, i64, &str, &str, i64); 12] = [
            ("Facebook", "Facebook Clone US — Avatar đầy đủ, tương tác thật", 35000, 60000, 2, 118, "Bảo hành 1 đổi 1 trong 7 ngày", "Clone US, avatar đầy đủ, có 2FA, email gốc.", 0),
            ("Facebook", "Page Facebook 10K Like — Đủ điều kiện bật kiếm tiền", 450000, 650000, 1, 5, "Bảo hành 1 đổi 1 trong 30 ngày", "Page 10K like thật, đủ điều kiện bật kiếm tiền.", 1),
            ("Facebook", "Facebook Clone Việt — Tương tác cao", 45000, 69000, 2, 40, "Bảo hành 1 đổi 1 trong 7 ngày", "Clone Việt, bạn bè thật, tương tác cao.", 0),
            ("TikTok", "TikTok 1K Follow — Tăng nhanh", 129000, 199000, 1, 30, "Bảo hành 1 đổi 1 trong 7 ngày", "Tài khoản TikTok 1.000 follow, tăng nhanh trong 24h.", 0),
            ("TikTok", "TikTok Cổ 2020 — Live đủ điều kiện", 259000, 399000, 2, 6, "Bảo hành 1 đổi 1 trong 30 ngày", "Tài khoản cổ 2020, đã bật live, đủ điều kiện kiếm tiền.", 0),
            ("Instagram", "Instagram 1K Follow — Follow thật", 149000, 229000, 1, 20, "Bảo hành 1 đổi 1 trong 7 ngày", "Instagram 1.000 follow thật, tương tác ổn định.", 0),
            ("Instagram", "Instagram Clone US — Email gốc, 2FA", 79000, 119000, 0, 35, "Bảo hành 1 đổi 1 trong 7 ngày", "Clone US, email gốc, đã bật 2FA.", 0),
            ("YouTube", "YouTube 1K Sub — Kênh bật kiếm tiền", 299000, 459000, 1, 10, "Bảo hành 1 đổi 1 trong 30 ngày", "Kênh YouTube 1.000 sub, đủ điều kiện bật kiếm tiền.", 0),
            ("Telegram", "Telegram Premium 1 năm", 189000, 289000, 2, 15, "Bảo hành 1 đổi 1 trong 30 ngày", "Telegram Premium 12 tháng, kích hoạt nhanh.", 0),
            ("Gmail", "Gmail Cổ 2019 — Email gốc", 69000, 99000, 1, 50, "Bảo hành 1 đổi 1 trong 7 ngày", "Gmail cổ 2019, email gốc, dùng được ngay.", 0),
            ("X", "X (Twitter) Cổ 2018 — Có email gốc, 2FA", 249000, 379000, 0, 7, "Bảo hành 1 đổi 1 trong 30 ngày", "Tài khoản X cổ 2018, email gốc, đã bật 2FA.", 0),
            ("Zalo", "Zalo Cổ — Bạn bè đầy, tương tác thật", 99000, 149000, 1, 12, "Bảo hành 1 đổi 1 trong 7 ngày", "Zalo cổ, bạn bè đầy, tương tác thật.", 0),
        ];
        for (platform, name, price, old_price, sold, stock, warranty, desc, hot) in seed {
            let _ = conn.execute(
                "INSERT INTO products (platform, name, price, old_price, sold, stock, warranty, description, is_hot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                params![platform, name, price, old_price, sold, stock, warranty, desc, hot, now],
            );
        }
    }

    // Seed lịch sử đơn thật của shop (đồng bộ từ shop Muse): chỉ chạy khi
    // bảng orders đang trống. Tên đã che, đúng sản phẩm/giá/trạng thái/thời
    // gian thật — không bịa đơn.
    let order_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM orders", [], |r| r.get(0))
        .unwrap_or(0);
    if order_count == 0 {
        let seed_orders: [(&str, &str, &str, i64, &str, &str); 4] = [
            ("DH00000001", "Mi***", "Facebook Clone US — Avatar đầy đủ, tương tác thật", 35000, "pending", "2026-11-25T11:24:41.542Z"),
            ("DH00000002", "Mi***", "X (Twitter) Cổ 2018 — Có email gốc, 2FA", 249000, "paid", "2026-11-25T11:37:51.077Z"),
            ("DH00000003", "Mi***", "Page Facebook 10K Like — Đủ điều kiện bật kiếm tiền", 450000, "pending", "2026-11-25T12:37:04.927Z"),
            ("DH00000004", "Mi***", "Facebook Clone US — Avatar đầy đủ, tương tác thật", 35000, "paid", "2026-11-25T12:37:28.786Z"),
        ];
        for (code, buyer, name, price, status, iso) in seed_orders {
            let prod: Option<(i64, String)> = conn
                .query_row(
                    "SELECT id, platform FROM products WHERE name = ?",
                    params![name],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .ok();
            let (pid, platform) = prod.unwrap_or((0, String::new()));
            let items = serde_json::json!([{
                "product_id": pid,
                "platform": platform,
                "name": name,
                "price": price,
                "qty": 1
            }]);
            let created_at = parse_iso_ms(iso);
            let _ = conn.execute(
                "INSERT INTO orders (code, user_id, buyer_name, contact, items_json, total, pay_method, status, created_at) VALUES (?, NULL, ?, '—', ?, ?, 'wallet', ?, ?)",
                params![code, buyer, items.to_string(), price, status, created_at],
            );
        }
    }

    Db {
        conn: Mutex::new(conn),
    }
}

fn parse_iso_ms(iso: &str) -> i64 {
    // "2026-11-25T11:24:41.542Z" -> mili-giây epoch (tính tay, không cần chrono).
    let date_part = iso.get(..10).unwrap_or("");
    let time_part = iso.get(11..23).unwrap_or("");
    let dp: Vec<i64> = date_part
        .split('-')
        .filter_map(|x| x.parse().ok())
        .collect();
    let tp: Vec<i64> = time_part
        .split(|c| c == ':' || c == '.')
        .filter_map(|x| x.parse().ok())
        .collect();
    if dp.len() < 3 || tp.len() < 3 {
        return 0;
    }
    let (y, m, d) = (dp[0], dp[1], dp[2]);
    let (hh, mm, ss) = (tp[0], tp[1], tp[2]);
    let ms = if tp.len() > 3 { tp[3] } else { 0 };
    let days = days_from_civil(y, m, d);
    days * 86_400_000 + hh * 3_600_000 + mm * 60_000 + ss * 1000 + ms
}

/// Số ngày kể từ 1970-01-01 (thuật toán civil-from-days của Howard Hinnant).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}
