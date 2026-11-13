// 서버 시작: 웹페이지 보내기 + 회원/퍼즐/기록 API + 실시간 같이하기
import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Server } from 'socket.io';
import { db, ah, ROOT, UPLOAD_DIR } from './db.js';
import { authRoutes, requireUser, userFromCookie, googleClientId } from './auth.js';
import { createRoom, roomInfo, progressInfo, attachSockets, saveAll } from './rooms.js';
import { socialRoutes, attachSocial } from './social.js';
import { rankingRoutes } from './ranking.js';

const PORT = Number(process.env.PORT) || 3000;
// 인터넷 주소: 직접 적은 것(PUBLIC_URL) → Render가 알려 주는 주소 → 없으면 같은 와이파이 주소를 쓴다
const publicUrl = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render 같은 인터넷 서버 앞단을 믿고 https 여부를 알기
app.use(express.json({ limit: '16mb' }));
app.use(ah(async (req, _res, next) => { req.user = await userFromCookie(req.headers.cookie); next(); }));

// 같은 와이파이의 다른 기기가 들어올 수 있는 주소들
function lanUrls() {
  if (publicUrl) return [];
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(`http://${a.address}:${PORT}`);
    }
  }
  return out;
}

authRoutes(app);
socialRoutes(app);
rankingRoutes(app);

// 음성 대화 연결을 도와주는 서버 주소 (STUN: 무료 공개 서버. TURN: 직접 연결이 막힐 때 쓰는 중계 서버, 있을 때만)
// 중계 서버 설정 방법: 음성대화_중계서버_설정방법.md
//  - ExpressTURN 등 고정 아이디: TURN_URL / TURN_USER / TURN_PASS
//  - Metered: METERED_APP(앱 이름) / METERED_API_KEY (임시 아이디를 받아 온다)
const baseIce = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
if (process.env.TURN_URL) {
  const urls = [];
  for (const u of process.env.TURN_URL.split(',').map(x => x.trim()).filter(Boolean)) {
    const full = /^turns?:/.test(u) ? u : 'turn:' + u; // 'relay1.expressturn.com:3478' 처럼 앞부분 없이 넣어도 되게
    urls.push(full);
    // 회사·학교처럼 UDP가 막힌 곳을 위해 TCP 방식도 함께 시도
    if (!/transport=/.test(full) && full.startsWith('turn:')) urls.push(full + (full.includes('?') ? '&' : '?') + 'transport=tcp');
  }
  baseIce.push({ urls, username: (process.env.TURN_USER || '').trim(), credential: (process.env.TURN_PASS || '').trim() });
}
let meteredCache = { at: 0, list: null };
async function getIceServers() {
  const app = (process.env.METERED_APP || '').trim(), key = (process.env.METERED_API_KEY || '').trim();
  if (!app || !key) return baseIce;
  if (meteredCache.list && Date.now() - meteredCache.at < 30 * 60e3) return [...baseIce, ...meteredCache.list];
  try {
    const host = app.includes('.') ? app : app + '.metered.live';
    const r = await fetch(`https://${host}/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`);
    const list = await r.json();
    if (Array.isArray(list)) meteredCache = { at: Date.now(), list };
  } catch (err) { console.error('중계 서버 아이디를 받아 오지 못했어요:', err.message); }
  return [...baseIce, ...(meteredCache.list || [])];
}
const hasTurn = () => !!(process.env.TURN_URL || (process.env.METERED_APP && process.env.METERED_API_KEY));
app.get('/api/config', ah(async (_req, res) => res.json({ googleClientId, lanUrls: lanUrls(), publicUrl, iceServers: await getIceServers(), turn: hasTurn() })));

// ---- 퍼즐 그림 ----
app.get('/api/pictures', requireUser, ah(async (req, res) => {
  const rows = await db.all(`SELECT id, title, url, w, h, sample, category FROM pictures WHERE sample = 1 OR owner_id = ?
    ORDER BY CASE category WHEN 'art' THEN 0 WHEN 'kids' THEN 1 ELSE 2 END, CASE WHEN sample = 1 THEN id ELSE -id END`, req.user.id);
  res.json({ pictures: rows.map(r => ({ id: r.id, title: r.title, url: r.url, w: r.w, h: r.h, sample: !!r.sample, category: r.sample ? r.category : 'mine' })) });
}));

