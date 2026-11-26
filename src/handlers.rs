//! Toàn bộ route /api/* — port trung thực từ server Node/Express cũ
//! (server-node/index.js): cùng đường dẫn, cùng validation, cùng thông báo
//! lỗi, cùng hình dạng JSON trả về để frontend (public/app.js) không đổi.

use crate::bank;
use crate::db::Db;
use crate::util::*;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::Json;
use rusqlite::{Connection, params};
use serde::Serialize;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::Arc;

pub struct AppState {
    pub db: Db,
}
pub type Shared = Arc<AppState>;

pub type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;

fn err(status: StatusCode, msg: &str) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": msg })))
}

fn bad(msg: &str) -> (StatusCode, Json<Value>) {
    err(StatusCode::BAD_REQUEST, msg)
}

fn get_setting(conn: &Connection, key: &str) -> String {
    conn.query_row("SELECT value FROM settings WHERE key = ?", params![key], |r| {
        r.get::<_, String>(0)
    })
    .unwrap_or_default()
}

fn set_setting(conn: &Connection, key: &str, value: &str) {
    let _ = conn.execute(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    );
}

// ---------- auth ----------
#[derive(Debug, Clone, Serialize)]
pub struct PublicUser {
    pub id: i64,
    pub full_name: String,
    pub username: String,
    pub is_owner: bool,
    pub balance: i64,
}

fn public_user(id: i64, full_name: String, username: String, is_owner: i64, balance: i64) -> PublicUser {
    PublicUser {
        id,
        full_name,
        username,
        is_owner: is_owner != 0,
        balance,
    }
}

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    let v = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let lower = v.to_ascii_lowercase();
    if lower.starts_with("bearer") {
        Some(v[6..].trim_start().to_string())
    } else {
        Some(v.to_string())
    }
}

fn user_from_token(conn: &Connection, token: &str) -> Option<PublicUser> {
    let uid: i64 = conn
        .query_row(
            "SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?",
            params![token, now_ms()],
            |r| r.get(0),
        )
        .ok()?;
    conn.query_row(
        "SELECT id, full_name, username, is_owner, balance FROM users WHERE id = ?",
        params![uid],
        |r| {
            Ok(public_user(
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
            ))
        },
    )
    .ok()
}

fn auth_user(
    state: &Shared,
    headers: &HeaderMap,
) -> Result<PublicUser, (StatusCode, Json<Value>)> {
    let token = bearer_token(headers)
        .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "Chưa đăng nhập"))?;
    let conn = state.db.conn.lock().unwrap();
    user_from_token(&conn, &token)
        .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "Phiên đã hết hạn, đăng nhập lại"))
}

fn optional_user(state: &Shared, headers: &HeaderMap) -> Option<PublicUser> {
    let token = bearer_token(headers)?;
    let conn = state.db.conn.lock().unwrap();
    user_from_token(&conn, &token)
}

fn require_owner(user: &PublicUser) -> Result<(), (StatusCode, Json<Value>)> {
    if !user.is_owner {
        return Err(err(
            StatusCode::FORBIDDEN,
            "Chỉ chủ shop mới dùng được mục này",
        ));
    }
    Ok(())
}

fn valid_username(u: &str) -> bool {
    let n = u.chars().count();
    (3..=40).contains(&n)
        && u.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
}

pub async fn register(State(state): State<Shared>, Json(body): Json<Value>) -> ApiResult {
    let full_name = body
        .get("full_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let username = body
        .get("username")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let password = body
        .get("password")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if full_name.is_empty() {
        return Err(bad("Nhập họ tên"));
    }
    if !valid_username(&username) {
        return Err(bad("Tên đăng nhập 3–40 ký tự: chữ thường, số, . _ -"));
    }
    if password.chars().count() < 4 {
        return Err(bad("Mật khẩu ít nhất 4 ký tự"));
    }
    let conn = state.db.conn.lock().unwrap();
    let exists: Option<i64> = conn
        .query_row(
            "SELECT id FROM users WHERE username = ?",
            params![username],
            |r| r.get(0),
        )
        .ok();
    if exists.is_some() {
        return Err(bad("Tên đăng nhập đã có người dùng"));
    }
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
        .unwrap_or(0);
    let is_owner: i64 = if count == 0 { 1 } else { 0 };
    let salt = random_hex_bytes(16);
    let hash = hash_password(&password, &salt);
    conn.execute(
        "INSERT INTO users (full_name, username, password_hash, salt, is_owner, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        params![full_name, username, hash, salt, is_owner, now_ms()],
    )
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let id = conn.last_insert_rowid();
    let user = public_user(id, full_name.clone(), username.clone(), is_owner, 0);
    let token = new_token();
    let _ = conn.execute(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
        params![token, id, now_ms() + SESSION_TTL_MS],
    );
    let mut out = json!({ "token": token, "user": user, "is_owner": is_owner != 0 });
    if is_owner != 0 {
        out["note"] = json!("Bạn là tài khoản đầu tiên nên là chủ shop.");
    }
    Ok(Json(out))
}

pub async fn login(State(state): State<Shared>, Json(body): Json<Value>) -> ApiResult {
    let username = body
        .get("username")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let password = body
        .get("password")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let conn = state.db.conn.lock().unwrap();
    let row = conn
        .query_row(
            "SELECT id, full_name, username, password_hash, salt, is_owner, balance FROM users WHERE username = ?",
            params![username],
            |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                ))
            },
        )
        .ok();
    let (id, full_name, uname, stored_hash, salt, is_owner, balance) = match row {
        Some(r) => r,
        None => return Err(bad("Sai tên đăng nhập hoặc mật khẩu")),
    };
    if hash_password(&password, &salt) != stored_hash {
        return Err(bad("Sai tên đăng nhập hoặc mật khẩu"));
    }
    let token = new_token();
    let _ = conn.execute(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
        params![token, id, now_ms() + SESSION_TTL_MS],
    );
    Ok(Json(json!({
        "token": token,
        "user": public_user(id, full_name, uname, is_owner, balance),
    })))
}

