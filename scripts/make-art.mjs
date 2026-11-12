// 퍼즐용 작품 그림(SVG)을 만들어 public/assets/art 에 저장한다.  실행: node scripts/make-art.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/assets/art');
fs.mkdirSync(OUT, { recursive: true });
const W = 1600, H = 1200, INK = '#14202B';

function rng(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const f = n => Math.round(n * 10) / 10;
const pick = (R, a) => a[Math.floor(R() * a.length)];
const svg = (defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs>${defs}</defs>${body}</svg>`;

// ---- 공통 그림 조각 ----
function leaf(x, y, len, wid, ang, fill, vein = true) {
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(ang)})"><path d="M0 0Q${f(wid)} ${f(-len / 2)} 0 ${f(-len)}Q${f(-wid)} ${f(-len / 2)} 0 0Z" fill="${fill}" stroke="${INK}" stroke-width="2"/>${vein ? `<path d="M0 0L0 ${f(-len * 0.9)}" stroke="${INK}" stroke-width="1.4" opacity=".7"/>` : ''}</g>`;
}
function rosette(R, x, y, r, cols) {
  const n = 5 + Math.floor(R() * 8);
  let s = `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(R() * 360)})">`;
  for (let layer = 0; layer < 3; layer++) {
    const rr = r * (1 - layer * 0.28), c = cols[layer % cols.length];
    for (let i = 0; i < n; i++) {
      const a = (i + layer * 0.5) * 360 / n;
      s += `<ellipse cx="0" cy="${f(-rr * 0.55)}" rx="${f(rr * 0.32)}" ry="${f(rr * 0.5)}" transform="rotate(${f(a)})" fill="${c}" stroke="${INK}" stroke-width="1.6"/>`;
    }
  }
  s += `<circle r="${f(r * 0.22)}" fill="${cols[3] || '#F2C14E'}" stroke="${INK}" stroke-width="1.6"/>`;
  for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5; s += `<circle cx="${f(Math.cos(a) * r * 0.13)}" cy="${f(Math.sin(a) * r * 0.13)}" r="${f(r * 0.025)}" fill="${INK}"/>`; }
  return s + '</g>';
}
function bird(x, y, s, flip, body, wing) {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${flip ? -s : s} ${s})">
    <path d="M-40 0Q-10 -34 30 -10Q46 -16 54 -6Q46 0 36 2Q14 26 -20 14L-64 22Q-50 8 -40 0Z" fill="${body}" stroke="${INK}" stroke-width="2.4"/>
    <path d="M-12 -4Q6 -46 34 -38Q20 -14 4 4Z" fill="${wing}" stroke="${INK}" stroke-width="2.2"/>
    <circle cx="38" cy="-9" r="3" fill="${INK}"/></g>`;
}
function butterfly(R, x, y, s, a, c1, c2) {
  const dots = Array.from({ length: 4 }, (_, i) => `<circle cx="${f(-24 - i * 6)}" cy="${f(-20 + i * 9)}" r="3.5" fill="${c2}"/><circle cx="${f(24 + i * 6)}" cy="${f(-20 + i * 9)}" r="3.5" fill="${c2}"/>`).join('');
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(a)}) scale(${s})">
    <path d="M0 0C-20 -50 -70 -50 -60 -10C-56 8 -30 10 0 0Z M0 0C20 -50 70 -50 60 -10C56 8 30 10 0 0Z" fill="${c1}" stroke="${INK}" stroke-width="2.2"/>
    <path d="M0 2C-16 20 -44 40 -36 14C-32 4 -14 4 0 2Z M0 2C16 20 44 40 36 14C32 4 14 4 0 2Z" fill="${c2}" stroke="${INK}" stroke-width="2.2"/>
    ${dots}<path d="M0 -14L0 22" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    <path d="M0 -14Q-8 -34 -16 -38M0 -14Q8 -34 16 -38" fill="none" stroke="${INK}" stroke-width="1.8"/></g>`;
}

