// Cloudflare Worker entry. Every /desk/* request goes to one Durable Object
// instance, so all lease state is owned and serialized by DeskDO.
import { DurableObject } from 'cloudflare:workers';
import { Desk } from './logic.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function respond({ status, body, headers = {}, text }) {
  const h = { ...CORS, ...headers };
  if (typeof text === 'string') return new Response(text, { status, headers: { ...h, 'Cache-Control': 'no-store' } });
  if (body === null || body === undefined) return new Response(null, { status, headers: h });
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...h, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export class DeskDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const storage = ctx.storage;
    this.desk = new Desk({
      store: {
        get: (key) => storage.get(key),
        put: (key, value) => storage.put(key, value),
        delete: (key) => storage.delete(key),
        list: async (prefix) => [...(await storage.list({ prefix })).entries()],
      },
      fetchFn: (url, opts) => fetch(url, opts),
      now: () => Date.now(),
      site: env.SITE,
      lemmasUrl: env.LEMMAS_URL,
      adminToken: env.ADMIN_TOKEN || '',
      githubClientId: env.GITHUB_CLIENT_ID || '',
      githubClientSecret: env.GITHUB_CLIENT_SECRET || '',
      origin: env.DESK_ORIGIN || '',
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    let body = '';
    if (request.method === 'POST') {
      const len = Number(request.headers.get('Content-Length') || 0);
      if (len > 4096) return respond({ status: 413, body: { error: 'request body too large' } });
      body = (await request.text()).slice(0, 4097);
    }
    const result = await this.desk.handle({
      method: request.method,
      pathname: url.pathname,
      searchParams: url.searchParams,
      ip: request.headers.get('CF-Connecting-IP'),
      body,
      auth: request.headers.get('Authorization') || '',
      ua: request.headers.get('User-Agent') || '',
      country: (request.cf && request.cf.country) || '',
    });
    return respond(result);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/desk/')) {
      return respond({ status: 404, body: { error: 'not found' } });
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    const stub = env.DESK.get(env.DESK.idFromName('desk'));
    return stub.fetch(request);
  },
};
