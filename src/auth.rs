//! Session authentication: reading the bearer token, resolving it
//! to the account that owns it, and guarding the owner-only area.

use crate::helpers::{fail, now_ms};
use crate::store::{AccountView, Store};
use crate::AppState;
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::Json;
use rusqlite::{Connection, params};
use serde_json::Value;
use std::sync::Arc;

/// Shared state handed to every handler.
pub type Shared = Arc<AppState>;

/// Failure value every auth helper returns.
pub type AuthFailure = (StatusCode, Json<Value>);

/// Pull the token out of an `Authorization` header. Accepts both
/// `"Bearer <token>"` (any capitalisation) and a bare token.
pub fn token_from_headers(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let trimmed = raw.trim();
    if trimmed.len() >= 7 && trimmed[..7].eq_ignore_ascii_case("bearer ") {
        Some(trimmed[7..].trim().to_string())
    } else if trimmed.eq_ignore_ascii_case("bearer") {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Resolve a token to its account when the session exists and has
/// not expired yet. Returns `None` for unknown or expired tokens.
fn account_for_token(conn: &Connection, token: &str) -> Option<AccountView> {
    let user_id: i64 = conn
        .query_row(
            "SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?",
            params![token, now_ms()],
            |row| row.get(0),
        )
        .ok()?;
    conn.query_row(
        "SELECT id, full_name, username, is_owner, balance FROM users WHERE id = ?",
        params![user_id],
        |row| {
            Ok(AccountView::new(
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        },
    )
    .ok()
}

/// The signed-in account for this request, or a 401. A missing token
/// and an expired/unknown token get different messages.
pub fn require_account(store: &Store, headers: &HeaderMap) -> Result<AccountView, AuthFailure> {
    let token = match token_from_headers(headers) {
        Some(t) if !t.is_empty() => t,
        _ => return Err(fail(StatusCode::UNAUTHORIZED, "Chưa đăng nhập")),
    };
    let conn = store.inner.lock().unwrap();
    account_for_token(&conn, &token)
        .ok_or_else(|| fail(StatusCode::UNAUTHORIZED, "Phiên đã hết hạn, đăng nhập lại"))
}

/// The signed-in account when a request happens to carry a valid
/// token, or `None` — used by endpoints that also serve guests.
pub fn maybe_account(store: &Store, headers: &HeaderMap) -> Option<AccountView> {
    let token = token_from_headers(headers)?;
    if token.is_empty() {
        return None;
    }
    let conn = store.inner.lock().unwrap();
    account_for_token(&conn, &token)
}

/// Reject anyone who is not the shop owner (403).
pub fn require_owner(account: &AccountView) -> Result<(), AuthFailure> {
    if account.is_owner {
        Ok(())
    } else {
        Err(fail(
            StatusCode::FORBIDDEN,
            "Chỉ chủ shop mới dùng được mục này",
        ))
    }
}

/// A username is valid when it is 3–40 characters long and uses only
/// lowercase letters, digits, `.`, `_` and `-`.
pub fn username_ok(name: &str) -> bool {
    let len = name.chars().count();
    (3..=40).contains(&len)
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
}

/// Authenticate in one line from a handler.
pub fn auth(state: &Shared, headers: &HeaderMap) -> Result<AccountView, AuthFailure> {
    require_account(&state.store, headers)
}
