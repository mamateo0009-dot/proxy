#!/usr/bin/env node
/**
 * T-COIN AGGREGATED PROXY (SUPER-NODE)
 * Logic: 1 Master TCP Connection <-> N WebSocket Users
 * Features: Anti-Ban, Wallet API, Leaderboard, Full Algorithm Map
 */
'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');       // Dùng module gốc để kiểm soát luồng TCP
const crypto = require('crypto'); // Tạo ví
const WebSocket = require('ws');
const url = require('url');

// --- 1. LOAD CONFIG ---
let config;
try {
    config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
} catch (e) {
    console.error('❌ [ERROR] Không tìm thấy file config.json');
    process.exit(1);
}

const PORT = process.env.PORT || 8080;
const COIN_CONFIG = {
    name: "T Coin",
    symbol: "TC",
    rewardPerShare: 0.125 // 1 Share = 0.125 TC
};

// --- BẢN ĐỒ THUẬT TOÁN ĐẦY ĐỦ (FULL MAP) ---
// Ánh xạ tên thuật toán trong config -> Tên kỹ thuật của Worker
const ALGO_MAP = {
    power2b: 'cwm_power2B',
    yespower: 'cwm_yespower',
    yespowerR16: 'cwm_yespowerR16',
    yescrypt: 'cwm_yescrypt',
    yescryptR8: 'cwm_yescryptR8',
    yescryptR16: 'cwm_yescryptR16',
    yescryptR32: 'cwm_yescryptR32',
    minotaurx: 'cwm_minotaurx',
    ghostrider: 'cwm_ghostrider',
    yespowerTIDE: 'cwm_yespowerTIDE',
    yespowerADVC: 'cwm_yespowerADVC',
};

// --- 2. GLOBAL STATE (IN-MEMORY DB) ---
const miners = {}; // { wallet: { accepted, rejected, lastSeen } }
let globalShares = 0;

// Request Map: Để định tuyến câu trả lời từ Pool về đúng User
// Map<RequestID_Pool, { ws: WebSocket, wallet: String }>
const requestMap = new Map();
let uniqueReqId = 1;

// Cache Job hiện tại (để user mới vào có việc làm ngay)
let currentJob = null;
let currentDifficulty = null;

// --- 3. MASTER TCP CONNECTION (SINGLETON) ---
// Đây là kết nối duy nhất đi ra ngoài Internet tới Pool
const [poolHost, poolPort] = config.pool.split(':');
const client = new net.Socket();
let isPoolConnected = false;
let buffer = '';

function connectToPool() {
    console.log(`🔌 [MASTER] Connecting to Pool: ${poolHost}:${poolPort}...`);
    client.connect(Number(poolPort), poolHost);
}

// Khi kết nối thành công tới Pool
client.on('connect', () => {
    console.log('✅ [MASTER] Uplink Established! Authenticating...');
    isPoolConnected = true;

    // 1. Subscribe (Đăng ký nhận việc)
    const sub = JSON.stringify({
        id: 1,
        method: "mining.subscribe",
        params: ["T-Coin-Proxy/3.0", null, poolHost, poolPort]
    }) + "\n";
    client.write(sub);

    // 2. Authorize (Đăng nhập bằng Ví Admin để đào gom)
    const auth = JSON.stringify({
        id: 2,
        method: "mining.authorize",
        params: [config.wallet, config.password || "x"]
    }) + "\n";
    client.write(auth);
});

// Khi nhận dữ liệu từ Pool
client.on('data', (data) => {
    buffer += data.toString();
    let idx;
    // Xử lý gói tin TCP bị dính liền (Stream handling)
    while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.substring(0, idx);
        buffer = buffer.substring(idx + 1);
        handlePoolMessage(line);
    }
});

// Tự động kết nối lại nếu rớt mạng
client.on('close', () => {
    console.log('⚠️ [MASTER] Connection Lost. Reconnecting in 5s...');
    isPoolConnected = false;
    setTimeout(connectToPool, 5000);
});

client.on('error', (err) => console.error('❌ [MASTER ERROR]', err.message));

// --- XỬ LÝ LOGIC STRATUM ---
function handlePoolMessage(jsonString) {
    if (!jsonString.trim()) return;

    try {
        const msg = JSON.parse(jsonString);

        // A. Pool gửi Job mới (Broadcast cho tất cả users)
        if (msg.method === 'mining.notify') {
            currentJob = msg.params;
            broadcast({
                id: 'task',
                method: 'task',
                params: [{
                    job_id: msg.params[0],
                    prevhash: msg.params[1],
                    coinbase1: msg.params[2],
                    coinbase2: msg.params[3],
                    merkle_branch: msg.params[4],
                    version: msg.params[5],
                    nbits: msg.params[6],
                    ntime: msg.params[7],
                    clean_jobs: msg.params[8]
                }]
            });
        }
        // B. Pool đổi độ khó
        else if (msg.method === 'mining.set_difficulty') {
            currentDifficulty = msg.params[0];
            broadcast({ id: 'difficulty', method: 'difficulty', params: [currentDifficulty] });
        }
        // C. Pool trả lời kết quả Submit (Response)
        else if (msg.id) {
            // Tìm xem ID này thuộc về User WebSocket nào
            if (requestMap.has(msg.id)) {
                const reqData = requestMap.get(msg.id);
                requestMap.delete(msg.id); // Dọn dẹp bộ nhớ

                if (msg.error) {
                    // Share bị từ chối
                    if (miners[reqData.wallet]) miners[reqData.wallet].rejected++;
                    sendJson(reqData.ws, { id: 'failed', method: 'failed', params: [msg.error] });
                } else {
                    // Share thành công
                    if (miners[reqData.wallet]) {
                        miners[reqData.wallet].accepted++;
                        miners[reqData.wallet].lastSeen = Date.now();
                    }
                    globalShares++;
                    sendJson(reqData.ws, { id: 'success', method: 'success', params: [true] });
                    console.log(`💰 [ACCEPT] Wallet: ${reqData.wallet} | Total: ${miners[reqData.wallet].accepted}`);
                }
            }
        }
    } catch (e) {
        console.error('Parse Error:', e.message);
    }
}

