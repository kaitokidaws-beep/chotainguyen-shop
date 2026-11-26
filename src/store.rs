//! SQLite storage: schema, first-run seeding, settings, and the
//! row shapes the handlers work with.
//!
//! The database file lives at `$DB_PATH` (default `./shop.db`). The
//! schema and the seed catalogue below are the contract the live
//! volume database already follows, so an existing file keeps working
//! untouched: tables are created only if missing, the three newer
//! product columns are added only if absent, and seeding runs only
//! when the matching table is empty.

use crate::helpers::{iso_to_ms, now_ms};
use rusqlite::{Connection, params};
use serde::Serialize;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::Mutex;

/// The single shared connection, guarded by a mutex so handlers can
/// take it one at a time.
pub struct Store {
    pub inner: Mutex<Connection>,
}

/// The public shape of a user: never includes the password hash or salt.
#[derive(Debug, Clone, Serialize)]
pub struct AccountView {
    pub id: i64,
    pub full_name: String,
    pub username: String,
    pub is_owner: bool,
    pub balance: i64,
}

impl AccountView {
    pub fn new(id: i64, full_name: String, username: String, is_owner: i64, balance: i64) -> Self {
        AccountView {
            id,
            full_name,
            username,
            is_owner: is_owner != 0,
            balance,
        }
    }
}

/// One catalogue product, in the exact field order the API returns.
#[derive(Debug, Clone, Serialize)]
pub struct ProductView {
    pub id: i64,
    pub platform: String,
    pub name: String,
    pub price: i64,
    pub stock: i64,
    pub warranty: String,
    pub description: String,
    pub old_price: i64,
    pub sold: i64,
    pub is_hot: i64,
    pub active: i64,
    pub created_at: i64,
}

/// Build a `ProductView` from a row selected with the columns in the
/// same order as the struct fields.
pub fn product_from_row(row: &rusqlite::Row) -> rusqlite::Result<ProductView> {
    Ok(ProductView {
        id: row.get(0)?,
        platform: row.get(1)?,
        name: row.get(2)?,
        price: row.get(3)?,
        stock: row.get(4)?,
        warranty: row.get(5)?,
        description: row.get(6)?,
        old_price: row.get(7)?,
        sold: row.get(8)?,
        is_hot: row.get(9)?,
        active: row.get(10)?,
        created_at: row.get(11)?,
    })
}

/// Column list for products, in struct order — used by every product
/// SELECT so the row mapping above always lines up.
pub const PRODUCT_COLUMNS: &str = "id, platform, name, price, stock, warranty, description, old_price, sold, is_hot, active, created_at";

/// Build a deposit's JSON shape from a row selected with the columns
/// in this order: id, code, user_id, amount, method, status, tx_code,
/// tx_time, card_carrier, card_serial, card_code, bank_tx_id,
/// created_at, verified_at.
pub fn deposit_from_row(row: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, i64>(0)?,
        "code": row.get::<_, String>(1)?,
        "user_id": row.get::<_, i64>(2)?,
        "amount": row.get::<_, i64>(3)?,
        "method": row.get::<_, String>(4)?,
        "status": row.get::<_, String>(5)?,
        "tx_code": row.get::<_, Option<String>>(6)?,
        "tx_time": row.get::<_, Option<String>>(7)?,
        "card_carrier": row.get::<_, Option<String>>(8)?,
        "card_serial": row.get::<_, Option<String>>(9)?,
        "card_code": row.get::<_, Option<String>>(10)?,
        "bank_tx_id": row.get::<_, Option<String>>(11)?,
        "created_at": row.get::<_, i64>(12)?,
        "verified_at": row.get::<_, Option<i64>>(13)?,
    }))
}

pub const DEPOSIT_COLUMNS: &str = "id, code, user_id, amount, method, status, tx_code, tx_time, card_carrier, card_serial, card_code, bank_tx_id, created_at, verified_at";

/// Read one key from the settings table; missing keys read as `""`.
pub fn setting(conn: &Connection, key: &str) -> String {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?",
        params![key],
        |row| row.get::<_, String>(0),
    )
    .unwrap_or_default()
}

/// Upsert one key in the settings table.
pub fn save_setting(conn: &Connection, key: &str, value: &str) {
    let _ = conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    );
}

fn database_path() -> PathBuf {
    match std::env::var("DB_PATH") {
        Ok(p) if !p.is_empty() => PathBuf::from(p),
        _ => PathBuf::from("./shop.db"),
    }
}

