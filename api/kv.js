// Tiny Firebase-Realtime-Database-style JSON store for the המרדנים online duel.
// Supports GET / PUT / PATCH / DELETE on /api/kv/<path>.json (rewritten to ?path=...).
import { redis, limit } from '../lib/core.js';

const ROOTS = new Set(['arena']);
const MAX_BYTES = 200_000;

function parsePath(raw) {
  const p = String(raw || '').replace(/\.json$/, '').split('/').filter(Boolean);
  if (!p.length || !ROOTS.has(p[0]) || p.length > 8 || p.some(s => !/^[A-Za-z0-9_-]{1,64}$/.test(s))) return null;
  return p;
}
const getAt = (o, p) => p.reduce((x, k) => (x && typeof x === 'object') ? x[k] : undefined, o);
function setAt(root, p, val) {
  if (!p.length) return val;
  root = (root && typeof root === 'object') ? root : {};
  let x = root;
  for (let i = 0; i < p.length - 1; i++) { if (!x[p[i]] || typeof x[p[i]] !== 'object') x[p[i]] = {}; x = x[p[i]]; }
  if (val === null || val === undefined) delete x[p[p.length - 1]]; else x[p[p.length - 1]] = val;
  return root;
}
const stripNulls = (v) => { if (v && typeof v === 'object' && !Array.isArray(v)) { for (const k of Object.keys(v)) { if (v[k] === null) delete v[k]; else stripNulls(v[k]); } } return v; };

async function withLock(key, fn) {
  const lk = 'lock:' + key;
  for (let i = 0; i < 40; i++) {
    if (await redis('SET', lk, '1', 'NX', 'EX', 3)) {
      try { return await fn(); } finally { await redis('DEL', lk).catch(() => { }); }
    }
    await new Promise(r => setTimeout(r, 60));
  }
  return fn();
}

export default async function handler(req, res) {
  try {
    const p = parsePath(req.query.path);
    if (!p) return res.status(400).json({ error: 'bad path' });
    const key = 'kv:' + p[0];
    const sub = p.slice(1);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') {
      await limit(req, 'kvr', 2000, 600);
      const raw = await redis('GET', key);
      const v = getAt(raw ? JSON.parse(raw) : null, sub);
      return res.status(200).json(v === undefined ? null : v);
    }
    await limit(req, 'kvw', 800, 600);
    let body = req.body;
    if (typeof body === 'string') body = body ? JSON.parse(body) : null;
    if (JSON.stringify(body ?? null).length > 20_000) return res.status(413).json({ error: 'too big' });
    const out = await withLock(key, async () => {
      const raw = await redis('GET', key);
      let root = raw ? JSON.parse(raw) : null;
      if (req.method === 'PUT') root = setAt(root, sub, stripNulls(body));
      else if (req.method === 'DELETE') root = setAt(root, sub, null);
      else if (req.method === 'PATCH') {
        const cur = getAt(root, sub);
        const merged = Object.assign({}, (cur && typeof cur === 'object') ? cur : {});
        for (const [k, v] of Object.entries(body || {})) { if (v === null) delete merged[k]; else merged[k] = v; }
        root = setAt(root, sub, merged);
      } else return { status: 405 };
      const s = JSON.stringify(root ?? {});
      if (s.length > MAX_BYTES) return { status: 413 };
      await redis('SET', key, s, 'EX', 86400);
      return { status: 200, value: req.method === 'DELETE' ? null : body };
    });
    return res.status(out.status).json(out.value ?? null);
  } catch (e) {
    console.error('kv', e);
    return res.status(500).json({ error: 'server' });
  }
}
