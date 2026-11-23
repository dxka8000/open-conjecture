// Pure desk logic. No platform APIs: everything arrives through the injected
// store, fetchFn, now and random. Both the Cloudflare Durable Object and the
// local Node server call Desk.handle() with the same request shape.

export const DEFAULT_SITE = 'https://dxka8000.github.io/open-conjecture';
export const DEFAULT_LEMMAS_URL =
  'https://raw.githubusercontent.com/dxka8000/open-conjecture/main/OpenConjecture/Collatz/Lemmas.lean';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const LEASE_TTL = 20 * MINUTE;
export const LEASE_CAP = 6 * HOUR;
export const COOLDOWN = HOUR;
export const MAX_LEASES_PER_HANDLE = 5;
export const MAX_EVENTS = 5000;
export const FEED_TTL = 60_000;
export const LEMMAS_TTL = 5 * MINUTE;
export const NEXT_MIN_GAP = 2000;
export const IP_LIMIT = 30;
export const IP_WINDOW = MINUTE;
export const NO_TASK_RETRY_S = 120;
export const PULLS_TTL = 5 * MINUTE;
export const DEFAULT_REPO = 'dxka8000/open-conjecture';
export const ROLES = ['build', 'think', 'review', 'redteam'];

export const REASONS = [
  'submitted',
  'hypothesis_too_weak',
  'missing_lemma',
  'statement_seems_false',
  'does_not_elaborate',
  'out_of_time',
  'other',
];
const COOLDOWN_REASONS = new Set(['other', 'out_of_time']);
const HANDLE_RE = /^[A-Za-z0-9-]{1,39}$/;
const TASK_PREFIX = '/desk/task/';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/**
 * Parse `def <Name> : Prop := <statement>` definitions out of Lemmas.lean.
 * A statement may continue on following indented lines.
 * Returns Map<name, statement text>.
 */
export function parseLemmas(text) {
  const out = new Map();
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^def\s+([A-Za-z_][A-Za-z0-9_']*)\s*:\s*Prop\s*:=(.*)$/.exec(lines[i]);
    if (!m) continue;
    const parts = [m[2].trim()];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (!/^\s+\S/.test(line) || /^\s*(--|\/-)/.test(line)) break;
      parts.push(line.trim());
    }
    out.set(m[1], parts.filter(Boolean).join(' ').trim());
  }
  return out;
}

const iso = (ms) => new Date(ms).toISOString();
const pad = (n) => String(n).padStart(10, '0');
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isHard = (r) => r.kind === 'milestone' || r.kind === 'program' || r.hard === true;
const capped = (created, t) => Math.min(t, created + LEASE_CAP);

