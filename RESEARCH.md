# Nghiên cứu shop thật — 26/11/2026
Mục đích: tìm ra cấu trúc đúng của một shop bán tài khoản, để xây lại frontend
theo đúng kiểu shop thật đang làm — thay vì vá tiếp khung cũ (header → banner →
rail Bán chạy → lưới thẻ) đã bị user chê 3 lần (v49 xấu, v50 3D quá, v51 banner
sai chỗ).

Đã mở và đọc trực tiếp 8 shop/danh sách. Kết luận chung ở cuối.

## 1. MCV Network (barrierimports.com — shop Việt, 996 sản phẩm)
- Màn hình đầu: KHÔNG có hero, KHÔNG banner, KHÔNG nút mua nổi bật riêng.
  Mở lên là số lượng "Hiển thị 996 sản phẩm" + nút "Chỉ hiện còn hàng".
- Catalog = CÁC MỤC THEO DANH MỤC, mỗi mục một tiêu đề + mô tả + số lượng
  ("## Facebook Via — Via Việt, Via Ngoại, Via kháng 902… — 335 sản phẩm"),
  bên dưới là DANH SÁCH DẠNG DÒNG (row), mỗi sản phẩm 1 dòng, không có ảnh,
  không có thẻ card lưới.
- Một dòng sản phẩm gồm: nhãn nền tảng nhỏ ("Gmail · Tài khoản cấp sẵn"),
  TÊN ĐẦY ĐỦ THÔNG SỐ (in đậm), GIÁ in đậm ("38.000₫"), dòng tồn kho
  ("Còn 15" / "Tạm hết hàng"), "Đã bán 5.751".
- Không thấy ô tìm kiếm trong bản crawl; điều hướng bằng danh mục.
- Tin cậy = con số: "Đã bán 5.751", "Còn 1.750", tồn kho thật từng dòng.
- Điểm nổi bật: KHÔNG có phần tử nổi bật riêng. Sản phẩm hot lộ ra bằng
  số "Đã bán" lớn và vị trí đầu danh sách của mục.

## 2. mmonhalam.net — "MMO Nhà Làm" (VIA, ~1934 sản phẩm/mục)
- Trang danh mục "Tài khoản VIA": tiêu đề + 1 dòng mô tả + "Hiển thị 20 /
  1934 sản phẩm" (phân trang 20/trang).
- Catalog = DANH SÁCH DẠNG DÒNG, 1 sản phẩm 1 dòng, không ảnh, không card:
  nhãn nhóm ("VIA Facebook Mỹ (US)"), "Còn **242**" in đậm, TÊN ĐẦY THÔNG SỐ,
  "Bảo hành 24h đăng nhập lần đầu", "Đơn giá 64.000 ₫", nút "Mua ngay".
- Lọc bằng danh mục con (via-viet-co, via-ngoai-global, clone-gia-re) và
  quốc gia (?country=us). Không banner, không rail, không "Bán chạy".
- Tin cậy = "Bảo hành 24h" ghi ngay trên từng dòng + số tồn kho thật.
- Điểm nổi bật: KHÔNG có banner. Món hot = dòng đầu tiên trong mục, và
  "Mua ngay" là nút duy nhất trên mỗi dòng (không có giỏ hàng).

## 3. khommo247.com — "Kho MMO 247" (marketplace đa người bán)
- Cấu trúc: MARKETPLACE, không phải shop 1 chủ. Danh mục chính: Tài khoản số
  (Discord, Gmail, Telegram, X, TikTok), Công cụ MMO, Website & source code,
  Dịch vụ MMO, Thuê dev.
- Bán tự động 24/7, giao ngay khi thanh toán xong; ký quỹ (escrow) + rút tiền
  tự động về ngân hàng; phí bán 0%.
- Đăng nhập để "truy cập lịch sử đơn, thanh toán nhanh, nhận hàng tự động".
  Đăng ký 4 bước: nhập thông tin → OTP email → nhập mã → bắt đầu giao dịch.
- Trang "Shop Premium" (khommo247.top): giá gạch ngang + badge -47%/-57%/-84%
  NGAY TRÊN DÒNG SẢN PHẨM; quy trình 4 bước "Chọn gói → Nhập Gmail → Thanh
  toán QR → Hoàn thành 3-20 phút"; "Tra cứu đơn bằng mã đơn hoặc Gmail";
  mục "Khách cũ nói gì" (đánh giá).
- Điểm nổi bật: giảm giá nằm TRÊN DÒNG SẢN PHẨM, không có banner riêng.

## 4. taphoammo.biz — "Tạp hoá MMO" (chuyển từ taphoammo.net, 11/2025)
- Quy trình mua chỉ 3 bước: 1. Chọn sản phẩm → 2. Thanh toán qua ví/ngân
  hàng → 3. Nhận tài khoản trong vài giây, tự động 100%, không chờ duyệt.
- Thanh toán tự động qua ngân hàng, MoMo, thẻ nội địa. Có affiliate.
- Danh mục: VIA Facebook, Zalo, Telegram, Gmail, Hotmail, TikTok Ads,
  Proxy, tool marketing.