pub async fn logout(State(state): State<Shared>, headers: HeaderMap) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    let _ = user;
    if let Some(token) = bearer_token(&headers) {
        let conn = state.db.conn.lock().unwrap();
        let _ = conn.execute("DELETE FROM sessions WHERE token = ?", params![token]);
    }
    Ok(Json(json!({ "ok": true })))
}

pub async fn me(State(state): State<Shared>, headers: HeaderMap) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    Ok(Json(json!({ "user": user })))
}

pub async fn rename(
    State(state): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    let name = body
        .get("full_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if name.is_empty() {
        return Err(bad("Nhập họ tên mới"));
    }
    let conn = state.db.conn.lock().unwrap();
    let _ = conn.execute(
        "UPDATE users SET full_name = ? WHERE id = ?",
        params![name, user.id],
    );
    Ok(Json(json!({ "ok": true })))
}

// ---------- sản phẩm ----------
#[derive(Debug, Clone, Serialize)]
pub struct Product {
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

fn row_product(r: &rusqlite::Row) -> rusqlite::Result<Product> {
    Ok(Product {
        id: r.get(0)?,
        platform: r.get(1)?,
        name: r.get(2)?,
        price: r.get(3)?,
        stock: r.get(4)?,
        warranty: r.get(5)?,
        description: r.get(6)?,
        old_price: r.get(7)?,
        sold: r.get(8)?,
        is_hot: r.get(9)?,
        active: r.get(10)?,
        created_at: r.get(11)?,
    })
}

pub async fn products(State(state): State<Shared>) -> ApiResult {
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT * FROM products WHERE active = 1 ORDER BY id")
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let rows = stmt
        .query_map([], row_product)
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    Ok(Json(json!({ "products": rows })))
}

fn sum_sold_qty(conn: &Connection, since: i64) -> i64 {
    let mut stmt = match conn.prepare(
        "SELECT items_json FROM orders WHERE status IN ('paid','delivered') AND created_at > ?",
    ) {
        Ok(s) => s,
        Err(_) => return 0,
    };
    let rows = match stmt.query_map(params![since], |r| r.get::<_, String>(0)) {
        Ok(rows) => rows,
        Err(_) => return 0,
    };
    let mut total = 0i64;
    for row in rows.flatten() {
        if let Ok(items) = serde_json::from_str::<Vec<Value>>(&row) {
            for it in items {
                total += it.get("qty").and_then(|q| q.as_i64()).unwrap_or(0);
            }
        }
    }
    total
}

pub async fn stats(State(state): State<Shared>) -> ApiResult {
    let conn = state.db.conn.lock().unwrap();
    let since = now_ms() - 30 * 24 * 3600 * 1000;
    let sold = sum_sold_qty(&conn, since);
    let total_products: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM products WHERE active = 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(Json(json!({
        "sold_30d": sold,
        "total_products": total_products,
        "sold_raw": { "n": sold },
    })))
}

// ---------- giỏ / đặt hàng ----------
pub async fn create_order(
    State(state): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult {
    let user = optional_user(&state, &headers);
    let items: Vec<Value> = body
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let buyer_name = body
        .get("buyer_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let buyer_name = if buyer_name.is_empty() {
        user.as_ref().map(|u| u.full_name.clone()).unwrap_or_default()
    } else {
        buyer_name
    };
    let contact = body
        .get("contact")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let pay_method = if body.get("pay_method").and_then(|v| v.as_str()) == Some("manual") {
        "manual"
    } else {
        "wallet"
    };
    if items.is_empty() {
        return Err(bad("Giỏ hàng trống"));
    }
    if buyer_name.is_empty() || contact.is_empty() {
        return Err(bad("Nhập họ tên và SĐT / Zalo / Telegram để nhận tài khoản"));
    }
    let mut conn = state.db.conn.lock().unwrap();
    let mut total: i64 = 0;
    let mut lines: Vec<Value> = vec![];
    for it in &items {
        let pid = it.get("product_id").and_then(|v| v.as_i64()).unwrap_or(0);
        let p: Option<Product> = conn
            .query_row(
                "SELECT * FROM products WHERE id = ? AND active = 1",
                params![pid],
                row_product,
            )
            .ok();
        let p = match p {
            Some(p) => p,
            None => return Err(bad("Có sản phẩm không còn bán")),
        };
        let qty = it
            .get("qty")
            .and_then(|v| v.as_i64())
            .unwrap_or(1)
            .max(1);
        if p.stock < qty {
            return Err(bad(&format!(
                "Sản phẩm \"{}\" chỉ còn {} cái",
                p.name, p.stock
            )));
        }
        total += p.price * qty;
        lines.push(json!({
            "product_id": p.id,
            "platform": p.platform,
            "name": p.name,
            "price": p.price,
            "qty": qty,
        }));
    }
    let user_id = user.as_ref().map(|u| u.id);
    if pay_method == "wallet" {
        let u = match &user {
            Some(u) => u,
            None => {
                return Err(err(
                    StatusCode::UNAUTHORIZED,
                    "Thanh toán bằng ví cần đăng nhập",
                ))
            }
        };
        if u.balance < total {
            return Err(bad(&format!(
                "Ví chỉ còn {}, cần {}. Nạp thêm tiền rồi đặt lại.",
                fmt_money(u.balance),
                fmt_money(total)
            )));
        }
    }
    // Ghi đơn nguyên tử: trừ ví (nếu ví) + trừ kho + tạo đơn.
    let tx = conn
        .transaction()
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    if pay_method == "wallet" {
        let uid = user.as_ref().unwrap().id;
        tx.execute(
            "UPDATE users SET balance = balance - ? WHERE id = ?",
            params![total, uid],
        )
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    }
    for l in &lines {
        let qty = l.get("qty").and_then(|v| v.as_i64()).unwrap_or(0);
        let pid = l.get("product_id").and_then(|v| v.as_i64()).unwrap_or(0);
        tx.execute(
            "UPDATE products SET stock = stock - ? WHERE id = ?",
            params![qty, pid],
        )
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    }
    let code = new_code("DH");
    let status = if pay_method == "wallet" { "paid" } else { "pending" };
    tx.execute(
        "INSERT INTO orders (code, user_id, buyer_name, contact, items_json, total, pay_method, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![code, user_id, buyer_name, contact, serde_json::to_string(&lines).unwrap(), total, pay_method, status, now_ms()],
    )
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    tx.commit()
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    Ok(Json(json!({
        "code": code,
        "total": total,
        "pay_method": pay_method,
        "message": if pay_method == "wallet" { "Đã thanh toán bằng ví. Lưu mã đơn để tra cứu." } else { "Đã tạo đơn. Lưu mã đơn để tra cứu." },
    })))
}

fn parse_items(s: &str) -> Vec<Value> {
    serde_json::from_str::<Vec<Value>>(s).unwrap_or_default()
}

pub async fn orders_mine(State(state): State<Shared>, headers: HeaderMap) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT code, items_json, total, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC")
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let rows = stmt
        .query_map(params![user.id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let orders: Vec<Value> = rows
        .into_iter()
        .map(|(code, items_json, total, status, created_at)| {
            let items = parse_items(&items_json);
            json!({ "code": code, "items_json": items_json, "items": items, "total": total, "status": status, "created_at": created_at })
        })
        .collect();
    Ok(Json(json!({ "orders": orders })))
}

pub async fn orders_lookup(
    State(state): State<Shared>,
    Json(body): Json<Value>,
) -> ApiResult {
    let code = body
        .get("code")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_uppercase();
    let contact = body
        .get("contact")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if code.is_empty() || contact.is_empty() {
        return Err(bad("Nhập mã đơn và thông tin liên hệ lúc đặt hàng"));
    }
    let conn = state.db.conn.lock().unwrap();
    let row: Option<(String, String, i64, String, i64)> = conn
        .query_row(
            "SELECT code, items_json, total, status, created_at FROM orders WHERE code = ? AND contact = ?",
            params![code, contact],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                ))
            },
        )
        .ok();
    let (code, items_json, total, status, created_at) = match row {
        Some(r) => r,
        None => {
            return Err(err(
                StatusCode::NOT_FOUND,
                "Không tìm thấy đơn với mã và liên hệ này",
            ))
        }
    };
    let items = parse_items(&items_json);
    Ok(Json(json!({ "order": {
        "code": code, "items_json": items_json, "items": items,
        "total": total, "status": status, "created_at": created_at,
    }})))
}

