export { PlayerDO } from './player-do';

interface Env {
  PLAYER_DO: DurableObjectNamespace;
}

const ALLOWED_ORIGINS = [
  'https://tokensyber.pages.dev',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

function getCorsOrigin(request: Request): string {
  const origin = request.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  return ALLOWED_ORIGINS[0]; // default
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const corsOrigin = getCorsOrigin(request);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: { ...CORS_HEADERS, 'Access-Control-Allow-Origin': corsOrigin },
      });
    }

    const jsonHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': corsOrigin,
    };

    // Route: WebSocket upgrade
    if (url.pathname === '/ws' && request.headers.get('Upgrade') === 'websocket') {
      const playerId = url.searchParams.get('player');
      if (!playerId || playerId.length < 8) {
        return new Response(JSON.stringify({ error: 'Missing or invalid player ID' }), {
          status: 400,
          headers: jsonHeaders,
        });
      }
      const id = env.PLAYER_DO.idFromName(playerId);
      const stub = env.PLAYER_DO.get(id);
      return stub.fetch(request);
    }

    // Route: fuel-inject
    if (url.pathname === '/fuel-inject') {
      const playerId = url.searchParams.get('player');
      if (!playerId || playerId.length < 8) {
        return new Response(JSON.stringify({ error: 'Missing or invalid player ID' }), {
          status: 400,
          headers: jsonHeaders,
        });
      }
      const id = env.PLAYER_DO.idFromName(playerId);
      const stub = env.PLAYER_DO.get(id);
      return stub.fetch(request);
    }

    // Route: fuel-stats
    if (url.pathname === '/fuel-stats') {
      const playerId = url.searchParams.get('player');
      if (!playerId || playerId.length < 8) {
        return new Response(JSON.stringify({ error: 'Missing or invalid player ID' }), {
          status: 400,
          headers: jsonHeaders,
        });
      }
      const id = env.PLAYER_DO.idFromName(playerId);
      const stub = env.PLAYER_DO.get(id);
      return stub.fetch(request);
    }

    // Route: health check
    if (url.pathname === '/') {
      return new Response(JSON.stringify({ server: 'tokensyber', version: '2.0' }), {
        headers: jsonHeaders,
      });
    }

    return new Response('Not found', { status: 404 });
  },
};
