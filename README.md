# Chợ Tài Nguyên Mmo — backend

Backend Rust (Axum + SQLite) cho shop bán tài khoản mạng xã hội
(Facebook, TikTok, Instagram, YouTube, Telegram, Gmail, X, Zalo).
Phục vụ JSON API dưới `/api/*` và giao diện tĩnh trong `public/`.

## Chạy local

```sh
cargo run
```

Mặc định nghe tại `http://127.0.0.1:8080` và dùng file `./shop.db`.
Lần chạy đầu tiên sẽ tự tạo bảng và nạp 12 sản phẩm mẫu cùng 4 đơn
đầu tiên. Tài khoản đăng ký đầu tiên trở thành chủ shop.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `PORT` | `8080` | Cổng HTTP lắng nghe (bind `0.0.0.0`) |
| `DB_PATH` | `./shop.db` | Đường dẫn file SQLite |
| `PUBLIC_DIR` | `./public` | Thư mục file tĩnh của shop |

Xem `.env.example` để có mẫu.

## API chính

- Tài khoản: `POST /api/register`, `POST /api/login`, `POST /api/logout`,
  `GET /api/me`, `POST /api/me/rename`
- Mua hàng: `GET /api/products`, `GET /api/stats`, `POST /api/orders`,
  `GET /api/orders/mine`, `POST /api/orders/lookup`, `GET /api/notifications`,
  `GET /api/activity`
- Ví / nạp tiền: `GET /api/wallet`, `GET /api/receiving-info`,
  `POST /api/deposits`, `GET /api/deposits/:code`,
  `POST /api/deposits/:code/check-api`, `GET /api/api-status`
- Khác: `GET /api/leaderboard`, `GET /api/leaderboard/mine`, `POST /api/bot`
- Chủ shop (`/api/admin/*`, cần tài khoản chủ): overview, products,
  orders, deposits, settings.

Nạp tiền qua API ngân hàng hỗ trợ SePay và Casso: chỉ cộng tiền khi
tìm thấy giao dịch đúng số tiền, nội dung chứa mã `NAP…`, và giao
dịch đó chưa được dùng cho lần nạp khác. Thẻ cào do chủ shop xác
nhận thủ công trong Quản lý shop.

## Kiểm tra

```sh
cargo test
```

## Triển khai

```sh
fly deploy
```

`fly.toml` đã gắn volume `shop_data` tại `/data` và trỏ `DB_PATH`
về `/data/shop.db` để tài khoản, đơn hàng và số dư không mất khi
máy dừng hoặc deploy lại.