pub async fn notifications(State(state): State<Shared>) -> ApiResult {
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT buyer_name, items_json, status, created_at FROM orders WHERE status IN ('paid','delivered','pending') ORDER BY created_at DESC LIMIT 8")
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let list: Vec<Value> = rows
        .into_iter()
        .map(|(buyer, items_json, status, created_at)| {
            let items = parse_items(&items_json);
            let product = items
                .get(0)
                .and_then(|i| i.get("name"))
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .to_string();
            json!({
                "buyer": mask_name(&buyer),
                "product": product,
                "count": items.len(),
                "status": status,
                "created_at": created_at,
            })
        })
        .collect();
    Ok(Json(json!({ "notifications": list })))
}

// ---------- hoạt động gần đây ----------
pub async fn activity(
    State(state): State<Shared>,
    Query(q): Query<HashMap<String, String>>,
) -> ApiResult {
    let limit: i64 = q
        .get("limit")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(6)
        .clamp(1, 50);
    let conn = state.db.conn.lock().unwrap();
    let mut items: Vec<Value> = vec![];

    let mut stmt = conn
        .prepare("SELECT buyer_name, items_json, total, created_at FROM orders WHERE status IN ('paid','delivered') ORDER BY created_at DESC LIMIT 50")
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    for (buyer, items_json, total, created_at) in rows {
        let it = parse_items(&items_json);
        let name = it
            .get(0)
            .and_then(|i| i.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or("Tài khoản")
            .to_string();
        items.push(json!({
            "type": "purchase",
            "name": mask_name(&buyer),
            "desc": format!("Thanh toán thành công · {}", name),
            "amount": -total,
            "created_at": created_at,
        }));
    }
    drop(stmt);

    let mut stmt = conn
        .prepare("SELECT buyer_name, items_json, created_at FROM orders WHERE status = 'pending' ORDER BY created_at DESC LIMIT 50")
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    for (buyer, items_json, created_at) in rows {
        let it = parse_items(&items_json);
        let name = it
            .get(0)
            .and_then(|i| i.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or("Tài khoản")
            .to_string();
        items.push(json!({
            "type": "order",
            "name": mask_name(&buyer),
            "desc": format!("Đặt hàng · {}", name),
            "amount": Value::Null,
            "created_at": created_at,
        }));
    }
    drop(stmt);

    let method_text = |m: &str| match m {
        "bank" => "Chuyển khoản ngân hàng",
        "momo" => "MoMo",
        "zalopay" => "ZaloPay",
        "card" => "Thẻ cào",
        _ => "Chuyển khoản",
    };
    let mut stmt = conn
        .prepare("SELECT d.amount, d.method, d.created_at, u.full_name FROM deposits d JOIN users u ON u.id = d.user_id WHERE d.status = 'verified' ORDER BY d.created_at DESC LIMIT 50")
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    for (amount, method, created_at, full_name) in rows {
        items.push(json!({
            "type": "topup",
            "name": mask_name(&full_name),
            "desc": format!("Nạp tiền thành công · {}", method_text(&method)),
            "amount": amount,
            "created_at": created_at,
        }));
    }
    drop(stmt);

    let mut stmt = conn
        .prepare("SELECT full_name, created_at FROM users ORDER BY created_at DESC LIMIT 50")
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    for (full_name, created_at) in rows {
        items.push(json!({
            "type": "register",
            "name": mask_name(&full_name),
            "desc": "Đăng ký tài khoản mới · Gia nhập nền tảng",
            "amount": Value::Null,
            "created_at": created_at,
        }));
    }
    drop(stmt);

    items.sort_by(|a, b| {
        let ca = a.get("created_at").and_then(|v| v.as_i64()).unwrap_or(0);
        let cb = b.get("created_at").and_then(|v| v.as_i64()).unwrap_or(0);
        cb.cmp(&ca)
    });
    let total = items.len();
    let sliced: Vec<Value> = items.into_iter().take(limit as usize).collect();
    Ok(Json(json!({ "activity": sliced, "total": total })))
}

// ---------- ví / nạp tiền ----------
pub async fn wallet(State(state): State<Shared>, headers: HeaderMap) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    let conn = state.db.conn.lock().unwrap();
    let balance: i64 = conn
        .query_row(
            "SELECT balance FROM users WHERE id = ?",
            params![user.id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let mut stmt = conn
        .prepare("SELECT code, amount, method, status, created_at, verified_at FROM deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 50")
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let rows = stmt
        .query_map(params![user.id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, Option<i64>>(5)?,
            ))
        })
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let deposits: Vec<Value> = rows
        .into_iter()
        .map(|(code, amount, method, status, created_at, verified_at)| {
            json!({
                "code": code, "amount": amount, "method": method,
                "status": status, "created_at": created_at, "verified_at": verified_at,
            })
        })
        .collect();
    Ok(Json(json!({ "balance": balance, "deposits": deposits })))
}

pub async fn receiving_info(State(state): State<Shared>) -> ApiResult {
    let conn = state.db.conn.lock().unwrap();
    Ok(Json(json!({
        "bank_name": get_setting(&conn, "recv_bank_name"),
        "bank_bin": get_setting(&conn, "recv_bank_bin"),
        "account_number": get_setting(&conn, "recv_account_number"),
        "account_holder": get_setting(&conn, "recv_account_holder"),
        "momo": get_setting(&conn, "recv_momo"),
        "zalopay": get_setting(&conn, "recv_zalopay"),
    })))
}

fn opt_str(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

pub async fn create_deposit(
    State(state): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    let amount = body.get("amount").and_then(|v| v.as_f64()).unwrap_or(f64::NAN);
    let method = body
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("bank")
        .to_string();
    if !amount.is_finite() || amount < 10000.0 {
        return Err(bad("Số tiền nạp tối thiểu 10.000đ"));
    }
    if !["bank", "momo", "zalopay", "card"].contains(&method.as_str()) {
        return Err(bad("Chọn phương thức nạp"));
    }
    let code = new_code("NAP");
    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO deposits (code, user_id, amount, method, status, card_carrier, card_serial, card_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            code,
            user.id,
            amount as i64,
            method,
            "pending",
            opt_str(body.get("card_carrier")),
            opt_str(body.get("card_serial")),
            opt_str(body.get("card_code")),
            now_ms(),
        ],
    )
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    Ok(Json(json!({
        "code": code,
        "amount": amount as i64,
        "method": method,
        "message": "Đã tạo yêu cầu nạp. Chuyển tiền đúng nội dung mã này rồi bấm kiểm tra giao dịch qua API.",
    })))
}

fn deposit_row_json(r: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": r.get::<_, i64>(0)?,
        "code": r.get::<_, String>(1)?,
        "user_id": r.get::<_, i64>(2)?,
        "amount": r.get::<_, i64>(3)?,
        "method": r.get::<_, String>(4)?,
        "status": r.get::<_, String>(5)?,
        "tx_code": r.get::<_, Option<String>>(6)?,
        "tx_time": r.get::<_, Option<String>>(7)?,
        "card_carrier": r.get::<_, Option<String>>(8)?,
        "card_serial": r.get::<_, Option<String>>(9)?,
        "card_code": r.get::<_, Option<String>>(10)?,
        "bank_tx_id": r.get::<_, Option<String>>(11)?,
        "created_at": r.get::<_, i64>(12)?,
        "verified_at": r.get::<_, Option<i64>>(13)?,
    }))
}

