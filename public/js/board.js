// 퍼즐판: 그리기, 조각 끌어 놓기, 화면 이동, 확대/축소
import { buildPieces } from './jigsaw.js';

const DRAG_START = 7; // 이만큼(화면 점) 움직여야 '끌기'로 본다. 그보다 적으면 '한 번 누르기'.

export class Board {
  constructor(canvas, o) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.o = o;
    this.S = o.S; this.cols = o.cols; this.rows = o.rows;
    this.W = o.cols * o.S; this.H = o.rows * o.S;
    this.me = o.me;
    const built = buildPieces(o.image, o.crop, o.cols, o.rows, o.edges, o.S);
    this.big = built.big; this.sprites = built.sprites; this.paths = built.paths; this.padW = built.padWorld;
    this.hitCtx = document.createElement('canvas').getContext('2d');
    this.cam = { x: 0, y: 0, z: 1 };
    this.minZ = 0.05; this.maxZ = 3;
    this.hint = false;
    this.pieces = [];
    this.order = [];          // 아직 안 맞춘 조각들 (뒤에 있을수록 위)
    this.cursors = new Map(); // 다른 사람 마우스
    this.effects = [];
    this.ptr = null; this.drag = null;
    this.need = true;
    this.lastMoveSent = 0; this.lastCursorSent = 0;
    this.setPieces(o.pieces);

