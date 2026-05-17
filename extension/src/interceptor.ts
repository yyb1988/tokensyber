import * as zlib from 'zlib';
import { parseTokensFromBody, isAiApiPath } from './token-parser';

const http = require('http') as typeof import('http');
const https = require('https') as typeof import('https');

type TokenCallback = (tokens: number) => void;

let onTokenExtracted: TokenCallback = () => {};
let localPort = 3001;

// Original references for restoration on dispose
const originals = {
  httpRequest: http.request,
  httpGet: http.get,
  httpsRequest: https.request,
  httpsGet: https.get,
  fetch: null as typeof globalThis.fetch | null,
};

export function initInterceptor(callback: TokenCallback, port: number): void {
  onTokenExtracted = callback;
  localPort = port;
  patchModule(http, 'http');
  patchModule(https, 'https');
  patchFetch();
}

export function disposeInterceptor(): void {
  http.request = originals.httpRequest;
  http.get = originals.httpGet;
  https.request = originals.httpsRequest;
  https.get = originals.httpsGet;
  if (originals.fetch) {
    globalThis.fetch = originals.fetch;
  }
}

function patchModule(mod: typeof http, _name: string): void {
  const origRequest = mod.request;
  const origGet = mod.get;

  mod.request = function patchedRequest(...args: any[]) {
    const req = origRequest.apply(mod, args);
    hookResponse(req);
    return req;
  };

  mod.get = function patchedGet(...args: any[]) {
    const req = origGet.apply(mod, args);
    hookResponse(req);
    return req;
  };
}

function hookResponse(req: http.ClientRequest): void {
  // Skip our own WebSocket/stats server
  const host = req.getHeader('host') as string | undefined;
  if (host && isLocalhost(host)) return;

  req.on('response', (res: http.IncomingMessage) => {
    if (res.statusCode !== 200) return;
    if (!isAiApiPath(req.path)) return;

    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    res.on('end', () => {
      try {
        const encoding = res.headers['content-encoding'];
        const body = decompress(chunks, encoding);
        const tokens = parseTokensFromBody(body);
        if (tokens > 0) {
          onTokenExtracted(tokens);
        }
      } catch {
        // Decompress or parse failure — don't disrupt the caller
      }
    });
  });
}

function patchFetch(): void {
  if (typeof globalThis.fetch !== 'function') return;

  originals.fetch = globalThis.fetch;

  globalThis.fetch = async function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const response = await originals.fetch!.call(globalThis, input, init);

    const url = resolveFetchUrl(input);
    if (!url || isLocalhostUrl(url)) return response;
    if (!response.ok || !isAiApiPath(url)) return response;

    try {
      const cloned = response.clone();
      cloned.text().then(body => {
        const tokens = parseTokensFromBody(body);
        if (tokens > 0) {
          onTokenExtracted(tokens);
        }
      }).catch(() => {});
    } catch {
      // clone() can fail for some response types
    }

    return response;
  };
}

function decompress(chunks: Buffer[], encoding?: string | string[]): string {
  const raw = Buffer.concat(chunks);
  const enc = Array.isArray(encoding) ? encoding[0] : encoding;
  if (enc === 'gzip') {
    return zlib.gunzipSync(raw).toString();
  } else if (enc === 'br') {
    return zlib.brotliDecompressSync(raw).toString();
  } else if (enc === 'deflate') {
    return zlib.inflateSync(raw).toString();
  }
  return raw.toString();
}

function isLocalhost(host: string): boolean {
  return host.includes(`localhost:${localPort}`)
    || host.includes(`127.0.0.1:${localPort}`)
    || host.includes(`[::1]:${localPort}`);
}

function isLocalhostUrl(url: string): boolean {
  return url.includes(`localhost:${localPort}`)
    || url.includes(`127.0.0.1:${localPort}`)
    || url.includes(`[::1]:${localPort}`);
}

function resolveFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if ('url' in input) return (input as Request).url;
  return '';
}