- Điểm nổi bật: tốc độ + tự động là điểm bán hàng, không phải banner.

## 5. buysellacc.com — marketplace ví-đầu-tiên
- Nạp ví TRƯỚC rồi mới mua; catalog tự phục vụ hàng chục danh mục
  (Facebook, Instagram, Threads, TikTok, Zalo, X, Telegram, WhatsApp,
  Google Ads, Microsoft, email, Shopee/Lazada, WeChat…).
- Hàng có sẵn giao tự động ngay khi ví trừ tiền; hết hàng thì nhắn
  Messenger/Zalo/Telegram thủ công. Giảm 7% tự động sau đăng ký 12–24h.
  Có API + panel reseller/white-label, xuất hoá đơn VAT.
- Điểm nổi bật: ví + tự động giao hàng, không banner.

## 6. HOTLIKESHOP top 10 web bán nguyên liệu ads (bảng 23/11/2026)
- 7 tiêu chí chấm trang chủ: (1) ghi rõ giao/xử lý tự động, (2) công khai
  chính sách, (3) có công cụ miễn phí (2FA, check live UID), (4) có tài
  liệu API, (5) nạp ngân hàng + crypto, (6) bán ngoài Facebook
  (TikTok/Instagram/mail), (7) affiliate/đa ngôn ngữ.
- Top: hotlikeshop.com, muaviavn.com, shopbanvia.com, shopviavn.com,
  viaclone.vn, muavia.net, tkfb.store, via24h.vn, viatrau.vn, via2fa.vn.
- Mẫu chung: menu danh mục sâu (via Việt cổ, via ngoại, 902, XMDT, clone,
  BM, fanpage, TKQC) + công cụ 2FA/check live UID ngay trang chủ. tkfb.store
  có danh mục ngoài Facebook rộng nhất (TikTok, Telegram, X, Discord, AI).

## 7. TGX Account (tgxaccount.com) — marketplace quốc tế
- Danh mục chuẩn hoá + đặt hàng online + lịch sử đơn + giao tự động +
  hậu mãi, tất cả trong 1 nền tảng. Số liệu tin cậy: "2+ năm, 20.000+
  khách, 1.000+ đánh giá, 24H tự phục vụ".
- Điểm nổi bật: con số tin cậy + danh mục chuẩn, không banner.

## 8. AccountProvide — storefront cao cấp quốc tế
- Hero chỉ là 1 dòng chữ ("Launch faster with verified accounts…") + 4
  điểm bán (giá rõ, giao nhanh, đủ danh mục, hỗ trợ 1-1) + số liệu
  ("60+ nền tảng, Fresh + Aged").
- Catalog = Ô DANH MỤC (Social Media, Email, Custom Packages) với giá
  "từ $X/tài khoản" và gói bulk 100/200/500/1000. Quy trình 3 bước:
  Chọn gói → … → nhận hàng.
- Điểm nổi bật: ô danh mục + giá bulk, không banner deal.

## KẾT LUẬN — 6 điểm chung của shop thật (áp cho bản xây lại)
1. KHÔNG shop thật nào mở đầu bằng banner deal to. Mở lên là tìm kiếm /
   danh mục rồi THẤY HÀNG NGAY. Banner deal to ở đầu trang là kiểu của
   sàn TMĐT, không phải kiểu shop tài khoản — đó là lý do v51 bị chê sai chỗ.
2. Catalog chuẩn = DANH SÁCH DẠNG DÒNG, nhóm theo DANH MỤC (mục có tiêu đề
   + số lượng + mô tả ngắn), mỗi dòng: nhãn nền tảng, tên đầy thông số,
   giá đậm, "Còn N" / "Tạm hết hàng", "Đã bán N", nút "Mua ngay".
   Không lưới thẻ ảnh, không rail cuộn ngang "Bán chạy"/"Mới về".
3. Nút chính trên mỗi dòng là "MUA NGAY" (mmonhalam, MCV) — bấm là vào
   thẳng thanh toán, không qua giỏ. Giỏ chỉ là phụ (buysellacc thì ví
   là chính). Đăng nhập chỉ xuất hiện lúc thanh toán.
4. Điểm nổi bật KHÔNG BAO GIỜ là một khối riêng trên đầu trang. Nó nằm
   TRÊN DÒNG SẢN PHẨM: badge -% + giá gạch ngang ngay trong dòng
   (khommo247.top), hoặc dòng đầu tiên của mục (MCV/mmonhalam), hoặc số
   "Đã bán" lớn nhất. Món giảm mạnh nhất = dòng đầu tiên của mục đầu tiên.
5. Tin cậy = CON SỐ, không phải khẩu hiệu: "Đã bán 5.751", "Còn 1.750",
   "Bảo hành 24h đăng nhập lần đầu" trên từng dòng, số liệu shop
   (20.000+ khách, 1.000+ đánh giá), tra cứu đơn công khai bằng mã đơn.
6. Trang chủ luôn có: hướng dẫn mua 3–4 bước ngắn, tra cứu đơn, FAQ,
   đánh giá khách cũ — đặt ở CUỐI trang, sau hàng hoá, không chiếm màn
   hình đầu.
