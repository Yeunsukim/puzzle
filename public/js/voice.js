// 음성 대화: 브라우저끼리 목소리를 바로 주고받는다 (WebRTC). 서버는 처음 연결 신호만 전해 준다.
// - 음성 대화를 켠 사람끼리만 서로 연결된다. 저장은 하지 않는다.
// - 나중에 들어온 사람이 먼저 와 있던 사람들에게 연결을 건다.

export class Voice {
  constructor(socket, iceServers, hooks = {}) {
    this.socket = socket;
    this.ice = iceServers?.length ? iceServers : [{ urls: 'stun:stun.l.google.com:19302' }];
    this.hooks = hooks;       // onChange(), onSpeaking(uidSet)
    this.on = false;
    this.muted = false;
    this.stream = null;
    this.peers = new Map();   // 상대 연결 id -> { uid, pc, audio, pending:[], analyser }
    this.silenced = new Set(); // 내가 소리를 끈 친구 uid
    this.speaking = new Set();
    this.ctx = null;
    this.timer = 0;
    this.retries = new Map(); // 상대 uid -> 다시 건 횟수

    socket.on('voice-signal', m => this.onSignal(m));
    socket.on('voice-left', ({ sid }) => this.drop(sid));
    socket.on('disconnect', reason => {
      if (!this.on) return;
      if (reason === 'io client disconnect') { this.stop(true); return; } // 방에서 나감
      // 인터넷이 잠깐 끊김: 마이크는 켜 둔 채로 연결만 정리하고, 다시 붙으면 rejoin() 으로 이어 준다
      for (const sid of [...this.peers.keys()]) this.drop(sid, true);
      this.waiting = true;
      this.hooks.onChange?.();
    });
    // 휴대폰 등에서 소리 재생이 막혔으면, 화면을 한 번 누를 때 다시 틀어 준다
    this.unlock = () => {
      if (!this.on) return;
      this.ctx?.resume?.().catch(() => {});
      for (const p of this.peers.values()) if (p.audio && p.audio.paused) p.audio.play().catch(() => {});
    };
    document.addEventListener('pointerdown', this.unlock, { passive: true });
  }

  // 인터넷이 다시 연결된 뒤 (게임방에 다시 들어간 다음) 음성 대화를 다시 잇는다
  rejoin() {
    if (!this.on) return;
    this.waiting = false;
    this.retries.clear();
    this.socket.emit('voice-join', list => {
      for (const p of list || []) this.call(p.sid, p.uid);
    });
    this.hooks.onChange?.();
  }

  destroy() {
    this.stop(true);
    document.removeEventListener('pointerdown', this.unlock);
  }

  static supported() {
    return !!(window.RTCPeerConnection && navigator.mediaDevices?.getUserMedia);
  }

