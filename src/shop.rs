//! The public shop API: accounts, catalogue, orders, wallet,
//! top-ups, leaderboards and the support bot.

use crate::auth::{Shared, auth, maybe_account, token_from_headers, username_ok};
use crate::bank;
use crate::helpers::{
    HandlerResult, SESSION_TTL_MS, bad, fail, fmt_money, fresh_code, fresh_salt, fresh_token,
    hash_password, mask_name, now_ms,
};
use crate::store::{
    AccountView, PRODUCT_COLUMNS, ProductView, deposit_from_row, parse_items, product_from_row,
    setting, sold_qty_since, DEPOSIT_COLUMNS,
};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Json;
use rusqlite::params;
use serde_json::{Value, json};
use std::collections::HashMap;

/// A 500 with the generic message used when the database misbehaves.
fn server_error() -> (StatusCode, Json<Value>) {
    fail(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra")
}

/// Read a string field from a JSON body, trimmed; missing fields
/// read as an empty string.
fn text(body: &Value, key: &str) -> String {
    body.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string()
}

/// Read an optional card field: empty strings become `None` so the
/// column stays NULL.
fn card_field(body: &Value, key: &str) -> Option<String> {
    match body.get(key).and_then(|v| v.as_str()) {
        Some(s) if !s.is_empty() => Some(s.to_string()),
        _ => None,
    }
}

/// Open a fresh session row for an account and return its token.
fn start_session(conn: &rusqlite::Connection, user_id: i64) -> String {
    let token = fresh_token();
    let _ = conn.execute(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
        params![token, user_id, now_ms() + SESSION_TTL_MS],
    );
    token
}

// ---------------------------------------------------------------- accounts

pub async fn register(State(state): State<Shared>, Json(body): Json<Value>) -> HandlerResult {
    let full_name = text(&body, "full_name");
    let username = text(&body, "username").to_lowercase();
    let password = body
        .get("password")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if full_name.is_empty() {
        return Err(bad("Nhập họ tên"));
    }
    if !username_ok(&username) {
        return Err(bad("Tên đăng nhập 3–40 ký tự: chữ thường, số, . _ -"));
    }
    if password.chars().count() < 4 {
        return Err(bad("Mật khẩu ít nhất 4 ký tự"));
    }

    let conn = state.store.inner.lock().unwrap();
    let taken: Option<i64> = conn
        .query_row(
            "SELECT id FROM users WHERE username = ?",
            params![username],
            |row| row.get(0),
        )
        .ok();
    if taken.is_some() {
        return Err(bad("Tên đăng nhập đã có người dùng"));
    }
    let existing: i64 = conn
        .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
        .unwrap_or(0);
    let owner: i64 = if existing == 0 { 1 } else { 0 };
    let salt = fresh_salt();
    let digest = hash_password(&password, &salt);
    conn.execute(
        "INSERT INTO users (full_name, username, password_hash, salt, is_owner, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        params![full_name, username, digest, salt, owner, now_ms()],
    )
    .map_err(|_| server_error())?;
    let id = conn.last_insert_rowid();
    let token = start_session(&conn, id);
    let account = AccountView::new(id, full_name, username, owner, 0);
    let mut out = json!({ "token": token, "user": account, "is_owner": owner != 0 });
    if owner != 0 {
        out["note"] = json!("Bạn là tài khoản đầu tiên nên là chủ shop.");
    }
    Ok(Json(out))
}

pub async fn login(State(state): State<Shared>, Json(body): Json<Value>) -> HandlerResult {
    let username = text(&body, "username").to_lowercase();
    let password = body
        .get("password")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let conn = state.store.inner.lock().unwrap();
    let found = conn
        .query_row(
            "SELECT id, full_name, username, password_hash, salt, is_owner, balance FROM users WHERE username = ?",
            params![username],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            },
        )
        .ok();
    let (id, full_name, uname, stored, salt, owner, balance) = match found {
        Some(row) => row,
        None => return Err(bad("Sai tên đăng nhập hoặc mật khẩu")),
    };
    if hash_password(&password, &salt) != stored {
        return Err(bad("Sai tên đăng nhập hoặc mật khẩu"));
    }
    let token = start_session(&conn, id);
    Ok(Json(json!({
        "token": token,
        "user": AccountView::new(id, full_name, uname, owner, balance),
    })))
}

