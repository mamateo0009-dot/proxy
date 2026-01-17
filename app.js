#!/usr/bin/env node
/**
 * WebSocket to TCP Stratum Proxy
 * Full Logic: User Tracking + Leaderboard API + Mining Bridge
 */
'use strict';

const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const Pool = require('@marco_ciaramella/stratum-client');
const url = require('url'); // Thêm thư viện xử lý URL

// --- 1. LOAD CONFIG ---
let config;
try {
    config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
} catch (err) {
    console.error('[CONFIG] Failed to load config.json:', err.message);
    process.exit(1);
}

const WS_PORT = process.env.PORT || 8080;

// --- 2. KHO DỮ LIỆU USER ---
// Lưu trữ thông tin từng người đào để làm Bảng xếp hạng
// Cấu trúc: { "TenUser": { accepted: 0, rejected: 0, lastSeen: timestamp } }
const userStats = {};

// Biến tổng (Optional)
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

// --- 3. HTTP SERVER (API & STATUS) ---
const server = http.createServer((req, res) => {
    // Cấu hình CORS để Frontend (index.html) có thể gọi API này
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // API Endpoint: Trả về dữ liệu Bảng xếp hạng (JSON)
    if (req.url === '/api/stats') {
        const sortedUsers = Object.entries(userStats)
            .sort(([, a], [, b]) => b.accepted - a.accepted) // Sắp xếp người nhiều share nhất lên đầu
            .map(([name, stat], index) => ({
                rank: index + 1,
                name: name,
                accepted: stat.accepted,
                rejected: stat.rejected,
                lastSeen: stat.lastSeen
            }));
        
        const totalAccepted = sortedUsers.reduce((sum, u) => sum + u.accepted, 0);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            total: totalAccepted, 
            miners: sortedUsers 
        }));
        return;
    }

    // Trang chủ hiển thị text đơn giản
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`PROXY RUNNING\nPort: ${WS_PORT}\nAPI Endpoint: /api/stats\nTotal Shares: ${globalStats.accepted}`);
});

// --- 4. WEBSOCKET SERVER ---
const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false,
    maxPayload: 100 * 1024,
});

console.log(`[PROXY] WebSocket listening on port: ${WS_PORT}`);

const sendJson = (ws, payload) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
};

wss.on('connection', (ws, req) => {
    // 1. Lấy tên User từ URL (Ví dụ: ws://host:8080/?user=Miner01)
    const parameters = url.parse(req.url, true).query;
    // Lấy tên, nếu không có thì đặt là Anonymous, cắt bớt nếu quá dài
    const username = (parameters.user || 'Anonymous').substring(0, 20);
    const clientIp = req.socket.remoteAddress;

    // 2. Khởi tạo stats cho user này nếu chưa có
    if (!userStats[username]) {
        userStats[username] = { accepted: 0, rejected: 0, lastSeen: Date.now() };
    }

    const { pool, wallet, password, argent, algo } = config;
    const [host, port] = pool.split(':');
    const selectedAlgo = ALGO_MAP[algo] ?? 'cwm_power2B';

    console.log(`[WS] New Miner Connected: ${username} (${clientIp})`);

    // Gửi lệnh Initialize cho Browser
    sendJson(ws, { id: 'initialize', method: 'initialize', params: [selectedAlgo] });

    let client = null;

    const startStratumClient = () => {
        if (client) return;

        client = Pool({
            server: host,
            port: Number(port),
            worker: wallet,
            password: password,
            userAgent: argent,
            ssl: false,
            autoReconnectOnError: true,
            onConnect: () => {
                console.log(`[TCP] Pool Connected for ${username}`);
            },
            onClose: () => {
                if (ws.readyState === WebSocket.OPEN) ws.close();
            },
            onError: (error) => {
                console.log(`[TCP Error] ${username}: ${error.message}`);
            },
            onNewDifficulty: (newDiff) => {
                sendJson(ws, { id: 'difficulty', method: 'difficulty', params: [newDiff] });
            },
            onNewMiningWork: (newWork) => {
                sendJson(ws, { id: 'task', method: 'task', params: [newWork] });
            },
            
            // --- XỬ LÝ KHI SHARE THÀNH CÔNG ---
            onSubmitWorkSuccess: (error, result) => {
                // Cập nhật cho User
                userStats[username].accepted++;
                userStats[username].lastSeen = Date.now();
                
                // Cập nhật Global
                globalStats.accepted++;

                console.log(`[SUCCESS] User: ${username} | Total: ${userStats[username].accepted}`);
                sendJson(ws, { id: 'success', method: 'success', params: [error, result] });
            },

            // --- XỬ LÝ KHI SHARE THẤT BẠI ---
            onSubmitWorkFail: (error, result) => {
                userStats[username].rejected++;
                userStats[username].lastSeen = Date.now();
                globalStats.rejected++;

                console.log(`[REJECT] User: ${username}`);
                sendJson(ws, { id: 'failed', method: 'failed', params: [error, result] });
            }
        });
    };

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            
            // Cập nhật thời gian hoạt động
            if (userStats[username]) userStats[username].lastSeen = Date.now();

            switch (msg.id) {
                case 'ready':
                    startStratumClient();
                    break;
                case 'submit':
                    if (client) {
                        const shared = msg.params[0];
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

    ws.on('close', () => client?.shutdown());
    ws.on('error', () => client?.shutdown());
});

wss.on('error', (err) => console.error('[WSS ERROR]', err.message));

server.listen(WS_PORT, () => {
    console.log(`[SERVER] Ready! Web Miner UI can connect to ws://YOUR_IP:${WS_PORT}`);
});
