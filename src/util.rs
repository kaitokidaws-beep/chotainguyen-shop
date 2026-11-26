//! Tiện ích dùng chung: định dạng tiền VNĐ, che tên, băm mật khẩu scrypt
//! (tương thích Node crypto.scryptSync), mã DH…/NAP…, thời gian (ms).

use rand::Rng;
use scrypt::{Params, scrypt};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Định dạng tiền kiểu vi-VN: 1.234.567đ
pub fn fmt_money(n: i64) -> String {
    let neg = n < 0;
    let s = n.unsigned_abs().to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push('.');
        }
        out.push(c);
    }
    if neg {
        format!("-{}đ", out)
    } else {
        format!("{}đ", out)
    }
}

/// Che tên như Node: "Minh" -> "Mi***", tên <= 2 ký tự -> "M***".
pub fn mask_name(name: &str) -> String {
    let s = name.trim();
    let chars: Vec<char> = s.chars().collect();
    if chars.is_empty() {
        return "***".to_string();
    }
    if chars.len() <= 2 {
        return format!("{}***", chars[0]);
    }
    format!("{}{}***", chars[0], chars[1])
}

/// Băm mật khẩu bằng scrypt, tương thích y hệt Node:
/// crypto.scryptSync(password, salt, 64) với salt là CHUỖI hex (byte UTF-8 của
/// chuỗi đó), tham số mặc định N=16384, r=8, p=1, độ dài khóa 64 byte.
pub fn hash_password(password: &str, salt: &str) -> String {
    let params = Params::new(14, 8, 1, 64).expect("scrypt params");
    let mut out = [0u8; 64];
    scrypt(password.as_bytes(), salt.as_bytes(), &params, &mut out)
        .expect("scrypt");
    hex::encode(out)
}

pub fn random_hex_bytes(n: usize) -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..n).map(|_| rng.gen()).collect();
    hex::encode(bytes)
}

/// Mã đơn / mã nạp: tiền tố + 8 ký tự hex in hoa (như Node: randomBytes(4)).
pub fn new_code(prefix: &str) -> String {
    format!("{}{}", prefix, random_hex_bytes(4).to_uppercase())
}

/// Token phiên 64 ký tự hex (32 byte ngẫu nhiên).
pub fn new_token() -> String {
    random_hex_bytes(32)
}

/// 30 ngày tính bằng mili-giây.
pub const SESSION_TTL_MS: i64 = 30 * 24 * 3600 * 1000;

/// Tính "truthy" kiểu JS cho trường active của sản phẩm khi admin sửa.
pub fn js_truthy(v: &serde_json::Value) -> bool {
    match v {
        serde_json::Value::Null => false,
        serde_json::Value::Bool(b) => *b,
        serde_json::Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        serde_json::Value::String(s) => !s.is_empty(),
        _ => true,
    }
}
