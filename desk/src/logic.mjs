// Pure desk logic. No platform APIs: everything arrives through the injected
// store, fetchFn, now and random. Both the Cloudflare Durable Object and the
// local Node server call Desk.handle() with the same request shape.

export const DEFAULT_SITE = 'https://proofhive.github.io';
export const DEFAULT_LEMMAS_URL =
  'https://raw.githubusercontent.com/proofhive/proofhive.github.io/main/OpenConjecture/Collatz/Lemmas.lean';

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
export const DEFAULT_REPO = 'proofhive/proofhive.github.io';
// Outside agents prove (build), split (think) or refute (redteam).
export const ROLES = ['build', 'think', 'redteam'];
export const NOTE_TASK_BELOW = 2; // role=think hands out a note task while a record has fewer research notes than this

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

// Anonymous page-view counts
export const HIT_IP_LIMIT = 120; // per hour per address; beyond that, hits are dropped silently
export const STATS_CAP = 200; // distinct paths and referrer hosts per day; the rest count as "other"
export const UV_CAP = 200000; // distinct visitors counted per day
export const STATS_KEEP_DAYS = 400;
const BOT_RE = /bot|crawler|spider|crawl|slurp|headless|preview|monitor|curl|wget|python-requests|go-http/i;
const PATH_RE = /^\/[A-Za-z0-9/._-]{0,119}$/;
const REF_RE = /^[a-z0-9.-]{1,100}$/;

// Library votes ("want this attacked")
export const VOTE_IDS_CAP = 5000;
export const VOTES_PER_IP_DAY = 50;
const VOTE_ID_RE = /^(fc|ph):[A-Za-z0-9_.'-]{1,120}$/;

// Members (sign-up) and GitHub sessions
export const MEMBER_ROLES = ['ai', 'mathematician', 'sponsor', 'following'];
export const JOIN_IP_LIMIT = 5; // per hour
export const MAX_MEMBERS = 20000;
export const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const PROFILE_TEXT = { display_name: 60, affiliation: 100, bio: 400, country: 40 };
const PROFILE_LINK_HOSTS = { x: ['x.com', 'twitter.com'], linkedin: ['linkedin.com'], github: ['github.com'], orcid: ['orcid.org'], scholar: ['scholar.google.com'], homepage: null };
/** Same rules as checker/profiles.mjs, for profile fields edited on the web. */
export function checkMemberProfile(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, why: 'send a JSON object' };
  const allowed = new Set([...Object.keys(PROFILE_TEXT), 'interests', 'links']);
  for (const k of Object.keys(d)) if (!allowed.has(k)) return { ok: false, why: `unknown field ${k}` };
  const out = {};
  for (const [k, max] of Object.entries(PROFILE_TEXT)) {
    if (d[k] === undefined) continue;
    const v = cleanText(d[k], max);
    if (v === null) return { ok: false, why: `${k} must be text of at most ${max} characters` };
    if (v) out[k] = v;
  }
  if (d.interests !== undefined) {
    if (!Array.isArray(d.interests) || d.interests.length > 8) return { ok: false, why: 'interests: at most 8' };
    const list = d.interests.map((x) => cleanText(x, 40));
    if (list.some((x) => !x)) return { ok: false, why: 'each interest is 1 to 40 characters' };
    if (list.length) out.interests = list;
  }
  if (d.links !== undefined) {
    if (!d.links || typeof d.links !== 'object' || Array.isArray(d.links)) return { ok: false, why: 'links must be an object' };
    const links = {};
    for (const [k, v] of Object.entries(d.links)) {
      if (!(k in PROFILE_LINK_HOSTS)) return { ok: false, why: `unknown link ${k}` };
      if (v === '' || v === null) continue;
      let u;
      try { u = new URL(String(v)); } catch (e) { return { ok: false, why: `link ${k} is not a valid address` }; }
      if (u.protocol !== 'https:' || u.username || u.password || String(v).length > 200) return { ok: false, why: `link ${k} must be https` };
      const hosts = PROFILE_LINK_HOSTS[k];
      if (hosts && !hosts.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))) return { ok: false, why: `link ${k} must go to ${hosts.join(' or ')}` };
      links[k] = u.href;
    }
    if (Object.keys(links).length) out.links = links;
  }
  return { ok: true, profile: out };
}

