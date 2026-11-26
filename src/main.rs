//! Chợ Tài Nguyên Mmo — shop bán tài khoản mạng xã hội.
//!
//! HTTP service built on Axum with a SQLite database. The JSON API
//! lives under `/api/*`; everything else is served from the static
//! `public/` directory, falling back to `index.html` for the
//! single-page shop frontend.
//!
//! Environment: `PORT` (default 8080), `DB_PATH` (default
//! `./shop.db`), `PUBLIC_DIR` (default `./public`).

mod admin;
mod auth;
mod bank;
mod helpers;
mod shop;
mod store;

use axum::body::Body;
use axum::http::{StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::Router;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

/// State shared by all handlers: the database store.
pub struct AppState {
    pub store: store::Store,
}

fn public_dir() -> PathBuf {
    std::env::var("PUBLIC_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./public"))
}

/// Serve the static shop frontend.
/// - A path that matches a real file is served with its guessed MIME type.
/// - Anything else falls back to `index.html`.
/// - HTML (and the fallback) is never cached by the browser.
async fn serve_frontend(uri: Uri) -> Response {
    let base = public_dir();
    let requested = uri.path().trim_start_matches('/');
    let mut target = base.join("index.html");
    let mut real_file = false;
    if !requested.is_empty()
        && !requested.split('/').any(|part| part == ".." || part == ".")
    {
        let candidate = base.join(requested);
        if candidate.is_file() {
            target = candidate;
            real_file = true;
        }
    }
    let bytes = match tokio::fs::read(&target).await {
        Ok(b) => b,
        Err(_) => {
            return (StatusCode::NOT_FOUND, "Không tìm thấy trang".to_string()).into_response();
        }
    };
    let mime = mime_guess::from_path(&target).first_or_octet_stream();
    let mut response = Response::new(Body::from(bytes));
    response.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        mime.to_string().parse().unwrap(),
    );
    let is_html = target.extension().map(|e| e == "html").unwrap_or(false);
    if is_html || !real_file {
        response.headers_mut().insert(
            axum::http::header::CACHE_CONTROL,
            "no-store, no-cache, must-revalidate".parse().unwrap(),
        );
    }
    response
}

fn build_app(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/register", post(shop::register))
        .route("/api/login", post(shop::login))
        .route("/api/logout", post(shop::logout))
        .route("/api/me", get(shop::me))
        .route("/api/me/rename", post(shop::rename))
        .route("/api/products", get(shop::products))
        .route("/api/stats", get(shop::stats))
        .route("/api/orders", post(shop::create_order))
        .route("/api/orders/mine", get(shop::orders_mine))
        .route("/api/orders/lookup", post(shop::orders_lookup))
        .route("/api/notifications", get(shop::notifications))
        .route("/api/activity", get(shop::activity))
        .route("/api/wallet", get(shop::wallet))
        .route("/api/receiving-info", get(shop::receiving_info))
        .route("/api/deposits", post(shop::create_deposit))
        .route("/api/deposits/:code", get(shop::get_deposit))
        .route("/api/deposits/:code/check-api", post(shop::check_api))
        .route("/api/api-status", get(shop::api_status))
        .route("/api/leaderboard", get(shop::leaderboard))
        .route("/api/leaderboard/mine", get(shop::leaderboard_mine))
        .route("/api/bot", post(shop::bot))
        .route("/api/admin/overview", get(admin::overview))
        .route(
            "/api/admin/products",
            get(admin::list_products).post(admin::create_product),
        )
        .route(
            "/api/admin/products/:id",
            put(admin::update_product).delete(admin::delete_product),
        )
        .route("/api/admin/orders", get(admin::list_orders))
        .route("/api/admin/orders/:code/status", put(admin::set_order_status))
        .route("/api/admin/deposits", get(admin::list_deposits))
        .route(
            "/api/admin/deposits/:code/confirm",
            post(admin::confirm_deposit),
        )
        .route(
            "/api/admin/settings",
            get(admin::get_settings).post(admin::save_settings),
        )
        .fallback_service(get(serve_frontend))
        .with_state(state)
}

#[tokio::main]
async fn main() {
    let state = Arc::new(AppState {
        store: store::open_store(),
    });
    let app = build_app(state);
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("Chợ Tài Nguyên Mmo chạy tại http://{}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
