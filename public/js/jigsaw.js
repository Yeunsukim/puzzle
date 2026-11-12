// 조각 모양 만들기: 네 변마다 볼록(꼭지)·오목(홈)·평평
export const PAD = 0.3; // 조각 밖으로 꼭지가 튀어나오는 여유 (칸 크기 대비)

// 조각 (r,c)의 네 변 방향: 1 = 바깥으로 볼록, -1 = 안으로 오목, 0 = 평평(가장자리)
export function pieceDirs(r, c, rows, cols, edges) {
  return {
    top: r === 0 ? 0 : -edges.h[r - 1][c],
    right: c === cols - 1 ? 0 : edges.v[r][c],
    bottom: r === rows - 1 ? 0 : edges.h[r][c],
    left: c === 0 ? 0 : -edges.v[r][c - 1],
  };
}

// 한 변 그리기 (시계 방향으로 돌면서, 바깥쪽이 왼편 법선)
function edge(p, x0, y0, x1, y1, dir) {
  if (!dir) { p.lineTo(x1, y1); return; }
  const dx = x1 - x0, dy = y1 - y0;
  const nx = dy * dir, ny = -dx * dir;
  const P = (t, h) => [x0 + dx * t + nx * h, y0 + dy * t + ny * h];
  const L = (t, h) => { const q = P(t, h); p.lineTo(q[0], q[1]); };
  const B = (a, b, c) => { const A = P(...a), Bq = P(...b), C = P(...c); p.bezierCurveTo(A[0], A[1], Bq[0], Bq[1], C[0], C[1]); };
  L(0.36, 0);
  B([0.42, 0], [0.42, 0.08], [0.38, 0.12]);
  B([0.32, 0.20], [0.40, 0.27], [0.50, 0.27]);
  B([0.60, 0.27], [0.68, 0.20], [0.62, 0.12]);
  B([0.58, 0.08], [0.58, 0], [0.64, 0]);
  p.lineTo(x1, y1);
}

// size 크기 조각의 테두리 (왼쪽 위 모서리가 (off, off))
export function piecePath(size, dirs, off = 0) {
  const p = new Path2D();
  const a = off, b = off + size;
  p.moveTo(a, a);
  edge(p, a, a, b, a, dirs.top);
  edge(p, b, a, b, b, dirs.right);
  edge(p, b, b, a, b, dirs.bottom);
  edge(p, a, b, a, a, dirs.left);
  p.closePath();
  return p;
}

// 모든 조각 그림을 미리 그려 둔다 (그릴 때마다 다시 자르지 않도록)
export function buildPieces(img, crop, cols, rows, edges, S) {
  const isVector = /\.svg(\?|$)/i.test(img.src);
  const srcPerCell = crop.sw / cols;
  const P = Math.max(28, Math.min(isVector ? 240 : srcPerCell, 240, Math.floor(4096 / cols), Math.floor(4096 / rows)) | 0);
  const bw = cols * P, bh = rows * P;
  const big = document.createElement('canvas');
  big.width = bw; big.height = bh;
  const bctx = big.getContext('2d');
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(img, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, bw, bh);

  const pad = Math.ceil(P * PAD);
  const box = P + pad * 2;
  const lw = Math.max(1, P * 0.022);
  const sprites = [], paths = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dirs = pieceDirs(r, c, rows, cols, edges);
      const cv = document.createElement('canvas');
      cv.width = box; cv.height = box;
      const ctx = cv.getContext('2d');
      const path = piecePath(P, dirs, pad);
      ctx.save();
      ctx.clip(path);
      const sx0 = Math.max(0, c * P - pad), sy0 = Math.max(0, r * P - pad);
      const sx1 = Math.min(bw, c * P + P + pad), sy1 = Math.min(bh, r * P + P + pad);
      ctx.drawImage(big, sx0, sy0, sx1 - sx0, sy1 - sy0, sx0 - c * P + pad, sy0 - r * P + pad, sx1 - sx0, sy1 - sy0);
      // 살짝 입체감
      const g = ctx.createLinearGradient(0, 0, box, box);
      g.addColorStop(0, 'rgba(255,255,255,.18)');
      g.addColorStop(0.5, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(0,0,0,.12)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, box, box);
      ctx.restore();
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(90,50,70,.35)';
      ctx.lineWidth = lw * 2;
      ctx.stroke(path);
      ctx.strokeStyle = 'rgba(255,255,255,.75)';
      ctx.lineWidth = lw;
      ctx.stroke(path);
      sprites.push(cv);
      paths.push(piecePath(S, dirs, 0));
    }
  }
  return { big, sprites, paths, padWorld: pad / P * S };
}
