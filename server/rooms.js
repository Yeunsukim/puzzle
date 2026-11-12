// 게임방: 조각 위치·회전·누가 잡고 있는지를 서버가 기준으로 관리하고, 모두에게 알려 준다.
import crypto from 'node:crypto';
import { db } from './db.js';

export const S = 100;            // 한 칸(조각) 크기 = 100 (게임판 단위)
export const MAX_PLAYERS = 6;    // 나 + 친구 5명
export const COLORS = ['#E2725B', '#2779A7', '#2E9C8F', '#C9A45C', '#7E62C9', '#D9568C'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const live = new Map();          // 지금 메모리에 올라와 있는 방들

const shuffle = a => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const clampNum = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));

// 퍼즐 틀 둘레에 조각을 흩어 놓을 자리들 (틀에 가까운 곳부터)
export function makeSlots(cols, rows, count) {
  const W = cols * S, H = rows * S, gap = S * 1.4, m = S * 0.6;
  const need = Math.ceil(count * 1.3) + 8;
  for (let R = 2; ; R++) {
    const pts = [];
    const x0 = -m - gap * R, x1 = W + m + gap * R, y0 = -m - gap * R, y1 = H + m + gap * R;
    for (let y = y0; y <= y1 - S; y += gap) {
      for (let x = x0; x <= x1 - S; x += gap) {
        if (x + S > -m && x < W + m && y + S > -m && y < H + m) continue; // 틀 위는 비워 둔다
        const cx = x + S / 2, cy = y + S / 2;
        const dx = Math.max(0, -cx, cx - W), dy = Math.max(0, -cy, cy - H);
        pts.push({ x: Math.round(x), y: Math.round(y), d: Math.max(dx, dy) + Math.hypot(dx, dy) * 0.01 });
      }
    }
    if (pts.length >= need) {
      pts.sort((a, b) => a.d - b.d);
      return pts.slice(0, need).map(({ x, y }) => ({ x, y }));
    }
  }
}

async function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!(await db.get('SELECT 1 AS x FROM rooms WHERE code = ?', c))) return c;
  }
}

export async function createRoom(picture, cols, rows, hostId) {
  const n = cols * rows;
  const flip = () => (Math.random() < 0.5 ? 1 : -1);
  const h = Array.from({ length: rows - 1 }, () => Array.from({ length: cols }, flip));
  const v = Array.from({ length: rows }, () => Array.from({ length: cols - 1 }, flip));
  const slots = shuffle(makeSlots(cols, rows, n));
  const jitter = () => Math.round((Math.random() - 0.5) * S * 0.25);
  const pieces = [];
  for (let i = 0; i < n; i++) {
    pieces.push({ id: i, x: slots[i].x + jitter(), y: slots[i].y + jitter(), rot: crypto.randomInt(4), cell: -1, locked: false });
  }
  const state = { edges: { h, v }, pieces, scores: {}, people: {}, startedAt: null, finishedAt: null };
  const code = await newCode();
  await db.run('INSERT INTO rooms (code, picture_id, cols, rows, host_id, state, created) VALUES (?, ?, ?, ?, ?, ?, ?)',
    code, picture.id, cols, rows, hostId, JSON.stringify(state), Date.now());
  return code;
}