// ---- 1. 푸른 정원 ----
function blueGarden() {
  const R = rng(11);
  const defs = `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9FD9E6"/><stop offset=".5" stop-color="#3E9AB8"/><stop offset="1" stop-color="#1D4E73"/></linearGradient>`;
  let b = `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;
  // 멀리 보이는 둥근 언덕과 해
  b += `<circle cx="1260" cy="220" r="120" fill="#FCE9B8" stroke="${INK}" stroke-width="3"/>`;
  for (let i = 0; i < 14; i++) b += `<path d="M${1260 + Math.cos(i / 14 * Math.PI * 2) * 140} ${220 + Math.sin(i / 14 * Math.PI * 2) * 140}L${1260 + Math.cos(i / 14 * Math.PI * 2) * 175} ${220 + Math.sin(i / 14 * Math.PI * 2) * 175}" stroke="${INK}" stroke-width="3"/>`;
  b += `<path d="M0 520Q300 400 620 500T1250 470T1600 520V1200H0Z" fill="#2E7F9E" stroke="${INK}" stroke-width="3"/>`;
  const items = [];
  const warm = [['#F7B7A3', '#E2725B', '#FCE4D6', '#F2C14E'], ['#F5D06B', '#E89F2E', '#FFF1C9', '#B5462F'], ['#E9A6C8', '#C5508A', '#FBE3EF', '#F2C14E'], ['#FFFFFF', '#CFE7F0', '#9CC9DC', '#E2725B'], ['#C9B6F2', '#7E62C9', '#EDE5FF', '#F2C14E']];
  for (let i = 0; i < 260; i++) {
    const x = R() * W, y = 430 + Math.pow(R(), 0.8) * 820;
    const depth = (y - 430) / 820;
    if (R() < 0.55) {
      const g = ['#5FB38A', '#3F8F6B', '#8CCB8F', '#2F6E57', '#A9D98B'];
      items.push({ y, s: leaf(x, y, 50 + depth * 110, 16 + depth * 40, -70 + R() * 140, pick(R, g)) });
    } else {
      items.push({ y, s: rosette(R, x, y, 18 + depth * 46 + R() * 14, pick(R, warm)) });
    }
  }
  // 줄기 달린 큰 꽃
  for (let i = 0; i < 9; i++) {
    const x = 90 + i * 180 + R() * 60, y = 560 + R() * 160;
    items.push({ y: y - 1, s: `<path d="M${f(x)} ${f(y)}Q${f(x + 30)} ${f(y + 200)} ${f(x - 10)} 1200" fill="none" stroke="${INK}" stroke-width="4"/>` + leaf(x + 8, y + 160, 120, 36, 50, '#3F8F6B') + leaf(x + 4, y + 220, 110, 34, -50, '#5FB38A') });
    items.push({ y, s: rosette(R, x, y, 58 + R() * 20, pick(R, warm)) });
  }
  items.sort((a, c) => a.y - c.y);
  b += items.map(i => i.s).join('');
  b += bird(380, 260, 1.4, false, '#F6F1E7', '#E2725B') + bird(720, 180, 1.1, true, '#F5D06B', '#1D4E73') + bird(980, 330, 0.9, false, '#E9A6C8', '#7E62C9');
  for (let i = 0; i < 40; i++) b += `<circle cx="${f(R() * W)}" cy="${f(R() * 420)}" r="${f(2 + R() * 4)}" fill="#FFFFFF" opacity=".8"/>`;
  return svg(defs, b);
}

// ---- 2. 달밤의 물결 ----
function moonWaves() {
  const R = rng(22);
  const defs = `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0F2440"/><stop offset="1" stop-color="#2779A7"/></linearGradient>`;
  let b = `<rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  for (let i = 0; i < 160; i++) { const x = R() * W, y = R() * 560, r = 1 + R() * 3; b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="#FFF6D8" opacity="${f(0.4 + R() * 0.6)}"/>`; }
  b += `<circle cx="420" cy="290" r="190" fill="#FBEFC8" stroke="${INK}" stroke-width="4"/>`;
  for (let i = 0; i < 9; i++) b += `<circle cx="${f(330 + R() * 180)}" cy="${f(220 + R() * 150)}" r="${f(10 + R() * 26)}" fill="#F1DFA6" stroke="${INK}" stroke-width="2"/>`;
  // 소용돌이 구름
  const cloud = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 0H260Q300 0 300 -30Q300 -60 270 -60Q250 -60 245 -42Q240 -80 200 -80Q170 -80 160 -50Q150 -100 100 -100Q50 -100 50 -50Q20 -60 10 -30Q0 -12 0 0Z" fill="#E7F4F7" stroke="${INK}" stroke-width="3"/><path d="M100 -50a22 22 0 1 1 22 22M215 -40a14 14 0 1 1 14 14" fill="none" stroke="${INK}" stroke-width="3"/></g>`;
  b += cloud(760, 230, 1.3) + cloud(1180, 380, 0.9) + cloud(80, 520, 0.8) + cloud(1250, 140, 0.7);
  // 학
  const crane = (x, y, s, flip) => `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})"><path d="M-60 10Q0 -10 60 0L110 -30L112 -24L66 8Q20 30 -40 24Z" fill="#FFFFFF" stroke="${INK}" stroke-width="2.5"/><path d="M-10 4Q-60 -90 -140 -110Q-70 -40 -30 20Z M10 6Q60 -70 150 -90Q80 -30 30 18Z" fill="#FFFFFF" stroke="${INK}" stroke-width="2.5"/><path d="M-140 -110L-120 -96M150 -90L130 -78" stroke="${INK}" stroke-width="6"/><circle cx="108" cy="-28" r="5" fill="#D9473B"/><path d="M-40 24L-90 60M-34 22L-80 66" stroke="${INK}" stroke-width="2"/></g>`;
  b += crane(1010, 520, 1.1, false) + crane(1330, 260, 0.75, true) + crane(700, 420, 0.6, true);
  // 청해파 물결: 위 줄부터 그려서 아래 줄이 겹치게
  const r = 64;
  const palettes = [['#1D4E73', '#2779A7', '#49C5B6', '#E7F4F7'], ['#163C5A', '#3E9AB8', '#8FD3D8', '#FFFFFF'], ['#21557E', '#49C5B6', '#B9E6E0', '#F6F1E7']];
  let row = 0;
  for (let y = 640; y < H + r; y += r / 2, row++) {
    for (let x = (row % 2) * r - r; x < W + r; x += 2 * r) {
      const pal = palettes[(Math.floor((x + r) / 300) + row) % 3];
      const warm = R() < 0.06;
      for (let k = 0; k < 4; k++) {
        const rr = r * (1 - k * 0.22);
        b += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rr)}" fill="${warm && k === 3 ? '#F2C14E' : pal[k]}" stroke="${INK}" stroke-width="2"/>`;
      }
    }
  }
  return svg(defs, b);
}

