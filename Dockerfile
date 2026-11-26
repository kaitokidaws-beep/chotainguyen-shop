# syntax = docker/dockerfile:1

# Chợ Tài Nguyên Mmo — backend Rust.
# Two stages: compile with the Rust image, then ship only the binary
# plus the static frontend in a slim Debian image.

# --- Builder ---
FROM rust:1.100-slim-bookworm AS builder
WORKDIR /app
# The bundled SQLite build needs a C compiler.
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential pkg-config && \
    rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

# --- Runtime ---
FROM debian:bookworm-slim
WORKDIR /app
# ca-certificates: the top-up check calls SePay / Casso over HTTPS.
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y ca-certificates && \
    rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/shop /app/shop
COPY public ./public

ENV PORT=8080
EXPOSE 8080
CMD ["/app/shop"]
