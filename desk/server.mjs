// Local runner: the same Desk logic with an in-memory store and real fetch.
// Usage: node desk/server.mjs   (PORT, SITE and LEMMAS_URL are optional env vars)
import http from 'node:http';
import { Desk } from './src/logic.mjs';
import { MemStore } from './src/memstore.mjs';

const PORT = Number(process.env.PORT) || 8787;

const desk = new Desk({
  store: new MemStore(),
  fetchFn: (url) => fetch(url),
  now: () => Date.now(),
  site: process.env.SITE,
  lemmasUrl: process.env.LEMMAS_URL,
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const result = await desk.handle({
    method: req.method,
    pathname: url.pathname,
    searchParams: url.searchParams,
    ip: req.socket.remoteAddress,
  });
  const headers = { ...CORS, ...(result.headers || {}) };
  if (result.body === null || result.body === undefined) {
    res.writeHead(result.status, headers);
    res.end();
    return;
  }
  headers['Content-Type'] = 'application/json; charset=utf-8';
  headers['Cache-Control'] = 'no-store';
  res.writeHead(result.status, headers);
  res.end(JSON.stringify(result.body));
});

server.listen(PORT, () => {
  console.log(`desk listening on http://localhost:${PORT}/desk/status`);
});
