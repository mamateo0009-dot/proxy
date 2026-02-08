FROM node:20-alpine

RUN apk add --no-cache ca-certificates

WORKDIR /app

# Copy toàn bộ project
COPY . .

# Cấp quyền cho sshx-server
RUN chmod +x /app/sshx-server

# Cài npm trong thư mục sshx
WORKDIR /app/sshx
RUN npm install

EXPOSE 5173 8080

CMD sh -c "\
  /app/sshx-server \
    --override-origin $OVERRIDE_ORIGIN \
    --secret $SSHX_SECRET & \
  cd /app/sshx && npm run dev \
"
