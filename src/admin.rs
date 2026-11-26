//! The owner-only area: shop overview, product and order
//! management, manual top-up confirmation, and shop settings.

use crate::auth::{Shared, auth, require_owner};
use crate::helpers::{HandlerResult, bad, fail, fmt_money, js_truthy, now_ms};
use crate::store::{
    PRODUCT_COLUMNS, ProductView, deposit_from_row, parse_items, product_from_row, save_setting,
    setting,
};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Json;
use rusqlite::params;
use serde_json::{Value, json};

/// A 500 with the generic message used when the database misbehaves.
fn server_error() -> (StatusCode, Json<Value>) {
    fail(StatusCode::INTERNAL_SERVER_ERROR, "Có lỗi xảy ra")
}

/// Authenticate and confirm shop ownership in one step.
fn owner(
    state: &Shared,
    headers: &HeaderMap,
) -> Result<crate::store::AccountView, (StatusCode, Json<Value>)> {
    let account = auth(state, headers)?;
    require_owner(&account)?;
    Ok(account)
}

pub async fn overview(State(state): State<Shared>, headers: HeaderMap) -> HandlerResult {
    let _owner = owner(&state, &headers)?;
    let conn = state.store.inner.lock().unwrap();
    let pending: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM deposits WHERE status = 'pending'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let total_orders: i64 = conn
        .query_row("SELECT COUNT(*) FROM orders", [], |row| row.get(0))
        .unwrap_or(0);
    let revenue: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(total),0) FROM orders WHERE status IN ('paid','delivered')",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    Ok(Json(json!({
        "pending_deposits": pending,
        "total_orders": total_orders,
        "revenue": revenue,
    })))
}

pub async fn list_products(State(state): State<Shared>, headers: HeaderMap) -> HandlerResult {
    let _owner = owner(&state, &headers)?;
    let conn = state.store.inner.lock().unwrap();
    let mut stmt = conn
        .prepare(&format!("SELECT {} FROM products ORDER BY id", PRODUCT_COLUMNS))
        .map_err(|_| server_error())?;
    let rows = stmt
        .query_map([], product_from_row)
        .map_err(|_| server_error())?
        .collect::<Result<Vec<ProductView>, _>>()
        .map_err(|_| server_error())?;
    Ok(Json(json!({ "products": rows })))
}

pub async fn create_product(
    State(state): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> HandlerResult {
    let _owner = owner(&state, &headers)?;
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
    if platform.is_empty() || name.is_empty() || price.is_none() {
        return Err(bad("Nhập đủ nền tảng, tên và giá"));
    }
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
    let conn = state.store.inner.lock().unwrap();
    conn.execute(
        "INSERT INTO products (platform, name, price, stock, warranty, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        params![platform, name, price.unwrap() as i64, stock, warranty, description, now_ms()],
    )
    .map_err(|_| server_error())?;
    Ok(Json(json!({ "id": conn.last_insert_rowid() })))
}

pub async fn update_product(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(id): Path<i64>,
    Json(body): Json<Value>,
) -> HandlerResult {
    let _owner = owner(&state, &headers)?;
    let conn = state.store.inner.lock().unwrap();
    let current: Option<ProductView> = conn
        .query_row(
            &format!("SELECT {} FROM products WHERE id = ?", PRODUCT_COLUMNS),
            params![id],
            product_from_row,
        )
        .ok();
    let current = match current {
        Some(p) => p,
        None => return Err(fail(StatusCode::NOT_FOUND, "Không tìm thấy sản phẩm")),
    };
    let platform = body
        .get("platform")
        .and_then(|v| v.as_str())
        .unwrap_or(&current.platform)
        .to_string();
    let name = body
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(&current.name)
        .to_string();
    let price = body
        .get("price")
        .and_then(|v| v.as_f64())
        .map(|f| f as i64)
        .unwrap_or(current.price);
    let stock = body
        .get("stock")
        .and_then(|v| v.as_i64())
        .unwrap_or(current.stock);
    let warranty = body
        .get("warranty")
        .and_then(|v| v.as_str())
        .unwrap_or(&current.warranty)
        .to_string();
    let description = body
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or(&current.description)
        .to_string();
    let active: i64 = match body.get("active") {
        Some(v) => {
            if js_truthy(v) {
                1
            } else {
                0
            }
        }
        None => current.active,
    };
    let _ = conn.execute(
        "UPDATE products SET platform = ?, name = ?, price = ?, stock = ?, warranty = ?, description = ?, active = ? WHERE id = ?",
        params![platform, name, price, stock, warranty, description, active, id],
    );
    Ok(Json(json!({ "ok": true })))
}

pub async fn delete_product(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(id): Path<i64>,
) -> HandlerResult {
    let _owner = owner(&state, &headers)?;
    let conn = state.store.inner.lock().unwrap();
    let _ = conn.execute("DELETE FROM products WHERE id = ?", params![id]);
    Ok(Json(json!({ "ok": true })))
}

pub async fn list_orders(State(state): State<Shared>, headers: HeaderMap) -> HandlerResult {
    let _owner = owner(&state, &headers)?;
    let conn = state.store.inner.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 100")
        .map_err(|_| server_error())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, i64>(9)?,
            ))
        })
        .map_err(|_| server_error())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| server_error())?;
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

