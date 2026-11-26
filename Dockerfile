# syntax = docker/dockerfile:1

# Chợ Tài Nguyên Mmo — server Rust (Axum + SQLite).
# Build 2 giai đoạn: biên dịch bằng Rust rồi chạy bằng image Debian mỏng
# chỉ chứa binary + file tĩnh public/. Nghe trên $PORT (mặc định 8080).

# --- Builder ---
FROM rust:1.100-slim-bookworm AS builder
WORKDIR /app
# rusqlite (bundled) biên dịch SQLite từ source nên cần trình biên dịch C.
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential pkg-config && \
    rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

# --- Runtime ---
FROM debian:bookworm-slim
LABEL fly_launch_runtime="Rust"
WORKDIR /app
# ca-certificates: reqwest gọi API SePay/Casso qua HTTPS.
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y ca-certificates && \
    rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/shop /app/shop
COPY public ./public

ENV PORT="8080"
EXPOSE 8080
CMD ["/app/shop"]