// 방 불러오기: 메모리에 있으면 그것을, 없으면 데이터베이스에서 (동시에 두 번 불러오지 않게)
const loading = new Map();
export function getRoom(codeIn) {
  const code = String(codeIn || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) return Promise.resolve(null);
  if (live.has(code)) return Promise.resolve(live.get(code));
  if (!loading.has(code)) {
    loading.set(code, loadRoom(code).finally(() => loading.delete(code)));
  }
  return loading.get(code);
}
async function loadRoom(code) {
  const row = await db.get('SELECT r.*, p.title, p.url, p.w, p.h FROM rooms r JOIN pictures p ON p.id = r.picture_id WHERE r.code = ?', code);
  if (!row) return null;
  const state = JSON.parse(row.state);
  const room = {
    code, cols: row.cols, rows: row.rows,
    picture: { id: row.picture_id, title: row.title, url: row.url, w: row.w, h: row.h },
    state,
    online: new Map(),   // uid -> { uid, nick, avatar, color, sockets:Set }
    held: new Map(),     // 조각 id -> 잡고 있는 uid
    cells: new Int32Array(row.cols * row.rows).fill(-1), // 칸 -> 그 칸에 놓인 조각 id
    slots: makeSlots(row.cols, row.rows, row.cols * row.rows),
    lockedCount: 0,
    dirty: false,
  };
  for (const p of state.pieces) {
    if (p.cell >= 0) room.cells[p.cell] = p.id;
    if (p.locked) room.lockedCount++;
  }
  live.set(code, room);
  return room;
}

export async function roomInfo(code) {
  const r = await getRoom(code);
  if (!r) return null;
  return {
    code: r.code, title: r.picture.title, url: r.picture.url, cols: r.cols, rows: r.rows,
    pieces: r.cols * r.rows, finished: !!r.state.finishedAt, online: r.online.size,
  };
}

async function saveRoom(room) {
  room.dirty = false;
  try {
    await db.run('UPDATE rooms SET state = ?, finished = ? WHERE code = ?', JSON.stringify(room.state), room.state.finishedAt, room.code);
  } catch (err) {
    room.dirty = true; // 다음에 다시 저장
    console.error('방 저장 실패:', err.message);
  }
}
setInterval(() => {
  for (const room of live.values()) {
    if (room.dirty) saveRoom(room);
    else if (room.online.size === 0) live.delete(room.code);
  }
}, 3000).unref();
export async function saveAll() { await Promise.all([...live.values()].filter(r => r.dirty).map(saveRoom)); }

// ---- 조각 다루기 ----
const pub = (room, p) => ({ id: p.id, x: p.x, y: p.y, rot: p.rot, cell: p.cell, locked: p.locked, held: room.held.get(p.id) || 0 });

function unsetCell(room, p) {
  if (p.cell >= 0 && room.cells[p.cell] === p.id) room.cells[p.cell] = -1;
  p.cell = -1;
}

// 틀 밖에서 (x,y)와 가까운 빈자리
function freeSpot(room, p) {
  const others = room.state.pieces.filter(q => q.id !== p.id && q.cell < 0);
  const order = room.slots
    .map(s => ({ s, d: Math.hypot(s.x - p.x, s.y - p.y) }))
    .sort((a, b) => a.d - b.d);
  for (const { s } of order) {
    if (!others.some(q => Math.abs(q.x - s.x) < S * 0.8 && Math.abs(q.y - s.y) < S * 0.8)) return { x: s.x, y: s.y };
  }
  return { x: room.cols * S + S + crypto.randomInt(S * 4), y: crypto.randomInt(room.rows * S) };
}

function tryLock(room, p, uid, locked) {
  if (!p.locked && p.cell === p.id && p.rot === 0) {
    p.locked = true;
    room.lockedCount++;
    room.state.scores[uid] = (room.state.scores[uid] || 0) + 1;
    locked.push(p.id);
  }
}

function dropPiece(room, uid, p, x, y) {
  const changed = [p], locked = [];
  const W = room.cols * S, H = room.rows * S;
  const cx = x + S / 2, cy = y + S / 2;
  unsetCell(room, p);
  if (cx >= 0 && cx < W && cy >= 0 && cy < H) {
    const c = Math.floor(cx / S), r = Math.floor(cy / S), cell = r * room.cols + c;
    const occId = room.cells[cell];
    if (occId >= 0 && room.state.pieces[occId].locked) {
      // 이미 맞춰진 칸이면 틀 밖으로 돌려보낸다
      p.x = x; p.y = y;
      Object.assign(p, freeSpot(room, p));
    } else {
      if (occId >= 0) { // 다른 조각이 있으면 그 조각을 밖으로 빼 준다
        const q = room.state.pieces[occId];
        unsetCell(room, q);
        Object.assign(q, freeSpot(room, q));
        changed.push(q);
      }
      p.x = c * S; p.y = r * S; p.cell = cell;
      room.cells[cell] = p.id;
      tryLock(room, p, uid, locked);
    }
  } else {
    p.x = Math.round(clampNum(x, -S * 200, S * 260));
    p.y = Math.round(clampNum(y, -S * 200, S * 260));
  }
  return { changed, locked };
}

