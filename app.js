#!/usr/bin/env node
/**
 * WebSocket to TCP Stratum Proxy with DNS Resolution
 * Added: Share Counter
 */
'use strict';

const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const Pool = require('@marco_ciaramella/stratum-client');

// Load config
let config;
try {
    config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
} catch (err) {
    console.error('[CONFIG] Failed to load config.json:', err.message);
    process.exit(1);
}

const WS_PORT = process.env.PORT || 8080;

// --- [THÊM MỚI] Biến toàn cục để đếm Share ---
let globalStats = {
    accepted: 0,
    rejected: 0
};
// ---------------------------------------------

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
    yespowerMWC: 'cwm_yespowerADVC',
};

// Create HTTP server
const server = http.createServer((req, res) => {
    // Hiển thị thống kê cơ bản khi truy cập vào trình duyệt
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`PROXY RUNNING\n----------------\nAccepted Shares: ${globalStats.accepted}\nRejected Shares: ${globalStats.rejected}\n`);
});

// WebSocket server
const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false,
    maxPayload: 100 * 1024,
});

console.log(`[PROXY] WebSocket listening on port: ${WS_PORT}`);

// Helper to send JSON messages safely
const sendJson = (ws, payload) => {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
};

wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress; // Lấy IP người đào
    const { pool, wallet, password, argent, algo } = config;
    const [host, port] = pool.split(':');
    const selectedAlgo = ALGO_MAP[algo] ?? 'cwm_power2B';

    console.log(`[WS] Connecting from ${clientIp} -> ${host}:${port}`);

    sendJson(ws, {
        id: 'initialize',
        method: 'initialize',
        params: [selectedAlgo]
    });

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
                console.log(`[TCP] Connected from ${clientIp} -> ${host}:${port}`);
            },
            onClose: () => {
                if (ws.readyState === WebSocket.OPEN) ws.close();
                console.log(`[TCP] Closed from ${clientIp} -> ${host}:${port}`);
            },
            onError: (error) => {
                console.log(`[TCP] Error from ${clientIp} -> ${host}:${port}`, error.message);
            },
            onNewDifficulty: (newDiff) => {
                sendJson(ws, {
                    id: 'difficulty',
                    method: 'difficulty',
                    params: [newDiff]
                });
            },
            onSubscribe: (subscribeData) => {
                // Optional
            },
            onNewMiningWork: (newWork) => {
                sendJson(ws, {
                    id: 'task',
                    method: 'task',
                    params: [newWork]
                });
            },
            
            // --- [SỬA ĐỔI] Xử lý khi Submit thành công ---
            onSubmitWorkSuccess: (error, result) => {
                globalStats.accepted++; // Tăng biến đếm
                
                // In log ra màn hình console server
                console.log(`[SHARE][SUCCESS] Miner: ${clientIp} | Total Accepted: ${globalStats.accepted}`);

                sendJson(ws, {
                    id: 'success',
                    method: 'success',
                    params: [error, result]
                });
            },

            // --- [SỬA ĐỔI] Xử lý khi Submit thất bại ---
            onSubmitWorkFail: (error, result) => {
                globalStats.rejected++; // Tăng biến đếm lỗi
                
                // In log ra màn hình console server
                console.log(`[SHARE][REJECT] Miner: ${clientIp} | Reason: ${error} | Total Rejected: ${globalStats.rejected}`);

                sendJson(ws, {
                    id: 'failed',
                    method: 'failed',
                    params: [error, result]
                });
            }
            // ---------------------------------------------
        });
    };

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
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
            console.error('[ERROR] WS→TCP failed:', err.message);
        }
    });

    ws.on('close', () => client?.shutdown());
    ws.on('error', () => client?.shutdown());
});

wss.on('error', (err) => console.error('[WSS ERROR]', err.message));

server.listen(WS_PORT, () => {
    console.log(`[SERVER] Listening on port ${WS_PORT}`);
});
