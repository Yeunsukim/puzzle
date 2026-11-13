// 친구 맺기 · 게임 초대 보내기/받기 · 누가 접속해 있는지
import crypto from 'node:crypto';
import { db, ah } from './db.js';
import { requireUser } from './auth.js';
import { roomInfo } from './rooms.js';

let io = null;
const onlineCount = new Map(); // uid -> 열려 있는 연결 수
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const isOnline = uid => (onlineCount.get(uid) || 0) > 0;
const notify = (uid, event, data = {}) => io?.to('u:' + uid).emit(event, data);

// 친구맺기 코드: 친구에게 알려 주면 나를 찾을 수 있는 8글자
export async function friendCode(uid) {
  const row = await db.get('SELECT friend_code FROM users WHERE id = ?', uid);
  if (row?.friend_code) return row.friend_code;
  for (;;) {
    let c = '';
    for (let i = 0; i < 8; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!(await db.get('SELECT 1 AS x FROM users WHERE friend_code = ?', c))) {
      await db.run('UPDATE users SET friend_code = ? WHERE id = ?', c, uid);
      return c;
    }
  }
}

const person = u => ({ id: u.id, nick: u.nick, avatar: u.avatar, online: isOnline(u.id) });
const areFriends = async (a, b) => !!(await db.get('SELECT 1 AS x FROM friends WHERE user_id = ? AND friend_id = ?', a, b));
async function makeFriends(a, b) {
  const now = Date.now();
  await db.run('INSERT INTO friends (user_id, friend_id, created) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', a, b, now);
  await db.run('INSERT INTO friends (user_id, friend_id, created) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', b, a, now);
  await db.run('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)', a, b, b, a);
}

// 같은 방에서 같이 맞춘 사람은 서로 친구 추천에 나온다
async function recentPlayers(uid) {
  const codes = (await db.all('SELECT room_code FROM records WHERE user_id = ? ORDER BY finished DESC LIMIT 30', uid)).map(r => r.room_code);
  const ids = new Set();
  for (const code of new Set(codes)) {
    const r = await db.get('SELECT state FROM rooms WHERE code = ?', code);
    try { for (const k of Object.keys(JSON.parse(r?.state || '{}').people || {})) ids.add(Number(k)); } catch { /* 무시 */ }
  }
  ids.delete(uid);
  const out = [];
  for (const id of ids) {
    if (out.length >= 12) break;
    if (await areFriends(uid, id)) continue;
    const u = await db.get('SELECT id, nick, avatar FROM users WHERE id = ?', id);
    if (u) out.push(person(u));
  }
  return out;
}

export async function socialState(uid) {
  const friends = (await db.all(`SELECT u.id, u.nick, u.avatar FROM friends f JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ? ORDER BY u.nick`, uid)).map(person).sort((a, b) => b.online - a.online);
  const requests = (await db.all(`SELECT r.id, u.id AS uid, u.nick, u.avatar FROM friend_requests r JOIN users u ON u.id = r.from_id
    WHERE r.to_id = ? ORDER BY r.created DESC`, uid))
    .map(r => ({ id: r.id, from: person({ id: r.uid, nick: r.nick, avatar: r.avatar }) }));
  const sent = (await db.all(`SELECT r.id, u.id AS uid, u.nick, u.avatar FROM friend_requests r JOIN users u ON u.id = r.to_id
    WHERE r.from_id = ? ORDER BY r.created DESC`, uid))
    .map(r => ({ id: r.id, to: person({ id: r.uid, nick: r.nick, avatar: r.avatar }) }));
  const dayAgo = Date.now() - 864e5;
  const invites = [];
  for (const r of await db.all(`SELECT i.id, i.room_code, i.created, u.id AS uid, u.nick, u.avatar FROM invites i JOIN users u ON u.id = i.from_id
      WHERE i.to_id = ? AND i.status = 'wait' AND i.created > ? ORDER BY i.created DESC`, uid, dayAgo)) {
    const room = await roomInfo(r.room_code);
    if (!room || room.finished) continue;
    invites.push({ id: r.id, created: r.created, from: person({ id: r.uid, nick: r.nick, avatar: r.avatar }), room });
  }
  return { code: await friendCode(uid), friends, requests, sent, invites, recent: await recentPlayers(uid) };
}

const fail = (res, msg, code = 400) => res.status(code).json({ error: msg });

