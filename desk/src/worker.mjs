// Cloudflare Worker entry. Every /desk/* request goes to one Durable Object
// instance, so all lease state is owned and serialized by DeskDO.
import { DurableObject } from 'cloudflare:workers';
import { Desk } from './logic.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function respond({ status, body, headers = {} }) {
  const h = { ...CORS, ...headers };
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
      fetchFn: (url) => fetch(url),
      now: () => Date.now(),
      site: env.SITE,
      lemmasUrl: env.LEMMAS_URL,
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const result = await this.desk.handle({
      method: request.method,
      pathname: url.pathname,
      searchParams: url.searchParams,
      ip: request.headers.get('CF-Connecting-IP'),
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
