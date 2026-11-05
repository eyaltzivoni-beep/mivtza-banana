// Shared server helpers: Redis (Upstash REST), Claude API, auth, rate limits.
import crypto from 'node:crypto';

/* ---------------- Redis ---------------- */
const RURL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const RTOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

let memory = null; // in-memory fallback for local tests (MOCK=1)
export function useMemoryRedis() { memory = new Map(); }

export async function redis(...cmd) {
  if (memory || process.env.MOCK === '1') { if (!memory) memory = new Map(); return memRedis(cmd); }
  if (!RURL || !RTOK) throw httpError(500, 'מסד הנתונים לא מחובר. חברו Upstash Redis לפרויקט ב-Vercel.');
  const r = await fetch(RURL, { method: 'POST', headers: { Authorization: `Bearer ${RTOK}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd.map(String)) });
  const j = await r.json();
  if (j.error) throw new Error('redis: ' + j.error);
  return j.result;
}

function memRedis([op, key, ...a]) {
  const m = memory; op = op.toUpperCase();
  const get = (t) => { let v = m.get(key); if (v && v.exp && v.exp < Date.now()) { m.delete(key); v = null; } if (!v) { v = { t, val: t === 'hash' ? new Map() : t === 'list' ? [] : t === 'set' ? new Set() : null }; } return v; };
  switch (op) {
    case 'GET': { const v = get('str'); return v.val ?? null; }
    case 'SET': { const v = { t: 'str', val: a[0] }; const ei = a.indexOf('EX'); if (ei > 0) v.exp = Date.now() + a[ei + 1] * 1000; if (a.includes('NX') && m.has(key) && !(m.get(key).exp < Date.now())) return null; m.set(key, v); return 'OK'; }
    case 'INCR': { const v = get('str'); v.val = String((+v.val || 0) + 1); m.set(key, v); return +v.val; }
    case 'EXPIRE': { const v = m.get(key); if (v) v.exp = Date.now() + a[0] * 1000; return 1; }
    case 'DEL': return m.delete(key) ? 1 : 0;
    case 'EXISTS': return m.has(key) ? 1 : 0;
    case 'HSET': { const v = get('hash'); for (let i = 0; i < a.length; i += 2) v.val.set(a[i], a[i + 1]); m.set(key, v); return 1; }
    case 'HSETNX': { const v = get('hash'); if (v.val.has(a[0])) return 0; v.val.set(a[0], a[1]); m.set(key, v); return 1; }
    case 'HGET': { const v = get('hash'); return v.val.get(a[0]) ?? null; }
    case 'HGETALL': { const v = get('hash'); return [...v.val].flat(); }
    case 'LPUSH': { const v = get('list'); v.val.unshift(...a.reverse()); m.set(key, v); return v.val.length; }
    case 'LTRIM': { const v = get('list'); v.val = v.val.slice(+a[0], +a[1] + 1); m.set(key, v); return 'OK'; }
    case 'LRANGE': { const v = get('list'); return v.val.slice(+a[0], +a[1] === -1 ? undefined : +a[1] + 1); }
    case 'LSET': { const v = get('list'); v.val[+a[0]] = a[1]; return 'OK'; }
    case 'SADD': { const v = get('set'); a.forEach(x => v.val.add(x)); m.set(key, v); return 1; }
    case 'SMEMBERS': { const v = get('set'); return [...v.val]; }
    default: throw new Error('mem redis: ' + op);
  }
}
export const hashToObj = (arr) => { const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1]; return o; };

/* ---------------- Claude ---------------- */
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';

export async function claude({ system, prompt, image, messages, maxTokens = 600, model }) {
  if (process.env.MOCK === '1') return mockClaude(prompt || JSON.stringify(messages), image);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw httpError(500, 'מפתח ה-AI חסר. הוסיפו ANTHROPIC_API_KEY בהגדרות הפרויקט ב-Vercel.');
  if (!messages) {
    const content = [];
    if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.type, data: image.data } });
    content.push({ type: 'text', text: prompt });
    messages = [{ role: 'user', content }];
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: model || MODEL, max_tokens: maxTokens, system, messages })
  });
  const j = await r.json();
  if (!r.ok) { console.error('claude error', j); throw httpError(502, 'ה-AI לא זמין כרגע. נסו שוב עוד רגע.'); }
  return (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

export async function claudeJSON(opts) {
  const text = await claude(opts);
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw httpError(502, 'ה-AI החזיר תשובה לא תקינה. נסו שוב.');
  try { return JSON.parse(m[0]); } catch { throw httpError(502, 'ה-AI החזיר תשובה לא תקינה. נסו שוב.'); }
}

function mockClaude(prompt, image) {
  if (prompt.includes('MISSION')) return JSON.stringify({ mission: 'תגידו בננה שלוש פעמים בלי שישימו לב', decoys: ['תמחאו כפיים פעמיים', 'תלבשו גרב אחת הפוך', 'תציירו פרצוף על אגודל'] });
  if (prompt.includes('TRANSLATE')) return prompt.includes('אסור') ? JSON.stringify({ blocked: true }) : JSON.stringify({ blocked: false, dramatic: 'הו, רעב אני כמו מלך בגלות!', decoys: ['אין לי כוח לקום', 'בא לי פיצה', 'משעמם לי'] });
  if (prompt.includes('"technique"')) return '{"technique":"היפוך מהיר","explanation":"לוקחים את העלבון ומחזירים אותו הפוך.","example":"דוגמה מדומה","tip":"קצר וחד"}';
  if (prompt.includes('JUDGE')) return JSON.stringify({ safe: true, verdict: 'השופט מרשים: ביצוע אמנותי מושלם!' });
  return '{}';
}

/* ---------------- Safety ---------------- */
export const SYSTEM = `אתה מנוע המשחק "מבצע בננה", אפליקציה חברתית לבני נוער בישראל (גילאי 10-18). כל תוכן שאתה יוצר חייב להיות מתאים לילדים: בלי קללות, בלי תוכן מיני, בלי אלימות, בלי אוכל לא בטוח, בלי סכנה, בלי הצקה או השפלה של אדם אחר, בלי פגיעה בפרטיות, ובלי הפרעה למורים או לשיעור. אתה מחזיר JSON בלבד, בלי טקסט נוסף.`;

const BAD = /(זונה|שרמוט|כוס[ ]?אמ|זין|מזדיין|לזיין|נאצי|להתאבד|תתאבד|fuck|shit|bitch|nigg|porn)/i;
export const isBadText = (t) => BAD.test(String(t || ''));
export const clean = (t, n) => String(t || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);

/* ---------------- Auth & limits ---------------- */
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export async function auth(body) {
  const uid = String(body.uid || ''), secret = String(body.secret || '');
  if (!/^[a-z0-9]{12,40}$/.test(uid) || secret.length < 16) throw httpError(401, 'זיהוי לא תקין. רעננו את הדף.');
  const h = sha(secret);
  const set = await redis('HSETNX', 'users', uid, h);
  if (!set) { const cur = await redis('HGET', 'users', uid); if (cur !== h) throw httpError(401, 'זיהוי לא תקין. רעננו את הדף.'); }
  return uid;
}

export async function limit(req, bucket, max, seconds) {
  const ip = String(req.headers['x-forwarded-for'] || 'local').split(',')[0].trim();
  const k = `rl:${bucket}:${sha(ip).slice(0, 16)}:${Math.floor(Date.now() / 1000 / seconds)}`;
  const n = await redis('INCR', k);
  if (n === 1) await redis('EXPIRE', k, seconds + 5);
  if (n > max) throw httpError(429, 'יותר מדי בקשות. נסו שוב מאוחר יותר.');
}
export async function aiQuota(req) {
  await limit(req, 'ai-min', 8, 60);
  await limit(req, 'ai-day', +(process.env.AI_DAILY_LIMIT || 60), 86400);
  const g = await redis('INCR', 'ai-global:' + dayKey());
  if (g === 1) await redis('EXPIRE', 'ai-global:' + dayKey(), 172800);
  if (g > +(process.env.AI_GLOBAL_DAILY_LIMIT || 3000)) throw httpError(429, 'הגענו למכסת ה-AI היומית של האתר. נסו מחר.');
}

/* ---------------- misc ---------------- */
export function httpError(status, message) { const e = new Error(message); e.status = status; return e; }
export function dayKey(d = new Date()) {
  // Israel time
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return s;
}
export const dayNum = (k) => Math.round(new Date(k + 'T12:00:00Z').getTime() / 864e5);
export const rid = (n = 10) => crypto.randomBytes(16).toString('hex').slice(0, n);
export const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const validCode = (c) => /^[A-Z]{5}$/.test(String(c || ''));

export const STYLES = {
  shakespeare: 'שייקספיר: דרמה מלכותית עתיקה', news: 'מבזק חדשות: כתבת דחופה מהשטח', savta: 'סבתא מרוקאית: חום, דאגה ואוכל',
  robot: 'רובוט: מערכת. מזהה. רגש.', sport: 'שדר כדורגל נלהב', anime: 'גיבור אנימה: כוח הידידות!!!',
  nature: 'קריין סרט טבע שקט מהסוואנה', villain: 'נבל קולנועי עם צחוק מרושע ותוכנית'
};
export const STYLE_IDS = Object.keys(STYLES);
export const dailyStyle = () => STYLE_IDS[dayNum(dayKey()) % STYLE_IDS.length];