pub async fn logout(State(state): State<Shared>, headers: HeaderMap) -> HandlerResult {
    let _account = auth(&state, &headers)?;
    if let Some(token) = token_from_headers(&headers) {
        let conn = state.store.inner.lock().unwrap();
        let _ = conn.execute("DELETE FROM sessions WHERE token = ?", params![token]);
    }
    Ok(Json(json!({ "ok": true })))
}

pub async fn me(State(state): State<Shared>, headers: HeaderMap) -> HandlerResult {
    let account = auth(&state, &headers)?;
    Ok(Json(json!({ "user": account })))
}

pub async fn rename(
    State(state): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> HandlerResult {
    let account = auth(&state, &headers)?;
    let name = text(&body, "full_name");
    if name.is_empty() {
        return Err(bad("Nhập họ tên mới"));
    }
    let conn = state.store.inner.lock().unwrap();
    let _ = conn.execute(
        "UPDATE users SET full_name = ? WHERE id = ?",
        params![name, account.id],
    );
    Ok(Json(json!({ "ok": true })))
}

// ---------------------------------------------------------------- catalogue

pub async fn products(State(state): State<Shared>) -> HandlerResult {
    let conn = state.store.inner.lock().unwrap();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {} FROM products WHERE active = 1 ORDER BY id",
            PRODUCT_COLUMNS
        ))
        .map_err(|_| server_error())?;
    let rows = stmt
        .query_map([], product_from_row)
        .map_err(|_| server_error())?
        .collect::<Result<Vec<ProductView>, _>>()
        .map_err(|_| server_error())?;
    Ok(Json(json!({ "products": rows })))
}

pub async fn stats(State(state): State<Shared>) -> HandlerResult {
    let conn = state.store.inner.lock().unwrap();
    let sold = sold_qty_since(&conn, now_ms() - 30 * 24 * 3600 * 1000);
    let total_products: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM products WHERE active = 1",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    Ok(Json(json!({
        "sold_30d": sold,
        "total_products": total_products,
        "sold_raw": { "n": sold },
    })))
}

// ------------------------------------------------------------------- orders

/// One resolved order line: the product snapshot plus quantity.
struct Line {
    product_id: i64,
    platform: String,
    name: String,
    price: i64,
    qty: i64,
}

impl Line {
    fn as_json(&self) -> Value {
        json!({
            "product_id": self.product_id,
            "platform": self.platform,
            "name": self.name,
            "price": self.price,
            "qty": self.qty,
        })
    }
}