// 올린 사진은 데이터베이스에 보관한다 (인터넷 서버는 다시 켜지면 파일이 지워지므로)
app.post('/api/pictures', requireUser, ah(async (req, res) => {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body?.dataUrl || ''));
  if (!m) return res.status(400).json({ error: '사진을 읽을 수 없어요. 다른 사진을 골라 주세요.' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 12e6) return res.status(400).json({ error: '사진이 너무 커요.' });
  const w = Math.round(Number(req.body.w)), h = Math.round(Number(req.body.h));
  if (!(w >= 64 && h >= 64 && w <= 6000 && h <= 6000)) return res.status(400).json({ error: '사진 크기를 알 수 없어요.' });
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
  await db.run('INSERT INTO images (name, mime, data, created) VALUES (?, ?, ?, ?)', name, 'image/' + m[1], buf, Date.now());
  const title = String(req.body.title || '').trim().slice(0, 30) || '나의 퍼즐';
  const url = '/uploads/' + name;
  const exhibit = req.body.exhibit === false ? 0 : 1; // 갤러리·랭킹에 전시할지 (사진 올릴 때 고름)
  const r = await db.get('INSERT INTO pictures (owner_id, title, url, w, h, sample, category, exhibit, created) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?) RETURNING id',
    req.user.id, title, url, w, h, 'mine', exhibit, Date.now());
  res.json({ picture: { id: r.id, title, url, w, h, sample: false, category: 'mine', exhibit: !!exhibit } });
}));

// 내가 올린 사진의 갤러리·랭킹 전시 켜기/끄기 (사진을 올린 사람만)
app.post('/api/pictures/:id/exhibit', requireUser, ah(async (req, res) => {
  const pic = await db.get('SELECT id FROM pictures WHERE id = ? AND owner_id = ? AND sample = 0', Number(req.params.id), req.user.id);
  if (!pic) return res.status(404).json({ error: '내가 올린 사진만 바꿀 수 있어요.' });
  const on = req.body?.on ? 1 : 0;
  await db.run('UPDATE pictures SET exhibit = ? WHERE id = ?', on, pic.id);
  res.json({ ok: true, exhibit: !!on });
}));

app.get('/api/stats', requireUser, ah(async (req, res) => {
  const r = await db.get('SELECT COUNT(*) AS done, COALESCE(SUM(placed), 0) AS placed, COALESCE(SUM(seconds), 0) AS seconds FROM records WHERE user_id = ?', req.user.id);
  res.json({ done: Number(r.done), placed: Number(r.placed), seconds: Number(r.seconds) });
}));

// ---- 게임방 ----
app.post('/api/rooms', requireUser, ah(async (req, res) => {
  const pic = await db.get('SELECT * FROM pictures WHERE id = ? AND (sample = 1 OR owner_id = ?)', Number(req.body?.pictureId), req.user.id);
  if (!pic) return res.status(404).json({ error: '그림을 찾을 수 없어요.' });
  const cols = Math.round(Number(req.body.cols)), rows = Math.round(Number(req.body.rows));
  if (!(cols >= 2 && rows >= 2 && cols <= 60 && rows <= 60 && cols * rows <= 1100)) {
    return res.status(400).json({ error: '조각 수가 알맞지 않아요.' });
  }
  res.json({ code: await createRoom(pic, cols, rows, req.user.id) });
}));

app.get('/api/rooms/:code', requireUser, ah(async (req, res) => {
  const info = await roomInfo(req.params.code);
  if (!info) return res.status(404).json({ error: '그런 방이 없어요. 방 번호를 다시 확인해 주세요.' });
  res.json({ room: info });
}));

// ---- 하던 퍼즐 (보관함) ----
app.get('/api/saved', requireUser, ah(async (req, res) => {
  const rows = await db.all('SELECT room_code, saved_at FROM saved_games WHERE user_id = ? ORDER BY saved_at DESC LIMIT 30', req.user.id);
  const games = [];
  for (const r of rows) {
    const info = await progressInfo(r.room_code);
    if (!info || info.finished) { await db.run('DELETE FROM saved_games WHERE user_id = ? AND room_code = ?', req.user.id, r.room_code); continue; }
    games.push({ ...info, savedAt: r.saved_at });
  }
  res.json({ games });
}));

app.post('/api/saved/keep', requireUser, ah(async (req, res) => {
  const code = String(req.body?.code || '').toUpperCase();
  if (!(await roomInfo(code))) return res.status(404).json({ error: '방을 찾을 수 없어요.' });
  await db.run('INSERT INTO saved_games (user_id, room_code, saved_at) VALUES (?, ?, ?) ON CONFLICT (user_id, room_code) DO UPDATE SET saved_at = excluded.saved_at',
    req.user.id, code, Date.now());
  res.json({ ok: true });
}));