pub async fn get_deposit(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(code): Path<String>,
) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    let code = code.to_uppercase();
    let conn = state.db.conn.lock().unwrap();
    let row: Option<Value> = conn
        .query_row(
            "SELECT * FROM deposits WHERE code = ? AND user_id = ?",
            params![code, user.id],
            deposit_row_json,
        )
        .ok();
    match row {
        Some(d) => Ok(Json(json!({ "deposit": d }))),
        None => Err(err(
            StatusCode::NOT_FOUND,
            "Không tìm thấy yêu cầu nạp này",
        )),
    }
}

// ---------- kiểm tra giao dịch qua API (SePay / Casso) ----------
pub async fn check_api(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(code): Path<String>,
) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    let code = code.to_uppercase();
    // Đọc yêu cầu nạp (không giữ khóa trong lúc gọi mạng).
    let dep: Option<(i64, i64, String, String)> = {
        let conn = state.db.conn.lock().unwrap();
        conn.query_row(
            "SELECT id, amount, method, status FROM deposits WHERE code = ? AND user_id = ?",
            params![code, user.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .ok()
    };
    let (dep_id, amount, method, status) = match dep {
        Some(d) => d,
        None => {
            return Err(err(
                StatusCode::NOT_FOUND,
                "Không tìm thấy yêu cầu nạp này",
            ))
        }
    };
    if status == "verified" {
        return Ok(Json(json!({
            "ok": true,
            "message": "Yêu cầu này đã được cộng tiền rồi.",
        })));
    }
    if method == "card" {
        return Err(bad("Nạp bằng thẻ cào không kiểm tra qua API ngân hàng được. Chủ shop xác nhận thẻ trong Quản lý shop."));
    }
    let (gateway, api_key) = {
        let conn = state.db.conn.lock().unwrap();
        (
            get_setting(&conn, "api_gateway"),
            get_setting(&conn, "api_key"),
        )
    };
    let res = bank::fetch_bank_transactions(&gateway, &api_key).await;
    if !res.connected {
        return Err(bad(&res.error.unwrap_or_else(|| {
            "Shop chưa kết nối API SePay/Casso. Chủ shop vào Quản lý shop → API nạp tiền qua QR để kết nối.".to_string()
        })));
    }
    // Tìm giao dịch khớp: đúng số tiền + nội dung chứa mã + chưa dùng cho lần nạp khác.
    let matched: Option<bank::BankTx> = {
        let conn = state.db.conn.lock().unwrap();
        let mut found = None;
        for t in &res.transactions {
            if t.amount != amount {
                continue;
            }
            if !t.content.to_uppercase().contains(&code) {
                continue;
            }
            let used: Option<i64> = conn
                .query_row(
                    "SELECT id FROM deposits WHERE bank_tx_id = ?",
                    params![t.id],
                    |r| r.get(0),
                )
                .ok();
            if used.is_none() {
                found = Some(t.clone());
                break;
            }
        }
        found
    };
    let m = match matched {
        Some(m) => m,
        None => {
            return Err(err(
                StatusCode::NOT_FOUND,
                &format!(
                    "Chưa thấy giao dịch khớp (đúng số tiền + đúng nội dung mã {}). Kiểm tra lại nội dung chuyển khoản rồi thử lại.",
                    code
                ),
            ))
        }
    };
    let conn = state.db.conn.lock().unwrap();
    let _ = conn.execute(
        "UPDATE deposits SET status = 'verified', bank_tx_id = ?, verified_at = ? WHERE id = ?",
        params![m.id, now_ms(), dep_id],
    );
    let _ = conn.execute(
        "UPDATE users SET balance = balance + ? WHERE id = ?",
        params![amount, user.id],
    );
    Ok(Json(json!({
        "ok": true,
        "message": format!("Đã khớp giao dịch và cộng {} vào ví.", fmt_money(amount)),
    })))
}

pub async fn api_status(State(state): State<Shared>) -> ApiResult {
    let conn = state.db.conn.lock().unwrap();
    let gateway = get_setting(&conn, "api_gateway");
    let key = get_setting(&conn, "api_key");
    let connected = !gateway.is_empty() && !key.is_empty();
    Ok(Json(json!({
        "connected": connected,
        "gateway": if gateway.is_empty() { Value::Null } else { Value::String(gateway) },
    })))
}

pub async fn leaderboard(State(state): State<Shared>) -> ApiResult {
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT u.full_name AS name, COALESCE(SUM(d.amount), 0) AS total
             FROM deposits d JOIN users u ON u.id = d.user_id
             WHERE d.status = 'verified' GROUP BY d.user_id ORDER BY total DESC LIMIT 20",
        )
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let top: Vec<Value> = rows
        .into_iter()
        .enumerate()
        .map(|(i, (name, total))| {
            json!({ "rank": i + 1, "name": mask_name(&name), "total": total })
        })
        .collect();
    Ok(Json(json!({ "top": top })))
}

