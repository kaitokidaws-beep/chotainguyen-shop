//! Kiểm tra giao dịch qua API ngân hàng (SePay / Casso) — chỉ cộng tiền khi
//! khớp thật: đúng số tiền + nội dung chứa mã NAP… + giao dịch chưa dùng.
//! SePay: GET https://my.sepay.vn/userapi/transactions/list
//! Casso:  GET https://oauth.casso.vn/v2/transactions

#[derive(Debug, Clone)]
pub struct BankTx {
    pub id: String,
    pub amount: i64,
    pub content: String,
}

pub struct BankResult {
    pub connected: bool,
    pub transactions: Vec<BankTx>,
    pub error: Option<String>,
}

fn str_field(v: &serde_json::Value, keys: &[&str]) -> String {
    for k in keys {
        if let Some(s) = v.get(*k) {
            if let Some(s) = s.as_str() {
                if !s.is_empty() {
                    return s.to_string();
                }
            }
            if let Some(n) = s.as_i64() {
                return n.to_string();
            }
        }
    }
    String::new()
}

fn num_field(v: &serde_json::Value, keys: &[&str]) -> i64 {
    for k in keys {
        if let Some(n) = v.get(*k) {
            if let Some(n) = n.as_i64() {
                return n;
            }
            if let Some(f) = n.as_f64() {
                return f as i64;
            }
        }
    }
    0
}

pub async fn fetch_bank_transactions(gateway: &str, key: &str) -> BankResult {
    if gateway.is_empty() || key.is_empty() {
        return BankResult {
            connected: false,
            transactions: vec![],
            error: None,
        };
    }
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return BankResult {
                connected: false,
                transactions: vec![],
                error: Some(e.to_string()),
            }
        }
    };
    if gateway == "sepay" {
        let r = client
            .get("https://my.sepay.vn/userapi/transactions/list?limit=100")
            .header("Authorization", format!("Bearer {}", key))
            .send()
            .await;
        let r = match r {
            Ok(r) => r,
            Err(e) => {
                return BankResult {
                    connected: false,
                    transactions: vec![],
                    error: Some(e.to_string()),
                }
            }
        };
        if !r.status().is_success() {
            return BankResult {
                connected: false,
                transactions: vec![],
                error: Some(format!("SePay trả lỗi HTTP {}", r.status())),
            };
        }
        let j: serde_json::Value = r.json().await.unwrap_or(serde_json::Value::Null);
        let list = j
            .get("transactions")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let txs = list
            .iter()
            .map(|t| BankTx {
                id: str_field(t, &["id", "reference_number"]),
                amount: num_field(t, &["amount_in", "amount"]),
                content: str_field(t, &["transaction_content", "content"]),
            })
            .collect();
        return BankResult {
            connected: true,
            transactions: txs,
            error: None,
        };
    }
    if gateway == "casso" {
        let r = client
            .get("https://oauth.casso.vn/v2/transactions?limit=100")
            .header("Authorization", format!("Apikey {}", key))
            .send()
            .await;
        let r = match r {
            Ok(r) => r,
            Err(e) => {
                return BankResult {
                    connected: false,
                    transactions: vec![],
                    error: Some(e.to_string()),
                }
            }
        };
        if !r.status().is_success() {
            return BankResult {
                connected: false,
                transactions: vec![],
                error: Some(format!("Casso trả lỗi HTTP {}", r.status())),
            };
        }
        let j: serde_json::Value = r.json().await.unwrap_or(serde_json::Value::Null);
        let list = j
            .get("data")
            .and_then(|d| d.get("records"))
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let txs = list
            .iter()
            .map(|t| BankTx {
                id: str_field(t, &["id", "tid"]),
                amount: num_field(t, &["amount"]),
                content: str_field(t, &["description"]),
            })
            .collect();
        return BankResult {
            connected: true,
            transactions: txs,
            error: None,
        };
    }
    BankResult {
        connected: false,
        transactions: vec![],
        error: None,
    }
}