    this.dpr = 1;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement);
    this.resize();
    this.fit();

    this.onDown = e => this.pointerDown(e);
    this.onMove = e => this.pointerMove(e);
    this.onUp = e => this.pointerUp(e, false);
    this.onCancel = e => this.pointerUp(e, true);
    this.onWheel = e => { e.preventDefault(); this.zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15); };
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onCancel);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    this.alive = true;
    const tick = () => { if (!this.alive) return; this.step(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  destroy() {
    this.alive = false;
    this.ro.disconnect();
  }

  // ---- 상태 ----
  setPieces(list) {
    this.pieces = list.map(s => ({ ...s, rx: s.x, ry: s.y, ang: s.rot * 90, angT: s.rot * 90 }));
    this.order = this.pieces.filter(p => !p.locked).map(p => p.id);
    this.need = true;
  }

  get lockedCount() { return this.pieces.reduce((a, p) => a + (p.locked ? 1 : 0), 0); }

  update(s) {
    const p = this.pieces[s.id];
    if (!p) return;
    if (this.drag && this.drag.id === s.id && s.held !== this.me) this.drag = null;
    if (!(this.drag && this.drag.id === s.id)) { p.x = s.x; p.y = s.y; }
    if (s.rot !== p.rot) {
      let diff = ((s.rot * 90 - p.angT) % 360 + 360) % 360;
      if (diff > 180) diff -= 360;
      p.angT += diff;
    }
    p.rot = s.rot; p.cell = s.cell; p.held = s.held;
    if (s.locked && !p.locked) {
      p.locked = true;
      this.order = this.order.filter(id => id !== p.id);
      this.effects.push({ x: p.x + this.S / 2, y: p.y + this.S / 2, t0: performance.now() });
    }
    this.need = true;
  }

  remoteGrab(id, uid) {
    const p = this.pieces[id];
    if (!p) return;
    p.held = uid;
    this.toTop(id);
    if (this.drag && this.drag.id === id) this.drag = null;
    this.need = true;
  }

  remoteMove(id, x, y) {
    const p = this.pieces[id];
    if (!p || (this.drag && this.drag.id === id)) return;
    p.x = x; p.y = y;
    this.need = true;
  }

  cancelDrag(id, s) {
    if (this.drag && this.drag.id === id) this.drag = null;
    if (s) this.update(s);
    this.need = true;
  }

  setCursor(uid, x, y) { this.cursors.set(uid, { x, y, t: performance.now() }); this.need = true; }
  removeCursor(uid) { this.cursors.delete(uid); this.need = true; }

  toTop(id) {
    const i = this.order.indexOf(id);
    if (i >= 0) { this.order.splice(i, 1); this.order.push(id); }
  }

  // ---- 화면 ----
  resize() {
    const r = this.c.parentElement.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.vw = Math.max(1, r.width); this.vh = Math.max(1, r.height);
    this.c.width = Math.round(this.vw * this.dpr);
    this.c.height = Math.round(this.vh * this.dpr);
    this.need = true;
  }

  bounds() {
    let x0 = -this.S * 0.3, y0 = -this.S * 0.3, x1 = this.W + this.S * 0.3, y1 = this.H + this.S * 0.3;
    for (const p of this.pieces) {
      x0 = Math.min(x0, p.x - this.padW); y0 = Math.min(y0, p.y - this.padW);
      x1 = Math.max(x1, p.x + this.S + this.padW); y1 = Math.max(y1, p.y + this.S + this.padW);
    }
    return { x0, y0, x1, y1 };
  }

  fit() {
    const b = this.bounds();
    const m = 30;
    const z = Math.min((this.vw - m * 2 - 90) / (b.x1 - b.x0), (this.vh - m * 2) / (b.y1 - b.y0));
    this.cam.z = Math.max(0.02, Math.min(this.maxZ, z));
    this.minZ = Math.min(this.cam.z * 0.7, 0.3);
    this.cam.x = (b.x0 + b.x1) / 2 - (this.vw - 90) / 2 / this.cam.z;
    this.cam.y = (b.y0 + b.y1) / 2 - this.vh / 2 / this.cam.z;
    this.need = true;
  }

  zoomAt(clientX, clientY, f) {
    const r = this.c.getBoundingClientRect();
    const sx = clientX - r.left, sy = clientY - r.top;
    const wx = this.cam.x + sx / this.cam.z, wy = this.cam.y + sy / this.cam.z;
    this.cam.z = Math.max(this.minZ, Math.min(this.maxZ, this.cam.z * f));
    this.cam.x = wx - sx / this.cam.z;
    this.cam.y = wy - sy / this.cam.z;
    this.need = true;
  }

  zoomBy(f) {
    const r = this.c.getBoundingClientRect();
    this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
  }

  toggleHint() { this.hint = !this.hint; this.need = true; return this.hint; }

  toWorld(clientX, clientY) {
    const r = this.c.getBoundingClientRect();
    return { x: this.cam.x + (clientX - r.left) / this.cam.z, y: this.cam.y + (clientY - r.top) / this.cam.z };
  }
  toScreen(wx, wy) {
    const r = this.c.getBoundingClientRect();
    return { x: (wx - this.cam.x) * this.cam.z + r.left, y: (wy - this.cam.y) * this.cam.z + r.top };
  }

  pieceAt(wx, wy) {
    const S = this.S, half = S / 2;
    for (let i = this.order.length - 1; i >= 0; i--) {
      const p = this.pieces[this.order[i]];
      let dx = wx - (p.x + half), dy = wy - (p.y + half);
      if (Math.abs(dx) > half + this.padW || Math.abs(dy) > half + this.padW) continue;
      const a = -p.rot * Math.PI / 2;
      const lx = dx * Math.cos(a) - dy * Math.sin(a) + half;
      const ly = dx * Math.sin(a) + dy * Math.cos(a) + half;
      if (this.hitCtx.isPointInPath(this.paths[p.id], lx, ly)) return p;
    }
    return null;
  }

  // ---- 마우스/손가락 ----
  pointerDown(e) {
    if (e.button > 0 || this.ptr) return;
    this.c.setPointerCapture(e.pointerId);
    const w = this.toWorld(e.clientX, e.clientY);
    const p = this.pieceAt(w.x, w.y);
    const free = p && (!p.held || p.held === this.me);
    this.ptr = { id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, piece: free ? p.id : -1, moved: false, cam: { ...this.cam } };
    this.o.onPress?.();
  }

  pointerMove(e) {
    const now = performance.now();
    const w = this.toWorld(e.clientX, e.clientY);
    if (now - this.lastCursorSent > 90) { this.lastCursorSent = now; this.o.onCursor?.(w.x, w.y); }
    if (!this.ptr || e.pointerId !== this.ptr.id) {
      if (!this.ptr) this.c.style.cursor = this.pieceAt(w.x, w.y) ? 'grab' : 'default';
      return;
    }
    this.ptr.cx = e.clientX; this.ptr.cy = e.clientY;
    if (!this.ptr.moved && Math.hypot(e.clientX - this.ptr.sx, e.clientY - this.ptr.sy) > DRAG_START) {
      this.ptr.moved = true;
      if (this.ptr.piece >= 0) {
        const p = this.pieces[this.ptr.piece];
        const w0 = this.toWorld(this.ptr.sx, this.ptr.sy);
        this.drag = { id: p.id, offX: w0.x - p.x, offY: w0.y - p.y };
        p.held = this.me;
        this.toTop(p.id);
        this.c.style.cursor = 'grabbing';
        this.o.onGrab(p.id);
      }
    }
    if (!this.ptr.moved) return;
    if (this.drag) this.dragTo(w);
    else {
      this.cam.x = this.ptr.cam.x - (e.clientX - this.ptr.sx) / this.cam.z;
      this.cam.y = this.ptr.cam.y - (e.clientY - this.ptr.sy) / this.cam.z;
      this.need = true;
    }
  }

  dragTo(w) {
    const p = this.pieces[this.drag.id];
    p.x = p.rx = w.x - this.drag.offX;
    p.y = p.ry = w.y - this.drag.offY;
    const now = performance.now();
    if (now - this.lastMoveSent > 50) { this.lastMoveSent = now; this.o.onMove(p.id, p.x, p.y); }
    this.need = true;
  }

  pointerUp(e, cancelled) {
    if (!this.ptr || e.pointerId !== this.ptr.id) return;
    const ptr = this.ptr;
    this.ptr = null;
    this.c.style.cursor = 'default';
    if (this.drag) {
      const p = this.pieces[this.drag.id];
      this.drag = null;
      this.o.onDrop(p.id, p.x, p.y);
    } else if (!ptr.moved && !cancelled) {
      if (ptr.piece >= 0) this.o.onClickPiece(ptr.piece, { x: e.clientX, y: e.clientY });
      else this.o.onClickEmpty?.();
    }
    this.need = true;
  }

  // ---- 매 화면마다 ----
  step() {
    let anim = false;
    // 끄는 중 화면 가장자리에 가까우면 화면이 따라 움직인다
    if (this.drag && this.ptr) {
      const r = this.c.getBoundingClientRect(), edge = 50, sp = 12;
      let vx = 0, vy = 0;
      if (this.ptr.cx < r.left + edge) vx = -sp; else if (this.ptr.cx > r.right - edge) vx = sp;
      if (this.ptr.cy < r.top + edge) vy = -sp; else if (this.ptr.cy > r.bottom - edge) vy = sp;
      if (vx || vy) {
        this.cam.x += vx / this.cam.z; this.cam.y += vy / this.cam.z;
        this.ptr.cam.x += vx / this.cam.z; this.ptr.cam.y += vy / this.cam.z;
        this.dragTo(this.toWorld(this.ptr.cx, this.ptr.cy));
        anim = true;
      }
    }
    for (const p of this.pieces) {
      if (Math.abs(p.rx - p.x) > 0.3 || Math.abs(p.ry - p.y) > 0.3) {
        p.rx += (p.x - p.rx) * 0.3; p.ry += (p.y - p.ry) * 0.3; anim = true;
      } else { p.rx = p.x; p.ry = p.y; }
      if (Math.abs(p.ang - p.angT) > 0.5) { p.ang += (p.angT - p.ang) * 0.3; anim = true; } else p.ang = p.angT;
    }
    if (this.effects.length) anim = true;
    if (anim || this.need) { this.draw(); this.need = false; }
  }

  draw() {
    const { ctx, S, W, H, cam, dpr } = this;
    const z = cam.z;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.c.width, this.c.height);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, -cam.x * z * dpr, -cam.y * z * dpr);

    // 퍼즐 틀
    const fp = S * 0.14;
    ctx.save();
    ctx.shadowColor = 'rgba(18,50,75,.25)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.roundRect(-fp, -fp, W + fp * 2, H + fp * 2, S * 0.06); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#EFE8DA';
    ctx.fillRect(0, 0, W, H);
    if (this.hint) { ctx.globalAlpha = 0.3; ctx.drawImage(this.big, 0, 0, W, H); ctx.globalAlpha = 1; }
    ctx.strokeStyle = 'rgba(20,32,43,.14)';
    ctx.lineWidth = Math.max(1 / z, S * 0.012);
    ctx.beginPath();
    for (let i = 1; i < this.cols; i++) { ctx.moveTo(i * S, 0); ctx.lineTo(i * S, H); }
    for (let i = 1; i < this.rows; i++) { ctx.moveTo(0, i * S); ctx.lineTo(W, i * S); }
    ctx.stroke();
    ctx.strokeStyle = '#1D4E73';
    ctx.lineWidth = Math.max(2 / z, S * 0.02);
    ctx.strokeRect(0, 0, W, H);

    // 화면에 보이는 범위
    const vx0 = cam.x - S, vy0 = cam.y - S, vx1 = cam.x + this.vw / z + S, vy1 = cam.y + this.vh / z + S;
    const visible = p => p.rx < vx1 && p.rx + S > vx0 && p.ry < vy1 && p.ry + S > vy0;

    for (const p of this.pieces) if (p.locked && visible(p)) this.drawPiece(p);
    for (const id of this.order) { const p = this.pieces[id]; if (visible(p)) this.drawPiece(p); }

    // 맞췄을 때 반짝
    const now = performance.now();
    this.effects = this.effects.filter(f => now - f.t0 < 700);
    for (const f of this.effects) {
      const k = (now - f.t0) / 700;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = '#C9A45C';
      ctx.lineWidth = S * 0.08 * (1 - k) + 1 / z;
      ctx.beginPath(); ctx.arc(f.x, f.y, S * (0.4 + k * 0.6), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#49C5B6';
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + k;
        const d = S * (0.3 + k * 0.8);
        ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, S * 0.06 * (1 - k), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // 다른 사람 마우스
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const [uid, cu] of this.cursors) {
      if (now - cu.t > 8000) continue;
      const info = this.o.playerInfo(uid);
      if (!info) continue;
      const sx = (cu.x - cam.x) * z, sy = (cu.y - cam.y) * z;
      if (sx < -40 || sy < -40 || sx > this.vw + 40 || sy > this.vh + 40) continue;
      ctx.fillStyle = info.color;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 4, sy + 22); ctx.lineTo(sx + 18, sy + 14); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 30, sy + 30, 19, 0, Math.PI * 2); ctx.fill();
      if (info.img?.complete) ctx.drawImage(info.img, sx + 14, sy + 14, 32, 32);
      ctx.font = '700 15px "Noto Sans KR", sans-serif';
      const tw = ctx.measureText(info.nick).width;
      ctx.fillStyle = info.color;
      ctx.beginPath(); ctx.roundRect(sx + 52, sy + 18, tw + 16, 24, 12); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(info.nick, sx + 60, sy + 35);
    }
  }

  drawPiece(p) {
    const { ctx, S } = this;
    const half = S / 2, pw = this.padW;
    const dragging = this.drag && this.drag.id === p.id;
    const other = !p.locked && p.held && p.held !== this.me ? this.o.playerInfo(p.held) : null;
    ctx.save();
    ctx.translate(p.rx + half, p.ry + half);
    if (p.ang % 360) ctx.rotate(p.ang * Math.PI / 180);
    if (dragging || other) {
      ctx.shadowColor = 'rgba(74,55,64,.35)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 8;
      ctx.scale(1.04, 1.04);
    }
    ctx.drawImage(this.sprites[p.id], -half - pw, -half - pw, S + pw * 2, S + pw * 2);
    if (other) {
      ctx.shadowColor = 'transparent';
      ctx.translate(-half, -half);
      ctx.strokeStyle = other.color;
      ctx.lineWidth = Math.max(3 / this.cam.z, S * 0.05);
      ctx.stroke(this.paths[p.id]);
    }
    ctx.restore();
  }
}