pub async fn leaderboard_mine(State(state): State<Shared>, headers: HeaderMap) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT u.id, COALESCE(SUM(d.amount), 0) AS total FROM deposits d JOIN users u ON u.id = d.user_id
             WHERE d.status = 'verified' GROUP BY d.user_id ORDER BY total DESC",
        )
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
        })
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let idx = rows.iter().position(|(id, _)| *id == user.id);
    match idx {
        Some(i) => Ok(Json(json!({ "rank": i + 1, "total": rows[i].1 }))),
        None => Ok(Json(json!({ "rank": Value::Null, "total": 0 }))),
    }
}

// ---------- bot hỗ trợ 24/7 ----------
fn find_dh_code(q: &str) -> Option<String> {
    // Tìm "dh" rồi ăn tiếp các ký tự hex; cần ít nhất 4 ký tự (như /dh[0-9a-f]{4,}/i).
    let bytes = q.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'd' && bytes[i + 1] == b'h' {
            let mut j = i + 2;
            while j < bytes.len() && (bytes[j] as char).is_ascii_hexdigit() {
                j += 1;
            }
            if j - (i + 2) >= 4 {
                return Some(format!("DH{}", q[i + 2..j].to_uppercase()));
            }
            i = j;
        } else {
            i += 1;
        }
    }
    None
}