/// The starter catalogue, in display order:
/// (platform, name, price, old_price, sold, stock, warranty, description, is_hot).
const CATALOGUE: [(&str, &str, i64, i64, i64, i64, &str, &str, i64); 12] = [
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

/// The first four orders shown in the shop history, in order:
/// (code, product name, total, status, created-at ISO timestamp).
/// Buyer is the masked name `"Mi***"`, contact is `"—"`, payment is wallet.
const FIRST_ORDERS: [(&str, &str, i64, &str, &str); 4] = [
    ("DH00000001", "Facebook Clone US — Avatar đầy đủ, tương tác thật", 35000, "pending", "2026-11-25T11:24:41.542Z"),
    ("DH00000002", "X (Twitter) Cổ 2018 — Có email gốc, 2FA", 249000, "paid", "2026-11-25T11:37:51.077Z"),
    ("DH00000003", "Page Facebook 10K Like — Đủ điều kiện bật kiếm tiền", 450000, "pending", "2026-11-25T12:37:04.927Z"),
    ("DH00000004", "Facebook Clone US — Avatar đầy đủ, tương tác thật", 35000, "paid", "2026-11-25T12:37:28.786Z"),
];

fn table_count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(
        &format!("SELECT COUNT(*) FROM {}", table),
        [],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

fn seed_catalogue(conn: &Connection) {
    if table_count(conn, "products") != 0 {
        return;
    }
    let stamped = now_ms();
    for (platform, name, price, old_price, sold, stock, warranty, desc, hot) in CATALOGUE {
        let _ = conn.execute(
            "INSERT INTO products (platform, name, price, old_price, sold, stock, warranty, description, is_hot, created_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![platform, name, price, old_price, sold, stock, warranty, desc, hot, stamped],
        );
    }
}

fn seed_first_orders(conn: &Connection) {
    if table_count(conn, "orders") != 0 {
        return;
    }
    for (code, product_name, total, status, iso) in FIRST_ORDERS {
        let found: Option<(i64, String)> = conn
            .query_row(
                "SELECT id, platform FROM products WHERE name = ?",
                params![product_name],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();
        let (product_id, platform) = found.unwrap_or((0, String::new()));
        let items = json!([{
            "product_id": product_id,
            "platform": platform,
            "name": product_name,
            "price": total,
            "qty": 1
        }]);
        let _ = conn.execute(
            "INSERT INTO orders (code, user_id, buyer_name, contact, items_json, total, pay_method, status, created_at) \
             VALUES (?, NULL, 'Mi***', '—', ?, ?, 'wallet', ?, ?)",
            params![code, items.to_string(), total, status, iso_to_ms(iso)],
        );
    }
}

/// Open (or create) the database, make sure the schema exists,
/// migrate the three newer product columns when absent, and seed
/// the catalogue and the first orders when their tables are empty.
pub fn open_store() -> Store {
    let path = database_path();
    let conn = Connection::open(&path).expect("cannot open the shop database");
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
          expires_at INTEGER NOT NULL
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
    .expect("cannot create the shop tables");

    // Databases created before these columns existed gain them here.
    // Each ALTER is best-effort: it fails harmlessly when the column
    // is already present.
    for column in [
        "old_price INTEGER NOT NULL DEFAULT 0",
        "sold INTEGER NOT NULL DEFAULT 0",
        "is_hot INTEGER NOT NULL DEFAULT 0",
    ] {
        let _ = conn.execute_batch(&format!("ALTER TABLE products ADD COLUMN {}", column));
    }

    seed_catalogue(&conn);
    seed_first_orders(&conn);

    Store {
        inner: Mutex::new(conn),
    }
}

/// Parse an order's stored items JSON into an array (empty on bad data).
pub fn parse_items(raw: &str) -> Vec<Value> {
    serde_json::from_str::<Vec<Value>>(raw).unwrap_or_default()
}

/// Total quantity sold across paid / delivered orders since `since_ms`.
pub fn sold_qty_since(conn: &Connection, since_ms: i64) -> i64 {
    let mut stmt = match conn.prepare(
        "SELECT items_json FROM orders WHERE status IN ('paid','delivered') AND created_at > ?",
    ) {
        Ok(s) => s,
        Err(_) => return 0,
    };
    let rows = match stmt.query_map(params![since_ms], |row| row.get::<_, String>(0)) {
        Ok(rows) => rows,
        Err(_) => return 0,
    };
    let mut total = 0i64;
    for raw in rows.flatten() {
        for item in parse_items(&raw) {
            total += item.get("qty").and_then(|q| q.as_i64()).unwrap_or(0);
        }
    }
    total
}
