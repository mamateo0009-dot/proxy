#!/usr/bin/env node
/**
 * WebSocket to TCP Stratum Proxy with DNS Resolution
 * Dynamic target pool via base64 URL:
 * ws://IP:PORT/base64(host:port)
 */
'use strict';

const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const Pool = require('@marco_ciaramella/stratum-client');

// Load config once at startup
let config;
try {
    config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
} catch (err) {
    console.error('[CONFIG] Failed to load config.json:', err.message);
    process.exit(1);
}

const WS_PORT = process.env.PORT || 8080;

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
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('READY TO USE !!!\n');
});

// WebSocket server
const wss = new WebSocket.Server({
    server,
    perMessageDeflate: false, // Disable compression for performance
    maxPayload: 100 * 1024,   // 100KB max message size
});

console.log(`[PROXY] WebSocket listening on port: ${WS_PORT}`);

// Helper to send JSON messages safely
const sendJson = (ws, payload) => {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
};

wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    const { pool, wallet, password, argent, algo } = config;
    const [host, port] = pool.split(':');
    const selectedAlgo = ALGO_MAP[algo] ?? 'cwm_power2B';

    console.log(`[WS] Connecting from ${clientIp} -> ${host}:${port}`);

    // Send initialization message to client
    sendJson(ws, {
        id: 'initialize',
        method: 'initialize',
        params: [selectedAlgo]
    });

    let client = null;

    const startStratumClient = () => {
        if (client) return; // Prevent multiple instances

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
                // sendJson(ws, {
                //     id: 'subscribe',
                //     method: 'subscribe',
                //     params: [subscribeData]
                // });
            },
            onNewMiningWork: (newWork) => {
                sendJson(ws, {
                    id: 'task',
                    method: 'task',
                    params: [newWork]
                });
            },
            onSubmitWorkSuccess: (error, result) => {
                sendJson(ws, {
                    id: 'success',
                    method: 'success',
                    params: [error, result]
                });
            },
            onSubmitWorkFail: (error, result) => {
                sendJson(ws, {
                    id: 'failed',
                    method: 'failed',
                    params: [error, result]
                });
            }
        });
    };

    // Handle messages from WebSocket client
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
                    // Ignore unknown messages
                    break;
            }
        } catch (err) {
            console.error('[ERROR] WS→TCP failed:', err.message);
        }
    });

    // Cleanup on WebSocket close or error
    ws.on('close', () => client?.shutdown());
    ws.on('error', () => client?.shutdown());
});

wss.on('error', (err) => console.error('[WSS ERROR]', err.message));

server.listen(WS_PORT, () => {
    console.log(`[SERVER] Listening on port ${WS_PORT}`);
});