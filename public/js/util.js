// 여러 화면에서 같이 쓰는 도구들

// 화면 코드 버전 (메뉴 맨 아래에 보여요. 새 코드가 들어왔는지 확인할 때 써요)
export const VERSION = '11월 13일 · 12번';

export const AVATARS = [
  { id: 'bunny', name: '토끼' },
  { id: 'cat', name: '고양이' },
  { id: 'bear', name: '곰' },
  { id: 'chick', name: '병아리' },
  { id: 'fox', name: '여우' },
  { id: 'penguin', name: '펭귄' },
];
export const avatarUrl = id => `/assets/characters/${AVATARS.some(a => a.id === id) ? id : 'bunny'}.svg`;

// ---- 밝은 화면 / 어두운 화면 ----
// 'light'(밝게) · 'dark'(어둡게) · 'auto'(기기 설정 따르기)
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
export function getTheme() {
  try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; }
}
export const isDark = () => { const t = getTheme(); return t === 'dark' || (t === 'auto' && darkMQ.matches); };
export function setTheme(t) {
  try { if (t === 'auto') localStorage.removeItem('theme'); else localStorage.setItem('theme', t); } catch { /* 무시 */ }
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  window.dispatchEvent(new Event('themechange'));
}
darkMQ.addEventListener('change', () => window.dispatchEvent(new Event('themechange')));

// 화면 위에 대화 상자 띄우기. data-close 가 붙은 단추나 바깥을 누르면 닫힌다.
export function openModal(html, { onClose, sticky } = {}) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { if (!bg.isConnected) return; bg.remove(); onClose?.(); };
  bg.addEventListener('click', e => { if ((!sticky && e.target === bg) || e.target.closest('[data-close]')) close(); });
  document.body.appendChild(bg);
  bg.close = close;
  return bg;
}

export const COUNTS = [
  // 96 다음부터는 가로:세로가 4:3 인 칸 수 (16×12, 20×15, 24×18, 36×27)
  { n: 6, label: '아이 · 아주 쉬움' },
  { n: 12, label: '아이 · 쉬움' },
  { n: 24, label: '쉬움' },
  { n: 48, label: '보통' },
  { n: 96, label: '조금 어려움' },
  { n: 192, label: '어려움' },
  { n: 300, label: '아주 어려움' },
  { n: 432, label: '도전' },
  { n: 972, label: '어른 · 최고 도전!' },
];

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export async function api(path, body, method) {
  const opt = { method: method || (body ? 'POST' : 'GET'), headers: {} };
  if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(path, opt); } catch { throw new Error('서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '문제가 생겼어요. 다시 해 주세요.');
  return data;
}

let toastTimer = 0;
export function toast(msg, ms = 2800) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// 조각 수 n과 그림 비율에 가장 잘 맞는 가로×세로 칸 수
// 가로×세로가 정확히 n이 되는 짝 중에서 그림 모양에 가장 가까운 것을 고른다.
export function gridFor(n, aspect) {
  // 96보다 큰 조각 수는 항상 가로:세로 4:3 (세로 사진이면 3:4)
  const k = Math.sqrt(n / 12);
  if (n > 96 && Number.isInteger(k)) return aspect >= 1 ? { cols: 4 * k, rows: 3 * k } : { cols: 3 * k, rows: 4 * k };
  let best = null;
  for (let rows = 2; rows <= n / 2; rows++) {
    if (n % rows) continue;
    const cols = n / rows;
    const score = Math.abs(Math.log((cols / rows) / aspect));
    if (!best || score < best.score) best = { cols, rows, score };
  }
  if (best) return { cols: best.cols, rows: best.rows };
  // 정확히 나눌 수 없는 수(소수)일 때만 가장 가까운 개수로
  for (let rows = 2; rows <= Math.max(2, n / 2); rows++) {
    const cols = Math.max(2, Math.round(n / rows));
    const score = Math.abs(cols * rows - n) / n * 2 + Math.abs(Math.log((cols / rows) / aspect));
    if (!best || score < best.score) best = { cols, rows, score };
  }
  return { cols: best.cols, rows: best.rows };
}

// 조각판에 쓸 그림 부분. 그림이 너무 많이 잘리지 않도록
// 최대 15%까지는 살짝 늘이거나 줄여서 맞추고, 나머지만 가운데를 잘라 쓴다.
export const STRETCH = 1.15;
export function cropRect(w, h, cols, rows) {
  const g = cols / rows;
  const a = Math.min(g * STRETCH, Math.max(g / STRETCH, w / h)); // 잘라 낼 모양
  if (w / h > a) { const sw = h * a; return { sx: (w - sw) / 2, sy: 0, sw, sh: h }; }
  const sh = w / a;
  return { sx: 0, sy: (h - sh) / 2, sw: w, sh };
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  if (h) return `${h}시간 ${m}분`;
  if (m) return `${m}분 ${s}초`;
  return `${s}초`;
}
export function clock(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  const p = v => String(v).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('그림을 불러오지 못했어요.'));
    img.src = src;
  });
}

// 글 복사 (http 주소에서도 되도록 예비 방법 포함)
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* 아래 예비 방법 */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}
