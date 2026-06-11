interface Env {}

const MAX_TOKENS_PER_INJECT = 50_000; // 单次注入上限（> 单次 Claude 回复 ~32K）
const MAX_INJECTS_PER_MINUTE = 60;
const SIGNATURE_WINDOW_MS = 120_000; // 签名时间戳有效期 2 分钟
const NONCE_TTL_MS = 120_000; // nonce 存活期

export class PlayerDO implements DurableObject {
  private state: DurableObjectState;
  private clients: Set<WebSocket> = new Set();
  private totalTokens: number = 0;
  private totalRequests: number = 0;
  private lastReportedTotal: number = 0; // 服务端记录的累计值（防 state.json 篡改重放）
  private hmacKey: string = '';
  private lastActivity: number = 0;
  private injectTimestamps: number[] = [];
  private usedNonces: Map<string, number> = new Map(); // nonce → expiry timestamp
  private initialized: boolean = false;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    this.hmacKey = (await this.state.storage.get<string>('hmacKey')) || '';
    this.totalTokens = (await this.state.storage.get<number>('totalTokens')) || 0;
    this.totalRequests = (await this.state.storage.get<number>('totalRequests')) || 0;
    this.lastReportedTotal = (await this.state.storage.get<number>('lastReportedTotal')) || 0;
    // 恢复持久化的速率限制
    const savedTimestamps = (await this.state.storage.get<number[]>('injectTimestamps')) || [];
    this.injectTimestamps = savedTimestamps.filter(t => Date.now() - t < 60_000);
    this.initialized = true;
    this.lastActivity = Date.now();
  }

  private cleanupNonces(): void {
    const now = Date.now();
    for (const [nonce, expiry] of this.usedNonces) {
      if (now > expiry) this.usedNonces.delete(nonce);
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized();
    this.lastActivity = Date.now();

    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket();
    }

    // fuel-inject
    if (url.pathname === '/fuel-inject') {
      return this.handleInject(url);
    }

    // fuel-stats
    if (url.pathname === '/fuel-stats') {
      return this.handleStats();
    }

    // register-key (POST only, first-come)
    if (url.pathname === '/register-key' && request.method === 'POST') {
      return this.handleRegisterKey(request);
    }

    return new Response('Not found', { status: 404 });
  }

  private handleWebSocket(): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    this.state.acceptWebSocket(server);
    this.clients.add(server);

    server.send(JSON.stringify({
      type: 'connected',
      message: 'TokenSyber Fuel Pump connected',
      stats: { totalTokens: this.totalTokens, totalRequests: this.totalRequests },
    }));

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleInject(url: URL): Promise<Response> {
    const playerId = url.searchParams.get('player') || '';
    const sig = url.searchParams.get('sig') || '';
    const nonce = url.searchParams.get('nonce') || '';
    const ts = parseInt(url.searchParams.get('ts') || '0', 10);

    // 新协议：发送 total（累计值），DO 计算 delta
    // 旧协议兼容：发送 tokens（增量）
    let total = parseInt(url.searchParams.get('total') || '', 10);
    let tokens: number;

    if (!isNaN(total) && total > 0) {
      // 新协议：服务端验证单调递增
      tokens = total - this.lastReportedTotal;
    } else {
      // 旧协议兼容（将被逐步淘汰）
      tokens = parseInt(url.searchParams.get('tokens') || '0', 10);
      total = this.lastReportedTotal + tokens;
    }

    // --- 验证层 ---

    // 1. Token 数量合理性
    if (tokens <= 0 || tokens > MAX_TOKENS_PER_INJECT) {
      return new Response(JSON.stringify({ error: 'Invalid token count', max: MAX_TOKENS_PER_INJECT }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. 签名时间戳窗口
    const now = Date.now();
    if (!ts || Math.abs(now - ts) > SIGNATURE_WINDOW_MS) {
      return new Response(JSON.stringify({ error: 'Timestamp out of window' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Nonce 防重放
    this.cleanupNonces();
    if (!nonce || this.usedNonces.has(nonce)) {
      return new Response(JSON.stringify({ error: 'Nonce already used or missing' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. 速率限制
    this.injectTimestamps = this.injectTimestamps.filter(t => now - t < 60_000);
    if (this.injectTimestamps.length >= MAX_INJECTS_PER_MINUTE) {
      return new Response(JSON.stringify({ error: 'Rate limited' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 5. HMAC 签名验证（强制）
    if (!this.hmacKey) {
      return new Response(JSON.stringify({ error: 'HMAC key not registered — connect game page first' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // 签名: HMAC(key, "playerId:total:nonce:ts")
    const expectedSig = await this.computeHMAC(`${playerId}:${total}:${nonce}:${ts}`);
    if (sig !== expectedSig) {
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // --- 通过验证，接受注入 ---

    this.usedNonces.set(nonce, now + NONCE_TTL_MS);
    this.injectTimestamps.push(now);
    this.totalTokens += tokens;
    this.lastReportedTotal = total;
    this.totalRequests++;

    // 持久化（每次注入都保存关键状态，避免丢失）
    await this.persistState();

    return new Response(JSON.stringify({
      ok: true,
      tokens,       // 本次注入量
      delta: tokens, // 兼容
      totalTokens: this.totalTokens,
      clients: this.clients.size,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private async persistState(): Promise<void> {
    await this.state.storage.put({
      totalTokens: this.totalTokens,
      totalRequests: this.totalRequests,
      lastReportedTotal: this.lastReportedTotal,
      injectTimestamps: this.injectTimestamps,
    });
  }

  private handleStats(): Response {
    const activeMs = Date.now() - this.lastActivity;
    const connected = this.clients.size > 0 || activeMs < 10_000;
    return new Response(JSON.stringify({
      totalTokens: this.totalTokens,
      totalRequests: this.totalRequests,
      clients: this.clients.size,
      connected,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // HTTP key registration (first-come-first-served, locks after set)
  private async handleRegisterKey(request: Request): Promise<Response> {
    if (this.hmacKey) {
      return new Response(JSON.stringify({ error: 'HMAC key already registered' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let body: { key?: string };
    try { body = await request.json(); } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!body.key || typeof body.key !== 'string' || body.key.length < 32) {
      return new Response(JSON.stringify({ error: 'key required, min 32 chars' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    this.hmacKey = body.key;
    await this.state.storage.put('hmacKey', this.hmacKey);
    return new Response(JSON.stringify({ ok: true, message: 'HMAC key registered' }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // WebSocket message handler (called by platform after acceptWebSocket)
  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    try {
      const data = JSON.parse(message);
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
      if (data.type === 'register-key' && data.key && !this.hmacKey) {
        this.hmacKey = data.key;
        await this.state.storage.put('hmacKey', this.hmacKey);
      }
    } catch {
      // ignore malformed messages
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.clients.delete(ws);
    await this.persistState();
    await this.state.storage.put('hmacKey', this.hmacKey);
  }

  private async computeHMAC(message: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(this.hmacKey);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const msgData = encoder.encode(message);
    const signature = await crypto.subtle.sign('HMAC', key, msgData);
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