  async start() {
    if (this.on || this.starting) return;
    this.starting = true;
    // 소리 장치는 단추를 누른 바로 그 순간에 깨워 둔다 (기다리지 않음)
    try { this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)(); this.ctx.resume().catch(() => {}); } catch { this.ctx = null; }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false,
      });
    } finally { this.starting = false; }
    this.on = true;
    this.muted = false;
    this.waiting = false;
    this.retries.clear();
    this.myAnalyser = this.makeAnalyser(this.stream);
    this.timer = setInterval(() => this.measure(), 150);
    this.socket.emit('voice-join', list => {
      for (const p of list || []) this.call(p.sid, p.uid);
    });
    this.hooks.onChange?.();
  }

  stop(silent) {
    if (!this.on) return;
    this.on = false;
    this.waiting = false;
    clearInterval(this.timer);
    for (const sid of [...this.peers.keys()]) this.drop(sid, true);
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.speaking.clear();
    if (!silent) this.socket.emit('voice-leave');
    this.hooks.onSpeaking?.(this.speaking);
    this.hooks.onChange?.();
  }

  setMuted(m) {
    this.muted = m;
    this.stream?.getAudioTracks().forEach(t => { t.enabled = !m; });
    this.hooks.onChange?.();
  }

  // 특정 친구 소리만 끄기/켜기 (내 화면에서만)
  toggleSilence(uid) {
    if (this.silenced.has(uid)) this.silenced.delete(uid); else this.silenced.add(uid);
    for (const p of this.peers.values()) if (p.audio) p.audio.muted = this.silenced.has(p.uid);
    this.hooks.onChange?.();
  }

  peer(sid, uid, caller = false) {
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const entry = { uid, pc, audio: null, pending: [], analyser: null, caller, badSince: 0 };
    this.peers.set(sid, entry);
    for (const t of this.stream.getTracks()) pc.addTrack(t, this.stream);
    pc.onicecandidate = e => { if (e.candidate) this.signal(sid, { cand: e.candidate }); };
    pc.ontrack = e => {
      const s = e.streams[0] || new MediaStream([e.track]);
      if (!entry.audio) {
        entry.audio = document.createElement('audio');
        entry.audio.autoplay = true;
        entry.audio.setAttribute('playsinline', ''); // 아이폰에서도 소리가 나오게
        entry.audio.hidden = true;
        document.body.appendChild(entry.audio);
        entry.audio.muted = this.silenced.has(uid);
      }
      entry.audio.srcObject = s;
      entry.audio.play().catch(() => {});
      entry.analyser = this.makeAnalyser(s);
    };
    pc.oniceconnectionstatechange = () => this.hooks.onChange?.();
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') { entry.badSince = 0; this.retries.delete(uid); }
      if (st === 'failed') this.recover(sid);
      if (st === 'disconnected') {
        // 잠깐 끊김은 저절로 돌아오는 경우가 많다. 6초 넘게 이어지면 다시 건다
        entry.badSince = Date.now();
        setTimeout(() => { if (this.peers.get(sid) === entry && entry.pc.connectionState === 'disconnected') this.recover(sid); }, 6000);
      }
      this.hooks.onChange?.();
    };
    return entry;
  }

  // 연결이 실패한 친구와 다시 연결한다 (처음 연결을 건 쪽이 다시 건다, 3번까지)
  recover(sid) {
    const p = this.peers.get(sid);
    if (!p || !this.on) return;
    const uid = p.uid, caller = p.caller;
    this.drop(sid, true);
    if (!caller) { this.hooks.onChange?.(); return; } // 상대가 다시 걸어 온다
    const n = (this.retries.get(uid) || 0) + 1;
    this.retries.set(uid, n);
    if (n > 3) { this.hooks.onFail?.(uid); this.hooks.onChange?.(); return; }
    setTimeout(() => this.call(sid, uid), 800 * n);
    this.hooks.onChange?.();
  }

  async call(sid, uid) {
    if (!this.on || this.peers.has(sid)) return;
    const { pc } = this.peer(sid, uid, true);
    try {
      await pc.setLocalDescription(await pc.createOffer());
      this.signal(sid, { sdp: pc.localDescription });
    } catch (err) { console.warn('음성 연결 걸기 문제:', err); }
  }

  async onSignal({ from, uid, data }) {
    if (!this.on || !data) return;
    let entry = this.peers.get(from);
    try {
      if (data.sdp) {
        // 상대가 새로 걸어 온 연결(다시 걸기 포함)이면 예전 연결은 버리고 새로 받는다
        if (entry && data.sdp.type === 'offer') { this.drop(from, true); entry = null; }
        if (!entry) entry = this.peer(from, uid);
        const { pc } = entry;
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          this.signal(from, { sdp: pc.localDescription });
        }
        for (const c of entry.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      } else if (data.cand && entry) {
        if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(data.cand).catch(() => {});
        else entry.pending.push(data.cand);
      }
    } catch (err) { console.warn('음성 연결 신호 문제:', err); }
  }

  signal(to, data) { this.socket.emit('voice-signal', { to, data: JSON.parse(JSON.stringify(data)) }); }

  drop(sid, quiet) {
    const p = this.peers.get(sid);
    if (!p) return;
    this.peers.delete(sid);
    try { p.pc.close(); } catch { /* 무시 */ }
    if (p.audio) { p.audio.srcObject = null; p.audio.parentNode?.removeChild(p.audio); }
    if (!quiet) this.hooks.onChange?.();
  }

  // 이 친구와의 음성 연결 상태: 'ok'(연결됨) / 'wait'(연결 중) / 'fail'(안 됨) / null(연결 없음)
  stateOf(uid) {
    for (const p of this.peers.values()) {
      if (p.uid !== uid) continue;
      const s = p.pc.connectionState || p.pc.iceConnectionState;
      if (s === 'connected' || s === 'completed') return 'ok';
      if (s === 'failed' || s === 'disconnected' || s === 'closed') return 'fail';
      return 'wait';
    }
    return null;
  }

  // 연결된 친구 수 (실제로 연결이 이어진 사람)
  connectedCount() {
    let n = 0;
    for (const p of this.peers.values()) if (p.pc.connectionState === 'connected') n++;
    return n;
  }

  // ---- 누가 말하고 있는지 (소리 크기로 판단) ----
  makeAnalyser(stream) {
    if (!this.ctx) return null;
    try {
      const src = this.ctx.createMediaStreamSource(stream);
      const a = this.ctx.createAnalyser();
      a.fftSize = 512;
      src.connect(a);
      return { a, buf: new Uint8Array(a.fftSize) };
    } catch { return null; }
  }
  level(an) {
    if (!an) return 0;
    an.a.getByteTimeDomainData(an.buf);
    let sum = 0;
    for (const v of an.buf) { const d = (v - 128) / 128; sum += d * d; }
    return Math.sqrt(sum / an.buf.length);
  }
  measure() {
    const now = new Set();
    if (!this.muted && this.level(this.myAnalyser) > 0.04) now.add('me');
    for (const p of this.peers.values()) if (!this.silenced.has(p.uid) && this.level(p.analyser) > 0.04) now.add(p.uid);
    const changed = now.size !== this.speaking.size || [...now].some(x => !this.speaking.has(x));
    this.speaking = now;
    if (changed) this.hooks.onSpeaking?.(now);
  }
}
