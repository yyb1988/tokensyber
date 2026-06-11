// /register-key — HMAC key registration proxy to PlayerDO
interface Env {
  PLAYER_DO: DurableObjectNamespace;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const request = context.request;

  let body: { playerId?: string; key?: string };
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  if (!body.playerId || body.playerId.length < 8) {
    return new Response(JSON.stringify({ error: 'Missing or invalid playerId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const id = context.env.PLAYER_DO.idFromName(body.playerId);
  const stub = context.env.PLAYER_DO.get(id);
  return stub.fetch(request);
};