// ---- 3. 푸른 타일 ----
function blueTiles() {
  const R = rng(33);
  const T = 200, cols = W / T, rows = H / T;
  let b = `<rect width="${W}" height="${H}" fill="#F6F1E7"/>`;
  const blues = ['#1D4E73', '#2779A7', '#3E9AB8', '#49C5B6'];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * T, y = r * T, cx = x + T / 2, cy = y + T / 2;
      const main = blues[(r + c * 2) % 4], second = blues[(r * 3 + c + 1) % 4];
      const accent = (r * cols + c) % 7 === 3 ? '#E2725B' : (r * cols + c) % 5 === 1 ? '#F2C14E' : '#FFFFFF';
      const bg = (r + c) % 2 ? '#FBF8F1' : '#EAF4F6';
      b += `<rect x="${x}" y="${y}" width="${T}" height="${T}" fill="${bg}" stroke="${INK}" stroke-width="3"/>`;
      // 모서리 사분원 (이웃 타일과 이어져 원이 된다)
      for (const [qx, qy] of [[x, y], [x + T, y], [x, y + T], [x + T, y + T]]) {
        b += `<circle cx="${qx}" cy="${qy}" r="46" fill="${second}" stroke="${INK}" stroke-width="2.4" clip-path="url(#t${r}_${c})"/>`;
        b += `<circle cx="${qx}" cy="${qy}" r="24" fill="${accent}" stroke="${INK}" stroke-width="2" clip-path="url(#t${r}_${c})"/>`;
      }
      b += `<clipPath id="t${r}_${c}"><rect x="${x}" y="${y}" width="${T}" height="${T}"/></clipPath>`;
      const n = 4 + ((r * 5 + c * 3) % 9);
      const kind = (r + c * 3) % 3;
      b += `<g transform="translate(${cx} ${cy})">`;
      if (kind === 0) {
        for (let i = 0; i < n; i++) b += `<ellipse cy="-36" rx="13" ry="30" transform="rotate(${f(i * 360 / n)})" fill="${main}" stroke="${INK}" stroke-width="2"/>`;
      } else if (kind === 1) {
        let d = '';
        for (let i = 0; i < n * 2; i++) { const a = i * Math.PI / n, rr = i % 2 ? 30 : 66; d += (i ? 'L' : 'M') + f(Math.cos(a) * rr) + ' ' + f(Math.sin(a) * rr); }
        b += `<path d="${d}Z" fill="${main}" stroke="${INK}" stroke-width="2.4"/>`;
      } else {
        for (let i = 0; i < 4; i++) b += `<circle cx="${f(Math.cos(i * Math.PI / 2) * 30)}" cy="${f(Math.sin(i * Math.PI / 2) * 30)}" r="30" fill="${main}" stroke="${INK}" stroke-width="2.2" opacity=".95"/>`;
        for (let i = 0; i < n; i++) { const a = i * Math.PI * 2 / n; b += `<circle cx="${f(Math.cos(a) * 74)}" cy="${f(Math.sin(a) * 74)}" r="5" fill="${second}" stroke="${INK}" stroke-width="1.4"/>`; }
      }
      b += `<circle r="${18 + (c % 3) * 4}" fill="${accent}" stroke="${INK}" stroke-width="2"/><circle r="6" fill="${INK}"/></g>`;
      // 타일마다 다른 작은 무늬 (맞추기 쉽게)
      b += `<path d="M${cx - 16} ${y + 14}L${cx} ${y + 4}L${cx + 16} ${y + 14}" fill="none" stroke="${main}" stroke-width="4"/>`;
      if (R() < 0.4) b += `<rect x="${cx - 8}" y="${y + T - 22}" width="16" height="16" transform="rotate(45 ${cx} ${y + T - 14})" fill="${accent}" stroke="${INK}" stroke-width="1.6"/>`;
    }
  }
  return svg('', b);
}

