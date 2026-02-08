# =========================
# 1️⃣ Build sshx-server (Cargo)
# =========================
FROM rust:1.75-alpine AS rust-builder

RUN apk add --no-cache musl-dev openssl-dev pkgconfig

WORKDIR /build

COPY sshx/crates/sshx-server ./sshx-server
WORKDIR /build/sshx-server

RUN cargo build --release


# =========================
# 2️⃣ Runtime Node
# =========================
FROM node:20-alpine

RUN apk add --no-cache ca-certificates

WORKDIR /app

# Copy binary đã build
COPY --from=rust-builder \
  /build/sshx-server/target/release/sshx-server \
  /app/sshx-server

RUN chmod +x /app/sshx-server

# Copy toàn bộ project sshx (frontend)
COPY sshx ./sshx

# Cài npm trong thư mục sshx
WORKDIR /app/sshx
RUN npm install

# Giữ nguyên như file cũ
EXPOSE 5173 8080

# =========================
# 3️⃣ Chạy đúng như yêu cầu
# =========================
CMD sh -c "\
  /app/sshx-server \
    --override-origin $OVERRIDE_ORIGIN \
    --secret $SSHX_SECRET & \
  cd /app/sshx && npm run dev \
"
