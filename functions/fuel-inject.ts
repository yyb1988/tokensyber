// /fuel-inject — token injection proxy to PlayerDO
interface Env {
  PLAYER_DO: DurableObjectNamespace;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const request = context.request;
  const url = new URL(request.url);

  const playerId = url.searchParams.get('player');
  if (!playerId || playerId.length < 8) {
    return new Response(JSON.stringify({ error: 'Missing or invalid player ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const id = context.env.PLAYER_DO.idFromName(playerId);
  const stub = context.env.PLAYER_DO.get(id);
  return stub.fetch(request);
};
