FROM node:20-alpine

# Cài cert cho https/ws
RUN apk add --no-cache ca-certificates

# Thư mục làm việc
WORKDIR /app

# Copy node project
COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Cấp quyền cho sshx-server
RUN chmod +x ./sshx/sshx-server

# Expose port
EXPOSE 5173 8080

# Chạy song song sshx + npm dev
CMD sh -c "\
  cd sshx && ./sshx-server \
    --override-origin $OVERRIDE_ORIGIN \
    --secret $SSHX_SECRET & \
  cd /app && npm run dev \
"
