# Chợ Tài Nguyên Mmo — Source code FULL

Shop bán tài khoản mạng xã hội, bản full: đăng ký / đăng nhập, giỏ hàng, đặt hàng,
ví nạp tiền (VietQR + API SePay/Casso), BXH nạp, bot hỗ trợ 24/7, quản lý shop.
Chạy độc lập bằng Node.js + SQLite, không cần dịch vụ trả phí nào.

## 1. Chạy trên máy của bạn (thử trước)

Yêu cầu: Node.js 22 trở lên.

```bash
cd shop-cho-tai-nguyen-mmo-full-source
npm install
npm start
```

Mở trình duyệt: **http://localhost:3000**

- Lần chạy đầu, file `shop.db` được tạo tự động, kèm **12 sản phẩm mẫu**.
- **Tài khoản đầu tiên bạn đăng ký sẽ là chủ shop** (vào được Quản lý shop).
  Đăng ký xong là vào shop luôn, không cần tạo tài khoản admin riêng.
- Dữ liệu (tài khoản, đơn, ví, nạp tiền) lưu hết trong file `shop.db`.
  Muốn làm mới shop: tắt server, xóa file `shop.db`, chạy lại.

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
Muốn full thì bắt buộc phải có hosting chạy được Node.js.

### Cách miễn phí / rẻ: Railway, Render, VPS
1. Đẩy code lên GitHub (repo riêng).
2. Tạo app mới trên **Railway** (railway.app) hoặc **Render** (render.com),
   chọn repo này. Lệnh chạy: `npm start`. Port: lấy từ biến môi trường `PORT`
   (code đã tự đọc `process.env.PORT`).
3. Lưu ý: file `shop.db` nằm trên đĩa của hosting. Trên gói miễn phí, dữ liệu
   có thể mất khi hosting khởi động lại / deploy lại. Muốn dữ liệu bền:
   gắn thêm **Volume** (Railway) hoặc **Persistent Disk** (Render) vào thư mục
   chứa `shop.db`, hoặc đổi sang Postgres (cần sửa `server/db.js`).

### Cách truyền thống: VPS (DigitalOcean / Vultr / Hetzner…)
```bash
# trên VPS (Ubuntu)
sudo apt update && sudo apt install -y nodejs npm
git clone <repo-cua-ban> shop && cd shop
npm install
npm start
# Chạy nền bằng PM2: npm i -g pm2 && pm2 start server/index.js --name shop && pm2 save
```
Trỏ tên miền về VPS bằng bản ghi A → IP của VPS, rồi cài HTTPS miễn phí
bằng Caddy hoặc Nginx + Certbot.

### Gắn tên miền
- Mua / dùng tên miền sẵn có (ví dụ `chotainguyen.work.gd`).
- Vào chỗ quản lý DNS của tên miền, thêm bản ghi **A** trỏ về IP hosting,
  hoặc **CNAME** trỏ về tên host mà hosting cấp (ví dụ `xxx.up.railway.app`).
- Đợi DNS lan truyền (thường 5 phút – vài giờ), bật HTTPS trên hosting.

## 4. Cấu trúc code

```
package.json            Lệnh chạy, chỉ dùng 1 thư viện: express
server/
  index.js              Toàn bộ API: auth, sản phẩm, đơn, ví, nạp tiền, API SePay/Casso, bot, quản lý shop
  db.js                 SQLite: tạo bảng + seed 12 sản phẩm mẫu
public/
  index.html            Giao diện: cổng đăng ký, shop, footer, bottom nav 4 mục
  style.css             Hệ màu: nền xanh đen lục bảo, pine, vàng cát, jade, azure
  app.js                Gọi API, giỏ hàng, VietQR, bot, quản lý shop
shop.db                 File dữ liệu (tự tạo khi chạy, không có trong zip)
```

## 5. Ghi chú quan trọng

- Đăng nhập Google: nút Google chỉ hiển thị, shop **chưa bật** đăng nhập Google
  thật (cần đăng ký Google OAuth Client ID riêng). Bấm vào sẽ báo rõ như vậy,
  không giả vờ đăng nhập.
- Mật khẩu lưu dạng scrypt hash + salt, không lưu mật khẩu gốc.
- Phiên đăng nhập 30 ngày.
- Đơn hàng tra cứu công khai cần cả **mã đơn + thông tin liên hệ** lúc đặt hàng.
- Không có số điện thoại / email / Zalo / Telegram mặc định của shop trong code
  — bạn tự thêm vào phần Liên hệ nếu muốn.
