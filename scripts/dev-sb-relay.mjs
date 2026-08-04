#!/usr/bin/env node
// scripts/dev-sb-relay.mjs
//
// Plain-HTTP relay:  browser → 127.0.0.1:54321 → https://<ref>.supabase.co
//
// WHY THIS EXISTS
// Some sandboxed dev containers (Claude Code on the web, CI images) give Node
// a working TLS path out — via a CA bundle and an HTTPS proxy — but give the
// headless browser nothing. The app then boots, renders its shell, and every
// Supabase call dies with `TypeError: Failed to fetch`, which looks exactly
// like "the feature is broken" and wastes an afternoon.
//
// This relay lets the browser speak plain HTTP to localhost while Node does
// the TLS. It is a LOCAL DEV AID ONLY — never point a deployed build at it.
//
// USAGE
//   node scripts/dev-sb-relay.mjs &
//   # then in .env.local (git-ignored):
//   #   VITE_SUPABASE_URL=http://127.0.0.1:54321
//   #   VITE_SUPABASE_ANON_KEY=<the real anon key>
//   npm run dev
//
// Override upstream/port with SB_UPSTREAM / SB_RELAY_PORT.
//
// TWO GOTCHAS THIS ALREADY HANDLES — don't reintroduce them:
//   1. Node's fetch transparently gunzips the upstream body. Forwarding
//      upstream's `content-encoding: gzip` alongside already-decompressed
//      bytes makes Chromium fail with net::ERR_CONTENT_DECODING_FAILED.
//      Both content-encoding and content-length are dropped from responses.
//   2. supabase-js sends an `apikey` header, which triggers a CORS preflight.
//      OPTIONS is answered directly, echoing the requested headers back.
//
// Separately: drive the browser with `serviceWorkers: 'block'`. The app
// registers push-sw.js, and a service worker in the middle of this makes
// request failures nondeterministic.

import http from 'node:http';

const UPSTREAM = process.env.SB_UPSTREAM || 'https://ebvqxuwfiptcmlkhflfj.supabase.co';
const PORT = Number(process.env.SB_RELAY_PORT || 54321);

// Hop-by-hop headers plus the ones Node's fetch owns.
const HOP = new Set([
  'host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'content-length', 'accept-encoding',
]);
// Additionally stripped from RESPONSES — see gotcha 1 above.
const RESP_DROP = new Set([...HOP, 'content-encoding', 'content-length']);

http.createServer(async (req, res) => {
  const cors = {
    'access-control-allow-origin': req.headers.origin || '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD',
    'access-control-allow-headers':
      req.headers['access-control-request-headers'] ||
      'authorization,apikey,content-type,prefer,x-client-info,range,accept-profile,content-profile',
    'access-control-expose-headers': 'content-range,content-length,x-supabase-api-version',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP.has(k.toLowerCase())) headers[k] = v;
  }

  try {
    const up = await fetch(UPSTREAM + req.url, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
      redirect: 'manual',
    });
    const out = { ...cors };
    up.headers.forEach((v, k) => { if (!RESP_DROP.has(k.toLowerCase())) out[k] = v; });
    const buf = Buffer.from(await up.arrayBuffer());
    res.writeHead(up.status, out);
    res.end(buf);
  } catch (e) {
    res.writeHead(502, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ relayError: String(e) }));
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[dev-sb-relay] http://127.0.0.1:${PORT}  →  ${UPSTREAM}`);
});
