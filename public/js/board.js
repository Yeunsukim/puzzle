// 퍼즐판: 그리기, 조각 끌어 놓기, 화면 이동, 확대/축소
import { buildPieces } from './jigsaw.js';

const DRAG_START = 12; // 이만큼(화면 점) 움직여야 '끌기'로 본다. 손이 조금 떨려도 '누르기'로 알아보도록 넉넉하게.
const PICK_SCALE = 1.3; // 고른 조각을 틀 밖에서 얼마나 크게 보여 줄지
const SMALL_DRAG = 24; // 이보다 적게 끌었다 놓으면 '실수로 조금 움직인 것'으로 보고 선택을 지우지 않는다

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
    // 틀 안의 칸 선: 직선 대신 각 칸에 들어갈 조각 모양 그대로 (꼬불꼬불한 선)
    this.gridPath = new Path2D();
    for (let i = 0; i < this.paths.length; i++) {
      const c = i % o.cols, r = Math.floor(i / o.cols);
      this.gridPath.addPath(this.paths[i], new DOMMatrix().translate(c * o.S, r * o.S));
    }
    this.cam = { x: 0, y: 0, z: 1 };
    this.minZ = 0.05; this.maxZ = 3;
    this.hint = false;
    this.pieces = [];
    this.order = [];          // 아직 안 맞춘 조각들 (뒤에 있을수록 위)
    this.cursors = new Map(); // 다른 사람 마우스
    this.effects = [];
    this.ptr = null; this.drag = null;
    this.touches = new Map();  // 화면에 닿아 있는 손가락들
    this.pinch = null;         // 두 손가락으로 벌려 확대하는 중
    this.moveMode = -1;        // '놓을 곳 누르기'로 옮길 조각
    this.selected = -1;        // 지금 고른 조각
    this.remoteSel = new Map(); // 친구 uid -> 친구가 골라 둔 조각
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
    // '놓기' 신호가 퍼즐판 밖(단추 위 등)에서 일어나도 놓치지 않게 화면 전체에서 받는다
    this.onWinUp = e => { if (this.ptr && e.pointerId === this.ptr.id && e.target !== canvas) this.pointerUp(e, false); };
    window.addEventListener('pointerup', this.onWinUp, true);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    // 윈도우가 알려 주는 '두 번 누르기'도 받는다 (사람마다 누르는 속도가 달라서)
    this.onDbl = e => {
      e.preventDefault();
      const w = this.toWorld(e.clientX, e.clientY);
      const p = this.pieceAt(w.x, w.y);
      if (!p || (p.held && p.held !== this.me)) return;
      if (performance.now() - (this.dblAt || 0) < 1500) return; // 누르는 순간 이미 처리했으면 넘어간다
      this.tapWorld = w;
      this.lastTap = null;
      this.o.onDoubleClickPiece?.(p.id);
      this.shake(p.id);
    };
    canvas.addEventListener('dblclick', this.onDbl);

    // 밝은/어두운 화면에 맞는 퍼즐판 색 (CSS에 적어 둔 색을 읽어 온다)
    this.readTheme();
    this.onTheme = () => { this.readTheme(); this.need = true; };
    window.addEventListener('themechange', this.onTheme);

    if (/debug=1/.test(location.search)) {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:999;background:rgba(0,0,0,.8);color:#fff;font:14px/1.4 monospace;padding:8px 10px;border-radius:8px;max-width:520px;pointer-events:none;white-space:pre';
      document.body.appendChild(box);
      const lines = [];
      this.debug = t => { lines.push(new Date().toLocaleTimeString('ko-KR') + ' ' + t); while (lines.length > 14) lines.shift(); box.textContent = lines.join(String.fromCharCode(10)); };
      this.debugBox = box;
    }

    this.alive = true;
    const tick = () => { if (!this.alive) return; this.step(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  destroy() {
    this.alive = false;
    this.ro.disconnect();
    window.removeEventListener('pointerup', this.onWinUp, true);
    window.removeEventListener('themechange', this.onTheme);
    this.debugBox?.remove();
  }

  readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, d) => cs.getPropertyValue(name).trim() || d;
    this.theme = {
      frame: v('--board-frame', '#FFFFFF'), cell: v('--board-cell', '#EFE8DA'),
      grid: v('--board-grid', 'rgba(20,32,43,.14)'), edge: v('--board-edge', '#1D4E73'),
    };
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

  // 연결이 끊기거나 다시 붙을 때: 끄는 중·누르는 중 상태를 모두 정리한다
  resetInput() {
    this.drag = null; this.ptr = null; this.pinch = null; this.moveMode = -1;
    this.touches.clear();
    this.c.style.cursor = 'default';
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
    let b = this.bounds();
    const m = 30;
    let z = Math.min((this.vw - m * 2 - 90) / (b.x1 - b.x0), (this.vh - m * 2) / (b.y1 - b.y0));
    this.minZ = Math.min(Math.max(0.02, z) * 0.7, 0.3);
    // 화면이 좁아서(휴대폰) 조각이 너무 작게 보이면, 퍼즐 틀을 화면에 꽉 차게 보여 준다
    const minPiece = this.vw < 760 ? 40 : 0;
    if (this.S * z < minPiece) {
      b = { x0: -this.S * 0.2, y0: -this.S * 0.2, x1: this.W + this.S * 0.2, y1: this.H + this.S * 0.2 };
      z = Math.min((this.vw - 20 - 90) / (b.x1 - b.x0), (this.vh - 140) / (b.y1 - b.y0));
      z = Math.max(z, minPiece / this.S * 0.8);
    }
    this.cam.z = Math.max(0.02, Math.min(this.maxZ, z));
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
    // 고른 조각은 1.3배로 크게 그려져 있으니 그 크기대로 먼저 확인
    const sel = this.pieces[this.selected];
    if (sel && !sel.locked) {
      const sk = this.selBig ? PICK_SCALE : 1;
      const dx = (wx - (sel.x + half)) / sk, dy = (wy - (sel.y + half)) / sk;
      const a = -sel.rot * Math.PI / 2;
      const lx = dx * Math.cos(a) - dy * Math.sin(a) + half;
      const ly = dx * Math.sin(a) + dy * Math.cos(a) + half;
      if (Math.abs(dx) <= half + this.padW && Math.abs(dy) <= half + this.padW && this.hitCtx.isPointInPath(this.paths[sel.id], lx, ly)) return sel;
    }
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

  // 손가락으로 누를 때는 조각 모양 바깥을 조금 눌러도 가장 가까운 조각을 고른다
  pieceNear(wx, wy, screenR) {
    const exact = this.pieceAt(wx, wy);
    if (exact) return exact;
    const r = screenR / this.cam.z, half = this.S / 2;
    let best = null, bd = Infinity;
    for (let i = this.order.length - 1; i >= 0; i--) {
      const p = this.pieces[this.order[i]];
      const d = Math.max(Math.abs(wx - (p.x + half)), Math.abs(wy - (p.y + half))) - half;
      if (d < r && d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ---- 마우스/손가락 ----
  pointerDown(e) {
    if (e.button > 0) return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // 두 번째 손가락이 닿으면: 끌던 조각은 그 자리에 놓고 '벌려서 확대' 시작
    if (this.touches.size >= 2) {
      if (this.pinch) return;
      if (this.drag) { const p = this.pieces[this.drag.id]; this.drag = null; this.o.onDrop(p.id, p.x, p.y); }
      this.ptr = null;
      this.startPinch();
      return;
    }
    // 예전 누르기가 '놓기' 없이 남아 있으면(놓기 신호를 놓친 경우) 먼저 그 자리에 놓아 정리한다
    if (this.ptr && e.pointerType === 'mouse' && this.ptr.id === e.pointerId) {
      this.debug?.('놓기 신호를 놓쳐서 정리함');
      this.pointerUp({ pointerId: this.ptr.id, clientX: this.ptr.cx, clientY: this.ptr.cy }, false);
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (this.ptr || this.pinch) return;
    try { this.c.setPointerCapture(e.pointerId); } catch { /* 잡기 실패해도 계속 */ }
    const touch = e.pointerType !== 'mouse';
    const w = this.toWorld(e.clientX, e.clientY);
    const p = touch ? this.pieceNear(w.x, w.y, 22) : this.pieceAt(w.x, w.y);
    const free = p && (!p.held || p.held === this.me);
    this.ptr = { id: e.pointerId, touch, sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, piece: free ? p.id : -1, moved: false, cam: { ...this.cam } };
    this.o.onPress?.();
    // 눌렀다 뗐다 → 다시 '누르는 순간': 바로 잡았다(흔들기 + 흰 테두리 + 크기). 손을 떼지 않고 그대로 끌 수 있다.
    const last = this.lastTap;
    if (free && last && last.id === p.id && performance.now() - last.t < 1000) {
      this.lastTap = null;
      this.ptr.dbl = true;
      this.dblAt = performance.now();
      this.tapWorld = w;
      this.o.onDoubleClickPiece?.(p.id);
      this.shake(p.id);
    } else if (free) {
      // 조각을 잡는 순간: 흔들어서 '잡았다'를 알려 주고, 바로 흰 테두리 + 크기
      if (this.selected !== p.id) {
        this.tapWorld = w;
        this.setSelected(p.id);
        this.o.onPressPiece?.(p.id);
      }
      this.shake(p.id);
    }
    this.debug?.(`누름 조각=${free ? p.id : '없음'} 두번째=${!!this.ptr.dbl} 선택=${this.selected} 종류=${e.pointerType}`);
  }

  startPinch() {
    const [a, b] = [...this.touches.values()];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    this.pinch = { d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), z0: this.cam.z, world: this.toWorld(mx, my) };
  }

  movePinch() {
    const [a, b] = [...this.touches.values()];
    const r = this.c.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top;
    const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
    this.cam.z = Math.max(this.minZ, Math.min(this.maxZ, this.pinch.z0 * d / this.pinch.d0));
    this.cam.x = this.pinch.world.x - mx / this.cam.z;
    this.cam.y = this.pinch.world.y - my / this.cam.z;
    this.need = true;
  }

  pointerMove(e) {
    // 마우스 단추가 이미 떼어져 있는데 끄는 중으로 남아 있으면 놓은 것으로 처리
    if (this.ptr && e.pointerType === 'mouse' && e.pointerId === this.ptr.id && e.buttons === 0 && this.ptr.moved) { this.pointerUp(e, false); return; }
    if (this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch) { if (this.touches.size >= 2) this.movePinch(); return; }
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
        // 손가락일 때는 조각을 손가락보다 조금 위로 띄워서 손가락에 가려지지 않게
        const lift = this.ptr.touch ? 56 / this.cam.z : 0;
        this.drag = { id: p.id, offX: w0.x - p.x, offY: w0.y - p.y + lift };
        p.held = this.me;
        this.toTop(p.id);
        this.c.style.cursor = 'grabbing';
        this.o.onGrab(p.id);
      }
    }
    if (!this.ptr.moved) return;
    if (this.drag) {
      // 고른 조각을 끄는 중: 마우스가 틀 밖이면 1.3배, 틀 안이면 원래 크기
      if (this.drag.id === this.selected) this.selBig = !this.inFrameAt(w.x, w.y);
      this.dragTo(w);
    }
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
    this.touches.delete(e.pointerId);
    if (this.pinch) { if (this.touches.size < 2) this.pinch = null; return; }
    if (!this.ptr || e.pointerId !== this.ptr.id) return;
    const ptr = this.ptr;
    this.ptr = null;
    this.c.style.cursor = 'default';
    if (this.drag) {
      const p = this.pieces[this.drag.id];
      this.drag = null;
      this.debug?.(`놓음 조각=${p.id} 움직인거리=${Math.round(Math.hypot(e.clientX - ptr.sx, e.clientY - ptr.sy))}`);
      const dist = Math.hypot(e.clientX - ptr.sx, e.clientY - ptr.sy);
      this.o.onDrop(p.id, p.x, p.y);
      if (dist < SMALL_DRAG) {
        // 아주 조금만 움직였다 놓음: 끌기가 아니라 '누르기'로 본다 (손이 흔들려도 되게)
        this.tapWorld = this.toWorld(e.clientX, e.clientY);
        if (!ptr.dbl) this.tap(p.id, e);
      } else if (this.selected === p.id) this.setSelected(-1); // 내려놓으면 흰 테두리를 지운다
    } else if (!ptr.moved && !cancelled) {
      this.debug?.(`뗌(누르기) 조각=${ptr.piece} 두번째=${!!ptr.dbl}`);
      this.tapWorld = this.toWorld(e.clientX, e.clientY); // 누른 곳 (틀 안팎 판단용)
      // '놓을 곳 누르기' 중이면 누른 곳으로 조각을 옮긴다
      if (this.moveMode >= 0) {
        const w = this.toWorld(e.clientX, e.clientY);
        const id = this.moveMode;
        this.moveMode = -1;
        this.o.onTapMove?.(id, w.x - this.S / 2, w.y - this.S / 2);
      } else if (ptr.piece >= 0) {
        if (!ptr.dbl) this.tap(ptr.piece, e); // 이미 '잡았다'로 처리한 두 번째 누르기면 메뉴를 다시 띄우지 않는다
      }
      else this.o.onClickEmpty?.();
    }
    this.need = true;
  }

  // 조각 누르기: 한 번이면 메뉴, 1초 안에 같은 조각을 또 누르면 '두 번 누르기'(잡았다!)
  tap(id, e) {
    const now = performance.now(), last = this.lastTap;
    this.lastTap = { id, t: now };
    if (last && last.id === id && now - last.t < 1000) {
      this.lastTap = null;
      this.o.onDoubleClickPiece?.(id);
      this.shake(id);
    } else this.o.onClickPiece(id, { x: e.clientX, y: e.clientY });
  }

  // '잡았다' 표시: 조각을 잠깐 좌우로 흔든다
  shake(id) { this.wiggle = { id, t0: performance.now() }; this.need = true; }

  setRemoteSelect(uid, id) { if (id >= 0) this.remoteSel.set(uid, id); else this.remoteSel.delete(uid); this.need = true; }
  // 이 조각을 골라 둔 친구 (없으면 null)
  remotePicker(id) { for (const [uid, sid] of this.remoteSel) if (sid === id && uid !== this.me) return uid; return null; }

  setMoveMode(id) { this.moveMode = id; this.need = true; }

  // 고른 조각: 1.3배 크게 + 흰 테두리로 보여 준다 (-1 이면 선택 해제)
  // 크기는 마우스로 누른 곳 기준: 틀 밖이면 1.3배, 틀 안이면 원래 크기
  setSelected(id) {
    if (this.selected !== id) this.o.onSelect?.(id);
    this.selected = id;
    if (id >= 0) {
      this.toTop(id);
      const p = this.pieces[id], w = this.tapWorld || { x: p.x + this.S / 2, y: p.y + this.S / 2 };
      this.selBig = !this.inFrameAt(w.x, w.y);
    }
    this.need = true;
  }

  inFrameAt(wx, wy) { return wx >= 0 && wx <= this.W && wy >= 0 && wy <= this.H; }

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
    if (this.wiggle) { if (performance.now() - this.wiggle.t0 < 520) anim = true; else { this.wiggle = null; this.need = true; } }
    if (anim || this.need) { this.draw(); this.need = false; }
  }

  // 틀 그림(그림자 + 바탕 + 작게 볼 때의 칸 선)을 배율에 맞춰 만들어 두기
  frameLayer(scale, withGrid) {
    const th = this.theme, S = this.S, W = this.W, H = this.H;
    // 배율을 1.25배 단위로 끊어서, 확대·축소 때마다 새로 만들지 않게
    let k = Math.pow(1.25, Math.round(Math.log(scale) / Math.log(1.25)));
    const margin = S * 0.6;
    k = Math.min(k, 4096 / (W + margin * 2), 4096 / (H + margin * 2));
    const key = [k.toFixed(4), withGrid, th.frame, th.cell, th.grid].join('|');
    if (this._layer?.key === key) return this._layer;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round((W + margin * 2) * k));
    cv.height = Math.max(1, Math.round((H + margin * 2) * k));
    const c = cv.getContext('2d');
    c.setTransform(k, 0, 0, k, margin * k, margin * k);
    const fp = S * 0.14;
    c.save();
    c.shadowColor = 'rgba(18,50,75,.25)';
    c.shadowBlur = Math.min(40 * k, 60);
    c.shadowOffsetY = 10 * k;
    c.fillStyle = th.frame;
    c.beginPath(); c.roundRect(-fp, -fp, W + fp * 2, H + fp * 2, S * 0.06); c.fill();
    c.restore();
    c.fillStyle = th.cell;
    c.fillRect(0, 0, W, H);
    if (withGrid) {
      c.save();
      c.beginPath(); c.rect(0, 0, W, H); c.clip();
      c.strokeStyle = th.grid;
      c.lineJoin = 'round';
      c.lineWidth = Math.max(1.2 / k, S * 0.016);
      c.stroke(this.gridPath);
      c.restore();
    }
    this._layer = { key, cv, margin };
    return this._layer;
  }

  // 작게 볼 때 쓰는 작은 조각 그림 (큰 그림을 매번 줄여 그리면 느려서)
  smallAtlas() {
    if (this._atlas) return this._atlas;
    const n = 48, count = this.sprites.length, per = Math.ceil(Math.sqrt(count));
    const cv = document.createElement('canvas');
    cv.width = per * n; cv.height = Math.ceil(count / per) * n;
    const c = cv.getContext('2d');
    c.imageSmoothingQuality = 'high';
    this.sprites.forEach((sp, i) => c.drawImage(sp, (i % per) * n, Math.floor(i / per) * n, n, n));
    this._atlas = { cv, n, per };
    return this._atlas;
  }

  draw() {
    const { ctx, S, W, H, cam, dpr } = this;
    const z = cam.z;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.c.width, this.c.height);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, -cam.x * z * dpr, -cam.y * z * dpr);

    // 퍼즐 틀 (그림자·바탕·칸 선) — 미리 그려 둔 그림 한 장을 쓴다
    const th = this.theme;
    const cellPx = S * z * dpr;
    const layer = this.frameLayer(z * dpr, cellPx < 36);
    const m = layer.margin;
    ctx.drawImage(layer.cv, -m, -m, W + m * 2, H + m * 2);
    if (this.hint) { ctx.globalAlpha = 0.3; ctx.drawImage(this.big, 0, 0, W, H); ctx.globalAlpha = 1; }
    if (cellPx >= 36) {
      // 크게 볼 때: 화면에 보이는 칸의 조각 모양 선만 그린다 (또렷하게)
      const c0 = Math.max(0, Math.floor(cam.x / S) - 1), c1 = Math.min(this.cols - 1, Math.floor((cam.x + this.vw / z) / S) + 1);
      const r0 = Math.max(0, Math.floor(cam.y / S) - 1), r1 = Math.min(this.rows - 1, Math.floor((cam.y + this.vh / z) / S) + 1);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip(); // 틀 바깥으로 삐져나온 꼭지 선은 감춘다
      ctx.strokeStyle = th.grid;
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(1.2 / z, S * 0.016);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        ctx.setTransform(dpr * z, 0, 0, dpr * z, (c * S - cam.x) * z * dpr, (r * S - cam.y) * z * dpr);
        ctx.stroke(this.paths[r * this.cols + c]);
      }
      ctx.restore();
    }
    ctx.strokeStyle = th.edge;
    ctx.lineWidth = Math.max(2 / z, S * 0.02);
    ctx.strokeRect(0, 0, W, H);

    // 화면에 보이는 범위
    const vx0 = cam.x - S, vy0 = cam.y - S, vx1 = cam.x + this.vw / z + S, vy1 = cam.y + this.vh / z + S;
    const visible = p => p.rx < vx1 && p.rx + S > vx0 && p.ry < vy1 && p.ry + S > vy0;

    for (const p of this.pieces) if (p.locked && visible(p)) this.drawPiece(p);
    for (const id of this.order) { const p = this.pieces[id]; if (id !== this.selected && visible(p)) this.drawPiece(p); }
    const sel = this.pieces[this.selected];
    if (sel && !sel.locked) this.drawPiece(sel); // 고른 조각은 맨 위에

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

  // 조각 가운데가 틀 안에 있는지
  inFrame(p) {
    const cx = p.rx + this.S / 2, cy = p.ry + this.S / 2;
    return cx >= 0 && cx <= this.W && cy >= 0 && cy <= this.H;
  }

  drawPiece(p) {
    const { ctx, S } = this;
    const half = S / 2, pw = this.padW;
    const dragging = this.drag && this.drag.id === p.id;
    const otherUid = p.locked ? null : (p.held && p.held !== this.me ? p.held : this.remotePicker(p.id));
    const other = otherUid ? this.o.playerInfo(otherUid) : null;
    const picked = p.id === this.selected && !p.locked;
    // 틀 밖에서는 1.3배로 크게, 틀 안으로 들어오면 흰 테두리만 남기고 원래 크기
    const big = picked && this.selBig;
    const k = big ? PICK_SCALE : 1;
    ctx.save();
    ctx.translate(p.rx + half, p.ry + half);
    if (p.ang % 360) ctx.rotate(p.ang * Math.PI / 180);
    if (this.wiggle && this.wiggle.id === p.id) {
      const k = (performance.now() - this.wiggle.t0) / 500;
      if (k < 1) ctx.rotate(Math.sin(k * Math.PI * 6) * 0.16 * (1 - k));
    }
    if (picked) {
      ctx.scale(k, k);
      ctx.shadowColor = 'rgba(0,0,0,.45)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 6;
    } else if (dragging || other) {
      ctx.shadowColor = 'rgba(74,55,64,.35)';
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 8;
      ctx.scale(1.04, 1.04);
    }
    const tiny = (S + pw * 2) * this.cam.z * this.dpr < 44 && !picked && !dragging;
    if (tiny) {
      const a = this.smallAtlas();
      ctx.drawImage(a.cv, (p.id % a.per) * a.n, Math.floor(p.id / a.per) * a.n, a.n, a.n, -half - pw, -half - pw, S + pw * 2, S + pw * 2);
    } else ctx.drawImage(this.sprites[p.id], -half - pw, -half - pw, S + pw * 2, S + pw * 2);
    if (picked) {
      // 흰 실선 테두리 (밝은 바탕에서도 보이게 바깥에 얇은 어두운 선을 한 번 더)
      ctx.shadowColor = 'transparent';
      ctx.translate(-half, -half);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(20,32,43,.55)';
      ctx.lineWidth = Math.max(6 / this.cam.z, S * 0.07) / k;
      ctx.stroke(this.paths[p.id]);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = Math.max(3.5 / this.cam.z, S * 0.045) / k;
      ctx.stroke(this.paths[p.id]);
    } else if (other || p.id === this.moveMode) {
      ctx.shadowColor = 'transparent';
      ctx.translate(-half, -half);
      ctx.strokeStyle = other ? other.color : '#49C5B6';
      ctx.lineWidth = Math.max(3 / this.cam.z, S * 0.05);
      ctx.stroke(this.paths[p.id]);
    }
    ctx.restore();
  }
}