// ---- 4. 꽃다발과 나비 ----
function bouquet() {
  const R = rng(44);
  const defs = `<radialGradient id="bg4" cx=".5" cy=".42" r=".75"><stop offset="0" stop-color="#FFFBF2"/><stop offset="1" stop-color="#E8DDC7"/></radialGradient>
  <pattern id="dots" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="20" cy="20" r="2.2" fill="#C9B994"/></pattern>`;
  let b = `<rect width="${W}" height="${H}" fill="url(#bg4)"/><rect width="${W}" height="${H}" fill="url(#dots)" opacity=".7"/>`;
  b += `<rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="#2779A7" stroke-width="6"/><rect x="58" y="58" width="${W - 116}" height="${H - 116}" fill="none" stroke="${INK}" stroke-width="2"/>`;
  // 꽃병: 초록-빨강-초록 줄무늬
  b += `<path d="M640 860Q600 900 610 1010Q620 1110 800 1120Q980 1110 990 1010Q1000 900 960 860Z" fill="#F6F1E7" stroke="${INK}" stroke-width="4"/>`;
  b += `<clipPath id="vase"><path d="M640 860Q600 900 610 1010Q620 1110 800 1120Q980 1110 990 1010Q1000 900 960 860Z"/></clipPath>`;
  b += `<g clip-path="url(#vase)"><rect x="560" y="960" width="480" height="30" fill="#1F6B4A"/><rect x="560" y="990" width="480" height="26" fill="#C8323A"/><rect x="560" y="1016" width="480" height="30" fill="#1F6B4A"/></g>`;
  b += `<path d="M640 860H960" stroke="${INK}" stroke-width="4"/><rect x="560" y="1120" width="480" height="18" rx="9" fill="#2779A7" stroke="${INK}" stroke-width="3"/>`;
  const items = [];
  const green = ['#3F8F6B', '#5FB38A', '#2F6E57', '#8CCB8F'];
  for (let i = 0; i < 70; i++) {
    const a = -Math.PI * (0.05 + R() * 0.9), d = 160 + R() * 380;
    const x = 800 + Math.cos(a) * d * 1.25, y = 820 + Math.sin(a) * d;
    items.push({ z: 0, s: leaf(x, y, 70 + R() * 70, 20 + R() * 18, (a * 180 / Math.PI) + 90 + (R() - 0.5) * 40, pick(R, green)) });
  }
  const pals = [['#F7B7A3', '#E2725B', '#FCE4D6', '#F2C14E'], ['#FFFFFF', '#F6E2E8', '#E9A6C8', '#C5508A'], ['#F5D06B', '#E89F2E', '#FFF1C9', '#B5462F'], ['#9FD9E6', '#2779A7', '#E7F4F7', '#F2C14E'], ['#C9B6F2', '#7E62C9', '#EDE5FF', '#F2C14E'], ['#E2725B', '#B5462F', '#F7B7A3', '#1D4E73']];
  for (let i = 0; i < 48; i++) {
    const a = -Math.PI * (0.08 + R() * 0.84), d = R() * 400;
    const x = 800 + Math.cos(a) * d * 1.3, y = 760 + Math.sin(a) * d * 1.05;
    items.push({ z: 1 + R(), s: rosette(R, x, y, 34 + R() * 46, pick(R, pals)) });
  }
  items.sort((a, c) => a.z - c.z);
  b += items.map(i => i.s).join('');
  const bfs = [[260, 300, 1.3, -20, '#49C5B6', '#F2C14E'], [1330, 260, 1.1, 18, '#E2725B', '#FFFFFF'], [1240, 760, 0.9, -8, '#2779A7', '#F5D06B'], [300, 820, 1, 14, '#C5508A', '#9FD9E6'], [1450, 520, 0.7, 30, '#F2C14E', '#1D4E73'], [150, 560, 0.75, -30, '#7E62C9', '#FCE4D6']];
  for (const [x, y, s, a, c1, c2] of bfs) b += butterfly(R, x, y, s, a, c1, c2);
  // 흩날리는 꽃잎
  for (let i = 0; i < 50; i++) { const x = 90 + R() * (W - 180), y = 90 + R() * (H - 180); if (Math.hypot((x - 800) / 1.3, y - 700) < 470) continue; b += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="7" ry="13" transform="rotate(${f(R() * 360)} ${f(x)} ${f(y)})" fill="${pick(R, ['#E2725B', '#F2C14E', '#49C5B6', '#E9A6C8'])}" stroke="${INK}" stroke-width="1.2"/>`; }
  return svg(defs, b);
}

const arts = { 'blue-garden': blueGarden(), 'moon-waves': moonWaves(), 'blue-tiles': blueTiles(), 'bouquet': bouquet() };
for (const [name, s] of Object.entries(arts)) {
  fs.writeFileSync(path.join(OUT, name + '.svg'), s);
  console.log(name, Math.round(s.length / 1024) + 'KB');
}
