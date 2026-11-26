//! Chợ Tài Nguyên Mmo — backend Rust (Axum + SQLite).
//! Thay thế server Node/Express cũ (server-node/), cùng API, cùng frontend
//! (public/), cùng dữ liệu SQLite (shop.db).
//!
//! Chạy local: `cargo run` (mặc định cổng 8080, đổi bằng biến PORT).
//! Biến môi trường: PORT (mặc định 8080), DB_PATH (mặc định ./shop.db),
//! PUBLIC_DIR (mặc định ./public).

mod bank;
mod db;
mod handlers;
mod util;

use axum::body::Body;
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post, put};
use axum::Router;
use handlers::AppState;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

fn public_dir() -> PathBuf {
    std::env::var("PUBLIC_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("public"))
}

/// Phục vụ file tĩnh trong public/.
/// - index.html (và mọi file .html) KHÔNG được cache: nó là DOM duy nhất của
///   shop. Trình duyệt giữ HTML cũ qua một lần deploy sẽ kẹt header ở dạng cũ
///   dù file ?v= mới đã lên live (lỗi đã gặp với Node).
/// - Mọi đường dẫn không phải file thật đều trả về index.html (SPA fallback),
///   cũng no-store.
async fn serve_static(uri: Uri) -> Response {
    let raw = uri.path().trim_start_matches('/');
    let base = public_dir();
    let mut target = base.clone();
    let mut is_file = false;
    if !raw.is_empty() && !raw.split('/').any(|c| c == ".." || c == ".") {
        let candidate = base.join(raw);
        if candidate.is_file() {
            target = candidate;
            is_file = true;
        }
    }
    if !is_file {
        target = base.join("index.html");
    }
    let body = match tokio::fs::read(&target).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::NOT_FOUND,
                "Không tìm thấy trang".to_string(),
            )
                .into_response();
        }
    };
    let mime = mime_guess::from_path(&target).first_or_octet_stream();
    let mut resp = Response::new(Body::from(body));
    resp.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        mime.to_string().parse().unwrap(),
    );
    if target.extension().map(|e| e == "html").unwrap_or(false) || !is_file {
        resp.headers_mut().insert(
            axum::http::header::CACHE_CONTROL,
            "no-store, no-cache, must-revalidate".parse().unwrap(),
        );
    }
    resp
}

#[tokio::main]
async fn main() {
    let state = Arc::new(AppState { db: db::open() });
    let app = Router::new()
        .route("/api/register", post(handlers::register))
        .route("/api/login", post(handlers::login))
        .route("/api/logout", post(handlers::logout))
        .route("/api/me", get(handlers::me))
        .route("/api/me/rename", post(handlers::rename))
        .route("/api/products", get(handlers::products))
        .route("/api/stats", get(handlers::stats))
        .route("/api/orders", post(handlers::create_order))
        .route("/api/orders/mine", get(handlers::orders_mine))
        .route("/api/orders/lookup", post(handlers::orders_lookup))
        .route("/api/notifications", get(handlers::notifications))
        .route("/api/activity", get(handlers::activity))
        .route("/api/wallet", get(handlers::wallet))
        .route("/api/receiving-info", get(handlers::receiving_info))
        .route("/api/deposits", post(handlers::create_deposit))
        .route("/api/deposits/:code", get(handlers::get_deposit))
        .route("/api/deposits/:code/check-api", post(handlers::check_api))
        .route("/api/api-status", get(handlers::api_status))
        .route("/api/leaderboard", get(handlers::leaderboard))
        .route("/api/leaderboard/mine", get(handlers::leaderboard_mine))
        .route("/api/bot", post(handlers::bot))
        .route("/api/admin/overview", get(handlers::admin_overview))
        .route("/api/admin/products", get(handlers::admin_products))
        .route("/api/admin/products", post(handlers::admin_create_product))
        .route(
            "/api/admin/products/:id",
            put(handlers::admin_update_product),
        )
        .route(
            "/api/admin/products/:id",
            delete(handlers::admin_delete_product),
        )
        .route("/api/admin/orders", get(handlers::admin_orders))
        .route(
            "/api/admin/orders/:code/status",
            put(handlers::admin_order_status),
        )
        .route("/api/admin/deposits", get(handlers::admin_deposits))
        .route(
            "/api/admin/deposits/:code/confirm",
            post(handlers::admin_confirm_deposit),
        )
        .route("/api/admin/settings", get(handlers::admin_settings))
        .route("/api/admin/settings", post(handlers::admin_save_settings))
        .fallback_service(get(serve_static))
        .with_state(state);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("Chợ Tài Nguyên Mmo (Rust) chạy tại http://{}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

#[cfg(test)]
mod tests {
    /// Scrypt phải cho cùng kết quả với Node crypto.scryptSync(password, salt, 64)
    /// khi salt là chuỗi hex (byte UTF-8 của chuỗi) — nếu test này rớt thì tài
    /// khoản cũ sẽ không đăng nhập được nữa.
    #[test]
    fn scrypt_matches_node() {
        assert_eq!(
            crate::util::hash_password(
                "testpass",
                "0123456789abcdef0123456789abcdef"
            ),
            "560e90a4655d114209ffea5b410b7771c60036d7d0031c435903e7ac9216961a52d9370c206e9603855d6532b2241dab559222ce8a08c5d2c801897f44fe8ce2"
        );
        assert_eq!(
            crate::util::hash_password("", "0123456789abcdef0123456789abcdef"),
            "621cc87405655073d9133e27c77e7fb47d2562f3724772bc2475652494d3ae16db60f1dd7f703cca213ae0af976b056b40864b47414899171e552cbdb887e5ce"
        );
    }

    #[test]
    fn money_and_mask() {
        assert_eq!(crate::util::fmt_money(450000), "450.000đ");
        assert_eq!(crate::util::fmt_money(-35000), "-35.000đ");
        assert_eq!(crate::util::mask_name("Minh"), "Mi***");
        assert_eq!(crate::util::mask_name("Mi"), "M***"); // Node: tên <= 2 ký tự -> s[0] + '***'
        assert_eq!(crate::util::new_code("DH").len(), 10);
    }
}
