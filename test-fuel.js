#!/usr/bin/env node
/**
 * test-fuel.js — 模拟 TokenSyber 扩展的 WebSocket 服务，用于测试游戏连接
 *
 * 用法: node test-fuel.js
 * 可选: node test-fuel.js --interval=2000 --tokens=500
 */

const http = require('http');
const crypto = require('crypto');

const args = process.argv.slice(2);
function getArg(name) {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? parseInt(arg.split('=')[1]) : null;
}

const PORT = 3001;
const INTERVAL = getArg('interval') || 3000;
const TOKENS_PER_TICK = getArg('tokens') || 800;

// === 简易 WebSocket 服务 ===
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const wsClients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const socket of wsClients) {
    try { socket.send(msg); } catch { wsClients.delete(socket); }
  }
}

function handleUpgrade(req, socket, head) {
  if (req.headers.upgrade?.toLowerCase() !== 'websocket') return;
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.send = function(data) {
    const payload = Buffer.from(data);
    let header;
    if (payload.length < 126) {
      header = Buffer.alloc(2);
      header.writeUInt8(0x81, 0);
      header.writeUInt8(payload.length, 1);
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4);
      header.writeUInt8(0x81, 0);
      header.writeUInt8(126, 1);
      header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header.writeUInt8(0x81, 0);
      header.writeUInt8(127, 1);
      header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    socket.write(Buffer.concat([header, payload]));
  };
  wsClients.add(socket);
  socket.on('close', () => wsClients.delete(socket));
  socket.on('error', () => wsClients.delete(socket));
  socket.send(JSON.stringify({ type: 'connected', message: 'Test Fuel Pump connected', stats: { totalTokens: 0, totalRequests: 0 } }));
  console.log('  [WS] Game connected');
}

// === HTTP 服务 ===
let totalTokens = 0;
let totalRequests = 0;

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*', 'Access-Control-Max-Age': '86400' });
    res.end();
    return;
  }
  if (req.url === '/fuel-stats') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ totalTokens, totalRequests, clients: wsClients.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

server.on('upgrade', handleUpgrade);

server.listen(PORT, () => {
  console.log('');
  console.log('  Test Fuel Pump — 模拟 TokenSyber 扩展');
  console.log(`  WebSocket: ws://localhost:${PORT}`);
  console.log(`  每 ${INTERVAL}ms 发送 +${TOKENS_PER_TICK} tokens`);
  console.log('  按 Ctrl+C 停止');
  console.log('');

  setInterval(() => {
    totalTokens += TOKENS_PER_TICK;
    totalRequests++;
    broadcast({ type: 'token-consumed', tokens: TOKENS_PER_TICK, totalTokens, timestamp: Date.now() });
    console.log(`  [TOKEN] +${TOKENS_PER_TICK.toLocaleString()} tokens (total: ${totalTokens.toLocaleString()})`);
  }, INTERVAL);
});
