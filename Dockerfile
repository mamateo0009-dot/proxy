# =========================
# 1️⃣ Build sshx-server (Rust workspace)
# =========================
FROM rust:1.75-alpine AS rust-builder

RUN apk add --no-cache musl-dev openssl-dev pkgconfig

WORKDIR /build

# Copy workspace manifest trước (để cache tốt)
COPY sshx/Cargo.toml sshx/Cargo.lock ./

# Copy toàn bộ crates
COPY sshx/crates ./crates

# Build đúng crate trong workspace
RUN cargo build --release -p sshx-server


# =========================
# 2️⃣ Runtime Node
# =========================
FROM node:20-alpine

RUN apk add --no-cache ca-certificates

WORKDIR /app

# Copy binary đã build
COPY --from=rust-builder \
  /build/target/release/sshx-server \
  /app/sshx-server

RUN chmod +x /app/sshx-server

# Copy frontend
COPY sshx ./sshx

WORKDIR /app/sshx
RUN npm install

EXPOSE 5173 8080

# =========================
# 3️⃣ Run giống file cũ
# =========================
CMD sh -c "\
  /app/sshx-server \
    --override-origin $OVERRIDE_ORIGIN \
    --secret $SSHX_SECRET & \
  cd /app/sshx && npm run dev \
"