pub async fn bot(State(state): State<Shared>, Json(body): Json<Value>) -> ApiResult {
    let q = body
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    let reply = if q.contains("giá") || q.contains("bao nhiêu") || q.contains("mua") {
        let conn = state.db.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT platform, name, price FROM products WHERE active = 1 ORDER BY price LIMIT 5")
            .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })
            .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
        let parts: Vec<String> = rows
            .iter()
            .map(|(_, name, price)| format!("{} — {}", name, fmt_money(*price)))
            .collect();
        format!(
            "Giá tham khảo: {}. Chọn sản phẩm rồi bấm Mua ngay nhé.",
            parts.join(" | ")
        )
    } else if q.contains("nạp")
        || q.contains("nap")
        || q.contains("ví")
        || q.contains("nap tien")
    {
        "Nạp tiền: vào tab Nạp tiền, chọn số tiền (tối thiểu 10.000đ), chuyển đúng nội dung mã NAP… rồi bấm \"Kiểm tra giao dịch qua API\". Tiền chỉ cộng khi khớp đúng số tiền + mã.".to_string()
    } else if q.contains("bảo hành") || q.contains("doi") || q.contains("đổi") {
        "Shop bảo hành 1 đổi 1 theo thời hạn ghi trên từng sản phẩm. Gửi mã đơn (DH…) để mình kiểm tra.".to_string()
    } else if q.contains("đơn") || q.contains("tra cứu") || q.contains("dh") {
        match find_dh_code(&q) {
            Some(code) => {
                let conn = state.db.conn.lock().unwrap();
                let row: Option<(String, i64)> = conn
                    .query_row(
                        "SELECT status, total FROM orders WHERE code = ?",
                        params![code],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .ok();
                match row {
                    Some((status, total)) => {
                        let st = match status.as_str() {
                            "paid" => "đã thanh toán",
                            "delivered" => "đã giao",
                            "cancelled" => "đã hủy",
                            _ => "chờ xử lý",
                        };
                        format!("Đơn {}: {}, tổng {}.", code, st, fmt_money(total))
                    }
                    None => "Không tìm thấy đơn này. Nhập đúng mã DH… và thông tin liên hệ lúc đặt hàng ở mục Tra cứu đơn.".to_string(),
                }
            }
            None => {
                "Gửi mã đơn DH… để mình kiểm tra, hoặc vào mục Tra cứu đơn nhập mã + thông tin liên hệ.".to_string()
            }
        }
    } else if q.contains("chào") || q.contains("hello") || q.contains("hi") {
        "Chào bạn, mình là bot hỗ trợ của Chợ Tài Nguyên Mmo, online 24/7. Bạn cần hỏi giá, nạp tiền, bảo hành hay tra cứu đơn?".to_string()
    } else {
        "Mình là bot hỗ trợ 24/7 của Chợ Tài Nguyên Mmo. Bạn hỏi về giá, nạp tiền, bảo hành 1 đổi 1 hay tra cứu đơn (gửi mã DH…) nhé.".to_string()
    };
    Ok(Json(json!({ "reply": reply })))
}

