// 완성한 퍼즐 그림: 원래 그림 위에 조각 선을 은은하게 그리고, 오른쪽 아래에 작품 서명처럼
// 제목 · 날짜 · 함께 맞춘 사람을 적는다. (내 기록, 홈 화면, 저장하기에 쓴다)
import { cropRect, gridFor, loadImage } from './util.js';
import { piecePath, pieceDirs } from './jigsaw.js';

const imgCache = new Map();
const getImg = url => {
  if (!imgCache.has(url)) imgCache.set(url, loadImage(url).catch(err => { imgCache.delete(url); throw err; }));
  return imgCache.get(url);
};

// 서명 글씨체(손글씨)가 준비될 때까지 기다린다
let fontReady = null;
const waitFont = () => (fontReady ||= (document.fonts?.load('40px "Nanum Pen Script"') || Promise.resolve()).catch(() => {}));

// 날짜: 2026년 11월 12일
export const dateText = ms => new Date(ms).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

// rec: 기록 하나 (url, title, finished, friends, cols, rows, edges, w, h, pieces)
// me: 내 별명. width: 만들 그림의 가로 크기(점)
export async function renderArtwork(rec, me, width = 1600) {
  const [img] = await Promise.all([getImg(rec.url), waitFont()]);
  const iw = img.naturalWidth || rec.w || 1600, ih = img.naturalHeight || rec.h || 1200;
  let cols = rec.cols, rows = rec.rows;
  if (!cols || !rows) ({ cols, rows } = gridFor(rec.pieces || 12, iw / ih));
  const crop = cropRect(iw, ih, cols, rows);
  const W = Math.round(width), H = Math.round(W * rows / cols), cell = W / cols;

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, W, H);

  // 조각 선 (실제로 맞춘 퍼즐의 볼록·오목 모양. 없으면 보기용 무늬)
  let edges = rec.edges;
  if (!edges?.h || !edges?.v) {
    let seed = cols * 131 + rows * 71;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const flip = () => (rnd() < 0.5 ? 1 : -1);
    edges = {
      h: Array.from({ length: rows - 1 }, () => Array.from({ length: cols }, flip)),
      v: Array.from({ length: rows }, () => Array.from({ length: cols - 1 }, flip)),
    };
  }
  const all = new Path2D();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      all.addPath(piecePath(cell, pieceDirs(r, c, rows, cols, edges), 0), new DOMMatrix().translate(c * cell, r * cell));
    }
  }
  const lw = Math.max(1, W / 900);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,.28)';
  ctx.lineWidth = lw * 2.2;
  ctx.stroke(all);
  ctx.strokeStyle = 'rgba(255,255,255,.5)';
  ctx.lineWidth = lw;
  ctx.stroke(all);
  ctx.restore();

  // 서명 (오른쪽 아래)
  const people = [me, ...(rec.friends || [])].filter(Boolean);
  const lines = [`「${rec.title}」`, dateText(rec.finished), people.length > 1 ? people.join(' · ') : `${people[0] || ''} 혼자서 완성`];
  const fs = Math.max(16, Math.round(W / 34));
  const pad = Math.round(W / 40);
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  // 글씨 뒤를 살짝 어둡게 해서 어떤 그림 위에서도 잘 보이게
  const lh = fs * 1.05;
  ctx.font = `${fs}px "Nanum Pen Script", "Noto Sans KR", sans-serif`;
  const tw = Math.max(...lines.map(l => ctx.measureText(l).width));
  const bx = W - pad - tw - fs * 0.6, by = H - pad - lh * lines.length - fs * 0.2;
  const g = ctx.createLinearGradient(bx, by, W, H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,.45)');
  ctx.fillStyle = g;
  ctx.fillRect(bx - fs, by - fs * 0.6, W - bx + fs, H - by + fs * 0.6);
  ctx.shadowColor = 'rgba(0,0,0,.6)';
  ctx.shadowBlur = fs * 0.25;
  ctx.fillStyle = '#FFFDF6';
  lines.forEach((l, i) => {
    ctx.font = `${i === 0 ? fs * 1.15 : fs}px "Nanum Pen Script", "Noto Sans KR", sans-serif`;
    ctx.fillText(l, W - pad, H - pad - lh * (lines.length - 1 - i));
  });
  ctx.restore();
  return cv;
}

// 파일로 저장하기
export function downloadCanvas(cv, rec) {
  const d = new Date(rec.finished);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const name = `퍼즐_${String(rec.title).replace(/[\\/:*?"<>|]/g, '')}_${ymd}.png`;
  cv.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }, 'image/png');
}