function summary(room) {
  const st = room.state;
  const seconds = Math.max(1, Math.round(((st.finishedAt || Date.now()) - (st.startedAt || Date.now())) / 1000));
  const players = Object.entries(st.people)
    .map(([uid, p]) => ({ uid: Number(uid), nick: p.nick, avatar: p.avatar, color: p.color, placed: st.scores[uid] || 0 }))
    .sort((a, b) => b.placed - a.placed);
  return { code: room.code, title: room.picture.title, url: room.picture.url, cols: room.cols, rows: room.rows, pieces: room.cols * room.rows, seconds, players, finishedAt: st.finishedAt };
}

function finish(room) {
  const st = room.state;
  st.finishedAt = Date.now();
  const sum = summary(room);
  (async () => {
    for (const p of sum.players) {
      const friends = sum.players.filter(q => q.uid !== p.uid).map(q => q.nick);
      await db.run('INSERT INTO records (user_id, room_code, picture_id, title, url, pieces, seconds, placed, friends, finished) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        p.uid, room.code, room.picture.id, room.picture.title, room.picture.url, sum.pieces, sum.seconds, p.placed, JSON.stringify(friends), st.finishedAt);
    }
    await saveRoom(room);
  })().catch(err => console.error('기록 저장 실패:', err.message));
  return sum;
}

function playersPayload(room) {
  return {
    online: [...room.online.values()].map(o => ({ uid: o.uid, nick: o.nick, avatar: o.avatar, color: o.color })),
    people: room.state.people,
    scores: room.state.scores,
  };
}

function snapshot(room, uid) {
  return {
    code: room.code, cols: room.cols, rows: room.rows, S,
    picture: room.picture,
    edges: room.state.edges,
    pieces: room.state.pieces.map(p => pub(room, p)),
    players: playersPayload(room),
    startedAt: room.state.startedAt, finishedAt: room.state.finishedAt,
    summary: room.state.finishedAt ? summary(room) : null,
    now: Date.now(), me: uid, maxPlayers: MAX_PLAYERS,
  };
}

// ---- 실시간 연결 ----
export function attachSockets(io) {
  io.on('connection', socket => {
    const user = socket.data.user;
    const uid = user.id;
    let room = null;

    const validId = id => room && Number.isInteger(id) && id >= 0 && id < room.state.pieces.length;
    const emitPlayers = () => io.to(room.code).emit('players', playersPayload(room));

    const afterChange = (changed, locked) => {
      room.dirty = true;
      io.to(room.code).emit('pieces', { list: changed.map(p => pub(room, p)), locked, by: uid, scores: room.state.scores, done: room.lockedCount });
      if (room.lockedCount === room.state.pieces.length && !room.state.finishedAt) {
        io.to(room.code).emit('done', finish(room));
      }
    };

    // 이 사람이 잡고 있던 조각을 지금 자리에 내려놓기
    const releaseAll = (exceptId = -1) => {
      if (!room) return;
      for (const [id, holder] of [...room.held]) {
        if (holder !== uid || id === exceptId) continue;
        room.held.delete(id);
        const p = room.state.pieces[id];
        const { changed, locked } = dropPiece(room, uid, p, p.x, p.y);
        afterChange(changed, locked);
      }
    };

    socket.on('join', async (code, ack) => {
      if (typeof ack !== 'function') return;
      if (room) return ack({ error: '이미 방에 들어와 있어요.' });
      let r;
      try { r = await getRoom(code); } catch { return ack({ error: '방을 불러오지 못했어요. 잠시 뒤 다시 해 주세요.' }); }
      if (!r) return ack({ error: '그런 방이 없어요. 방 번호를 다시 확인해 주세요.' });
      if (room || !socket.connected) return;
      live.set(r.code, r); // 불러오는 사이 메모리에서 빠졌을 수도 있으니 다시 넣기
      if (!r.online.has(uid) && r.online.size >= MAX_PLAYERS && !r.state.finishedAt) {
        return ack({ error: `방이 꽉 찼어요. (한 방에 ${MAX_PLAYERS}명까지)`, full: true });
      }
      room = r;
      let o = r.online.get(uid);
      if (!o) {
        const used = new Set([...r.online.values()].map(x => x.color));
        const prev = r.state.people[uid]?.color;
        const color = prev && !used.has(prev) ? prev : (COLORS.find(c => !used.has(c)) || COLORS[0]);
        o = { uid, nick: user.nick, avatar: user.avatar, color, sockets: new Set() };
        r.online.set(uid, o);
      }
      o.sockets.add(socket.id);
      if (!r.state.finishedAt) {
        r.state.people[uid] = { nick: user.nick, avatar: user.avatar, color: o.color };
        if (!r.state.startedAt) r.state.startedAt = Date.now();
        r.dirty = true;
      }
      socket.join(r.code);
      ack({ ok: true, snapshot: snapshot(r, uid) });
      emitPlayers();
    });

    socket.on('grab', (id, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!validId(id) || room.state.finishedAt) return reply(false);
      const p = room.state.pieces[id];
      const holder = room.held.get(id);
      if (p.locked || (holder && holder !== uid)) return reply(false, pub(room, p));
      releaseAll(id);
      room.held.set(id, uid);
      unsetCell(room, p);
      room.dirty = true;
      socket.to(room.code).emit('grab', { id, uid });
      reply(true);
    });

    socket.on('move', data => {
      const id = data?.id;
      if (!validId(id) || room.held.get(id) !== uid) return;
      const p = room.state.pieces[id];
      p.x = Math.round(clampNum(Number(data.x), -S * 200, S * 260));
      p.y = Math.round(clampNum(Number(data.y), -S * 200, S * 260));
      socket.to(room.code).volatile.emit('move', { id, x: p.x, y: p.y });
    });

    socket.on('drop', data => {
      const id = data?.id;
      if (!validId(id) || room.held.get(id) !== uid) return;
      room.held.delete(id);
      const p = room.state.pieces[id];
      const { changed, locked } = dropPiece(room, uid, p, Number(data.x), Number(data.y));
      afterChange(changed, locked);
    });

    // 돌리기: dir = 1 이면 오른쪽(시계 방향), -1 이면 왼쪽(시계 반대 방향)으로 90도
    socket.on('rotate', (id, dir) => {
      if (!validId(id) || room.state.finishedAt) return;
      const p = room.state.pieces[id];
      const holder = room.held.get(id);
      if (p.locked || (holder && holder !== uid)) return;
      p.rot = (p.rot + (dir === -1 ? 3 : 1)) % 4;
      const locked = [];
      tryLock(room, p, uid, locked);
      afterChange([p], locked);
    });

    socket.on('eject', id => {
      if (!validId(id) || room.state.finishedAt) return;
      const p = room.state.pieces[id];
      const holder = room.held.get(id);
      if (p.locked || (holder && holder !== uid)) return;
      room.held.delete(id);
      unsetCell(room, p);
      Object.assign(p, freeSpot(room, p));
      afterChange([p], []);
    });

    socket.on('cursor', data => {
      if (!room) return;
      const x = Number(data?.x), y = Number(data?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      socket.to(room.code).volatile.emit('cursor', { uid, x, y });
    });

    socket.on('disconnect', () => {
      if (!room) return;
      releaseAll();
      const o = room.online.get(uid);
      if (o) {
        o.sockets.delete(socket.id);
        if (o.sockets.size === 0) room.online.delete(uid);
      }
      io.to(room.code).emit('cursor-off', { uid });
      emitPlayers();
    });
  });
}
