FROM node:20-alpine

RUN apk add --no-cache ca-certificates

WORKDIR /app

# Copy toàn bộ project
COPY . .

# Cấp quyền cho sshx-server (ở ROOT)
RUN chmod +x /app/sshx-server

# Cài npm trong thư mục sshx
WORKDIR /app/sshx
RUN npm install

# Expose port
EXPOSE 5173 8080

# Chạy song song:
# - sshx-server ở ROOT
# - npm run dev trong /app/sshx
CMD sh -c "\
  /app/sshx-server \
    --override-origin $OVERRIDE_ORIGIN \
    --secret $SSHX_SECRET & \
  cd /app/sshx && npm run dev \
"