app.post('/api/saved/remove', requireUser, ah(async (req, res) => {
  await db.run('DELETE FROM saved_games WHERE user_id = ? AND room_code = ?', req.user.id, String(req.body?.code || '').toUpperCase());
  res.json({ ok: true });
}));

// ---- 내 기록 ----
app.get('/api/records', requireUser, ah(async (req, res) => {
  // 완성 그림을 다시 그릴 수 있도록 칸 수·조각 모양(볼록·오목)·그림 크기도 함께 보낸다
  const rows = await db.all(`SELECT r.*, rm.cols, rm.rows, rm.state, p.w, p.h, p.owner_id AS pic_owner, p.sample AS pic_sample, p.exhibit AS pic_exhibit FROM records r
    LEFT JOIN rooms rm ON rm.code = r.room_code LEFT JOIN pictures p ON p.id = r.picture_id
    WHERE r.user_id = ? ORDER BY r.finished DESC LIMIT 200`, req.user.id);
  res.json({ me: req.user.nick, records: rows.map(({ state, pic_owner, pic_sample, pic_exhibit, ...r }) => {
    let edges = null;
    try { edges = JSON.parse(state || 'null')?.edges || null; } catch { /* 없으면 보기용 무늬 */ }
    const myPhoto = !pic_sample && pic_owner === req.user.id; // 내가 올린 사진이면 전시 켜기/끄기를 할 수 있다
    return { ...r, edges, friends: JSON.parse(r.friends), myPhoto, exhibit: pic_sample ? true : !!pic_exhibit };
  }) });
}));

// 인터넷 서버가 게임 중에 잠들지 않도록 깨어 있음 확인용
app.get('/api/ping', (_req, res) => res.json({ ok: true, t: Date.now() }));

app.use('/api', (_req, res) => res.status(404).json({ error: '없는 주소예요.' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' })); // 예전에 내 컴퓨터에 저장한 사진
app.get('/uploads/:name', ah(async (req, res) => {
  const img = await db.get('SELECT mime, data FROM images WHERE name = ?', req.params.name);
  if (!img) return res.status(404).end();
  res.setHeader('Content-Type', img.mime);
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.end(Buffer.from(img.data));
}));
// 화면 파일(html·css·js)은 고친 내용이 바로 보이도록 매번 새 버전인지 확인하게 한다
app.use(express.static(path.join(ROOT, 'public'), {
  extensions: ['html'],
  setHeaders: (res, file) => { if (/\.(html|css|js)$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); },
}));

// 오류가 나면 서버가 멈추지 않고 알려 주기
app.use((err, _req, res, _next) => {
  console.error('오류:', err);
  if (!res.headersSent) res.status(500).json({ error: '서버에 잠깐 문제가 생겼어요. 다시 해 주세요.' });
});

const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });
io.use((socket, next) => {
  userFromCookie(socket.handshake.headers.cookie).then(u => {
    if (!u) return next(new Error('login'));
    socket.data.user = u;
    next();
  }, () => next(new Error('server')));
});
attachSocial(io);
attachSockets(io);

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  🧩 퍼즐 친구들 서버가 켜졌어요!');
  console.log(`  · 저장소: ${db.kind === 'supabase' ? 'Supabase (인터넷 데이터베이스)' : '내 컴퓨터 (data/puzzle.db)'}`);
  if (publicUrl) console.log(`  ▶ 인터넷 주소:        ${publicUrl}`);
  console.log(`  ▶ 이 컴퓨터에서:      http://localhost:${PORT}`);
  for (const u of lanUrls()) console.log(`  ▶ 같은 와이파이에서:  ${u}`);
  console.log(hasTurn() ? '  ✔ 음성 중계 서버: 켜짐' : '  · 음성 중계 서버: 꺼짐 (멀리 있는 친구와 음성 대화를 하려면 음성대화_중계서버_설정방법.md)');
  console.log(googleClientId ? '  ✔ 구글 로그인: 켜짐' : '  · 구글 로그인: 꺼짐 (GOOGLE_CLIENT_ID 를 넣으면 켜져요)');
  console.log('');
});

// 예상 못 한 오류가 나도 서버가 꺼지지 않게 기록만 남긴다 (방에 있는 모두가 끊기지 않도록)
process.on('unhandledRejection', err => console.error('처리 못 한 오류:', err?.stack || err));
process.on('uncaughtException', err => console.error('예상 못 한 오류:', err?.stack || err));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { await saveAll().catch(() => {}); process.exit(0); });
}