// ---------- chủ shop ----------
pub async fn admin_overview(State(state): State<Shared>, headers: HeaderMap) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    require_owner(&user)?;
    let conn = state.db.conn.lock().unwrap();
    let pending: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM deposits WHERE status = 'pending'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let orders: i64 = conn
        .query_row("SELECT COUNT(*) FROM orders", [], |r| r.get(0))
        .unwrap_or(0);
    let revenue: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(total),0) FROM orders WHERE status IN ('paid','delivered')",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(Json(json!({
        "pending_deposits": pending,
        "total_orders": orders,
        "revenue": revenue,
    })))
}

pub async fn admin_products(State(state): State<Shared>, headers: HeaderMap) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    require_owner(&user)?;
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT * FROM products ORDER BY id")
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let rows = stmt
        .query_map([], row_product)
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    Ok(Json(json!({ "products": rows })))
}

pub async fn admin_create_product(
    State(state): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    require_owner(&user)?;
    let platform = body
        .get("platform")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let name = body
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let price = body.get("price").and_then(|v| v.as_f64());
    if name.is_empty() || platform.is_empty() || price.is_none() {
        return Err(bad("Nhập đủ nền tảng, tên và giá"));
    }
    let price = price.unwrap() as i64;
    let stock = body.get("stock").and_then(|v| v.as_i64()).unwrap_or(0);
    let warranty = body
        .get("warranty")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("Bảo hành 1 đổi 1")
        .to_string();
    let description = body
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let conn = state.db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO products (platform, name, price, stock, warranty, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![platform, name, price, stock, warranty, description, now_ms()],
    )
    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    Ok(Json(json!({ "id": conn.last_insert_rowid() })))
}

pub async fn admin_update_product(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(body): Json<Value>,
) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    require_owner(&user)?;
    let conn = state.db.conn.lock().unwrap();
    let cur: Option<Product> = conn
        .query_row("SELECT * FROM products WHERE id = ?", params![id], row_product)
        .ok();
    let cur = match cur {
        Some(p) => p,
        None => return Err(err(StatusCode::NOT_FOUND, "Không tìm thấy sản phẩm")),
    };
    let platform = body
        .get("platform")
        .and_then(|v| v.as_str())
        .unwrap_or(&cur.platform)
        .to_string();
    let name = body
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(&cur.name)
        .to_string();
    let price = body
        .get("price")
        .and_then(|v| v.as_f64())
        .map(|f| f as i64)
        .unwrap_or(cur.price);
    let stock = body
        .get("stock")
        .and_then(|v| v.as_i64())
        .unwrap_or(cur.stock);
    let warranty = body
        .get("warranty")
        .and_then(|v| v.as_str())
        .unwrap_or(&cur.warranty)
        .to_string();
    let description = body
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or(&cur.description)
        .to_string();
    let active: i64 = match body.get("active") {
        Some(v) => {
            if js_truthy(v) {
                1
            } else {
                0
            }
        }
        None => cur.active,
    };
    let _ = conn.execute(
        "UPDATE products SET platform = ?, name = ?, price = ?, stock = ?, warranty = ?, description = ?, active = ? WHERE id = ?",
        params![platform, name, price, stock, warranty, description, active, id],
    );
    Ok(Json(json!({ "ok": true })))
}

