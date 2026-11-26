# Chợ Tài Nguyên Mmo — Source code FULL

Shop bán tài khoản mạng xã hội, bản full: đăng ký / đăng nhập, giỏ hàng, đặt hàng,
ví nạp tiền (VietQR + API SePay/Casso), BXH nạp, bot hỗ trợ 24/7, quản lý shop.
Server viết bằng **Rust (Axum + SQLite)** — bản viết lại từ server Node/Express cũ,
cùng API, cùng giao diện, cùng dữ liệu. Mật khẩu cũ (scrypt) vẫn đăng nhập được.
Server Node cũ vẫn giữ trong thư mục `server-node/` để đối chiếu, không còn chạy nữa.

Giao diện mới "Aurora Premium": nền sáng với vệt cực quang tím–xanh dương–cyan,
thẻ trắng kính, nút gradient cực quang, hero gradient đậm, modal chi tiết dùng
`<dialog>` native, chuyển cảnh view transition khi mở sản phẩm, form có
autocomplete + kiểm tra `:user-invalid`, tôn trọng giảm chuyển động.

## 1. Chạy trên máy của bạn (thử trước)

Yêu cầu: Rust toolchain ổn định (rustc/cargo). Cài bằng rustup:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
source "$HOME/.cargo/env"
```

Chạy shop:

```bash
cd shop-cho-tai-nguyen-mmo-full-source
cargo run --release
```

Mở trình duyệt: **http://localhost:8080**

- Lần chạy đầu, file `shop.db` được tạo tự động, kèm **12 sản phẩm mẫu**.
- **Tài khoản đầu tiên bạn đăng ký sẽ là chủ shop** (vào được Quản lý shop).
  Đăng ký xong là vào shop luôn, không cần tạo tài khoản admin riêng.
- Dữ liệu (tài khoản, đơn, ví, nạp tiền) lưu hết trong file `shop.db`.
  Muốn làm mới shop: tắt server, xóa file `shop.db`, chạy lại.
- Đổi cổng: `PORT=3000 cargo run --release`. Đổi đường dẫn DB:
  `DB_PATH=/data/shop.db cargo run --release`.

## 2. Cài đặt để shop chạy thật (chủ shop làm 2 việc này)

### a) Thông tin nhận tiền & mã QR
Vào shop → **Quản lý shop → Thông tin nhận tiền & mã QR**, nhập:
ngân hàng + mã BIN, số tài khoản, chủ tài khoản, số MoMo / ZaloPay.
Chưa nhập thì khách vẫn tạo được yêu cầu nạp, nhưng không có QR / STK để chuyển.

### b) API nạp tiền qua QR (SePay / Casso)
Vào shop → **Quản lý shop → API nạp tiền qua QR**, chọn SePay hoặc Casso,
dán API key của tài khoản SePay/Casso đã liên kết với tài khoản ngân hàng nhận tiền.
Key chỉ lưu trên máy chủ, không bao giờ hiển thị lại.

Khi đã kết nối, khách bấm **"Kiểm tra giao dịch qua API"**: tiền chỉ cộng khi
hệ thống đọc được giao dịch thật khớp **đúng số tiền + đúng nội dung mã NAP…**,
mỗi giao dịch ngân hàng chỉ dùng cho 1 lần nạp.

> Chưa kết nối API thì nạp tiền qua QR **không tự cộng được** — yêu cầu nạp sẽ
> ở trạng thái "Chờ xác minh". Thẻ cào do chủ shop xác nhận thủ công trong
> Quản lý shop → Yêu cầu nạp đang chờ.
>
> SePay có gói FREE (0đ/tháng, 50 giao dịch đến/tháng). Casso tính phí theo
> giao dịch đối soát tự động. VietQR tạo mã thì miễn phí nhưng không tự
> kiểm tra tiền vào.

**Không bịa sẵn trong code:** shop không có sẵn số tài khoản, số ví hay API key
nào. Bạn phải nhập của chính bạn.

## 3. Đưa shop lên mạng (hosting)

### Vì sao Blogger KHÔNG chạy được bản full?
Blogger chỉ chứa được trang HTML tĩnh, không có máy chủ để lưu tài khoản,
đơn hàng, ví tiền. Up code này lên Blogger là mất hết chức năng.
Muốn full thì bắt buộc phải có hosting chạy được file thực thi (binary).

### Fly.io (đang dùng cho shop này)
Repo đã có sẵn `Dockerfile` (build Rust 2 giai đoạn) và `fly.toml`
(app `chotainguyen-shop`, vùng Singapore, cổng trong 8080).
Deploy từ GitHub qua dashboard Fly.io; mỗi lần push code mới lên `main`
thì bấm **Deploy** lại trên dashboard.

Muốn dữ liệu bền qua các lần deploy: tạo Volume 1GB (`fly volumes create
shop-data -a chotainguyen-shop --region sin --size 1`), thêm vào `fly.toml`:

```toml
[[mounts]]
  source = "shop-data"
  destination = "/data"