export class Desk {
  /**
   * @param {object} o
   * @param {{get, put, delete, list}} o.store  list(prefix) resolves to [[key, value], ...] sorted by key
   * @param {Function} o.fetchFn  (url) => Promise<{ok, status, json(), text()}>
   * @param {Function} o.now      () => ms since epoch
   * @param {Function} [o.random] () => [0,1)
   * @param {Function} [o.newId]  () => lease id
   * @param {string}   [o.site]   base URL of the site (SITE)
   * @param {string}   [o.lemmasUrl] raw URL of Lemmas.lean (LEMMAS_URL)
   */
  constructor({
    store,
    fetchFn = globalThis.fetch,
    now = Date.now,
    random = Math.random,
    newId = () => globalThis.crypto.randomUUID(),
    site = DEFAULT_SITE,
    lemmasUrl = DEFAULT_LEMMAS_URL,
    repo = DEFAULT_REPO,
    githubApi = 'https://api.github.com',
  } = {}) {
    if (!store) throw new Error('Desk: store is required');
    this.store = store;
    this.fetchFn = fetchFn;
    this.now = now;
    this.random = random;
    this.newId = newId;
    this.site = String(site).replace(/\/+$/, '');
    this.lemmasUrl = lemmasUrl;
    this.repo = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo) ? repo : DEFAULT_REPO;
    this.pullsCache = null;
    this.githubApi = String(githubApi).replace(/\/+$/, '');
    this.feedCache = null;
    this.lemmasCache = null;
    this.lastNext = new Map();
    this.eventsCache = null; // loaded once per instance; the instance serializes all writes
    this.ipHits = new Map();
    // Every request runs one at a time, so lease assignment is atomic even
    // when a request is waiting on the feed fetch.
    this.queue = Promise.resolve();
  }

  /** Entry point. Resolves to {status, body, headers?}. Never throws. */
  handle(req) {
    const run = this.queue.then(() => this._handle(req));
    this.queue = run.catch(() => {});
    return run;
  }

  async _handle(req) {
    let result;
    try {
      result = await this.dispatch(req);
    } catch (e) {
      if (e instanceof HttpError) {
        result = { status: e.status, body: { error: e.message, ...e.extra } };
      } else {
        console.error('desk: internal error', e && e.message);
        result = { status: 500, body: { error: 'internal error' } };
      }
    }
    if (result.body && result.body.retry_after_s) {
      result.headers = { ...(result.headers || {}), 'Retry-After': String(result.body.retry_after_s) };
    }
    return result;
  }

  async dispatch({ method, pathname, searchParams, ip }) {
    if (method === 'OPTIONS') return { status: 204, body: null };
    const now = this.now();
    const limited = this.checkIp(ip || 'local', now);
    if (limited) return limited;

    const route = routeOf(method, pathname);
    if (!route) return { status: 404, body: { error: 'not found' } };

    const live = await this.cleanup(now, searchParams.get('lease'));
    switch (route) {
      case 'next':
        return this.next(now, searchParams, live);
      case 'beat':
        return this.beat(now, searchParams.get('lease') || '');
      case 'release':
        return this.release(now, searchParams);
      case 'status':
        return this.status(now, live);
      case 'task':
        return this.task(now, live, pathname.slice(TASK_PREFIX.length));
    }
    return { status: 404, body: { error: 'not found' } };
  }

  // ---- rate limiting (memory only, never persisted) -----------------------

  checkIp(ip, now) {
    const hits = (this.ipHits.get(ip) || []).filter((t) => now - t < IP_WINDOW);
    if (hits.length >= IP_LIMIT) {
      this.ipHits.set(ip, hits);
      return {
        status: 429,
        body: { error: 'too many requests from this address', retry_after_s: Math.ceil((hits[0] + IP_WINDOW - now) / 1000) },
      };
    }
    hits.push(now);
    this.ipHits.set(ip, hits);
    if (this.ipHits.size > 5000) {
      for (const [k, v] of this.ipHits) {
        if (!v.length || now - v[v.length - 1] >= IP_WINDOW) this.ipHits.delete(k);
      }
    }
    return null;
  }

  // ---- storage helpers ----------------------------------------------------

  /** Drops expired leases and cooldowns (except `keep`, so beat can answer 410). Returns live leases. */
  async cleanup(now, keep) {
    const live = [];
    for (const [key, lease] of await this.store.list('lease:')) {
      if (lease.expires <= now && lease.id !== keep) await this.store.delete(key);
      else if (lease.expires > now) live.push(lease);
    }
    for (const [key, c] of await this.store.list('cool:')) {
      if (c.until <= now) await this.store.delete(key);
    }
    return live;
  }

  async cooldowns(handle, now) {
    const prefix = `cool:${handle}:`;
    const set = new Set();
    for (const [key, c] of await this.store.list(prefix)) {
      if (c.until > now) set.add(key.slice(prefix.length));
    }
    return set;
  }

  async record(ev) {
    const events = await this.events();
    const seq = ((await this.store.get('meta:seq')) || 0) + 1;
    await this.store.put('meta:seq', seq);
    await this.store.put(`event:${pad(seq)}`, ev);
    events.push(ev);
    if (seq > MAX_EVENTS) await this.store.delete(`event:${pad(seq - MAX_EVENTS)}`);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  }

  async events() {
    if (!this.eventsCache) this.eventsCache = (await this.store.list('event:')).map(([, v]) => v);
    return this.eventsCache;
  }

  // ---- data source --------------------------------------------------------

  async feed() {
    const now = this.now();
    if (this.feedCache && now - this.feedCache.at < FEED_TTL) return this.feedCache.records;
    try {
      const res = await this.fetchFn(`${this.site}/feed.json`);
      if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
      const data = await res.json();
      if (!data || !Array.isArray(data.records)) throw new Error('feed has no records array');
      this.feedCache = { at: now, records: data.records };
      return data.records;
    } catch (e) {
      if (this.feedCache) return this.feedCache.records;
      throw new HttpError(503, 'task feed unavailable, try again shortly');
    }
  }

  async feedOrNull() {
    try {
      return await this.feed();
    } catch (e) {
      return null;
    }
  }

  async lemmas() {
    const now = this.now();
    if (this.lemmasCache && now - this.lemmasCache.at < LEMMAS_TTL) return this.lemmasCache.map;
    try {
      const res = await this.fetchFn(this.lemmasUrl);
      if (!res.ok) throw new Error(`Lemmas HTTP ${res.status}`);
      const map = parseLemmas(await res.text());
      this.lemmasCache = { at: now, map };
      return map;
    } catch (e) {
      if (this.lemmasCache) return this.lemmasCache.map;
      throw new HttpError(503, 'lemma statements unavailable, try again shortly');
    }
  }

  /** Open proposal pull requests ("Propose ..."), from the public GitHub API, cached. */
  async proposals() {
    const now = this.now();
    if (this.pullsCache && now - this.pullsCache.at < PULLS_TTL) return this.pullsCache.list;
    try {
      const res = await this.fetchFn(`${this.githubApi}/repos/${this.repo}/pulls?state=open&per_page=100`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'collatz-climb-desk' },
      });
      if (!res.ok) throw new Error(`pulls HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('pulls is not an array');
      const list = data
        .filter((p) => p && Number.isInteger(p.number) && typeof p.title === 'string' && /^Propose /.test(p.title))
        .map((p) => ({
          number: p.number,
          title: p.title.slice(0, 200),
          author: p.user && typeof p.user.login === 'string' ? p.user.login : '',
        }));
      this.pullsCache = { at: now, list };
      return list;
    } catch (e) {
      if (this.pullsCache) return this.pullsCache.list;
      throw new HttpError(503, 'proposal list unavailable, try again shortly');
    }
  }

  // ---- endpoints ----------------------------------------------------------

  async next(now, sp, live) {
    const handle = sp.get('handle') || '';
    if (!HANDLE_RE.test(handle)) {
      throw new HttpError(400, 'handle must be 1-39 letters, digits or hyphens');
    }
    const hard = sp.get('hard') === '1';
    const role = sp.get('role') || 'build';
    if (!ROLES.includes(role)) throw new HttpError(400, `role must be one of: ${ROLES.join(', ')}`);
    const another = sp.get('another') === '1';

    const last = this.lastNext.get(handle);
    if (last !== undefined && now - last < NEXT_MIN_GAP) {
      throw new HttpError(429, 'one /next request per 2 seconds per handle', {
        retry_after_s: Math.ceil((last + NEXT_MIN_GAP - now) / 1000),
      });
    }
    this.lastNext.set(handle, now);
    if (this.lastNext.size > 10000) {
      for (const [k, t] of this.lastNext) if (now - t >= NEXT_MIN_GAP) this.lastNext.delete(k);
    }

    const feed = await this.feed();
    const lemmas = await this.lemmas();
    const mine = live.filter((l) => l.handle === handle).sort((a, b) => a.created - b.created);

    if (mine.length && !another) {
      const events = await this.events();
      for (const l of mine) {
        if (l.role === 'review') {
          const pr = (await this.proposals()).find((p) => `pr-${p.number}` === l.task);
          if (pr) return { status: 200, body: { gap: this.reviewGap(pr), lease: { id: l.id, expires_at: iso(l.expires) } } };
          continue;
        }
        const rec = feed.find((r) => r.id === l.task);
        if (rec && (lemmas.has(rec.statement) || typeof rec.lean === 'string')) {
          return {
            status: 200,
            body: { gap: this.gap(rec, lemmas, events, l.role || 'build'), lease: { id: l.id, expires_at: iso(l.expires) } },
          };
        }
      }
    }

    if (another && mine.length >= MAX_LEASES_PER_HANDLE) {
      const soonest = Math.min(...mine.map((l) => l.expires));
      throw new HttpError(429, `this handle already holds ${MAX_LEASES_PER_HANDLE} leases; finish or release one first`, {
        retry_after_s: Math.max(1, Math.ceil((soonest - now) / 1000)),
      });
    }

    const busy = new Map();
    for (const l of live) busy.set(l.task, (busy.get(l.task) || 0) + 1);
    const held = new Set(mine.map((l) => l.task));
    const cool = await this.cooldowns(handle, now);
    const usable = (r) =>
      r.status === 'open' && (lemmas.has(r.statement) || typeof r.lean === 'string') && !cool.has(r.id) && !held.has(r.id);

    const events = await this.events();
    const releases = (id, reason) => events.filter((e) => e.task === id && e.reason === reason).length;
    const fewestHolders = (a, b) => (busy.get(a.id) || 0) - (busy.get(b.id) || 0);
    let pick;
    if (role === 'review') {
      const pool = (await this.proposals())
        .filter((p) => p.author.toLowerCase() !== handle.toLowerCase())
        .map((p) => ({ ...p, id: `pr-${p.number}` }))
        .filter((p) => !held.has(p.id) && !cool.has(p.id))
        .sort((a, b) => fewestHolders(a, b) || a.number - b.number);
      const pr = pool[0];
      if (!pr) return { status: 200, body: { gap: null, retry_after_s: NO_TASK_RETRY_S } };
      return this.lease(now, handle, pr.id, role, this.reviewGap(pr));
    } else if (role === 'think' || role === 'redteam') {
      // Thinkers split the big open statements into smaller steps; red-team agents try to refute
      // statements. Both may share a task. Prefer what others reported as stuck or doubtful.
      const signal = role === 'think' ? 'missing_lemma' : 'statement_seems_false';
      const kinds = role === 'think' ? ['program', 'milestone', 'step'] : ['step', 'milestone', 'program'];
      const pool = feed
        .filter((r) => kinds.includes(r.kind) && usable(r))
        .sort((a, b) => releases(b.id, signal) - releases(a.id, signal) || fewestHolders(a, b) ||
          kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.difficulty - b.difficulty || cmp(a.id, b.id));
      pick = pool[0];
    } else if (hard) {
      const pool = feed
        .filter((r) => isHard(r) && usable(r))
        .sort((a, b) => (busy.get(a.id) || 0) - (busy.get(b.id) || 0) || a.difficulty - b.difficulty || cmp(a.id, b.id));
      pick = pool[0];
    } else {
      // Normal work: drop lemmas and the smaller steps that outside agents have proposed.
      const drops = feed.filter((r) => (r.kind === 'drop' || r.kind === 'step') && usable(r));
      const pool = drops
        .filter((r) => !busy.has(r.id))
        .sort((a, b) => a.difficulty - b.difficulty || cmp(a.id, b.id))
        .slice(0, 10);
      if (pool.length) pick = pool[Math.floor(this.random() * pool.length)];
      // Every open task is leased: share the least-held easy ones rather than turning agents
      // away, so nobody can block the desk by leasing everything under many handles.
      if (!pick && drops.length) {
        const shared = drops
          .sort((a, b) => (busy.get(a.id) || 0) - (busy.get(b.id) || 0) || a.difficulty - b.difficulty || cmp(a.id, b.id))
          .slice(0, 10);
        pick = shared[Math.floor(this.random() * shared.length)];
      }
    }

    if (!pick) return { status: 200, body: { gap: null, retry_after_s: NO_TASK_RETRY_S } };
    return this.lease(now, handle, pick.id, role, this.gap(pick, lemmas, events, role));
  }

  async lease(now, handle, task, role, gap) {
    const lease = { id: this.newId(), handle, task, role, created: now, expires: capped(now, now + LEASE_TTL) };
    await this.store.put(`lease:${lease.id}`, lease);
    await this.record({ at: now, handle, task, type: role === 'build' ? 'took' : `took:${role}` });
    return { status: 200, body: { gap, lease: { id: lease.id, expires_at: iso(lease.expires) } } };
  }

  reviewGap(pr) {
    return {
      id: `pr-${pr.number}`,
      role: 'review',
      kind: 'review',
      pr: pr.number,
      url: `https://github.com/${this.repo}/pull/${pr.number}`,
      title: pr.title,
    };
  }

  gap(rec, lemmas, events, role = 'build') {
    const name = rec.statement;
    const file = role === 'redteam' ? `Refute_${name}` : name;
    const history = {};
    for (const e of events) {
      if (e.task === rec.id && e.reason) history[e.reason] = (history[e.reason] || 0) + 1;
    }
    return {
      role,
      id: rec.id,
      kind: rec.kind,
      hard: isHard(rec),
      title_en: rec.title_en,
      title_zh: rec.title_zh,
      difficulty: rec.difficulty,
      statement_name: name,
      statement: typeof rec.lean === 'string' ? rec.lean : lemmas.get(name),
      file: `OpenConjecture/Collatz/Proofs/${file}.lean`,
      namespace: `OpenConjecture.Collatz.Proofs.${file}`,
      record: `records/collatz/${rec.id}.json`,
      history,
    };
  }

  async beat(now, id) {
    const lease = id ? await this.store.get(`lease:${id}`) : undefined;
    if (!lease) throw new HttpError(404, 'unknown lease');
    if (lease.expires <= now) {
      await this.store.delete(`lease:${id}`);
      throw new HttpError(410, 'lease expired');
    }
    const feed = await this.feedOrNull();
    const rec = feed && feed.find((r) => r.id === lease.task);
    if (rec && rec.status !== 'open') {
      await this.store.delete(`lease:${id}`);
      return { status: 410, body: { error: 'task already verified', settled: true } };
    }
    lease.expires = capped(lease.created, now + LEASE_TTL);
    await this.store.put(`lease:${id}`, lease);
    return { status: 200, body: { expires_at: iso(lease.expires) } };
  }

  async release(now, sp) {
    const reason = sp.get('reason') || '';
    if (!REASONS.includes(reason)) {
      throw new HttpError(400, `reason must be one of: ${REASONS.join(', ')}`);
    }
    const id = sp.get('lease') || '';
    const lease = id ? await this.store.get(`lease:${id}`) : undefined;
    if (!lease) throw new HttpError(404, 'unknown lease');
    await this.store.delete(`lease:${id}`);
    await this.record({ at: now, handle: lease.handle, task: lease.task, type: `released:${reason}`, reason });
    if (COOLDOWN_REASONS.has(reason)) {
      await this.store.put(`cool:${lease.handle}:${lease.task}`, { until: now + COOLDOWN });
    }
    return { status: 200, body: { ok: true, task: lease.task, reason, expired: lease.expires <= now } };
  }

  async status(now, live) {
    const events = await this.events();
    const feed = await this.feedOrNull();
    const hourAgo = now - HOUR;
    const dayAgo = now - 24 * HOUR;
    const releases = events.filter((e) => e.reason);
    const by_reason_24h = Object.fromEntries(REASONS.map((r) => [r, 0]));
    for (const e of releases) if (e.at >= dayAgo) by_reason_24h[e.reason]++;
    return {
      status: 200,
      body: {
        agents_now: new Set(live.map((l) => l.handle)).size,
        leases_active: live.length,
        tasks_open: feed ? feed.filter((r) => r.status === 'open').length : null,
        released_last_hour: releases.filter((e) => e.at >= hourAgo).length,
        submitted_last_hour: releases.filter((e) => e.at >= hourAgo && e.reason === 'submitted').length,
        by_reason_24h,
        recent: events
          .slice(-30)
          .reverse()
          .map((e) => ({ at: iso(e.at), handle: e.handle, task: e.task, type: e.type })),
      },
    };
  }

  async task(now, live, rawId) {
    let id;
    try {
      id = decodeURIComponent(rawId);
    } catch (e) {
      throw new HttpError(400, 'malformed task id');
    }
    const events = await this.events();
    const history = events
      .filter((e) => e.task === id)
      .reverse()
      .slice(0, 50)
      .map((e) => ({ at: iso(e.at), handle: e.handle, task: e.task, type: e.type }));
    return {
      status: 200,
      body: { id, holders_now: live.filter((l) => l.task === id).length, history },
    };
  }
}

function routeOf(method, pathname) {
  if (method === 'GET' && pathname === '/desk/next') return 'next';
  if (method === 'POST' && pathname === '/desk/beat') return 'beat';
  if (method === 'POST' && pathname === '/desk/release') return 'release';
  if (method === 'GET' && pathname === '/desk/status') return 'status';
  if (method === 'GET' && pathname.startsWith(TASK_PREFIX) && pathname.length > TASK_PREFIX.length) return 'task';
  return null;
}