// Khởi chạy kết nối Pool
connectToPool();


// --- 4. HTTP SERVER (API) ---
const server = http.createServer((req, res) => {
    // CORS: Cho phép Frontend gọi API
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    // API: Stats Leaderboard
    if (req.url === '/api/stats') {
        const sorted = Object.entries(miners)
            .sort(([, a], [, b]) => b.accepted - a.accepted)
            .slice(0, 100) // Top 100 user
            .map(([w, d], i) => ({
                rank: i + 1,
                wallet: w,
                shares: d.accepted,
                balance: (d.accepted * COIN_CONFIG.rewardPerShare).toFixed(4),
                status: (Date.now() - d.lastSeen < 30000) ? 'online' : 'offline'
            }));

        res.end(JSON.stringify({
            network: {
                total_shares: globalShares,
                name: COIN_CONFIG.name,
                symbol: COIN_CONFIG.symbol
            },
            miners: sorted
        }));
        return;
    }

    // API: Create Wallet
    if (req.url === '/api/wallet/create') {
        const id = 'TC' + crypto.randomBytes(4).toString('hex').toUpperCase();
        miners[id] = { accepted: 0, rejected: 0, lastSeen: Date.now() };
        res.end(JSON.stringify({ status: 'success', wallet: id }));
        return;
    }

    // Default
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('T-Coin Super-Node Online');
});

// --- 5. WEBSOCKET SERVER ---
const wss = new WebSocket.Server({ server, maxPayload: 10 * 1024 * 1024 });

console.log(`🚀 [SERVER] Aggregator listening on port ${PORT}`);

// Helper: Gửi tới 1 Client
function sendJson(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

// Helper: Gửi tới TẤT CẢ Client (Broadcast)
function broadcast(payload) {
    const data = JSON.stringify(payload);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(data);
    });
}

wss.on('connection', (ws, req) => {
    const query = url.parse(req.url, true).query;
    const wallet = (query.user || 'Anonymous').substring(0, 50);

    // Init User Stats
    if (!miners[wallet]) miners[wallet] = { accepted: 0, rejected: 0, lastSeen: Date.now() };

    // 1. Gửi cấu hình thuật toán ngay lập tức (Lấy từ ALGO_MAP đầy đủ)
    const selectedAlgo = ALGO_MAP[config.algo] || 'cwm_power2B';
    sendJson(ws, { id: 'initialize', method: 'initialize', params: [selectedAlgo] });

    // 2. Gửi Job hiện tại (Nếu có sẵn)
    if (currentDifficulty) sendJson(ws, { id: 'difficulty', method: 'difficulty', params: [currentDifficulty] });
    if (currentJob) {
        sendJson(ws, {
            id: 'task', method: 'task',
            params: [{
                job_id: currentJob[0], prevhash: currentJob[1], coinbase1: currentJob[2], coinbase2: currentJob[3],
                merkle_branch: currentJob[4], version: currentJob[5], nbits: currentJob[6], ntime: currentJob[7], clean_jobs: currentJob[8]
            }]
        });
    }

    // 3. Xử lý tin nhắn Client gửi lên
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            miners[wallet].lastSeen = Date.now();

            if (data.id === 'submit' && isPoolConnected) {
                // Tạo ID request duy nhất nội bộ
                uniqueReqId++;
                const proxyReqId = uniqueReqId;

                // Lưu vào Map để khi Pool trả lời thì biết trả về cho Client nào
                requestMap.set(proxyReqId, { ws, wallet });

                // Dọn dẹp Map (tránh tràn RAM nếu request bị treo)
                if (requestMap.size > 20000) requestMap.delete(requestMap.keys().next().value);

                const p = data.params[0];
                
                // Gửi Share lên Pool qua đường truyền Master
                // ID gửi lên Pool là proxyReqId (số nguyên)
                const submitStr = JSON.stringify({
                    id: proxyReqId,
                    method: "mining.submit",
                    params: [config.wallet, p.job_id, p.extranonce2, p.ntime, p.nonce]
                }) + "\n";
                
                client.write(submitStr);
            }
        } catch (e) { 
            // Bỏ qua lỗi JSON hỏng
        }
    });
});

server.listen(PORT);
