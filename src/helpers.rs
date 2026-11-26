//! Small shared helpers: Vietnamese money formatting, name masking,
//! scrypt password hashing, random codes/tokens, and time utilities.
//!
//! The password hash must stay byte-compatible with accounts created
//! earlier: scrypt with N=16384 (log_n 14), r=8, p=1, 64-byte output,
//! the salt used as its UTF-8 bytes, hex-encoded result.

use axum::http::StatusCode;
use axum::response::Json;
use rand::Rng;
use scrypt::{Params, scrypt};
use serde_json::{Value, json};
use std::time::{SystemTime, UNIX_EPOCH};

/// Outcome type shared by every JSON handler in this service.
pub type HandlerResult = Result<Json<Value>, (StatusCode, Json<Value>)>;

/// Build an `{"error": msg}` failure with the given status.
pub fn fail(status: StatusCode, msg: &str) -> (StatusCode, Json<Value>) {
    (status, Json(json!({ "error": msg })))
}

/// Shorthand for a 400 failure.
pub fn bad(msg: &str) -> (StatusCode, Json<Value>) {
    fail(StatusCode::BAD_REQUEST, msg)
}

/// Current wall-clock time in milliseconds since the Unix epoch.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// A session lives for 30 days, measured in milliseconds.
pub const SESSION_TTL_MS: i64 = 30 * 24 * 3600 * 1000;

/// Format an amount the Vietnamese way: `450000` -> `"450.000đ"`.
/// Negative amounts keep their minus sign in front.
pub fn fmt_money(amount: i64) -> String {
    let digits = amount.unsigned_abs().to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, ch) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            grouped.push('.');
        }
        grouped.push(ch);
    }
    if amount < 0 {
        format!("-{}đ", grouped)
    } else {
        format!("{}đ", grouped)
    }
}

/// Hide most of a display name: `"Minh"` -> `"Mi***"`.
/// Names of two characters or fewer keep only the first character,
/// and an empty name becomes just `"***"`.
pub fn mask_name(name: &str) -> String {
    let chars: Vec<char> = name.trim().chars().collect();
    match chars.len() {
        0 => "***".to_string(),
        1 | 2 => format!("{}***", chars[0]),
        _ => format!("{}{}***", chars[0], chars[1]),
    }
}

/// Hash a password with scrypt (N=16384, r=8, p=1, 64 output bytes)
/// and return the result hex-encoded. The salt is fed in as UTF-8 bytes.
pub fn hash_password(password: &str, salt: &str) -> String {
    let params = Params::new(14, 8, 1, 64).expect("scrypt parameters are valid");
    let mut digest = [0u8; 64];
    scrypt(password.as_bytes(), salt.as_bytes(), &params, &mut digest)
        .expect("scrypt hashing cannot fail with fixed parameters");
    hex::encode(digest)
}

/// `n` random bytes, hex-encoded (so 16 bytes -> 32 hex characters).
fn random_hex(n: usize) -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..n).map(|_| rng.gen()).collect();
    hex::encode(bytes)
}

/// A fresh per-account salt: 16 random bytes as 32 hex characters.
pub fn fresh_salt() -> String {
    random_hex(16)
}

/// A fresh session token: 32 random bytes as 64 hex characters.
pub fn fresh_token() -> String {
    random_hex(32)
}

/// An order / top-up code: a prefix plus 8 uppercase hex characters,
/// for example `DH3F9A1C02` or `NAP77B0E4A1`.
pub fn fresh_code(prefix: &str) -> String {
    format!("{}{}", prefix, random_hex(4).to_uppercase())
}

/// JavaScript-style truthiness for a JSON value, used when an admin
/// toggles a product's `active` flag: null is false, booleans keep
/// their value, numbers are false only for zero, and strings are
/// false only when empty.
pub fn js_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// Days from 1970-01-01 to the given civil date (Howard Hinnant's
/// days-from-civil algorithm, written out directly).
pub fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let month_prime = (month + 9) % 12;
    let day_of_year = (153 * month_prime + 2) / 5 + day - 1;
    let day_of_era = yoe * 365 + yoe / 4 - yoe / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// Parse an ISO-8601 UTC timestamp such as
/// `"2026-11-25T11:24:41.542Z"` into epoch milliseconds.
/// Returns 0 when the text does not match the expected shape.
pub fn iso_to_ms(iso: &str) -> i64 {
    let date = iso.get(..10).unwrap_or("");
    let time = iso.get(11..23).unwrap_or("");
    let d: Vec<i64> = date
        .split('-')
        .filter_map(|part| part.parse().ok())
        .collect();
    let t: Vec<i64> = time
        .split(|c| c == ':' || c == '.')
        .filter_map(|part| part.parse().ok())
        .collect();
    if d.len() < 3 || t.len() < 3 {
        return 0;
    }
    let millis = if t.len() > 3 { t[3] } else { 0 };
    days_from_civil(d[0], d[1], d[2]) * 86_400_000
        + t[0] * 3_600_000
        + t[1] * 60_000
        + t[2] * 1000
        + millis
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrypt_vectors_stay_compatible() {
        assert_eq!(
            hash_password("testpass", "0123456789abcdef0123456789abcdef"),
            "560e90a4655d114209ffea5b410b7771c60036d7d0031c435903e7ac9216961a52d9370c206e9603855d6532b2241dab559222ce8a08c5d2c801897f44fe8ce2"
        );
        assert_eq!(
            hash_password("", "0123456789abcdef0123456789abcdef"),
            "621cc87405655073d9133e27c77e7fb47d2562f3724772bc2475652494d3ae16db60f1dd7f703cca213ae0af976b056b40864b47414899171e552cbdb887e5ce"
        );
    }

    #[test]
    fn money_formatting() {
        assert_eq!(fmt_money(450000), "450.000đ");
        assert_eq!(fmt_money(35000), "35.000đ");
        assert_eq!(fmt_money(0), "0đ");
        assert_eq!(fmt_money(-35000), "-35.000đ");
        assert_eq!(fmt_money(1234567), "1.234.567đ");
    }

    #[test]
    fn name_masking() {
        assert_eq!(mask_name("Minh"), "Mi***");
        assert_eq!(mask_name("Mi"), "M***");
        assert_eq!(mask_name("A"), "A***");
        assert_eq!(mask_name(""), "***");
        assert_eq!(mask_name("  "), "***");
    }

    #[test]
    fn generated_codes_have_the_right_shape() {
        let code = fresh_code("DH");
        assert_eq!(code.len(), 10);
        assert!(code.starts_with("DH"));
        assert!(code[2..].chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(fresh_salt().len(), 32);
        assert_eq!(fresh_token().len(), 64);
    }

    #[test]
    fn iso_timestamps_match_known_values() {
        assert_eq!(iso_to_ms("2026-11-25T11:24:41.542Z"), 1_795_605_881_542);
        assert_eq!(iso_to_ms("2026-11-25T11:37:51.077Z"), 1_795_606_671_077);
        assert_eq!(iso_to_ms("2026-11-25T12:37:04.927Z"), 1_795_610_224_927);
        assert_eq!(iso_to_ms("2026-11-25T12:37:28.786Z"), 1_795_610_248_786);
        assert_eq!(iso_to_ms("1970-01-01T00:00:00.000Z"), 0);
    }
}