export function socialRoutes(app) {
  app.get('/api/social', requireUser, ah(async (req, res) => res.json(await socialState(req.user.id))));

  // 친구 신청 (이메일 또는 친구맺기 코드, 또는 같이 했던 사람의 번호)
  app.post('/api/friends/request', requireUser, ah(async (req, res) => {
    const me = req.user.id;
    let target = null;
    if (req.body?.userId) target = await db.get('SELECT * FROM users WHERE id = ?', Number(req.body.userId));
    else {
      const q = String(req.body?.query || '').trim();
      if (!q) return fail(res, '친구의 이메일이나 친구맺기 코드를 적어 주세요.');
      target = q.includes('@')
        ? await db.get('SELECT * FROM users WHERE email = ?', q.toLowerCase())
        : await db.get('SELECT * FROM users WHERE friend_code = ?', q.toUpperCase().replace(/\s/g, ''));
    }
    if (!target) return fail(res, '그런 사람을 찾지 못했어요. 친구가 먼저 가입했는지 확인해 주세요.');
    if (target.id === me) return fail(res, '나 자신은 친구로 추가할 수 없어요.');
    if (await areFriends(me, target.id)) return fail(res, `${target.nick}님은 이미 친구예요.`);
    // 상대가 먼저 나에게 신청했으면 바로 친구가 된다
    if (await db.get('SELECT 1 AS x FROM friend_requests WHERE from_id = ? AND to_id = ?', target.id, me)) {
      await makeFriends(me, target.id);
      notify(target.id, 'social', { type: 'friend-accepted', nick: req.user.nick });
      return res.json({ ok: true, message: `${target.nick}님과 친구가 되었어요!` });
    }
    await db.run('INSERT INTO friend_requests (from_id, to_id, created) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', me, target.id, Date.now());
    notify(target.id, 'social', { type: 'friend-request', nick: req.user.nick });
    res.json({ ok: true, message: `${target.nick}님에게 친구 신청을 보냈어요. 수락하면 친구가 돼요.` });
  }));

  app.post('/api/friends/respond', requireUser, ah(async (req, res) => {
    const r = await db.get('SELECT * FROM friend_requests WHERE id = ? AND to_id = ?', Number(req.body?.id), req.user.id);
    if (!r) return fail(res, '이미 처리된 신청이에요.');
    if (req.body.accept) {
      await makeFriends(r.from_id, r.to_id);
      notify(r.from_id, 'social', { type: 'friend-accepted', nick: req.user.nick });
    } else {
      await db.run('DELETE FROM friend_requests WHERE id = ?', r.id);
    }
    res.json(await socialState(req.user.id));
  }));

  app.post('/api/friends/cancel', requireUser, ah(async (req, res) => {
    await db.run('DELETE FROM friend_requests WHERE id = ? AND from_id = ?', Number(req.body?.id), req.user.id);
    res.json(await socialState(req.user.id));
  }));

  app.post('/api/friends/remove', requireUser, ah(async (req, res) => {
    const other = Number(req.body?.id);
    await db.run('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)', req.user.id, other, other, req.user.id);
    notify(other, 'social', { type: 'refresh' });
    res.json(await socialState(req.user.id));
  }));

  // 게임방으로 친구 초대 보내기
  app.post('/api/invites', requireUser, ah(async (req, res) => {
    const room = await roomInfo(req.body?.roomCode);
    if (!room) return fail(res, '방을 찾을 수 없어요.');
    if (room.finished) return fail(res, '이미 완성된 퍼즐이에요.');
    const to = Number(req.body?.to);
    if (!(await areFriends(req.user.id, to))) return fail(res, '친구에게만 초대를 보낼 수 있어요.');
    const dup = await db.get("SELECT id FROM invites WHERE from_id = ? AND to_id = ? AND room_code = ? AND status = 'wait'", req.user.id, to, room.code);
    if (!dup) await db.run('INSERT INTO invites (from_id, to_id, room_code, created) VALUES (?, ?, ?, ?)', req.user.id, to, room.code, Date.now());
    else await db.run('UPDATE invites SET created = ? WHERE id = ?', Date.now(), dup.id);
    notify(to, 'invite', { from: person(req.user), room });
    res.json({ ok: true, online: isOnline(to) });
  }));

  app.post('/api/invites/respond', requireUser, ah(async (req, res) => {
    const inv = await db.get('SELECT * FROM invites WHERE id = ? AND to_id = ?', Number(req.body?.id), req.user.id);
    if (!inv) return fail(res, '초대를 찾을 수 없어요.');
    const status = req.body.accept ? 'yes' : 'no';
    // 같은 방으로 온 초대를 함께 정리
    await db.run("UPDATE invites SET status = ? WHERE to_id = ? AND room_code = ? AND status = 'wait'", status, req.user.id, inv.room_code);
    notify(inv.from_id, 'social', { type: status === 'yes' ? 'invite-accepted' : 'invite-declined', nick: req.user.nick });
    res.json({ ok: true, roomCode: inv.room_code });
  }));
}

// 실시간 연결마다: 내 알림 받는 방에 넣고, 친구들에게 접속했다고 알려 준다
export function attachSocial(ioServer) {
  io = ioServer;
  io.on('connection', socket => {
    const uid = socket.data.user.id;
    socket.join('u:' + uid);
    const before = onlineCount.get(uid) || 0;
    onlineCount.set(uid, before + 1);
    const tellFriends = () => db.all('SELECT friend_id FROM friends WHERE user_id = ?', uid)
      .then(rows => { for (const f of rows) notify(f.friend_id, 'social', { type: 'presence' }); })
      .catch(() => {});
    if (before === 0) tellFriends();
    socket.on('disconnect', () => {
      const n = (onlineCount.get(uid) || 1) - 1;
      if (n <= 0) { onlineCount.delete(uid); tellFriends(); } else onlineCount.set(uid, n);
    });
  });
}
