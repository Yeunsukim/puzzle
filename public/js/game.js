// 게임방 화면: 실시간 연결 + 퍼즐판 + 정보판 + 조각 메뉴 + 완성 축하
import { $, $$, esc, api, toast, avatarUrl, cropRect, clock, fmtTime, loadImage, copyText, openModal } from './util.js';
import { Board } from './board.js';
import { Voice } from './voice.js';

export async function openRoom(root, code, { me, config, go, openDrawer, getSocial, onSocial, inviteLink, setLeaveGuard }) {
  root.innerHTML = `
  <div class="game">
    <aside class="side">
      <div class="side-top">
        <button class="menu-btn" id="g-menu-open" aria-label="메뉴 열기"><i></i><i></i><i></i><small>메뉴</small></button>
        <button class="btn light home-btn" id="g-exit">나가기</button>
        <button class="btn light fold-btn" id="g-fold" aria-label="정보판 접기">◀ 접기</button>
      </div>
      <div class="info-block"><div class="info-label">퍼즐</div><div class="info-val" id="g-title">...</div></div>
      <div class="info-block hide-sm"><div class="info-label">조각</div><div class="info-val" id="g-count">-</div></div>
      <div class="info-block"><div class="info-label">걸린 시간</div><div class="info-val time" id="g-time">00:00</div></div>
      <div class="info-block" style="flex:1 1 160px">
        <div class="info-label">진행 <b id="g-pct">0%</b></div>
        <div class="progress"><div id="g-bar"></div></div>
      </div>
      <div class="info-label hide-sm">함께하는 친구 (<span id="g-pn">0</span>/6)</div>
      <ul class="players" id="g-players"></ul>
      <div class="voice-box">
        <button class="btn voice-btn" id="v-toggle">🎤 음성 대화 켜기</button>
        <button class="btn light" id="v-mute" hidden>🔇 내 마이크 잠깐 끄기</button>
        <p class="voice-note" id="v-note">마이크는 꺼져 있어요.</p>
      </div>
      <button class="btn teal" id="g-invite">＋ 친구 초대하기</button>
    </aside>
    <main class="stage" id="stage">
      <canvas id="board" aria-label="퍼즐판"></canvas>
      <div class="side-mini" id="g-unfold-box">
        <button class="menu-btn" id="g-menu-open2" aria-label="메뉴 열기"><i></i><i></i><i></i><small>메뉴</small></button>
        <button class="btn light" id="g-exit2">나가기</button>
        <button class="btn light" id="g-unfold" aria-label="정보판 펼치기">▶ 정보판</button>
        <button class="btn light mic-mini" id="v-toggle2" aria-label="음성 대화 켜기">🎤 켜기</button>
        <span class="mini-stat" id="g-mini-stat"></span>
      </div>
      <div class="zoom">
        <button class="zbtn" id="z-in" aria-label="크게 보기">＋<small>크게</small></button>
        <button class="zbtn" id="z-out" aria-label="작게 보기">－<small>작게</small></button>
        <button class="zbtn" id="z-fit" aria-label="전체 보기">⤢<small>전체</small></button>
        <button class="zbtn" id="z-hint" aria-label="밑그림 보기">👁<small>밑그림</small></button>
      </div>
      <button class="mini" id="g-mini" aria-label="완성 그림 크게 보기"><img id="g-mini-img" alt=""><span>완성 그림</span></button>
      <div class="hint-help" id="g-help">조각을 <b>누른 채 끌어서</b> 틀에 놓아요.<br>조각을 <b>한 번 누르면</b> 왼쪽·오른쪽 돌리기 메뉴가 나와요.</div>
      <div class="piece-menu" id="g-menu" hidden>
        <div class="rot-row">
          <button class="btn" id="m-rot-l" aria-label="왼쪽으로 돌리기"><span class="big-ic">↺</span>왼쪽으로</button>
          <button class="btn" id="m-rot-r" aria-label="오른쪽으로 돌리기"><span class="big-ic">↻</span>오른쪽으로</button>
        </div>
        <button class="btn light" id="m-move">☝ 누른 곳으로 옮기기</button>
        <button class="btn light" id="m-out">⇱ 밖으로 빼기</button>
        <button class="btn light" id="m-close">✕ 닫기</button>
      </div>
      <div class="loading" id="g-loading"><div><img src="/assets/logo.svg" alt=""><h3 id="g-loading-msg">퍼즐 방에 들어가는 중...</h3></div></div>
    </main>
  </div>`;

  const state = { board: null, snap: null, players: { online: [], people: {}, scores: {} }, clockOffset: 0, menuFor: -1, timer: 0, closed: false };
  const imgCache = new Map();
  const avatarImg = id => {
    if (!imgCache.has(id)) { const i = new Image(); i.src = avatarUrl(id); imgCache.set(id, i); }
    return imgCache.get(id);
  };
  const playerInfo = uid => {
    const p = state.players.people[uid] || state.players.online.find(o => o.uid === uid);
    return p ? { nick: p.nick, color: p.color, img: avatarImg(p.avatar) } : null;
  };

  $('#g-menu-open').addEventListener('click', openDrawer);
  $('#g-menu-open2').addEventListener('click', openDrawer);
  // 정보판 접기/펼치기 (고른 것을 기억. 처음엔 좁은 화면이면 접어 둔다)
  const setFolded = folded => {
    root.querySelector('.game').classList.toggle('folded', folded);
    try { localStorage.setItem('sideFolded', folded ? '1' : '0'); } catch { /* 무시 */ }
  };
  let savedFold = null;
  try { savedFold = localStorage.getItem('sideFolded'); } catch { /* 무시 */ }
  setFolded(savedFold === null ? innerWidth < 1100 : savedFold === '1');
  // ---- 나가기: 저장할지 물어본다 ----
  let asking = false;
  const askLeave = target => {
    if (state.snap?.finishedAt || !state.board) { setLeaveGuard(null); location.hash = target; return; }
    if (asking) return;
    asking = true;
    const bg = modal(`
      <span class="eyebrow">나가기</span>
      <h2 style="margin-top:10px">퍼즐에서 나갈까요?</h2>
      <p class="muted" style="margin-bottom:22px">저장하면 <b>왼쪽 위 메뉴 → 하던 퍼즐</b>이나 홈 화면에서 이어서 맞출 수 있어요. 지금까지 맞춘 조각은 그대로 남아요.</p>
      <div class="stack">
        <button class="btn big wide" id="lv-save">저장하고 나가기</button>
        <button class="btn danger wide" id="lv-drop">저장하지 않고 나가기</button>
        <button class="btn light wide" data-close>계속 맞추기</button>
      </div>`);
    const leave = async keep => {
      $$('button', bg).forEach(b => { b.disabled = true; });
      try { await api(keep ? '/api/saved/keep' : '/api/saved/remove', { code }); } catch { /* 나가는 건 그대로 */ }
      if (!keep) toast('하던 퍼즐 목록에서 뺐어요.');
      else toast('저장했어요. 다음에 이어서 맞춰요!');
      setLeaveGuard(null);
      bg.close();
      location.hash = target;
    };
    $('#lv-save', bg).addEventListener('click', () => leave(true));
    $('#lv-drop', bg).addEventListener('click', () => leave(false));
    const done = new MutationObserver(() => { if (!bg.isConnected) { asking = false; done.disconnect(); } });
    done.observe(document.body, { childList: true });
  };
  setLeaveGuard(askLeave);
  $('#g-exit').addEventListener('click', () => askLeave('#/home'));
  $('#g-exit2').addEventListener('click', () => askLeave('#/home'));
  $('#g-fold').addEventListener('click', () => setFolded(true));
  $('#g-unfold').addEventListener('click', () => setFolded(false));
  const showError = (msg, full) => {
    $('#g-loading').innerHTML = `<div class="stack" style="align-items:center;padding:20px">
      <img src="/assets/logo.svg" alt="" style="animation:none">
      <h2>${esc(msg)}</h2>
      ${full ? '<p class="muted">다른 친구가 나가면 다시 들어올 수 있어요.</p>' : ''}
      <a class="btn big" href="#/home">홈으로</a></div>`;
  };

  // ---- 실시간 연결 ----
  const socket = window.io({ transports: ['websocket', 'polling'] });
  let joinedOnce = false;
  socket.on('connect_error', err => {
    if (err.message === 'login') showError('로그인이 풀렸어요. 다시 로그인해 주세요.');
  });
  socket.on('connect', () => {
    socket.emit('join', code, async res => {
      if (state.closed) return;
      if (res?.error) return showError(res.error, res.full);
      if (!joinedOnce) { joinedOnce = true; await init(res.snapshot); }
      else { // 다시 연결됨: 최신 상태로 맞춘다
        state.snap = res.snapshot;
        state.board?.setPieces(res.snapshot.pieces);
        setPlayers(res.snapshot.players);
        updateProgress();
        toast('다시 연결됐어요!');
      }
    });
  });
  socket.on('disconnect', reason => { if (!state.closed && reason !== 'io client disconnect') toast('연결이 잠깐 끊겼어요. 다시 연결하는 중...'); });

  socket.on('grab', ({ id, uid }) => {
    state.board?.remoteGrab(id, uid);
    if (state.menuFor === id) hideMenu();
  });
  socket.on('move', ({ id, x, y }) => state.board?.remoteMove(id, x, y));
  socket.on('pieces', ({ list, locked, by, scores }) => {
    if (!state.board) return;
    for (const s of list) state.board.update(s);
    if (state.menuFor >= 0 && list.some(s => s.id === state.menuFor && s.locked)) hideMenu();
    if (locked?.length) {
      state.players.scores = scores;
      renderPlayers();
      updateProgress();
      if (by === me.id) { ding(); try { navigator.vibrate?.(35); } catch { /* 진동 없어도 괜찮음 */ } }
    }
  });
  socket.on('players', p => setPlayers(p));

  // ---- 음성 대화 ----
  state.voicePeers = [];
  state.speaking = new Set();
  const voice = new Voice(socket, config.iceServers, {
    onChange: () => { renderPlayers(); updateVoiceUI(); },
    onSpeaking: s => { state.speaking = s; renderPlayers(); },
    onLost: () => toast('연결이 끊겨서 음성 대화가 꺼졌어요. 다시 켜 주세요.', 4000),
    onFail: uid => toast(`${playerInfo(uid)?.nick || '친구'}님과는 음성 연결이 잘 안 돼요. 인터넷 환경 때문일 수 있어요.`, 4500),
  });
  $('#board').voice = voice; // 시험할 때 확인용
  socket.on('voice-peers', list => { state.voicePeers = list || []; renderPlayers(); updateVoiceUI(); });
  const toggleVoice = async () => {
    if (voice.on) { voice.stop(); toast('음성 대화를 껐어요.'); return; }
    if (!Voice.supported() || !window.isSecureContext) {
      return toast('이 주소에서는 음성 대화를 쓸 수 없어요. https 로 시작하는 인터넷 주소에서 써 주세요.', 5000);
    }
    $('#v-toggle').disabled = true;
    try {
      await voice.start();
      toast('음성 대화를 켰어요. 이제 말하면 친구들에게 들려요.');
    } catch (err) {
      const msg = err?.name === 'NotAllowedError' ? '마이크 사용이 막혀 있어요. 주소창 왼쪽의 자물쇠 모양 → 마이크 → 허용으로 바꿔 주세요.'
        : err?.name === 'NotFoundError' ? '마이크를 찾을 수 없어요. 마이크(이어폰)가 연결돼 있는지 확인해 주세요.'
        : '마이크를 켜지 못했어요. 다시 눌러 주세요.';
      toast(msg, 6000);
    } finally { $('#v-toggle').disabled = false; }
  };
  function updateVoiceUI() {
    const others = state.voicePeers.filter(p => p.uid !== me.id);
    const othersCount = new Set(others.map(p => p.uid)).size;
    $('#v-toggle').textContent = voice.on ? '🎤 음성 대화 끄기' : '🎤 음성 대화 켜기';
    $('#v-toggle').classList.toggle('on', voice.on);
    $('#v-mute').hidden = !voice.on;
    $('#v-mute').textContent = voice.muted ? '🎙 내 마이크 다시 켜기' : '🔇 내 마이크 잠깐 끄기';
    $('#v-toggle2').textContent = voice.on ? (voice.muted ? '🔇 꺼짐' : '🎤 대화 중') : '🎤 켜기';
    $('#v-toggle2').classList.toggle('on', voice.on);
    $('#v-note').textContent = voice.on
      ? (voice.muted ? '내 마이크를 잠깐 껐어요. 친구 목소리는 계속 들려요.'
        : othersCount ? `${othersCount}명과 음성 대화 중이에요. 이어폰을 쓰면 더 깨끗하게 들려요.` : '음성 대화를 켰어요. 친구가 켜면 바로 이야기할 수 있어요.')
      : othersCount ? `지금 ${othersCount}명이 음성 대화 중이에요. 켜면 같이 이야기할 수 있어요.` : '마이크는 꺼져 있어요. 켜면 친구와 목소리로 이야기할 수 있어요.';
  }
  $('#v-toggle').addEventListener('click', toggleVoice);
  $('#v-toggle2').addEventListener('click', toggleVoice);
  $('#v-mute').addEventListener('click', () => voice.setMuted(!voice.muted));
  $('#g-players').addEventListener('click', e => {
    const b = e.target.closest('[data-silence]');
    if (b) voice.toggleSilence(Number(b.dataset.silence));
  });
  socket.on('cursor', ({ uid, x, y }) => state.board?.setCursor(uid, x, y));
  socket.on('cursor-off', ({ uid }) => state.board?.removeCursor(uid));
  socket.on('done', summary => { state.snap.finishedAt = summary.finishedAt; updateTime(); showDone(summary); });

  // ---- 처음 준비 ----
  async function init(snap) {
    state.snap = snap;
    state.clockOffset = snap.now - Date.now();
    $('#g-title').textContent = snap.picture.title;
    $('#g-count').textContent = `${snap.cols * snap.rows}조각`;
    $('#g-mini-img').src = snap.picture.url;
    $('#g-loading-msg').textContent = '조각을 준비하는 중...';
    state.voicePeers = snap.voice || [];
    setPlayers(snap.players);
    updateVoiceUI();
    let image;
    try { image = await loadImage(snap.picture.url); } catch { return showError('퍼즐 그림을 불러오지 못했어요.'); }
    await new Promise(r => setTimeout(r, 30)); // 안내 글이 먼저 보이도록
    if (state.closed) return;
    const crop = cropRect(image.naturalWidth || snap.picture.w, image.naturalHeight || snap.picture.h, snap.cols, snap.rows);
    state.board = new Board($('#board'), {
      S: snap.S, cols: snap.cols, rows: snap.rows, edges: snap.edges, pieces: snap.pieces, image, crop, me: me.id,
      playerInfo,
      onGrab: id => {
        hideMenu();
        socket.emit('grab', id, (ok, s) => { if (!ok) { state.board.cancelDrag(id, s); toast('다른 친구가 잡고 있는 조각이에요.'); } });
      },
      onMove: (id, x, y) => socket.volatile.emit('move', { id, x, y }),
      onDrop: (id, x, y) => socket.emit('drop', { id, x, y }),
      onClickPiece: (id, pt) => showMenu(id, pt),
      onClickEmpty: () => hideMenu(),
      // '누른 곳으로 옮기기': 잡았다가 바로 그 자리에 놓는다
      onTapMove: (id, x, y) => {
        socket.emit('grab', id, (ok, s) => {
          if (!ok) { state.board.cancelDrag(id, s); toast('다른 친구가 잡고 있는 조각이에요.'); return; }
          socket.emit('drop', { id, x, y });
        });
      },
      onCursor: (x, y) => socket.volatile.emit('cursor', { x, y }),
      onPress: () => { $('#g-help').hidden = true; },
    });
    $('#board').board = state.board; // 시험할 때 확인용
    $('#g-loading').remove();
    updateProgress();
    updateTime();
    state.timer = setInterval(updateTime, 1000);
    if (snap.finishedAt && snap.summary) showDone(snap.summary, true);
  }

  // ---- 정보판 ----
  function setPlayers(p) { state.players = p; renderPlayers(); }
  function renderPlayers() {
    const { online, people, scores } = state.players;
    const onIds = new Set(online.map(o => o.uid));
    const all = Object.entries(people).map(([uid, p]) => ({ uid: Number(uid), ...p }));
    for (const o of online) if (!all.some(a => a.uid === o.uid)) all.push(o);
    all.sort((a, b) => (onIds.has(b.uid) - onIds.has(a.uid)) || ((scores[b.uid] || 0) - (scores[a.uid] || 0)));
    $('#g-pn').textContent = online.length;
    const inVoice = new Set((state.voicePeers || []).map(v => v.uid));
    const talking = uid => state.speaking?.has(uid === me.id ? 'me' : uid);
    $('#g-players').innerHTML = all.map(p => {
      const mine = p.uid === me.id;
      const silenced = voice.silenced.has(p.uid);
      return `
      <li class="${onIds.has(p.uid) ? '' : 'off'} ${talking(p.uid) ? 'speaking' : ''}" style="border-color:${p.color}">
        <img src="${avatarUrl(p.avatar)}" alt="" style="background:${p.color}33">
        <span class="nm">${esc(p.nick)}${mine ? ' (나)' : ''}${inVoice.has(p.uid) ? ' <span class="v-ic" title="음성 대화 중">🎧</span>' : ''}</span>
        ${!mine && voice.on && inVoice.has(p.uid) ? `<button class="silence-btn" data-silence="${p.uid}" aria-label="${esc(p.nick)}님 소리 ${silenced ? '켜기' : '끄기'}">${silenced ? '🔇' : '🔈'}</button>` : ''}
        <span class="sc">${scores[p.uid] || 0}개</span>
      </li>`;
    }).join('');
    state.board && (state.board.need = true);
    state.redrawInvite?.();
  }
  function updateProgress() {
    if (!state.board) return;
    const n = state.board.pieces.length, done = state.board.lockedCount;
    const pct = Math.floor(done / n * 100);
    $('#g-pct').textContent = `${pct}% (${done}/${n})`;
    $('#g-bar').style.width = (done / n * 100) + '%';
    updateMiniStat();
  }
  function updateTime() {
    const s = state.snap;
    if (!s?.startedAt) return;
    const end = s.finishedAt || (Date.now() + state.clockOffset);
    $('#g-time').textContent = clock((end - s.startedAt) / 1000);
    updateMiniStat();
  }
  // 정보판을 접었을 때 보이는 짧은 상태: 걸린 시간 · 맞춘 조각
  function updateMiniStat() {
    if (!state.board) return;
    $('#g-mini-stat').textContent = `${$('#g-time').textContent} · ${state.board.lockedCount}/${state.board.pieces.length}조각`;
  }

  // ---- 조각 메뉴 ----
  function showMenu(id, pt) {
    const menu = $('#g-menu'), stage = $('#stage').getBoundingClientRect();
    state.menuFor = id;
    menu.hidden = false;
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let x = pt.x - stage.left + 30, y = pt.y - stage.top - mh / 2;
    if (x + mw > stage.width - 110) x = pt.x - stage.left - mw - 30;
    x = Math.max(10, Math.min(stage.width - mw - 10, x));
    y = Math.max(10, Math.min(stage.height - mh - 10, y));
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  }
  function hideMenu() { state.menuFor = -1; $('#g-menu').hidden = true; }
  $('#m-rot-l').addEventListener('click', () => { if (state.menuFor >= 0) socket.emit('rotate', state.menuFor, -1); });
  $('#m-rot-r').addEventListener('click', () => { if (state.menuFor >= 0) socket.emit('rotate', state.menuFor, 1); });
  $('#m-move').addEventListener('click', () => {
    if (state.menuFor < 0 || !state.board) return;
    state.board.setMoveMode(state.menuFor);
    hideMenu();
    toast('조각을 놓을 곳을 한 번 눌러 주세요.', 3500);
  });
  $('#m-out').addEventListener('click', () => { if (state.menuFor >= 0) socket.emit('eject', state.menuFor); hideMenu(); });
  $('#m-close').addEventListener('click', hideMenu);

  // ---- 확대/축소 단추 ----
  $('#z-in').addEventListener('click', () => state.board?.zoomBy(1.3));
  $('#z-out').addEventListener('click', () => state.board?.zoomBy(1 / 1.3));
  $('#z-fit').addEventListener('click', () => state.board?.fit());
  $('#z-hint').addEventListener('click', e => { if (state.board) e.currentTarget.classList.toggle('on', state.board.toggleHint()); });
  $('#g-mini').addEventListener('click', () => {
    const el = document.createElement('div');
    el.className = 'big-preview';
    el.innerHTML = `<img src="${esc(state.snap?.picture.url || '')}" alt="완성 그림">`;
    el.addEventListener('click', () => el.remove());
    $('#stage').appendChild(el);
  });

  // ---- 친구 초대 ----
  const sentTo = new Set();
  $('#g-invite').addEventListener('click', () => {
    const link = inviteLink(code);
    const lanOnly = !config.publicUrl && /^http:\/\/(10\.|192\.168\.|172\.|localhost|127\.)/.test(link);
    const bg = modal(`
      <span class="eyebrow">함께하기</span>
      <h2 style="margin-top:10px">친구 초대하기</h2>
      <p class="muted" style="margin-bottom:16px">초대를 보내면 친구 화면에 알림이 떠요. 친구가 <b>수락</b>하면 이 방으로 들어와요. (한 방에 6명까지)</p>
      <div class="card" style="padding:8px 20px" id="inv-friends"></div>
      <div class="spacer"></div>
      <h3 style="margin-bottom:8px">아직 친구가 아닌 사람에게는</h3>
      <p class="muted" style="margin-bottom:12px">이 링크를 문자나 카카오톡으로 보내 주세요. 가입하고 바로 들어올 수 있어요.</p>
      <div class="link-box">${esc(link)}</div>
      <div class="spacer" style="height:12px"></div>
      <button class="btn line wide" id="inv-copy">링크 복사하기</button>
      <p class="center muted" style="margin-top:18px">방 번호</p>
      <div class="room-code">${code}</div>
      ${lanOnly ? `<div class="spacer"></div><div class="note">지금은 이 컴퓨터에서 서버를 켜 둔 상태라, 링크로는 <b>같은 와이파이</b>에 있는 사람만 들어올 수 있어요. 멀리 있는 친구도 들어오게 하려면 사이트를 인터넷에 열어야 해요.</div>` : ''}
      <div class="spacer"></div>
      <button class="btn light wide" data-close>닫기</button>`);
    const drawFriends = () => {
      const el = $('#inv-friends', bg);
      if (!el) return;
      const here = new Set(state.players.online.map(o => o.uid));
      const fr = getSocial().friends;
      el.innerHTML = fr.length ? fr.map(f => `
        <div class="person"><div class="av"><img src="${avatarUrl(f.avatar)}" alt=""><span class="dot ${f.online ? 'on' : ''}"></span></div>
          <div class="nm">${esc(f.nick)}<small>${here.has(f.id) ? '이 방에 있어요' : f.online ? '지금 접속 중' : '쉬는 중 · 다음에 들어오면 알림이 보여요'}</small></div>
          ${here.has(f.id) ? '<span class="muted">함께하는 중</span>'
            : sentTo.has(f.id) ? `<button class="btn line" data-inv="${f.id}">다시 보내기</button>`
            : `<button class="btn" data-inv="${f.id}">초대 보내기</button>`}
        </div>`).join('')
        : '<p class="muted" style="padding:14px 0">아직 친구가 없어요. 왼쪽 위 메뉴 → 친구에서 친구를 추가하거나, 아래 링크를 보내 주세요.</p>';
      $$('[data-inv]', el).forEach(b => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const d = await api('/api/invites', { roomCode: code, to: Number(b.dataset.inv) });
          sentTo.add(Number(b.dataset.inv));
          toast(d.online ? '초대를 보냈어요! 친구가 수락하면 들어와요.' : '초대를 보냈어요. 친구가 사이트에 들어오면 알림이 보여요.', 4000);
          drawFriends();
        } catch (err) { toast(err.message); b.disabled = false; }
      }));
    };
    drawFriends();
    onSocial(drawFriends);
    state.redrawInvite = drawFriends;
    $('#inv-copy', bg).addEventListener('click', async () => {
      toast(await copyText(link) ? '링크를 복사했어요! 친구에게 붙여 넣어 보내 주세요.' : '복사가 안 됐어요. 위 주소를 직접 알려 주세요.');
    });
  });

  // ---- 완성! ----
  function showDone(sum, quiet) {
    hideMenu();
    if (!quiet) { confetti(); fanfare(); }
    const mine = sum.players.find(p => p.uid === me.id);
    modal(`
      <div class="center"><span class="eyebrow">완성</span></div>
      <h2 class="center" style="margin-top:8px">퍼즐을 완성했어요!</h2>
      <img class="done-img" src="${esc(sum.url)}" alt="">
      <h3 class="center" style="margin-bottom:14px">「${esc(sum.title)}」 ${sum.pieces}조각</h3>
      <div class="done-facts">
        <div>걸린 시간<b>${fmtTime(sum.seconds)}</b></div>
        <div>내가 맞춘 조각<b>${mine ? mine.placed : 0}개</b></div>
      </div>
      <h3 style="margin-bottom:8px">함께한 친구들</h3>
      <ul class="players" style="margin-bottom:20px">
        ${sum.players.map((p, i) => `<li style="border-color:${p.color}"><img src="${avatarUrl(p.avatar)}" alt="" style="background:${p.color}33">
          <span class="nm">${i === 0 && p.placed > 0 ? '👑 ' : ''}${esc(p.nick)}${p.uid === me.id ? ' (나)' : ''}</span><span class="sc">${p.placed}개</span></li>`).join('')}
      </ul>
      <div class="stack">
        <a class="btn big wide" href="#/records">내 기록 보기</a>
        <a class="btn teal wide" href="#/start">다른 퍼즐 하기</a>
        <button class="btn light wide" data-close>완성된 그림 구경하기</button>
      </div>`);
  }

  const modals = new Set();
  function modal(html) {
    const bg = openModal(html, { onClose: () => modals.delete(bg) });
    modals.add(bg);
    return bg;
  }

  // 정리 (다른 화면으로 갈 때)
  return () => {
    state.closed = true;
    setLeaveGuard(null);
    voice.stop();
    for (const m of [...modals]) m.close();
    clearInterval(state.timer);
    socket.disconnect();
    state.board?.destroy();
  };
}

// ---- 소리 ----
let audio = null;
function tone(freq, start, dur, type = 'sine', vol = 0.15) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type; o.frequency.value = freq;
    const t = audio.currentTime + start;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur + 0.05);
  } catch { /* 소리 안 나도 괜찮음 */ }
}
function ding() { tone(880, 0, 0.18); tone(1320, 0.08, 0.25); }
function fanfare() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.14, 0.35, 'triangle', 0.18)); }

// ---- 꽃가루 ----
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = document.createElement('canvas');
  cv.className = 'confetti';
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const colors = ['#2779A7', '#49C5B6', '#C9A45C', '#E2725B', '#F7F3EA', '#1D4E73'];
  const ps = Array.from({ length: 160 }, () => ({
    x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.5,
    vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4, r: 6 + Math.random() * 8,
    a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3, c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  const frame = t => {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of ps) {
      p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a);
      ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      ctx.restore();
    }
    if (t - t0 < 4000) requestAnimationFrame(frame); else cv.remove();
  };
  requestAnimationFrame(frame);
}