// Sponsor pledges
export const PLEDGE_MIN = 5;
export const PLEDGE_MAX = 10000;
export const TOTAL_MAX = 100000;
export const PLEDGE_IP_LIMIT = 5; // per hour
export const MAX_PLEDGERS = 5000;
export const BODY_MAX = 4096;
const NAME_MAX = 60;
const TAGLINE_MAX = 80;
const LINK_MAX = 200;
const EMAIL_MAX = 254;
const LINK_RE = /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._~\/-]*)?$/;
const EMAIL_RE = /^[^\s@<>"',;()\[\]\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
/** Trimmed text with control and bidi characters removed; '' if absent, null if not text or too long. */
function cleanText(v, max) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? null : t;
}
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
    adminToken = '',
    githubClientId = '',
    githubClientSecret = '',
    origin = '',
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
    this.githubApi = String(githubApi).replace(/\/+$/, '');
    this.feedCache = null;
    this.lemmasCache = null;
    this.lastNext = new Map();
    this.eventsCache = null; // loaded once per instance; the instance serializes all writes
    this.ipHits = new Map();
    this.pledgeHits = new Map();
    this.hitHits = new Map();
    this.joinHits = new Map();
    this.github = { id: typeof githubClientId === 'string' ? githubClientId : '', secret: typeof githubClientSecret === 'string' ? githubClientSecret : '' };
    this.origin = String(origin || '').replace(/\/+$/, '');
    this.adminToken = typeof adminToken === 'string' && adminToken.length >= 16 ? adminToken : '';
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

  async dispatch({ method, pathname, searchParams, ip, body, auth, ua, country }) {
    if (method === 'OPTIONS') return { status: 204, body: null };
    const now = this.now();
    const limited = this.checkIp(ip || 'local', now);
    if (limited) return limited;

    const route = routeOf(method, pathname);
    if (!route) return { status: 404, body: { error: 'not found' } };
    if (typeof body === 'string' && body.length > BODY_MAX) throw new HttpError(413, 'request body too large');
    if (route === 'hit') return this.hit(now, body, ip, ua, country);
    if (route === 'join') return this.join(now, body, ip);
    if (route === 'admin-members') return this.members(searchParams, auth);
    if (route === 'auth-status') return this.authStatus();
    if (route === 'gh-start') return this.githubStart(now, searchParams);
    if (route === 'gh-callback') return this.githubCallback(now, searchParams);
    if (route === 'me') return this.me(now, auth);
    if (route === 'me-profile') return this.saveProfile(now, body, auth);
    if (route === 'profiles') return this.publicProfiles();
    if (route === 'vote') return this.vote(now, body, ip);
    if (route === 'votes') return { status: 200, body: { votes: (await this.store.get('votes')) || {} } };
    if (route === 'admin-stats') return this.stats(now, searchParams, auth);
    if (route === 'pledge') return this.pledge(now, body, ip);
    if (route === 'sponsors') return this.sponsors();
    if (route.startsWith('admin-')) return this.admin(now, route, body, auth);

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



  // ---- anonymous page-view counts --------------------------------------------
  // Aggregated counters only, one document per day: views per path, per referrer host, per country and
  // per hour, plus a count of distinct visitors. A visitor is a hash of (daily salt, IP, user agent); the
  // salt and the hashes are kept for the current day only and deleted when the day changes. No raw IP,
  // no cookie, no identifier is ever stored.

  async rollDay(day) {
    const cur = await this.store.get('stats-day');
    if (cur === day) return;
    for (const [k] of await this.store.list('uv:')) await this.store.delete(k);
    for (const [k] of await this.store.list('salt:')) await this.store.delete(k);
    for (const [k] of await this.store.list('vt:')) await this.store.delete(k);
    const cutoff = iso(Date.parse(day + 'T00:00:00Z') - STATS_KEEP_DAYS * 864e5).slice(0, 10);
    for (const [k] of await this.store.list('stats:')) if (k.slice(6) < cutoff) await this.store.delete(k);
    await this.store.put(`salt:${day}`, this.newId() + this.newId());
    await this.store.put('stats-day', day);
  }

  async hit(now, body, ip, ua, country) {
    const agent = typeof ua === 'string' ? ua : '';
    if (!agent || BOT_RE.test(agent)) return { status: 204, body: null };
    const hits = (this.hitHits.get(ip) || []).filter((t) => now - t < HOUR);
    if (hits.length >= HIT_IP_LIMIT) return { status: 204, body: null }; // silently dropped
    hits.push(now);
    this.hitHits.set(ip, hits);
    if (this.hitHits.size > 20000) for (const [k, v] of this.hitHits) if (!v.length || now - v[v.length - 1] >= HOUR) this.hitHits.delete(k);

    let d = {};
    try { d = JSON.parse(body || '{}') || {}; } catch (e) { d = {}; }
    const path = typeof d.path === 'string' && PATH_RE.test(d.path) ? d.path : 'other';
    const refRaw = typeof d.ref === 'string' ? d.ref.toLowerCase() : '';
    const ref = refRaw === '' ? '(direct)' : REF_RE.test(refRaw) ? refRaw : 'other';
    const cc = typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? country : '??';

    const day = iso(now).slice(0, 10), hour = iso(now).slice(0, 13);
    await this.rollDay(day);
    const key = `stats:${day}`;
    const s = (await this.store.get(key)) || { views: 0, visitors: 0, paths: {}, refs: {}, countries: {}, hours: {} };
    for (const k of ['paths', 'refs', 'countries', 'hours']) s[k] = s[k] || {};
    s.views = s.views || 0; s.visitors = s.visitors || 0;
    const bump = (obj, k, cap) => { const kk = Object.prototype.hasOwnProperty.call(obj, k) || Object.keys(obj).length < cap ? k : 'other'; obj[kk] = (obj[kk] || 0) + 1; };
    s.views += 1;
    bump(s.paths, path, STATS_CAP);
    bump(s.refs, ref, STATS_CAP);
    bump(s.countries, cc, 300);
    s.hours[hour] = (s.hours[hour] || 0) + 1;

    const salt = (await this.store.get(`salt:${day}`)) || '';
    const bytes = new TextEncoder().encode(`${salt}|${ip || ''}|${agent}`);
    const v = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
    const uvKey = `uv:${day}:${v.slice(0, 2)}`; // 256 buckets per day keep each document small
    const bucket = (await this.store.get(uvKey)) || [];
    if (!bucket.includes(v) && s.visitors < UV_CAP) {
      bucket.push(v);
      await this.store.put(uvKey, bucket);
      s.visitors += 1;
    }
    await this.store.put(key, s);
    return { status: 204, body: null };
  }

  // One "want this attacked" vote per IP, per library entry, per day. Only the totals are kept; the
  // daily-salted hashes that prevent double votes are deleted when the day changes.
  async vote(now, body, ip) {
    let d = {};
    try { d = JSON.parse(body || '{}') || {}; } catch (e) { d = {}; }
    const id = typeof d.id === 'string' ? d.id : '';
    if (!VOTE_ID_RE.test(id)) throw new HttpError(400, 'id must be a library entry id');
    const day = iso(now).slice(0, 10);
    await this.rollDay(day);
    const salt = (await this.store.get(`salt:${day}`)) || '';
    const hash = async (x) => [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(x)))].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
    const ipKey = `vt:${day}:ip:${await hash(`${salt}|${ip || ''}`)}`;
    const used = (await this.store.get(ipKey)) || 0;
    const votes = (await this.store.get('votes')) || {};
    if (used >= VOTES_PER_IP_DAY) return { status: 200, body: { ok: false, counted: false, votes: votes[id] || 0, reason: 'daily limit' } };
    const v = await hash(`${salt}|${ip || ''}|${id}`);
    const bucketKey = `vt:${day}:${v.slice(0, 2)}`;
    const bucket = (await this.store.get(bucketKey)) || [];
    if (bucket.includes(v)) return { status: 200, body: { ok: true, counted: false, votes: votes[id] || 0 } };
    if (!(id in votes) && Object.keys(votes).length >= VOTE_IDS_CAP) throw new HttpError(503, 'vote list is full');
    bucket.push(v);
    await this.store.put(bucketKey, bucket);
    await this.store.put(ipKey, used + 1);
    votes[id] = (votes[id] || 0) + 1;
    await this.store.put('votes', votes);
    return { status: 200, body: { ok: true, counted: true, votes: votes[id] } };
  }

  async stats(now, searchParams, auth) {
    this.checkAdmin(auth);
    const days = Math.max(1, Math.min(STATS_KEEP_DAYS, Number(searchParams.get('days')) || 30));
    const out = [], paths = {}, refs = {}, countries = {};
    let last24 = 0;
    const since = iso(now - 24 * HOUR).slice(0, 13);
    for (let i = days - 1; i >= 0; i--) {
      const day = iso(now - i * 864e5).slice(0, 10);
      const s = (await this.store.get(`stats:${day}`)) || { views: 0, visitors: 0, paths: {}, refs: {}, countries: {}, hours: {} };
      s.paths = s.paths || {}; s.refs = s.refs || {}; s.countries = s.countries || {}; s.hours = s.hours || {};
      out.push({ date: day, views: s.views, visitors: s.visitors, signups: s.signups || 0 });
      for (const [k, n] of Object.entries(s.paths)) paths[k] = (paths[k] || 0) + n;
      for (const [k, n] of Object.entries(s.refs)) refs[k] = (refs[k] || 0) + n;
      for (const [k, n] of Object.entries(s.countries)) countries[k] = (countries[k] || 0) + n;
      for (const [h, n] of Object.entries(s.hours)) if (h >= since) last24 += n;
    }
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 25).map(([key, n]) => ({ key, n }));
    return { status: 200, body: { days: out, last_24h: last24, paths: top(paths), referrers: top(refs), countries: top(countries) } };
  }


  // ---- members: sign-up, optional GitHub connection, profile edits -------------
  // A member is stored under member:<sha256 of the lowercased email> (or member:gh:<github id> for someone who
  // only connected GitHub). The email is never returned by a public endpoint; only /desk/admin/members shows it.
  // Sessions are random server-side tokens (ss:<token>), handed to the site in the URL fragment of the redirect
  // and kept by the page in sessionStorage; they are sent back as "Authorization: Bearer". A desk cookie would
  // be a third-party cookie for the site, which browsers block, so the token approach is the CSP-safe one.

  async emailHash(email) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.toLowerCase()));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  limit(map, ip, now, max, window) {
    const hits = (map.get(ip) || []).filter((t) => now - t < window);
    if (hits.length >= max) throw new HttpError(429, 'too many requests from this address; try again later', { retry_after_s: Math.ceil((hits[0] + window - now) / 1000) });
    hits.push(now);
    map.set(ip, hits);
    if (map.size > 5000) for (const [k, v] of map) if (!v.length || now - v[v.length - 1] >= window) map.delete(k);
  }

  async join(now, body, ip) {
    let d;
    try { d = JSON.parse(body || ''); } catch (e) { throw new HttpError(400, 'send a JSON object'); }
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new HttpError(400, 'send a JSON object');
    // Honeypot: a hidden field people never fill. Pretend success, store nothing.
    if (typeof d.website === 'string' && d.website.trim()) return { status: 200, body: { ok: true } };
    const email = typeof d.email === 'string' ? d.email.trim() : '';
    if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) throw new HttpError(400, 'email must be a valid address');
    const name = cleanText(d.name, NAME_MAX);
    if (name === null) throw new HttpError(400, `name must be at most ${NAME_MAX} characters`);
    const country = cleanText(d.country, 40);
    if (country === null) throw new HttpError(400, 'country must be at most 40 characters');
    const roles = Array.isArray(d.roles) ? d.roles : [];
    if (roles.length > MEMBER_ROLES.length || roles.some((r) => !MEMBER_ROLES.includes(r))) throw new HttpError(400, `roles must be among: ${MEMBER_ROLES.join(', ')}`);
    const interests = Array.isArray(d.interests) ? d.interests : [];
    if (interests.length > 8) throw new HttpError(400, 'at most 8 interests');
    const ints = interests.map((x) => cleanText(x, 60));
    if (ints.some((x) => !x)) throw new HttpError(400, 'each interest is 1 to 60 characters of text');
    if (d.consent !== undefined && typeof d.consent !== 'boolean') throw new HttpError(400, 'consent must be true or false');
    this.limit(this.joinHits, ip || 'local', now, JOIN_IP_LIMIT, HOUR);

    const key = `member:${await this.emailHash(email)}`;
    let m = await this.store.get(key);
    const fresh = !m;
    if (fresh) {
      if ((await this.store.list('member:')).length >= MAX_MEMBERS) throw new HttpError(503, 'sign-ups are full; try again later');
      m = { email, joined: now, github: null, profile: null, sponsor: false };
    }
    Object.assign(m, { email, name: name || m.name || '', roles: [...new Set(roles)], interests: ints, country: country || '', consent: d.consent === true, updated: now });
    if (await this.store.get(`pledge:${key.slice(7)}`)) m.sponsor = true;
    await this.store.put(key, m);
    if (fresh) await this.bumpStat(now, 'signups');
    const link = this.newId().replace(/-/g, '') + this.newId().replace(/-/g, '');
    await this.store.put(`lt:${link}`, { member: key, exp: now + HOUR });
    return { status: 200, body: { ok: true, new: fresh, link_token: link } };
  }

  async bumpStat(now, field) {
    const day = iso(now).slice(0, 10);
    const key = `stats:${day}`;
    const s = (await this.store.get(key)) || { views: 0, visitors: 0, paths: {}, refs: {}, countries: {}, hours: {} };
    s[field] = (s[field] || 0) + 1;
    await this.store.put(key, s);
  }

  async members(searchParams, auth) {
    this.checkAdmin(auth);
    const all = (await this.store.list('member:')).map(([, m]) => m).sort((a, b) => a.joined - b.joined);
    const rows = all.map((m) => ({ email: m.email || '', name: m.name || '', roles: (m.roles || []).join(' '), interests: (m.interests || []).join('; '),
      country: m.country || '', consent: !!m.consent, sponsor: !!m.sponsor, github: m.github ? m.github.login : '', joined: iso(m.joined) }));
    if (searchParams.get('format') === 'csv') {
      const cols = ['email', 'name', 'roles', 'interests', 'country', 'consent', 'sponsor', 'github', 'joined'];
      const cell = (v) => { const x = String(v); const safe = /^[=+\-@\t\r]/.test(x) ? "'" + x : x; return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe; };
      return { status: 200, body: null, text: [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n', headers: { 'Content-Type': 'text/csv; charset=utf-8' } };
    }
    return { status: 200, body: { count: rows.length, members: rows } };
  }

  authStatus() {
    return { status: 200, body: { github: !!(this.github.id && this.github.secret) } };
  }

  async githubStart(now, searchParams) {
    if (!this.github.id || !this.github.secret) throw new HttpError(404, 'not found');
    const t = searchParams.get('t') || '';
    let member = null;
    if (t) {
      const lt = /^[a-f0-9]{16,80}$/.test(t) ? await this.store.get(`lt:${t}`) : null;
      if (!lt || lt.exp < now) throw new HttpError(400, 'this link has expired; sign up again');
      member = lt.member;
    }
    const state = this.newId().replace(/-/g, '') + this.newId().replace(/-/g, '');
    await this.store.put(`os:${state}`, { member, exp: now + 10 * MINUTE });
    const u = new URL('https://github.com/login/oauth/authorize');
    u.searchParams.set('client_id', this.github.id);
    u.searchParams.set('redirect_uri', `${this.origin}/desk/auth/github/callback`);
    u.searchParams.set('scope', 'read:user');
    u.searchParams.set('state', state);
    u.searchParams.set('allow_signup', 'true');
    return { status: 302, body: null, headers: { Location: u.toString() } };
  }

  async githubCallback(now, searchParams) {
    if (!this.github.id || !this.github.secret) throw new HttpError(404, 'not found');
    const state = searchParams.get('state') || '', code = searchParams.get('code') || '';
    const st = /^[a-f0-9]{16,80}$/.test(state) ? await this.store.get(`os:${state}`) : null;
    if (st) await this.store.delete(`os:${state}`); // one-time, whatever happens next
    if (!st || st.exp < now) throw new HttpError(400, 'invalid or expired sign-in attempt; start again');
    if (!/^[A-Za-z0-9_-]{4,100}$/.test(code)) throw new HttpError(400, 'missing authorization code');
    const tok = await this.fetchFn('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'proofhive-desk' },
      body: JSON.stringify({ client_id: this.github.id, client_secret: this.github.secret, code, redirect_uri: `${this.origin}/desk/auth/github/callback` }),
    });
    const tj = tok && tok.ok ? await tok.json() : null;
    if (!tj || typeof tj.access_token !== 'string') throw new HttpError(502, 'GitHub did not accept the sign-in');
    const ur = await this.fetchFn('https://api.github.com/user', { headers: { Authorization: `Bearer ${tj.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'proofhive-desk' } });
    const u = ur && ur.ok ? await ur.json() : null; // the access token is not kept
    if (!u || !HANDLE_RE.test(String(u.login || '')) || !Number.isInteger(u.id)) throw new HttpError(502, 'could not read the GitHub account');
    const gh = { login: u.login, id: u.id, avatar: /^https:\/\/avatars\.githubusercontent\.com\//.test(u.avatar_url || '') ? String(u.avatar_url).slice(0, 200) : '', at: now };
    const indexKey = `gh:${u.login.toLowerCase()}`;
    let key = st.member || (await this.store.get(indexKey)) || `member:gh:${u.id}`;
    const m = (await this.store.get(key)) || { email: '', name: u.login, roles: [], interests: [], country: '', consent: false, joined: now, sponsor: false, profile: null };
    const old = m.github && m.github.login && m.github.login.toLowerCase() !== u.login.toLowerCase() ? m.github.login.toLowerCase() : null;
    m.github = gh;
    m.updated = now;
    await this.store.put(key, m);
    if (old) await this.store.delete(`gh:${old}`);
    await this.store.put(indexKey, key);
    const session = this.newId().replace(/-/g, '') + this.newId().replace(/-/g, '');
    await this.store.put(`ss:${session}`, { member: key, login: u.login, exp: now + SESSION_TTL });
    return { status: 302, body: null, headers: { Location: `${this.site}/me.html#s=${session}` } };
  }

  async sessionOf(now, auth) {
    const m = /^Bearer ([a-f0-9]{16,80})$/.exec(typeof auth === 'string' ? auth : '');
    const s = m ? await this.store.get(`ss:${m[1]}`) : null;
    if (!s || s.exp < now) throw new HttpError(401, 'not signed in');
    const member = await this.store.get(s.member);
    if (!member || !member.github) throw new HttpError(401, 'not signed in');
    return { s, member, key: s.member };
  }

  async me(now, auth) {
    const { member } = await this.sessionOf(now, auth);
    return { status: 200, body: { login: member.github.login, avatar: member.github.avatar, member_since: iso(member.joined).slice(0, 10), profile: member.profile || {} } };
  }

  async saveProfile(now, body, auth) {
    const { member, key } = await this.sessionOf(now, auth);
    let d;
    try { d = JSON.parse(body || ''); } catch (e) { throw new HttpError(400, 'send a JSON object'); }
    const r = checkMemberProfile(d);
    if (!r.ok) throw new HttpError(400, r.why);
    member.profile = r.profile;
    member.updated = now;
    await this.store.put(key, member);
    return { status: 200, body: { ok: true, profile: r.profile } };
  }

  async publicProfiles() {
    const out = {};
    for (const [, m] of await this.store.list('member:')) {
      if (!m || !m.github) continue;
      out[m.github.login] = { ...(m.profile || {}), member_since: iso(m.joined).slice(0, 10) };
    }
    return { status: 200, body: { profiles: out } };
  }

  // ---- sponsor pledges ------------------------------------------------------
  // Pledges are stored under pledge:<sha256 of the lowercased email>. The email is kept only inside
  // that record (so the owner can send the payment link) and never appears in any public answer.

  async pledgeKey(email) {
    const bytes = new TextEncoder().encode(email.toLowerCase());
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return 'pledge:' + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  checkPledgeIp(ip, now) {
    const hits = (this.pledgeHits.get(ip) || []).filter((t) => now - t < HOUR);
    if (hits.length >= PLEDGE_IP_LIMIT) {
      this.pledgeHits.set(ip, hits);
      throw new HttpError(429, `at most ${PLEDGE_IP_LIMIT} pledges per hour from one address`, {
        retry_after_s: Math.ceil((hits[0] + HOUR - now) / 1000),
      });
    }
    hits.push(now);
    this.pledgeHits.set(ip, hits);
    if (this.pledgeHits.size > 5000) {
      for (const [k, v] of this.pledgeHits) if (!v.length || now - v[v.length - 1] >= HOUR) this.pledgeHits.delete(k);
    }
  }

  async pledge(now, body, ip) {
    let d;
    try {
      d = JSON.parse(body || '');
    } catch (e) {
      throw new HttpError(400, 'send a JSON object');
    }
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new HttpError(400, 'send a JSON object');
    const name = cleanText(d.name, NAME_MAX);
    const tagline = cleanText(d.tagline, TAGLINE_MAX);
    const link = typeof d.link === 'string' ? d.link.trim() : '';
    const email = typeof d.email === 'string' ? d.email.trim() : '';
    const amount = Number(d.amount);
    if (!name) throw new HttpError(400, `name must be 1-${NAME_MAX} characters`);
    if (d.tagline != null && typeof d.tagline !== 'string') throw new HttpError(400, 'tagline must be text');
    if (tagline === null) throw new HttpError(400, `tagline must be at most ${TAGLINE_MAX} characters`);
    if (link && (link.length > LINK_MAX || !LINK_RE.test(link))) throw new HttpError(400, 'link must be an https:// address');
    if (email.length > EMAIL_MAX || !EMAIL_RE.test(email)) throw new HttpError(400, 'email must be a valid address');
    if (!Number.isFinite(amount) || amount < PLEDGE_MIN || amount > PLEDGE_MAX || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6)
      throw new HttpError(400, `amount must be US$${PLEDGE_MIN} to US$${PLEDGE_MAX}, in dollars and cents`);
    this.checkPledgeIp(ip || 'local', now);

    const key = await this.pledgeKey(email);
    let p = await this.store.get(key);
    if (!p) {
      const count = (await this.store.list('pledge:')).length;
      if (count >= MAX_PLEDGERS) throw new HttpError(503, 'the pledge list is full; try again later');
      const n = ((await this.store.get('pledge-seq')) || 0) + 1;
      await this.store.put('pledge-seq', n);
      p = { n, email, name, tagline: '', link: '', pledged_cents: 0, paid_cents: 0, first: now, last: now, hidden: false };
    }
    const cents = Math.round(amount * 100);
    if (p.pledged_cents + cents > TOTAL_MAX * 100) throw new HttpError(400, `the total per email is at most US$${TOTAL_MAX}`);
    p.pledged_cents += cents;
    p.email = email;
    p.name = name;
    if (tagline) p.tagline = tagline;
    if (link) p.link = link;
    p.last = now;
    await this.store.put(key, p);
    const mk = key.replace(/^pledge:/, 'member:');
    const member = await this.store.get(mk);
    if (member && !member.sponsor) { member.sponsor = true; member.updated = now; await this.store.put(mk, member); }
    return { status: 200, body: { ok: true, amount: cents / 100, total_pledged: p.pledged_cents / 100, member: !!member } };
  }

  async sponsors() {
    const all = (await this.store.list('pledge:')).map(([, p]) => p).filter((p) => p && !p.hidden);
    const total = (p) => Math.max(p.pledged_cents, p.paid_cents);
    all.sort((a, b) => total(b) - total(a) || a.first - b.first || a.n - b.n);
    return {
      status: 200,
      body: {
        sponsors: all.slice(0, 500).map((p, i) => ({
          rank: i + 1,
          name: p.name,
          tagline: p.tagline,
          link: p.link,
          pledged: total(p) / 100,
          paid: p.paid_cents / 100,
          since: iso(p.first).slice(0, 10),
        })),
      },
    };
  }

  // ---- owner-only admin (bearer token from the ADMIN_TOKEN Worker secret) ---

  checkAdmin(auth) {
    if (!this.adminToken) throw new HttpError(404, 'not found');
    const want = `Bearer ${this.adminToken}`;
    const got = typeof auth === 'string' ? auth : '';
    let diff = got.length ^ want.length;
    for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (got.charCodeAt(i) || 0);
    if (diff !== 0) throw new HttpError(401, 'unauthorized');
  }

  async admin(now, route, body, auth) {
    this.checkAdmin(auth);
    if (route === 'admin-list') {
      const all = (await this.store.list('pledge:')).map(([, p]) => p);
      all.sort((a, b) => a.n - b.n);
      return { status: 200, body: { pledges: all.map((p) => ({ ...p, first: iso(p.first), last: iso(p.last) })) } };
    }
    let d;
    try {
      d = JSON.parse(body || '');
    } catch (e) {
      throw new HttpError(400, 'send a JSON object');
    }
    const email = d && typeof d.email === 'string' ? d.email.trim() : '';
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'email must be a valid address');
    const key = await this.pledgeKey(email);
    const p = await this.store.get(key);
    if (!p) throw new HttpError(404, 'no pledge for that email');
    if (route === 'admin-paid') {
      const amount = Number(d.amount);
      if (!Number.isFinite(amount) || amount <= 0 || amount > TOTAL_MAX || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6)
        throw new HttpError(400, 'amount must be a positive number of dollars and cents');
      p.paid_cents += Math.round(amount * 100);
    } else if (route === 'admin-hide') {
      p.hidden = d.hidden !== false;
    }
    p.last = now;
    await this.store.put(key, p);
    return { status: 200, body: { ok: true, n: p.n, pledged: p.pledged_cents / 100, paid: p.paid_cents / 100, hidden: p.hidden } };
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
    if (role === 'redteam' || role === 'think') {
      // Thinkers split open statements that are not split yet; red-team agents try to refute statements.
      // Both may share a task. Prefer what builders handed back as too big (think) or as doubtful (redteam).
      const signal = role === 'think' ? 'missing_lemma' : 'statement_seems_false';
      const kinds = role === 'think' ? ['program', 'milestone', 'step'] : ['step', 'milestone', 'program'];
      const split = new Set(feed.filter((r) => r.kind === 'step').map((r) => r.parent));
      const pool = feed
        .filter((r) => kinds.includes(r.kind) && usable(r) && !(role === 'think' && split.has(r.id)))
        .sort((a, b) => releases(b.id, signal) - releases(a.id, signal) ||
          (role === 'think' ? (Number(a.notes) || 0) - (Number(b.notes) || 0) : 0) || fewestHolders(a, b) ||
          kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || a.difficulty - b.difficulty || cmp(a.id, b.id));
      pick = pool[0];
    } else if (hard || !feed.some((r) => (r.kind === 'drop' || r.kind === 'step') && r.status === 'open')) {
      // hard=1, or the board has no open steps at all: share the open problems themselves.
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

  gap(rec, lemmas, events, role = 'build') {
    const name = rec.statement;
    const file = role === 'redteam' ? `Refute_${name}` : name;
    if (role === 'think') {
      const history = {};
      for (const e of events) if (e.task === rec.id && e.reason) history[e.reason] = (history[e.reason] || 0) + 1;
      const notes = Number(rec.notes) || 0;
      const statement = typeof rec.lean === 'string' ? rec.lean : lemmas.get(name);
      if (notes < NOTE_TASK_BELOW) {
        // Few or no research notes yet: a note task. No Lean needed.
        return {
          kind: 'note',
          note_file: `notes/${rec.id}/<your GitHub login>-<slug>.md`,
          help: 'Write a research note on this statement: see "Your first contribution" in agent.md.',
          role, id: rec.id, record_kind: rec.kind, title_en: rec.title_en, title_zh: rec.title_zh,
          statement_name: name, statement, notes, history,
        };
      }
      return {
        kind: 'split',
        file: `OpenConjecture/Collatz/Proposals/Split_${name}.lean`,
        namespace: `OpenConjecture.Collatz.Proposals.Split_${name}`,
        steps: 'OpenConjecture/Collatz/Proposals/Step_<Name>.lean, one per step (1 to 4)',
        record: 'records/collatz/<new step id>.json, one per step',
        help: 'Split this statement: see "Thinker: split a statement" in agent.md.',
        role, id: rec.id, record_kind: rec.kind, hard: isHard(rec), title_en: rec.title_en, title_zh: rec.title_zh,
        difficulty: rec.difficulty, statement_name: name, statement, notes, history,
      };
    }
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
  if (method === 'POST' && pathname === '/desk/hit') return 'hit';
  if (method === 'POST' && pathname === '/desk/join') return 'join';
  if (method === 'GET' && pathname === '/desk/admin/members') return 'admin-members';
  if (method === 'GET' && pathname === '/desk/auth/status') return 'auth-status';
  if (method === 'GET' && pathname === '/desk/auth/github/start') return 'gh-start';
  if (method === 'GET' && pathname === '/desk/auth/github/callback') return 'gh-callback';
  if (method === 'GET' && pathname === '/desk/me') return 'me';
  if (method === 'POST' && pathname === '/desk/me/profile') return 'me-profile';
  if (method === 'GET' && pathname === '/desk/profiles') return 'profiles';
  if (method === 'POST' && pathname === '/desk/vote') return 'vote';
  if (method === 'GET' && pathname === '/desk/votes') return 'votes';
  if (method === 'GET' && pathname === '/desk/admin/stats') return 'admin-stats';
  if (method === 'POST' && pathname === '/desk/pledge') return 'pledge';
  if (method === 'GET' && pathname === '/desk/sponsors') return 'sponsors';
  if (method === 'POST' && pathname === '/desk/admin/mark-paid') return 'admin-paid';
  if (method === 'POST' && pathname === '/desk/admin/hide') return 'admin-hide';
  if (method === 'POST' && pathname === '/desk/admin/list') return 'admin-list';
  if (method === 'GET' && pathname.startsWith(TASK_PREFIX) && pathname.length > TASK_PREFIX.length) return 'task';
  return null;
}