pub async fn admin_delete_product(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    require_owner(&user)?;
    let conn = state.db.conn.lock().unwrap();
    let _ = conn.execute("DELETE FROM products WHERE id = ?", params![id]);
    Ok(Json(json!({ "ok": true })))
}

pub async fn admin_orders(State(state): State<Shared>, headers: HeaderMap) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    require_owner(&user)?;
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 100")
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<i64>>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, String>(7)?,
                r.get::<_, String>(8)?,
                r.get::<_, i64>(9)?,
            ))
        })
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let orders: Vec<Value> = rows
        .into_iter()
        .map(|(id, code, user_id, buyer_name, contact, items_json, total, pay_method, status, created_at)| {
            let items = parse_items(&items_json);
            json!({
                "id": id, "code": code, "user_id": user_id, "buyer_name": buyer_name,
                "contact": contact, "items_json": items_json, "items": items,
                "total": total, "pay_method": pay_method, "status": status, "created_at": created_at,
            })
        })
        .collect();
    Ok(Json(json!({ "orders": orders })))
}

pub async fn admin_order_status(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(code): Path<String>,
    Json(body): Json<Value>,
) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    require_owner(&user)?;
    let status = body
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if !["pending", "paid", "delivered", "cancelled"].contains(&status.as_str()) {
        return Err(bad("Trạng thái không hợp lệ"));
    }
    let conn = state.db.conn.lock().unwrap();
    let _ = conn.execute(
        "UPDATE orders SET status = ? WHERE code = ?",
        params![status, code.to_uppercase()],
    );
    Ok(Json(json!({ "ok": true })))
}

pub async fn admin_deposits(State(state): State<Shared>, headers: HeaderMap) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    require_owner(&user)?;
    let conn = state.db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT d.*, u.username FROM deposits d JOIN users u ON u.id = d.user_id ORDER BY d.created_at DESC LIMIT 100")
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    let rows = stmt
        .query_map([], |r| {
            let d = deposit_row_json(r)?;
            let username: String = r.get(14)?;
            let mut d = d;
            d["username"] = json!(username);
            Ok(d)
        })
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra"))?;
    Ok(Json(json!({ "deposits": rows })))
}

pub async fn admin_confirm_deposit(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(code): Path<String>,
) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    require_owner(&user)?;
    let code = code.to_uppercase();
    let conn = state.db.conn.lock().unwrap();
    let dep: Option<(i64, i64, String, i64)> = conn
        .query_row(
            "SELECT id, amount, status, user_id FROM deposits WHERE code = ?",
            params![code],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .ok();
    let (dep_id, amount, status, dep_user_id) = match dep {
        Some(d) => d,
        None => return Err(err(StatusCode::NOT_FOUND, "Không tìm thấy")),
    };
    if status == "verified" {
        return Ok(Json(json!({ "ok": true, "message": "Đã cộng tiền rồi." })));
    }
    let _ = conn.execute(
        "UPDATE deposits SET status = 'verified', verified_at = ? WHERE id = ?",
        params![now_ms(), dep_id],
    );
    let _ = conn.execute(
        "UPDATE users SET balance = balance + ? WHERE id = ?",
        params![amount, dep_user_id],
    );
    Ok(Json(json!({
        "ok": true,
        "message": format!("Đã cộng {} vào ví của {}.", fmt_money(amount), dep_user_id),
    })))
}

pub async fn admin_settings(State(state): State<Shared>, headers: HeaderMap) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    require_owner(&user)?;
    let conn = state.db.conn.lock().unwrap();
    let gateway = get_setting(&conn, "api_gateway");
    let key = get_setting(&conn, "api_key");
    Ok(Json(json!({
        "recv_bank_name": get_setting(&conn, "recv_bank_name"),
        "recv_bank_bin": get_setting(&conn, "recv_bank_bin"),
        "recv_account_number": get_setting(&conn, "recv_account_number"),
        "recv_account_holder": get_setting(&conn, "recv_account_holder"),
        "recv_momo": get_setting(&conn, "recv_momo"),
        "recv_zalopay": get_setting(&conn, "recv_zalopay"),
        "api_gateway": gateway,
        "api_connected": !gateway.is_empty() && !key.is_empty(),
    })))
}

pub async fn admin_save_settings(
    State(state): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult {
    let user = auth_user(&state, &headers)?;
    require_owner(&user)?;
    let conn = state.db.conn.lock().unwrap();
    for k in [
        "recv_bank_name",
        "recv_bank_bin",
        "recv_account_number",
        "recv_account_holder",
        "recv_momo",
        "recv_zalopay",
        "api_gateway",
    ] {
        if let Some(v) = body.get(k) {
            if let Some(s) = v.as_str() {
                set_setting(&conn, k, s);
            }
        }
    }
    if let Some(k) = body.get("api_key").and_then(|v| v.as_str()) {
        set_setting(&conn, "api_key", k);
    }
    Ok(Json(json!({ "ok": true })))
}