pub async fn create_order(
    State(state): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> HandlerResult {
    let viewer = maybe_account(&state.store, &headers);
    let raw_items: Vec<Value> = body
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut buyer = text(&body, "buyer_name");
    if buyer.is_empty() {
        buyer = viewer.as_ref().map(|u| u.full_name.clone()).unwrap_or_default();
    }
    let contact = text(&body, "contact");
    let pay_method = if body.get("pay_method").and_then(|v| v.as_str()) == Some("manual") {
        "manual"
    } else {
        "wallet"
    };
    if raw_items.is_empty() {
        return Err(bad("Giỏ hàng trống"));
    }
    if buyer.is_empty() || contact.is_empty() {
        return Err(bad("Nhập họ tên và SĐT / Zalo / Telegram để nhận tài khoản"));
    }

    // Resolve every line against the live catalogue while holding the
    // lock, so stock cannot change underneath the checks below.
    let mut guard = state.store.inner.lock().unwrap();
    let mut lines: Vec<Line> = Vec::with_capacity(raw_items.len());
    let mut total: i64 = 0;
    for raw in &raw_items {
        let pid = raw.get("product_id").and_then(|v| v.as_i64()).unwrap_or(0);
        let found: Option<ProductView> = guard
            .query_row(
                &format!(
                    "SELECT {} FROM products WHERE id = ? AND active = 1",
                    PRODUCT_COLUMNS
                ),
                params![pid],
                product_from_row,
            )
            .ok();
        let product = match found {
            Some(p) => p,
            None => return Err(bad("Có sản phẩm không còn bán")),
        };
        let qty = raw
            .get("qty")
            .and_then(|v| v.as_i64())
            .unwrap_or(1)
            .max(1);
        if product.stock < qty {
            return Err(bad(&format!(
                "Sản phẩm \"{}\" chỉ còn {} cái",
                product.name, product.stock
            )));
        }
        total += product.price * qty;
        lines.push(Line {
            product_id: product.id,
            platform: product.platform,
            name: product.name,
            price: product.price,
            qty,
        });
    }

    let buyer_id = viewer.as_ref().map(|u| u.id);
    if pay_method == "wallet" {
        let who = match &viewer {
            Some(u) => u,
            None => {
                return Err(fail(
                    StatusCode::UNAUTHORIZED,
                    "Thanh toán bằng ví cần đăng nhập",
                ))
            }
        };
        // Re-read the balance under the lock: the snapshot taken
        // during auth may predate another order.
        let current: i64 = guard
            .query_row(
                "SELECT balance FROM users WHERE id = ?",
                params![who.id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if current < total {
            return Err(bad(&format!(
                "Ví chỉ còn {}, cần {}. Nạp thêm tiền rồi đặt lại.",
                fmt_money(current),
                fmt_money(total)
            )));
        }
    }

    // One transaction: charge the wallet (wallet orders only),
    // take the items out of stock, and record the order.
    let tx = guard.transaction().map_err(|_| server_error())?;
    if pay_method == "wallet" {
        let uid = viewer.as_ref().unwrap().id;
        tx.execute(
            "UPDATE users SET balance = balance - ? WHERE id = ?",
            params![total, uid],
        )
        .map_err(|_| server_error())?;
    }
    for line in &lines {
        tx.execute(
            "UPDATE products SET stock = stock - ? WHERE id = ?",
            params![line.qty, line.product_id],
        )
        .map_err(|_| server_error())?;
    }
    let code = fresh_code("DH");
    let status = if pay_method == "wallet" { "paid" } else { "pending" };
    let items_json = serde_json::to_string(
        &lines.iter().map(|l| l.as_json()).collect::<Vec<Value>>(),
    )
    .unwrap_or_else(|_| "[]".to_string());
    tx.execute(
        "INSERT INTO orders (code, user_id, buyer_name, contact, items_json, total, pay_method, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![code, buyer_id, buyer, contact, items_json, total, pay_method, status, now_ms()],
    )
    .map_err(|_| server_error())?;
    tx.commit().map_err(|_| server_error())?;
    Ok(Json(json!({
        "code": code,
        "total": total,
        "pay_method": pay_method,
        "message": if pay_method == "wallet" {
            "Đã thanh toán bằng ví. Lưu mã đơn để tra cứu."
        } else {
            "Đã tạo đơn. Lưu mã đơn để tra cứu."
        },
    })))
}

pub async fn orders_mine(State(state): State<Shared>, headers: HeaderMap) -> HandlerResult {
    let account = auth(&state, &headers)?;
    let conn = state.store.inner.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT code, items_json, total, status, created_at FROM orders WHERE user_id = ? ORDER BY created_at DESC")
        .map_err(|_| server_error())?;
    let rows = stmt
        .query_map(params![account.id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|_| server_error())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| server_error())?;
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
) -> HandlerResult {
    let code = text(&body, "code").to_uppercase();
    let contact = text(&body, "contact");
    if code.is_empty() || contact.is_empty() {
        return Err(bad("Nhập mã đơn và thông tin liên hệ lúc đặt hàng"));
    }
    let conn = state.store.inner.lock().unwrap();
    let found: Option<(String, String, i64, String, i64)> = conn
        .query_row(
            "SELECT code, items_json, total, status, created_at FROM orders WHERE code = ? AND contact = ?",
            params![code, contact],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )
        .ok();
    let (code, items_json, total, status, created_at) = match found {
        Some(row) => row,
        None => {
            return Err(fail(
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

pub async fn notifications(State(state): State<Shared>) -> HandlerResult {
    let conn = state.store.inner.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT buyer_name, items_json, status, created_at FROM orders WHERE status IN ('paid','delivered','pending') ORDER BY created_at DESC LIMIT 8")
        .map_err(|_| server_error())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(|_| server_error())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| server_error())?;
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

// ------------------------------------------------------- recent activity

fn first_item_name(items_json: &str) -> String {
    parse_items(items_json)
        .get(0)
        .and_then(|i| i.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or("Tài khoản")
        .to_string()
}

fn method_label(method: &str) -> &'static str {
    match method {
        "bank" => "Chuyển khoản ngân hàng",
        "momo" => "MoMo",
        "zalopay" => "ZaloPay",
        "card" => "Thẻ cào",
        _ => "Chuyển khoản",
    }
}

pub async fn activity(
    State(state): State<Shared>,
    Query(query): Query<HashMap<String, String>>,
) -> HandlerResult {
    let limit: i64 = query
        .get("limit")
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(6)
        .clamp(1, 50);
    let conn = state.store.inner.lock().unwrap();
    let mut feed: Vec<Value> = Vec::new();

    {
        let mut stmt = conn
            .prepare("SELECT buyer_name, items_json, total, created_at FROM orders WHERE status IN ('paid','delivered') ORDER BY created_at DESC LIMIT 50")
            .map_err(|_| server_error())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(|_| server_error())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| server_error())?;
        for (buyer, items_json, total, created_at) in rows {
            let name = first_item_name(&items_json);
            feed.push(json!({
                "type": "purchase",
                "name": mask_name(&buyer),
                "desc": format!("Thanh toán thành công · {}", name),
                "amount": -total,
                "created_at": created_at,
            }));
        }
    }
    {
        let mut stmt = conn
            .prepare("SELECT buyer_name, items_json, created_at FROM orders WHERE status = 'pending' ORDER BY created_at DESC LIMIT 50")
            .map_err(|_| server_error())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(|_| server_error())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| server_error())?;
        for (buyer, items_json, created_at) in rows {
            let name = first_item_name(&items_json);
            feed.push(json!({
                "type": "order",
                "name": mask_name(&buyer),
                "desc": format!("Đặt hàng · {}", name),
                "amount": Value::Null,
                "created_at": created_at,
            }));
        }
    }
    {
        let mut stmt = conn
            .prepare("SELECT d.amount, d.method, d.created_at, u.full_name FROM deposits d JOIN users u ON u.id = d.user_id WHERE d.status = 'verified' ORDER BY d.created_at DESC LIMIT 50")
            .map_err(|_| server_error())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|_| server_error())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| server_error())?;
        for (amount, method, created_at, full_name) in rows {
            feed.push(json!({
                "type": "topup",
                "name": mask_name(&full_name),
                "desc": format!("Nạp tiền thành công · {}", method_label(&method)),
                "amount": amount,
                "created_at": created_at,
            }));
        }
    }
    {
        let mut stmt = conn
            .prepare("SELECT full_name, created_at FROM users ORDER BY created_at DESC LIMIT 50")
            .map_err(|_| server_error())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|_| server_error())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| server_error())?;
        for (full_name, created_at) in rows {
            feed.push(json!({
                "type": "register",
                "name": mask_name(&full_name),
                "desc": "Đăng ký tài khoản mới · Gia nhập nền tảng",
                "amount": Value::Null,
                "created_at": created_at,
            }));
        }
    }

    feed.sort_by(|a, b| {
        let ca = a.get("created_at").and_then(|v| v.as_i64()).unwrap_or(0);
        let cb = b.get("created_at").and_then(|v| v.as_i64()).unwrap_or(0);
        cb.cmp(&ca)
    });
    let total = feed.len();
    let page: Vec<Value> = feed.into_iter().take(limit as usize).collect();
    Ok(Json(json!({ "activity": page, "total": total })))
}

// ------------------------------------------------------------ wallet / top-up

pub async fn wallet(State(state): State<Shared>, headers: HeaderMap) -> HandlerResult {
    let account = auth(&state, &headers)?;
    let conn = state.store.inner.lock().unwrap();
    let balance: i64 = conn
        .query_row(
            "SELECT balance FROM users WHERE id = ?",
            params![account.id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let mut stmt = conn
        .prepare("SELECT code, amount, method, status, created_at, verified_at FROM deposits WHERE user_id = ? ORDER BY created_at DESC LIMIT 50")
        .map_err(|_| server_error())?;
    let rows = stmt
        .query_map(params![account.id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, Option<i64>>(5)?,
            ))
        })
        .map_err(|_| server_error())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| server_error())?;
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

pub async fn receiving_info(State(state): State<Shared>) -> HandlerResult {
    let conn = state.store.inner.lock().unwrap();
    Ok(Json(json!({
        "bank_name": setting(&conn, "recv_bank_name"),
        "bank_bin": setting(&conn, "recv_bank_bin"),
        "account_number": setting(&conn, "recv_account_number"),
        "account_holder": setting(&conn, "recv_account_holder"),
        "momo": setting(&conn, "recv_momo"),
        "zalopay": setting(&conn, "recv_zalopay"),
    })))
}

pub async fn create_deposit(
    State(state): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> HandlerResult {
    let account = auth(&state, &headers)?;
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
    let code = fresh_code("NAP");
    let conn = state.store.inner.lock().unwrap();
    conn.execute(
        "INSERT INTO deposits (code, user_id, amount, method, status, card_carrier, card_serial, card_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            code,
            account.id,
            amount as i64,
            method,
            "pending",
            card_field(&body, "card_carrier"),
            card_field(&body, "card_serial"),
            card_field(&body, "card_code"),
            now_ms(),
        ],
    )
    .map_err(|_| server_error())?;
    Ok(Json(json!({
        "code": code,
        "amount": amount as i64,
        "method": method,
        "message": "Đã tạo yêu cầu nạp. Chuyển tiền đúng nội dung mã này rồi bấm kiểm tra giao dịch qua API.",
    })))
}

pub async fn get_deposit(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(code): Path<String>,
) -> HandlerResult {
    let account = auth(&state, &headers)?;
    let code = code.to_uppercase();
    let conn = state.store.inner.lock().unwrap();
    let found: Option<Value> = conn
        .query_row(
            &format!(
                "SELECT {} FROM deposits WHERE code = ? AND user_id = ?",
                DEPOSIT_COLUMNS
            ),
            params![code, account.id],
            deposit_from_row,
        )
        .ok();
    match found {
        Some(deposit) => Ok(Json(json!({ "deposit": deposit }))),
        None => Err(fail(
            StatusCode::NOT_FOUND,
            "Không tìm thấy yêu cầu nạp này",
        )),
    }
}

pub async fn check_api(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(code): Path<String>,
) -> HandlerResult {
    let account = auth(&state, &headers)?;
    let code = code.to_uppercase();

    // Load the request first, then release the lock before the
    // network call so other requests are not blocked behind it.
    let wanted: Option<(i64, i64, String, String)> = {
        let conn = state.store.inner.lock().unwrap();
        conn.query_row(
            "SELECT id, amount, method, status FROM deposits WHERE code = ? AND user_id = ?",
            params![code, account.id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .ok()
    };
    let (dep_id, amount, method, status) = match wanted {
        Some(row) => row,
        None => {
            return Err(fail(
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
        let conn = state.store.inner.lock().unwrap();
        (setting(&conn, "api_gateway"), setting(&conn, "api_key"))
    };
    let fetched = bank::fetch_transactions(&gateway, &api_key).await;
    if !fetched.connected {
        return Err(bad(&fetched.error.unwrap_or_else(|| {
            "Shop chưa kết nối API SePay/Casso. Chủ shop vào Quản lý shop → API nạp tiền qua QR để kết nối.".to_string()
        })));
    }

    // A transfer matches when the amount is exact, its note contains
    // the NAP code, and no other top-up already claimed that
    // transaction id.
    let matched: Option<bank::BankTx> = {
        let conn = state.store.inner.lock().unwrap();
        let mut hit = None;
        for tx in &fetched.transactions {
            if tx.id.is_empty() || tx.amount != amount {
                continue;
            }
            if !tx.content.to_uppercase().contains(&code) {
                continue;
            }
            let claimed: Option<i64> = conn
                .query_row(
                    "SELECT id FROM deposits WHERE bank_tx_id = ?",
                    params![tx.id],
                    |row| row.get(0),
                )
                .ok();
            if claimed.is_none() {
                hit = Some(tx.clone());
                break;
            }
        }
        hit
    };
    let tx = match matched {
        Some(tx) => tx,
        None => {
            return Err(fail(
                StatusCode::NOT_FOUND,
                &format!(
                    "Chưa thấy giao dịch khớp (đúng số tiền + đúng nội dung mã {}). Kiểm tra lại nội dung chuyển khoản rồi thử lại.",
                    code
                ),
            ))
        }
    };
    let conn = state.store.inner.lock().unwrap();
    let _ = conn.execute(
        "UPDATE deposits SET status = 'verified', bank_tx_id = ?, verified_at = ? WHERE id = ?",
        params![tx.id, now_ms(), dep_id],
    );
    let _ = conn.execute(
        "UPDATE users SET balance = balance + ? WHERE id = ?",
        params![amount, account.id],
    );
    Ok(Json(json!({
        "ok": true,
        "message": format!("Đã khớp giao dịch và cộng {} vào ví.", fmt_money(amount)),
    })))
}

pub async fn api_status(State(state): State<Shared>) -> HandlerResult {
    let conn = state.store.inner.lock().unwrap();
    let gateway = setting(&conn, "api_gateway");
    let key = setting(&conn, "api_key");
    let connected = !gateway.is_empty() && !key.is_empty();
    Ok(Json(json!({
        "connected": connected,
        "gateway": if gateway.is_empty() { Value::Null } else { Value::String(gateway) },
    })))
}

// ------------------------------------------------------------- leaderboards

pub async fn leaderboard(State(state): State<Shared>) -> HandlerResult {
    let conn = state.store.inner.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT u.full_name, COALESCE(SUM(d.amount), 0) AS total \
             FROM deposits d JOIN users u ON u.id = d.user_id \
             WHERE d.status = 'verified' GROUP BY d.user_id ORDER BY total DESC LIMIT 20",
        )
        .map_err(|_| server_error())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|_| server_error())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| server_error())?;
    let top: Vec<Value> = rows
        .into_iter()
        .enumerate()
        .map(|(i, (name, total))| {
            json!({ "rank": i + 1, "name": mask_name(&name), "total": total })
        })
        .collect();
    Ok(Json(json!({ "top": top })))
}

pub async fn leaderboard_mine(State(state): State<Shared>, headers: HeaderMap) -> HandlerResult {
    let account = auth(&state, &headers)?;
    let conn = state.store.inner.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT u.id, COALESCE(SUM(d.amount), 0) AS total \
             FROM deposits d JOIN users u ON u.id = d.user_id \
             WHERE d.status = 'verified' GROUP BY d.user_id ORDER BY total DESC",
        )
        .map_err(|_| server_error())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|_| server_error())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| server_error())?;
    match rows.iter().position(|(id, _)| *id == account.id) {
        Some(i) => Ok(Json(json!({ "rank": i + 1, "total": rows[i].1 }))),
        None => Ok(Json(json!({ "rank": Value::Null, "total": 0 }))),
    }
}

// ------------------------------------------------------------------------ bot

/// Find an order code inside a lowercased message: the letters `dh`
/// followed by at least four hex digits.
fn find_order_code(message: &str) -> Option<String> {
    let bytes = message.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'd' && bytes[i + 1] == b'h' {
            let mut j = i + 2;
            while j < bytes.len() && (bytes[j] as char).is_ascii_hexdigit() {
                j += 1;
            }
            if j - (i + 2) >= 4 {
                return Some(format!("DH{}", message[i + 2..j].to_uppercase()));
            }
            i = j;
        } else {
            i += 1;
        }
    }
    None
}

