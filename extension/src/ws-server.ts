import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

type TokenCallback = (data: { tokens: number; totalTokens: number; timestamp: number }) => void;

let server: http.Server | null = null;
let wss: WebSocketServer | null = null;
let totalTokens = 0;
let totalRequests = 0;
let onBroadcast: TokenCallback = () => {};

export function startServer(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        });
        res.end();
        return;
      }

      if (req.url === '/fuel-stats') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({
          totalTokens,
          totalRequests,
          clients: wss?.clients.size ?? 0,
        }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({
        type: 'connected',
        message: 'TokenSyber Fuel Pump connected',
        stats: { totalTokens, totalRequests },
      }));

      ws.on('close', () => {});
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(err);
      }
    });

    server.listen(port, () => {
      resolve();
    });
  });
}

export function broadcastTokenConsumed(tokens: number): void {
  totalTokens += tokens;
  totalRequests++;

  const data = {
    type: 'token-consumed',
    tokens,
    totalTokens,
    timestamp: Date.now(),
  };

  if (wss) {
    const msg = JSON.stringify(data);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  onBroadcast(data);
}

export function onTokenBroadcast(callback: TokenCallback): void {
  onBroadcast = callback;
}

export function getTotalTokens(): number {
  return totalTokens;
}

export function getTotalRequests(): number {
  return totalRequests;
}

export async function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (wss) {
      for (const client of wss.clients) {
        client.close();
      }
      wss.close(() => {
        if (server) {
          server.close(() => resolve());
        } else {
          resolve();
        }
      });
    } else if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}
