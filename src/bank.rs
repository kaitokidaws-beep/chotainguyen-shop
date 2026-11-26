//! Looking up real bank transfers through SePay or Casso so a
//! top-up is only credited when a matching transfer truly exists:
//! the right amount, the NAP code in the transfer note, and a
//! transaction id that has not already been used for another top-up.

/// One bank transaction, reduced to the three fields matching needs.
#[derive(Debug, Clone)]
pub struct BankTx {
    pub id: String,
    pub amount: i64,
    pub content: String,
}

/// What a fetch attempt produced.
pub struct BankFetch {
    /// True only when the gateway answered successfully.
    pub connected: bool,
    pub transactions: Vec<BankTx>,
    /// Human-readable failure, when there is one.
    pub error: Option<String>,
}

fn text_field(tx: &serde_json::Value, keys: &[&str]) -> String {
    for key in keys {
        if let Some(found) = tx.get(*key) {
            if let Some(s) = found.as_str() {
                if !s.is_empty() {
                    return s.to_string();
                }
            }
            if let Some(n) = found.as_i64() {
                return n.to_string();
            }
        }
    }
    String::new()
}

fn amount_field(tx: &serde_json::Value, keys: &[&str]) -> i64 {
    for key in keys {
        if let Some(found) = tx.get(*key) {
            if let Some(n) = found.as_i64() {
                return n;
            }
            if let Some(f) = found.as_f64() {
                return f as i64;
            }
        }
    }
    0
}

fn disconnected(error: Option<String>) -> BankFetch {
    BankFetch {
        connected: false,
        transactions: Vec::new(),
        error,
    }
}

/// Fetch the latest 100 transactions from the configured gateway.
/// With no gateway or key configured this reports "not connected"
/// without making any request.
pub async fn fetch_transactions(gateway: &str, key: &str) -> BankFetch {
    if gateway.is_empty() || key.is_empty() {
        return disconnected(None);
    }
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
    {
        Ok(c) => c,
        Err(e) => return disconnected(Some(e.to_string())),
    };

    if gateway == "sepay" {
        let sent = client
            .get("https://my.sepay.vn/userapi/transactions/list?limit=100")
            .header("Authorization", format!("Bearer {}", key))
            .send()
            .await;
        let reply = match sent {
            Ok(r) => r,
            Err(e) => return disconnected(Some(e.to_string())),
        };
        if !reply.status().is_success() {
            return disconnected(Some(format!("SePay trả lỗi HTTP {}", reply.status())));
        }
        let body: serde_json::Value = reply.json().await.unwrap_or(serde_json::Value::Null);
        let list = body
            .get("transactions")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let txs = list
            .iter()
            .map(|t| BankTx {
                id: text_field(t, &["id", "reference_number"]),
                amount: amount_field(t, &["amount_in", "amount"]),
                content: text_field(t, &["transaction_content", "content"]),
            })
            .collect();
        return BankFetch {
            connected: true,
            transactions: txs,
            error: None,
        };
    }

    if gateway == "casso" {
        let sent = client
            .get("https://oauth.casso.vn/v2/transactions?limit=100")
            .header("Authorization", format!("Apikey {}", key))
            .send()
            .await;
        let reply = match sent {
            Ok(r) => r,
            Err(e) => return disconnected(Some(e.to_string())),
        };
        if !reply.status().is_success() {
            return disconnected(Some(format!("Casso trả lỗi HTTP {}", reply.status())));
        }
        let body: serde_json::Value = reply.json().await.unwrap_or(serde_json::Value::Null);
        let list = body
            .get("data")
            .and_then(|d| d.get("records"))
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let txs = list
            .iter()
            .map(|t| BankTx {
                id: text_field(t, &["id", "tid"]),
                amount: amount_field(t, &["amount"]),
                content: text_field(t, &["description"]),
            })
            .collect();
        return BankFetch {
            connected: true,
            transactions: txs,
            error: None,
        };
    }

    disconnected(None)
}
