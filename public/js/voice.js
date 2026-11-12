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

    socket.on('voice-signal', m => this.onSignal(m));
    socket.on('voice-left', ({ sid }) => this.drop(sid));
    socket.on('disconnect', () => { if (this.on) { this.stop(true); this.hooks.onLost?.(); } });
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

  peer(sid, uid) {
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const entry = { uid, pc, audio: null, pending: [], analyser: null };
    this.peers.set(sid, entry);
    for (const t of this.stream.getTracks()) pc.addTrack(t, this.stream);
    pc.onicecandidate = e => { if (e.candidate) this.signal(sid, { cand: e.candidate }); };
    pc.ontrack = e => {
      const s = e.streams[0] || new MediaStream([e.track]);
      if (!entry.audio) {
        entry.audio = new Audio();
        entry.audio.autoplay = true;
        entry.audio.muted = this.silenced.has(uid);
      }
      entry.audio.srcObject = s;
      entry.audio.play().catch(() => {});
      entry.analyser = this.makeAnalyser(s);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') this.hooks.onFail?.(uid);
      this.hooks.onChange?.();
    };
    return entry;
  }

  async call(sid, uid) {
    if (!this.on || this.peers.has(sid)) return;
    const { pc } = this.peer(sid, uid);
    await pc.setLocalDescription(await pc.createOffer());
    this.signal(sid, { sdp: pc.localDescription });
  }

  async onSignal({ from, uid, data }) {
    if (!this.on || !data) return;
    let entry = this.peers.get(from);
    try {
      if (data.sdp) {
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
    if (p.audio) { p.audio.srcObject = null; }
    if (!quiet) this.hooks.onChange?.();
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