pub async fn set_order_status(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(code): Path<String>,
    Json(body): Json<Value>,
) -> HandlerResult {
    let _owner = owner(&state, &headers)?;
    let status = body
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if !["pending", "paid", "delivered", "cancelled"].contains(&status.as_str()) {
        return Err(bad("Trạng thái không hợp lệ"));
    }
    let conn = state.store.inner.lock().unwrap();
    let _ = conn.execute(
        "UPDATE orders SET status = ? WHERE code = ?",
        params![status, code.to_uppercase()],
    );
    Ok(Json(json!({ "ok": true })))
}

pub async fn list_deposits(State(state): State<Shared>, headers: HeaderMap) -> HandlerResult {
    let _owner = owner(&state, &headers)?;
    let conn = state.store.inner.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT d.*, u.username FROM deposits d \
             JOIN users u ON u.id = d.user_id \
             ORDER BY d.created_at DESC LIMIT 100",
        )
        .map_err(|_| server_error())?;
    let rows = stmt
        .query_map([], |row| {
            let mut deposit = deposit_from_row(row)?;
            let username: String = row.get(14)?;
            deposit["username"] = json!(username);
            Ok(deposit)
        })
        .map_err(|_| server_error())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| server_error())?;
    Ok(Json(json!({ "deposits": rows })))
}

pub async fn confirm_deposit(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(code): Path<String>,
) -> HandlerResult {
    let _owner = owner(&state, &headers)?;
    let code = code.to_uppercase();
    let conn = state.store.inner.lock().unwrap();
    let found: Option<(i64, i64, String, i64)> = conn
        .query_row(
            "SELECT id, amount, status, user_id FROM deposits WHERE code = ?",
            params![code],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .ok();
    let (dep_id, amount, status, dep_user_id) = match found {
        Some(row) => row,
        None => return Err(fail(StatusCode::NOT_FOUND, "Không tìm thấy")),
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

pub async fn get_settings(State(state): State<Shared>, headers: HeaderMap) -> HandlerResult {
    let _owner = owner(&state, &headers)?;
    let conn = state.store.inner.lock().unwrap();
    let gateway = setting(&conn, "api_gateway");
    let key = setting(&conn, "api_key");
    Ok(Json(json!({
        "recv_bank_name": setting(&conn, "recv_bank_name"),
        "recv_bank_bin": setting(&conn, "recv_bank_bin"),
        "recv_account_number": setting(&conn, "recv_account_number"),
        "recv_account_holder": setting(&conn, "recv_account_holder"),
        "recv_momo": setting(&conn, "recv_momo"),
        "recv_zalopay": setting(&conn, "recv_zalopay"),
        "api_gateway": gateway,
        "api_connected": !gateway.is_empty() && !key.is_empty(),
    })))
}

pub async fn save_settings(
    State(state): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> HandlerResult {
    let _owner = owner(&state, &headers)?;
    let conn = state.store.inner.lock().unwrap();
    // The API key is stored the same way but is never sent back out.
    for key in [
        "recv_bank_name",
        "recv_bank_bin",
        "recv_account_number",
        "recv_account_holder",
        "recv_momo",
        "recv_zalopay",
        "api_gateway",
        "api_key",
    ] {
        if let Some(value) = body.get(key).and_then(|v| v.as_str()) {
            save_setting(&conn, key, value);
        }
    }
    Ok(Json(json!({ "ok": true })))
}
