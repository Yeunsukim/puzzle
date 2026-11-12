// 회원: 이메일 가입·로그인, 구글 로그인, 로그아웃, 내 정보
import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { db, ah } from './db.js';

export const googleClientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
const googleClient = googleClientId ? new OAuth2Client(googleClientId) : null;

export const AVATARS = ['bunny', 'cat', 'bear', 'chick', 'fox', 'penguin'];
const SESSION_DAYS = 60;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return salt.toString('hex') + ':' + h.toString('hex');
}
function checkPassword(pw, stored) {
  if (!stored) return false;
  const [salt, h] = stored.split(':');
  const test = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  const real = Buffer.from(h, 'hex');
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}

export function parseCookies(str = '') {
  const out = {};
  for (const part of String(str).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* 무시 */ }
  }
  return out;
}

export async function userFromCookie(cookieHeader) {
  const sid = parseCookies(cookieHeader).sid;
  if (!sid) return null;
  const row = await db.get('SELECT u.*, s.created AS s_created FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?', sid);
  if (!row) return null;
  if (Date.now() - row.s_created > SESSION_DAYS * 864e5) {
    await db.run('DELETE FROM sessions WHERE token = ?', sid);
    return null;
  }
  return row;
}

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, nick: u.nick, avatar: u.avatar, setup: !!u.setup, google: !!u.google_id, hasPassword: !!u.pass };
}

async function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.run('INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)', token, userId, Date.now());
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}

const getUser = id => db.get('SELECT * FROM users WHERE id = ?', id);
const emailOk = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 120;
const fail = (res, msg, code = 400) => res.status(code).json({ error: msg });

export function requireUser(req, res, next) {
  if (!req.user) return fail(res, '로그인이 필요해요.', 401);
  next();
}

export function authRoutes(app) {
  app.get('/api/me', (req, res) => res.json({ user: publicUser(req.user) }));

  app.post('/api/signup', ah(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const nick = String(req.body?.nick || '').trim().slice(0, 12);
    if (!emailOk(email)) return fail(res, '이메일 주소를 다시 확인해 주세요.');
    if (password.length < 6) return fail(res, '비밀번호는 6글자 이상으로 해 주세요.');
    if (!nick) return fail(res, '별명을 적어 주세요.');
    const exist = await db.get('SELECT id, pass FROM users WHERE email = ?', email);
    if (exist) {
      return fail(res, exist.pass ? '이미 가입된 이메일이에요. 로그인해 주세요.' : '이 이메일은 구글로 가입되어 있어요. "Google로 로그인"을 눌러 주세요.');
    }
    const r = await db.get('INSERT INTO users (email, pass, nick, created) VALUES (?, ?, ?, ?) RETURNING id', email, hashPassword(password), nick, Date.now());
    await startSession(req, res, r.id);
    res.json({ user: publicUser(await getUser(r.id)) });
  }));

  app.post('/api/login', ah(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const u = await db.get('SELECT * FROM users WHERE email = ?', email);
    if (u && !u.pass) return fail(res, '이 이메일은 구글로 가입되어 있어요. "Google로 로그인"을 눌러 주세요.');
    if (!u || !checkPassword(password, u.pass)) return fail(res, '이메일 또는 비밀번호가 맞지 않아요.');
    await startSession(req, res, u.id);
    res.json({ user: publicUser(u) });
  }));

  app.post('/api/google', ah(async (req, res) => {
    if (!googleClient) return fail(res, '구글 로그인이 아직 준비되지 않았어요.');
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: String(req.body?.credential || ''), audience: googleClientId });
      payload = ticket.getPayload();
    } catch {
      return fail(res, '구글 로그인 확인에 실패했어요. 다시 눌러 주세요.');
    }
    if (!payload?.email || !payload.email_verified) return fail(res, '확인된 구글 이메일이 없어요.');
    const email = payload.email.toLowerCase();
    let u = await db.get('SELECT * FROM users WHERE google_id = ? OR email = ?', payload.sub, email);
    if (u) {
      if (!u.google_id) await db.run('UPDATE users SET google_id = ? WHERE id = ?', payload.sub, u.id);
    } else {
      const nick = String(payload.given_name || payload.name || email.split('@')[0]).slice(0, 12);
      u = await db.get('INSERT INTO users (email, google_id, nick, created) VALUES (?, ?, ?, ?) RETURNING id', email, payload.sub, nick, Date.now());
    }
    await startSession(req, res, u.id);
    res.json({ user: publicUser(await getUser(u.id)) });
  }));

  app.post('/api/logout', ah(async (req, res) => {
    const sid = parseCookies(req.headers.cookie).sid;
    if (sid) await db.run('DELETE FROM sessions WHERE token = ?', sid);
    res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
    res.json({ ok: true });
  }));

  app.post('/api/profile', requireUser, ah(async (req, res) => {
    const nick = String(req.body?.nick || '').trim().slice(0, 12);
    const avatar = String(req.body?.avatar || '');
    if (!nick) return fail(res, '별명을 적어 주세요.');
    if (!AVATARS.includes(avatar)) return fail(res, '캐릭터를 골라 주세요.');
    await db.run('UPDATE users SET nick = ?, avatar = ?, setup = 1 WHERE id = ?', nick, avatar, req.user.id);
    res.json({ user: publicUser(await getUser(req.user.id)) });
  }));
}