pub async fn bot(State(state): State<Shared>, Json(body): Json<Value>) -> HandlerResult {
    let asked = body
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();

    let reply = if asked.contains("giá") || asked.contains("bao nhiêu") || asked.contains("mua") {
        let conn = state.store.inner.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT name, price FROM products WHERE active = 1 ORDER BY price LIMIT 5")
            .map_err(|_| server_error())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|_| server_error())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| server_error())?;
        let cheapest: Vec<String> = rows
            .iter()
            .map(|(name, price)| format!("{} — {}", name, fmt_money(*price)))
            .collect();
        format!(
            "Giá tham khảo: {}. Chọn sản phẩm rồi bấm Mua ngay nhé.",
            cheapest.join(" | ")
        )
    } else if asked.contains("nạp")
        || asked.contains("nap")
        || asked.contains("ví")
        || asked.contains("nap tien")
    {
        "Nạp tiền: vào tab Nạp tiền, chọn số tiền (tối thiểu 10.000đ), chuyển đúng nội dung mã NAP… rồi bấm \"Kiểm tra giao dịch qua API\". Tiền chỉ cộng khi khớp đúng số tiền + mã.".to_string()
    } else if asked.contains("bảo hành") || asked.contains("doi") || asked.contains("đổi") {
        "Shop bảo hành 1 đổi 1 theo thời hạn ghi trên từng sản phẩm. Gửi mã đơn (DH…) để mình kiểm tra.".to_string()
    } else if asked.contains("đơn") || asked.contains("tra cứu") || asked.contains("dh") {
        match find_order_code(&asked) {
            Some(code) => {
                let conn = state.store.inner.lock().unwrap();
                let found: Option<(String, i64)> = conn
                    .query_row(
                        "SELECT status, total FROM orders WHERE code = ?",
                        params![code],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .ok();
                match found {
                    Some((status, total)) => {
                        let state_text = match status.as_str() {
                            "paid" => "đã thanh toán",
                            "delivered" => "đã giao",
                            "cancelled" => "đã hủy",
                            _ => "chờ xử lý",
                        };
                        format!("Đơn {}: {}, tổng {}.", code, state_text, fmt_money(total))
                    }
                    None => "Không tìm thấy đơn này. Nhập đúng mã DH… và thông tin liên hệ lúc đặt hàng ở mục Tra cứu đơn.".to_string(),
                }
            }
            None => {
                "Gửi mã đơn DH… để mình kiểm tra, hoặc vào mục Tra cứu đơn nhập mã + thông tin liên hệ.".to_string()
            }
        }
    } else if asked.contains("chào") || asked.contains("hello") || asked.contains("hi") {
        "Chào bạn, mình là bot hỗ trợ của Chợ Tài Nguyên Mmo, online 24/7. Bạn cần hỏi giá, nạp tiền, bảo hành hay tra cứu đơn?".to_string()
    } else {
        "Mình là bot hỗ trợ 24/7 của Chợ Tài Nguyên Mmo. Bạn hỏi về giá, nạp tiền, bảo hành 1 đổi 1 hay tra cứu đơn (gửi mã DH…) nhé.".to_string()
    };
    Ok(Json(json!({ "reply": reply })))
}
