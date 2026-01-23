#!/usr/bin/env node
/**
 * T COIN PROXY SERVER
 * Full Logic: WebSocket <-> TCP Stratum Bridge
 * Added: Wallet Generator API + Coin Balance Calculation
 */
'use strict';

const fs = require('fs');
const http = require('http');
const crypto = require('crypto'); // Thêm: Dùng để tạo địa chỉ ví ngẫu nhiên
const WebSocket = require('ws');
const Pool = require('@marco_ciaramella/stratum-client');
const url = require('url');

// --- 1. LOAD CONFIG ---
let config;
try {
    config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
} catch (err) {
    console.error('[CONFIG] Failed to load config.json:', err.message);
    process.exit(1);
}

const WS_PORT = process.env.PORT || 8080;

// Cấu hình T Coin (Dùng để tính hiển thị số dư)
const COIN_CONFIG = {
    name: "T Coin",
    symbol: "TC",
    rewardPerShare: 0.125 // Giả lập: 1 Share = 0.125 TC
};

// --- 2. KHO DỮ LIỆU USER (MINERS) ---
// Cấu trúc: { "TCxxxx...": { accepted: 0, rejected: 0, lastSeen: timestamp } }
const miners = {};

// Biến tổng toàn mạng
let globalStats = { accepted: 0, rejected: 0 };

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

// --- 3. HTTP SERVER (API: Stats + Create Wallet) ---
const server = http.createServer((req, res) => {
    // Cấu hình CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');

    // === API MỚI: TẠO VÍ T COIN ===
    if (req.url === '/api/wallet/create') {
        // Tạo chuỗi hex ngẫu nhiên 8 ký tự -> TCxxxxxxxx
        const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
        const newWallet = `TC${randomHex}`;
        
        // Khởi tạo dữ liệu cho ví mới ngay lập tức
        miners[newWallet] = { accepted: 0, rejected: 0, lastSeen: Date.now() };

        res.writeHead(200);
        res.end(JSON.stringify({ 
            status: 'success', 
            wallet: newWallet,
            message: 'Wallet generated successfully'
        }));
        return;
    }

    // === API: TRẢ VỀ BẢNG XẾP HẠNG & SỐ DƯ ===
    if (req.url === '/api/stats') {
        const sortedMiners = Object.entries(miners)
            .sort(([, a], [, b]) => b.accepted - a.accepted) // Sắp xếp theo Share
            .map(([wallet, stat], index) => ({
                rank: index + 1,
                wallet: wallet, // Trả về ID ví thay vì name
                shares: stat.accepted,
                // Tính số dư dựa trên số share
                balance: (stat.accepted * COIN_CONFIG.rewardPerShare).toFixed(4), 
                rejected: stat.rejected,
                lastSeen: stat.lastSeen,
                status: (Date.now() - stat.lastSeen < 15000) ? 'online' : 'offline'
            }));
        
        res.writeHead(200);
        res.end(JSON.stringify({ 
            network: {
                name: COIN_CONFIG.name,
                symbol: COIN_CONFIG.symbol,
                total_shares: globalStats.accepted
            },
            miners: sortedMiners 
        }));
        return;
    }

    // Trang chủ hiển thị text đơn giản
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`[T COIN PROXY] RUNNING\nPort: ${WS_PORT}\nEndpoints:\n - /api/stats (Leaderboard)\n - /api/wallet/create (Generate ID)`);
});

// --- 4. WEBSOCKET SERVER (STRATUM BRIDGE) ---
const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false,
    maxPayload: 100 * 1024,
});

console.log(`🚀 [PROXY] WebSocket listening on port: ${WS_PORT}`);

const sendJson = (ws, payload) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
};

wss.on('connection', (ws, req) => {
    // 1. Lấy Wallet ID từ URL (Ví dụ: ws://host:8080/?user=TC1234AB)
    const parameters = url.parse(req.url, true).query;
    // Nếu không có user, gán Anonymous
    const walletId = (parameters.user || 'Anonymous').substring(0, 30);
    const clientIp = req.socket.remoteAddress;

    // 2. Khởi tạo stats cho ví này nếu chưa có
    if (!miners[walletId]) {
        miners[walletId] = { accepted: 0, rejected: 0, lastSeen: Date.now() };
    }

    const { pool, wallet, password, argent, algo } = config;
    const [host, port] = pool.split(':');
    const selectedAlgo = ALGO_MAP[algo] ?? 'cwm_power2B';

    console.log(`🔌 [WS] Miner Connected: ${walletId} (${clientIp})`);

    // Gửi lệnh Initialize cho Browser
    sendJson(ws, { id: 'initialize', method: 'initialize', params: [selectedAlgo] });

    let client = null;

    const startStratumClient = () => {
        if (client) return;

        // Kết nối TCP tới Pool thật
        client = Pool({
            server: host,
            port: Number(port),
            worker: wallet, // LƯU Ý: Đây là ví thật của Admin trong config.json
            password: password,
            userAgent: argent,
            ssl: false,
            autoReconnectOnError: true,
            onConnect: () => {
                console.log(`✅ [TCP] Pool Connected for ${walletId}`);
            },
            onClose: () => {
                if (ws.readyState === WebSocket.OPEN) ws.close();
            },
            onError: (error) => {
                console.log(`❌ [TCP Error] ${walletId}: ${error.message}`);
            },
            onNewDifficulty: (newDiff) => {
                sendJson(ws, { id: 'difficulty', method: 'difficulty', params: [newDiff] });
            },
            onNewMiningWork: (newWork) => {
                sendJson(ws, { id: 'task', method: 'task', params: [newWork] });
            },
            
            // --- XỬ LÝ KHI SHARE THÀNH CÔNG ---
            onSubmitWorkSuccess: (error, result) => {
                // Cập nhật cho User (Wallet ID)
                miners[walletId].accepted++;
                miners[walletId].lastSeen = Date.now();
                
                // Cập nhật Global
                globalStats.accepted++;

                console.log(`💰 [SUCCESS] Wallet: ${walletId} | Shares: ${miners[walletId].accepted}`);
                sendJson(ws, { id: 'success', method: 'success', params: [error, result] });
            },

            // --- XỬ LÝ KHI SHARE THẤT BẠI ---
            onSubmitWorkFail: (error, result) => {
                miners[walletId].rejected++;
                miners[walletId].lastSeen = Date.now();
                globalStats.rejected++;

                console.log(`⚠️ [REJECT] Wallet: ${walletId}`);
                sendJson(ws, { id: 'failed', method: 'failed', params: [error, result] });
            }
        });
    };

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            
            // Cập nhật thời gian hoạt động (Heartbeat)
            if (miners[walletId]) miners[walletId].lastSeen = Date.now();

            switch (msg.id) {
                case 'ready':
                    startStratumClient();
                    break;
                case 'submit':
                    if (client) {
                        const shared = msg.params[0];
                        // Submit công việc lên Pool
                        client.submit(wallet, shared.job_id, shared.extranonce2, shared.ntime, shared.nonce);
                    }
                    break;
                default:
                    break;
            }
        } catch (err) {
            console.error('[ERROR] WS Handling:', err.message);
        }
    });

    ws.on('close', () => {
        console.log(`👋 [WS] Disconnected: ${walletId}`);
        if (client) client.shutdown();
    });
    
    ws.on('error', () => client?.shutdown());
});

wss.on('error', (err) => console.error('[WSS ERROR]', err.message));

server.listen(WS_PORT, () => {
    console.log(`[SERVER] Ready! Web Miner UI can connect to ws://YOUR_IP:${WS_PORT}`);
});
