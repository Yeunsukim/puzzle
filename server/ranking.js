// 랭킹: 완성한 퍼즐(방 하나 = 작품 하나)을 점수로 줄 세운다. 주간·월간 5위까지.
// 점수 = 조각 수 × 조각 수 × 10 ÷ 걸린 시간(초)  → 조각이 많을수록, 빨리 맞출수록 높다.
// 시간은 한국 시간 기준: 주간 = 월요일 0시 ~ 다음 월요일 0시, 월간 = 1일 0시 ~ 다음 달 1일 0시
import { db, ah } from './db.js';
import { requireUser } from './auth.js';

const KST = 9 * 3600e3, DAY = 864e5;
export const scoreOf = (pieces, seconds) => Math.round(pieces * pieces * 10 / Math.max(1, seconds));

// 기간 계산 (offset: 0 = 이번, -1 = 지난 주/달 ...)
export function period(type, offset = 0, now = Date.now()) {
  const d = new Date(now + KST);
  if (type === 'month') {
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + offset;
    const start = Date.UTC(y, m, 1) - KST, end = Date.UTC(y, m + 1, 1) - KST;
    const s = new Date(start + KST);
    return { type, start, end, key: `M${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, '0')}`, label: `${s.getUTCFullYear()}년 ${s.getUTCMonth() + 1}월` };
  }
  const dow = (d.getUTCDay() + 6) % 7; // 월요일 = 0
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow) - KST + offset * 7 * DAY;
  const s = new Date(start + KST), e = new Date(start + 6 * DAY + KST);
  const nth = Math.floor((s.getUTCDate() - 1) / 7) + 1; // 그 달의 몇째 주 (월요일 날짜 기준)
  return {
    type, start, end: start + 7 * DAY,
    key: `W${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, '0')}-${String(s.getUTCDate()).padStart(2, '0')}`,
    label: `${s.getUTCFullYear()}년 ${s.getUTCMonth() + 1}월 ${nth}주차`,
    range: `${s.getUTCMonth() + 1}월 ${s.getUTCDate()}일 ~ ${e.getUTCMonth() + 1}월 ${e.getUTCDate()}일`,
  };
}

// 기간 안에 완성된 작품들을 점수 순으로 (limit 개)
export async function rankEntries(start, end, limit = 5) {
  const rows = await db.all(`SELECT r.code, r.cols, r.rows, r.state, r.finished, p.title, p.url, p.w, p.h
    FROM rooms r JOIN pictures p ON p.id = r.picture_id
    WHERE r.finished IS NOT NULL AND r.finished >= ? AND r.finished < ? AND (p.sample = 1 OR p.exhibit = 1)`, start, end);
  const list = [];
  for (const r of rows) {
    let st;
    try { st = JSON.parse(r.state); } catch { continue; }
    if (!st?.finishedAt || !st.startedAt) continue;
    const pieces = r.cols * r.rows;
    const seconds = Math.max(1, Math.round((st.finishedAt - st.startedAt) / 1000));
    const people = Object.entries(st.people || {})
      .map(([uid, p]) => ({ uid: Number(uid), nick: p.nick, avatar: p.avatar, placed: (st.scores || {})[uid] || 0 }))
      .sort((a, b) => b.placed - a.placed);
    list.push({
      code: r.code, title: r.title, url: r.url, w: r.w, h: r.h, cols: r.cols, rows: r.rows, edges: st.edges || null,
      pieces, seconds, score: scoreOf(pieces, seconds), finished: st.finishedAt, people,
    });
  }
  list.sort((a, b) => (b.score - a.score) || (a.finished - b.finished)); // 점수가 같으면 먼저 완성한 작품이 위
  return list.slice(0, limit).map((e, i) => ({ ...e, rank: i + 1 }));
}

// 방금 완성한 작품의 이번 주 / 이번 달 순위
export async function rankOf(code, now = Date.now()) {
  const out = {};
  for (const type of ['week', 'month']) {
    const p = period(type, 0, now);
    const all = await rankEntries(p.start, p.end, 1000);
    const hit = all.find(e => e.code === code);
    out[type] = hit ? { rank: hit.rank, total: all.length, label: p.label } : null;
    if (hit) out.score = hit.score;
  }
  return out;
}

// ---- 선물(트로피): 끝난 기간의 5위까지 작품을 함께 맞춘 사람 모두에게 ----
const LOOKBACK = { week: 26, month: 12 };
async function settleAwards() {
  const now = Date.now();
  for (const type of ['week', 'month']) {
    for (let off = -1; off >= -LOOKBACK[type]; off--) {
      const p = period(type, off, now);
      if (p.end > now) continue;
      if (await db.get('SELECT 1 AS x FROM award_periods WHERE period_key = ?', p.key)) break; // 이보다 예전 기간은 이미 정리됨
      for (const e of await rankEntries(p.start, p.end, 5)) {
        for (const person of e.people) {
          await db.run(`INSERT INTO awards (period_key, type, label, rank, room_code, uid, title, url, score, created)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
            p.key, type, p.label, e.rank, e.code, person.uid, e.title, e.url, e.score, now);
        }
      }
      await db.run('INSERT INTO award_periods (period_key, created) VALUES (?, ?) ON CONFLICT DO NOTHING', p.key, now);
    }
  }
}
let settling = null;
const settle = () => (settling ||= settleAwards().catch(err => console.error('트로피 정리 실패:', err.message)).finally(() => { settling = null; }));

export function rankingRoutes(app) {
  // 랭킹 (type = week | month, offset = 0 이번, -1 지난 ...)
  app.get('/api/rankings', requireUser, ah(async (req, res) => {
    const type = req.query.type === 'month' ? 'month' : 'week';
    const offset = Math.max(-52, Math.min(0, Math.round(Number(req.query.offset) || 0)));
    const p = period(type, offset);
    res.json({ ...p, offset, entries: await rankEntries(p.start, p.end, 5) });
  }));

  // 내가 받은 트로피
  app.get('/api/awards', requireUser, ah(async (req, res) => {
    await settle();
    const rows = await db.all('SELECT * FROM awards WHERE uid = ? ORDER BY created DESC, period_key DESC, rank ASC LIMIT 100', req.user.id);
    res.json({ awards: rows });
  }));
}