```

và chạy với biến môi trường `DB_PATH=/data/shop.db` (secret hoặc `[env]`).
Không mount đè lên thư mục chứa code.

### Cách khác: Railway, Render, VPS
1. Đẩy code lên GitHub (repo riêng).
2. Tạo app mới trên **Railway** (railway.app) hoặc **Render** (render.com),
   chọn repo này. Lệnh build: `cargo build --release`. Lệnh chạy:
   `./target/release/shop`. Port: lấy từ biến môi trường `PORT`
   (code Rust tự đọc `PORT`, mặc định 8080).
3. Lưu ý: file `shop.db` nằm trên đĩa của hosting. Trên gói miễn phí, dữ liệu
   có thể mất khi hosting khởi động lại / deploy lại. Muốn dữ liệu bền:
   gắn thêm **Volume** vào thư mục chứa `shop.db` và đặt `DB_PATH` trỏ vào đó,
   hoặc đổi sang Postgres (cần sửa `src/db.rs`).

### VPS (DigitalOcean / Vultr / Hetzner…)
```bash
# trên VPS (Ubuntu)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
source "$HOME/.cargo/env"
git clone <repo-cua-ban> shop && cd shop
cargo build --release
PORT=8080 ./target/release/shop
# Chạy nền bằng systemd: tạo unit file chạy /đường/dẫn/shop với WorkingDirectory là thư mục shop.
```
Trỏ tên miền về VPS bằng bản ghi A → IP của VPS, rồi cài HTTPS miễn phí
bằng Caddy hoặc Nginx + Certbot.

### Gắn tên miền
- Mua / dùng tên miền sẵn có (ví dụ `chotainguyen.work.gd`).
- Vào chỗ quản lý DNS của tên miền, thêm bản ghi **A** trỏ về IP hosting,
  hoặc **CNAME** trỏ về tên host mà hosting cấp (ví dụ `xxx.fly.dev`).
- Đợi DNS lan truyền (thường 5 phút – vài giờ), bật HTTPS trên hosting.

## 4. Cấu trúc code

```
Cargo.toml             Crate: axum, tokio, rusqlite (bundled), scrypt, reqwest (rustls), serde
Cargo.lock             Phiên bản crate đã khóa
Dockerfile             Build 2 giai đoạn: rust:1.100 → debian:bookworm-slim + binary shop + public/
fly.toml               Fly.io: app chotainguyen-shop, region sin, internal_port 8080
src/
  main.rs              Khởi động server, route /api/*, phục vụ file tĩnh public/
  db.rs                SQLite: tạo bảng + migrate + seed 12 sản phẩm mẫu + 4 đơn thật
  handlers.rs          Toàn bộ API: auth, sản phẩm, đơn, ví, nạp tiền, API SePay/Casso, bot, quản lý shop
  bank.rs              Đọc giao dịch SePay/Casso, khớp đúng số tiền + mã NAP…
  util.rs              Định dạng tiền, che tên, hash scrypt (tương thích Node), sinh mã DH…/NAP…
server-node/           Server Node/Express cũ — chỉ giữ lại để đối chiếu, không chạy nữa
public/
  index.html           Giao diện: cổng đăng ký, shop, footer, bottom nav 5 mục
  design-sang.css      "Chợ Sáng": xanh nước + trắng, serif tạp chí (mặc định)
  design-dem.css       "Chợ Đêm": mực tối + aurora (file gốc 4782c33 + lớp ADAPT)
  design-ruc.css       "Chợ Rực": gradient hoàng hôn cam–hồng–tím, thẻ chunky
  app.js               Gọi API, giỏ hàng, VietQR, bot, quản lý shop, dialog + view transition, chuyển 3 kiểu giao diện (localStorage ctn_design)
  logo.png             Logo thật của shop (ảnh user gửi)
  mascot.png           Linh vật cáo chín đuôi (ảnh user gửi) — chỉ hiện ở header PC
shop.db                File dữ liệu (tự tạo khi chạy, không có trong zip)
```

## 5. Ghi chú quan trọng

- Đăng nhập Google: nút Google chỉ hiển thị, shop **chưa bật** đăng nhập Google
  thật (cần đăng ký Google OAuth Client ID riêng). Bấm vào sẽ báo rõ như vậy,
  không giả vờ đăng nhập.
- Mật khẩu lưu dạng scrypt hash + salt, không lưu mật khẩu gốc. Hash Rust tạo ra
  giống hệt hash Node cũ tạo, nên tài khoản cũ đăng nhập bình thường.
- Phiên đăng nhập 30 ngày.
- Đơn hàng tra cứu công khai cần cả **mã đơn + thông tin liên hệ** lúc đặt hàng.
- Không có số điện thoại / email / Zalo / Telegram mặc định của shop trong code
  — bạn tự thêm vào phần Liên hệ nếu muốn.
