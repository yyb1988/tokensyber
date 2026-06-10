interface Env {}

const MAX_INJECTS_PER_MINUTE = 60;
const MAX_TOKENS_PER_INJECT = 500_000;

export class PlayerDO implements DurableObject {
  private state: DurableObjectState;
  private clients: Set<WebSocket> = new Set();
  private totalTokens: number = 0;
  private totalRequests: number = 0;
  private hmacKey: string = '';
  private lastActivity: number = 0;
  private injectTimestamps: number[] = [];
  private initialized: boolean = false;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    this.hmacKey = (await this.state.storage.get<string>('hmacKey')) || '';
    this.totalTokens = (await this.state.storage.get<number>('totalTokens')) || 0;
    this.totalRequests = (await this.state.storage.get<number>('totalRequests')) || 0;
    this.initialized = true;
    this.lastActivity = Date.now();
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

    return new Response('Not found', { status: 404 });
  }

  private handleWebSocket(): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    this.state.acceptWebSocket(server);
    this.clients.add(server);

    // Send connected message
    server.send(JSON.stringify({
      type: 'connected',
      message: 'TokenSyber Fuel Pump connected',
      stats: { totalTokens: this.totalTokens, totalRequests: this.totalRequests },
    }));

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleInject(url: URL): Promise<Response> {
    const tokens = parseInt(url.searchParams.get('tokens') || '0', 10);
    const sig = url.searchParams.get('sig') || '';
    const playerId = url.searchParams.get('player') || '';

    // Token count sanity check (Claude model physical limits)
    if (tokens <= 0 || tokens > MAX_TOKENS_PER_INJECT) {
      return new Response(JSON.stringify({ error: 'Invalid token count', max: MAX_TOKENS_PER_INJECT }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Rate limit: max N injects per minute per player
    const now = Date.now();
    this.injectTimestamps = this.injectTimestamps.filter(t => now - t < 60_000);
    if (this.injectTimestamps.length >= MAX_INJECTS_PER_MINUTE) {
      return new Response(JSON.stringify({ error: 'Rate limited' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // HMAC verification (enforce after key is established)
    if (this.hmacKey) {
      const expectedSig = await this.computeHMAC(playerId, tokens);
      if (sig !== expectedSig) {
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Accept and process — always accumulate (game polls /fuel-stats)
    this.injectTimestamps.push(now);
    this.totalTokens += tokens;
    this.totalRequests++;

    // Persist counters every 10 requests (reduce storage writes)
    if (this.totalRequests % 10 === 0) {
      await this.state.storage.put({
        totalTokens: this.totalTokens,
        totalRequests: this.totalRequests,
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      tokens,
      totalTokens: this.totalTokens,
      clients: this.clients.size,
    }), {
      headers: { 'Content-Type': 'application/json' },
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

  // WebSocket message handler (called by platform after acceptWebSocket)
  async webSocketMessage(ws: WebSocket, message: string): Promise<void> {
    try {
      const data = JSON.parse(message);
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
      // Game page registers the HMAC key (established from player.json)
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
    // Persist state on disconnect
    await this.state.storage.put({
      totalTokens: this.totalTokens,
      totalRequests: this.totalRequests,
      hmacKey: this.hmacKey,
    });
  }

  private async computeHMAC(playerId: string, tokens: number): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(this.hmacKey);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const msgData = encoder.encode(`${playerId}:${tokens}`);
    const signature = await crypto.subtle.sign('HMAC', key, msgData);
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
