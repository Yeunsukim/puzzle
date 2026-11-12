// 화면 전환: 로그인 → 캐릭터 고르기 → 홈 → 퍼즐 고르기/만들기 → 게임방 → 내 기록 / 친구
// 왼쪽 위 메뉴(줄 세 개) 서랍, 친구 초대 알림도 여기서 관리한다.
import { AVATARS, COUNTS, avatarUrl, $, $$, esc, api, toast, gridFor, cropRect, fmtTime, loadImage, copyText, openModal, getTheme, setTheme, isDark } from './util.js';
import { openRoom } from './game.js';

const app = $('#app');
let me = null;
let config = { googleClientId: '', lanUrls: [], publicUrl: '' };
let cleanup = null;
let social = { code: '', friends: [], requests: [], sent: [], invites: [], recent: [] };
let stats = { done: 0, placed: 0, seconds: 0 };
let notifySocket = null;
let currentRoom = '';
const socialListeners = new Set();

const ART = ['/assets/art/blue-garden.svg', '/assets/art/moon-waves.svg', '/assets/art/bouquet.svg', '/assets/art/blue-tiles.svg'];

function go(path) {
  if (location.hash === '#' + path) route();
  else location.hash = path;
}
window.addEventListener('hashchange', route);

async function route() {
  if (cleanup) { try { cleanup(); } catch { /* 무시 */ } cleanup = null; }
  socialListeners.clear();
  closeDrawer();
  currentRoom = '';
  const [, page = 'home', arg = ''] = (location.hash.slice(1) || '/home').split('/');
  if (!me) {
    if (page === 'room' && arg) sessionStorage.setItem('pendingRoom', arg);
    return renderLogin();
  }
  if (!me.setup && page !== 'profile') return go('/profile');
  window.scrollTo(0, 0);
  switch (page) {
    case 'profile': return renderProfile();
    case 'start': return renderStart(Number(arg) || 0);
    case 'create': return renderCreate();
    case 'records': return renderRecords();
    case 'friends': return renderFriends();
    case 'room':
      currentRoom = arg.toUpperCase();
      cleanup = await openRoom(app, currentRoom, { me, config, go, openDrawer, getSocial: () => social, onSocial: fn => socialListeners.add(fn), inviteLink });
      updateBadges();
      return;
    default: return renderHome();
  }
}

function afterLogin() {
  connectNotify();
  const pending = sessionStorage.getItem('pendingRoom');
  if (!me.setup) return go('/profile');
  if (pending) { sessionStorage.removeItem('pendingRoom'); return go('/room/' + pending); }
  const [, page] = location.hash.slice(1).split('/');
  if (page && page !== 'profile') return route();
  go('/home');
}

// 친구에게 보낼 게임방 주소: 인터넷 주소 → 같은 와이파이 주소 → 지금 주소
export function inviteLink(code) {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const base = config.publicUrl || (local && config.lanUrls?.length ? config.lanUrls[0] : location.origin);
  return `${base}/#/room/${code}`;
}

// ---------------- 실시간 알림 (친구 초대, 친구 신청) ----------------
function connectNotify() {
  if (notifySocket || !me) return;
  notifySocket = window.io({ transports: ['websocket', 'polling'] });
  notifySocket.on('connect', () => refreshSocial());
  notifySocket.on('invite', async d => {
    await refreshSocial();
    chime();
    const inv = social.invites.find(i => i.room.code === d.room.code && i.from.id === d.from.id);
    if (inv && inv.room.code !== currentRoom) showInvitePopup(inv);
  });
  notifySocket.on('social', async d => {
    await refreshSocial();
    const msg = {
      'friend-request': `${d.nick}님이 친구 신청을 보냈어요. 왼쪽 위 메뉴에서 확인하세요.`,
      'friend-accepted': `${d.nick}님과 친구가 되었어요!`,
      'invite-accepted': `${d.nick}님이 초대를 수락했어요. 곧 들어올 거예요!`,
      'invite-declined': `${d.nick}님이 지금은 함께하기 어렵대요.`,
    }[d.type];
    if (msg) { toast(msg, 4500); if (d.type !== 'invite-declined') chime(); }
  });
}

async function refreshSocial() {
  if (!me) return;
  try {
    [social, stats] = await Promise.all([api('/api/social'), api('/api/stats')]);
  } catch { return; }
  updateBadges();
  if ($('.drawer.open')) renderDrawer();
  for (const fn of socialListeners) { try { fn(social); } catch { /* 무시 */ } }
}

function updateBadges() {
  const n = social.invites.length + social.requests.length;
  for (const b of $$('.menu-btn')) {
    let el = $('.badge', b);
    if (!n) { el?.remove(); continue; }
    if (!el) { el = document.createElement('span'); el.className = 'badge'; b.appendChild(el); }
    el.textContent = n;
  }
}

function showInvitePopup(inv) {
  openModal(`
    <span class="eyebrow">함께하기 초대</span>
    <h2 style="margin-top:10px">${esc(inv.from.nick)}님이 퍼즐에 초대했어요</h2>
    <div class="inv-pic"><div class="thumb" style="background-image:url('${esc(inv.room.url)}')"></div>
      <div><b>${esc(inv.room.title)}</b><span class="muted">${inv.room.pieces}조각 · 지금 ${inv.room.online}명이 맞추는 중</span></div></div>
    <div class="stack">
      <button class="btn big wide" data-act="inv-yes" data-id="${inv.id}">수락하고 같이하기</button>
      <button class="btn line wide" data-act="inv-no" data-id="${inv.id}">이번엔 거절하기</button>
      <button class="btn light wide" data-close>나중에 정하기</button>
    </div>`);
}

let audio = null;
function chime() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    [[784, 0], [1175, 0.12]].forEach(([fr, st]) => {
      const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + st;
      o.frequency.value = fr; g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.55);
    });
  } catch { /* 소리 안 나도 괜찮음 */ }
}

// 여러 화면에서 쓰는 단추 동작 (초대 수락/거절, 친구 신청 수락/거절 등)
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act, id = Number(b.dataset.id);
  b.disabled = true;
  try {
    if (act === 'inv-yes' || act === 'inv-no') {
      const d = await api('/api/invites/respond', { id, accept: act === 'inv-yes' });
      b.closest('.modal-bg')?.close();
      await refreshSocial();
      if (act === 'inv-yes') go('/room/' + d.roomCode);
      else toast('초대를 거절했어요.');
    } else if (act === 'req-yes' || act === 'req-no') {
      await api('/api/friends/respond', { id, accept: act === 'req-yes' });
      toast(act === 'req-yes' ? '친구가 되었어요!' : '친구 신청을 거절했어요.');
      await refreshSocial();
    } else if (act === 'req-cancel') {
      await api('/api/friends/cancel', { id });
      await refreshSocial();
    } else if (act === 'friend-add') {
      const d = await api('/api/friends/request', { userId: id });
      toast(d.message, 4000);
      await refreshSocial();
    } else if (act === 'friend-remove') {
      const p = social.friends.find(f => f.id === id);
      const m = openModal(`<h2>${esc(p?.nick || '')}님을 친구에서 뺄까요?</h2><p class="muted">다시 친구 신청을 하면 언제든 친구가 될 수 있어요.</p><div class="spacer"></div>
        <div class="stack"><button class="btn danger wide" id="rm-yes">친구에서 빼기</button><button class="btn light wide" data-close>그대로 두기</button></div>`);
      $('#rm-yes', m).addEventListener('click', async () => { m.close(); await api('/api/friends/remove', { id }).catch(err => toast(err.message)); await refreshSocial(); });
    }
  } catch (err) { toast(err.message); }
  finally { b.disabled = false; }
});

// ---------------- 왼쪽 서랍 메뉴 ----------------
const drawerBg = document.createElement('div');
drawerBg.className = 'drawer-bg';
drawerBg.hidden = true;
const drawer = document.createElement('aside');
drawer.className = 'drawer';
drawer.setAttribute('aria-label', '내 정보와 메뉴');
document.body.append(drawerBg, drawer);
drawerBg.addEventListener('click', closeDrawer);

export function openDrawer() {
  if (!me) return;
  renderDrawer();
  drawerBg.hidden = false;
  requestAnimationFrame(() => { drawerBg.classList.add('open'); drawer.classList.add('open'); });
  refreshSocial();
}
function closeDrawer() {
  if (!drawer.classList.contains('open')) return;
  drawer.classList.remove('open');
  drawerBg.classList.remove('open');
  setTimeout(() => { if (!drawer.classList.contains('open')) drawerBg.hidden = true; }, 300);
}

function noteCards(kind) {
  if (kind === 'invites') {
    return social.invites.map(i => `
      <div class="note-card">
        <div class="thumb" style="background-image:url('${esc(i.room.url)}')"></div>
        <div class="txt"><b>${esc(i.from.nick)}</b>님이 「${esc(i.room.title)}」 ${i.room.pieces}조각 퍼즐에 초대했어요</div>
        <div class="acts"><button class="btn" data-act="inv-yes" data-id="${i.id}">수락하고 같이하기</button><button class="btn line" data-act="inv-no" data-id="${i.id}">거절</button></div>
      </div>`).join('');
  }
  return social.requests.map(r => `
    <div class="note-card">
      <img src="${avatarUrl(r.from.avatar)}" alt="" style="width:64px;height:64px;border-radius:50%;background:var(--sky);padding:4px">
      <div class="txt"><b>${esc(r.from.nick)}</b>님이 친구 신청을 했어요</div>
      <div class="acts"><button class="btn" data-act="req-yes" data-id="${r.id}">수락</button><button class="btn line" data-act="req-no" data-id="${r.id}">거절</button></div>
    </div>`).join('');
}

function renderDrawer() {
  const page = (location.hash.split('/')[1] || 'home');
  const item = (href, ic, label, key, cnt) => `<a class="nav-item ${page === key ? 'on' : ''}" href="${href}"><span class="ic">${ic}</span>${label}${cnt ? `<span class="cnt">${cnt}</span>` : ''}</a>`;
  const alerts = social.invites.length + social.requests.length;
  drawer.innerHTML = `
    <div class="drawer-top">
      <a class="logo" href="#/home"><img src="/assets/logo.svg" alt=""><span>퍼즐 친구들</span></a>
      <button class="close-btn" id="d-close">✕ 닫기</button>
    </div>
    <div class="profile-card">
      <div class="who"><img src="${avatarUrl(me.avatar)}" alt="">
        <div style="min-width:0"><div class="nick">${esc(me.nick)}</div><div class="mail">${esc(me.email)}</div>
        <span class="how">${me.google ? '구글 계정으로 로그인' : '이메일로 로그인'}</span></div></div>
      <div class="stats">
        <div><b>${stats.done}</b>완성한 퍼즐</div>
        <div><b>${stats.placed}</b>맞춘 조각</div>
        <div><b>${social.friends.length}</b>친구</div>
      </div>
    </div>
    ${alerts ? `<div class="drawer-sec"><h4>새 알림 ${alerts}개</h4>${noteCards('invites')}${noteCards('requests')}</div>` : ''}
    <div class="drawer-sec"><h4>메뉴</h4><nav class="nav-list">
      ${item('#/home', '⌂', '홈', 'home')}
      ${item('#/start', '◆', '퍼즐 시작하기', 'start')}
      ${item('#/create', '▣', '내 사진으로 만들기', 'create')}
      ${item('#/friends', '☺', '친구', 'friends', social.requests.length)}
      ${item('#/records', '★', '내 기록', 'records')}
      ${item('#/profile', '✎', '캐릭터·별명 바꾸기', 'profile')}
    </nav></div>
    <div class="drawer-sec"><h4>화면 밝기</h4>
      <div class="theme-pick" id="d-theme">
        <button data-t="light">☀ 밝게</button><button data-t="dark">☾ 어둡게</button><button data-t="auto">기기 설정</button>
      </div>
    </div>
    <div class="drawer-sec"><h4>내 친구 코드</h4>
      <div class="code-box"><span class="code-big" style="font-size:30px">${esc(social.code)}</span><button class="btn light small" id="d-copy">복사</button></div>
      <p class="muted" style="font-size:17px;margin-top:6px">친구에게 이 코드를 알려 주면 나를 친구로 추가할 수 있어요.</p>
    </div>
    <div class="drawer-foot"><button class="btn line wide" id="d-logout">로그아웃</button></div>`;
  $('#d-close', drawer).addEventListener('click', closeDrawer);
  const markTheme = () => $$('#d-theme button', drawer).forEach(b => b.classList.toggle('on', b.dataset.t === getTheme()));
  markTheme();
  $$('#d-theme button', drawer).forEach(b => b.addEventListener('click', () => { setTheme(b.dataset.t); markTheme(); }));
  $$('a', drawer).forEach(a => a.addEventListener('click', () => { if (a.getAttribute('href') === location.hash) closeDrawer(); }));
  $('#d-copy', drawer).addEventListener('click', async () => toast(await copyText(social.code) ? '친구 코드를 복사했어요.' : '복사가 안 됐어요. 코드를 직접 알려 주세요.'));
  $('#d-logout', drawer).addEventListener('click', async () => {
    await api('/api/logout', {}).catch(() => {});
    me = null;
    notifySocket?.disconnect(); notifySocket = null;
    closeDrawer();
    go('/home');
  });
}

// ---------------- 공통 틀 ----------------
function topbar() {
  return `
  <header class="topbar"><div class="topbar-in">
    <button class="menu-btn" id="menu-open" aria-label="메뉴 열기"><i></i><i></i><i></i><small>메뉴</small></button>
    <a class="logo" href="#/home"><img src="/assets/logo.svg" alt=""><span>퍼즐 친구들</span></a>
    <a class="btn top-cta" href="#/start">퍼즐 시작하기</a>
    ${themeBtn()}
    <button class="me-btn" id="me-open" aria-label="내 정보 보기"><img src="${avatarUrl(me.avatar)}" alt=""></button>
  </div></header>`;
}
// 한 번 누르면 밝게 ↔ 어둡게
const themeBtn = () => `<button class="theme-btn" id="theme-toggle" aria-label="${isDark() ? '밝은 화면으로' : '어두운 화면으로'}" title="${isDark() ? '밝은 화면으로' : '어두운 화면으로'}">${isDark() ? '☀' : '☾'}</button>`;
function bindThemeBtn() {
  const b = $('#theme-toggle');
  b?.addEventListener('click', () => setTheme(isDark() ? 'light' : 'dark'));
}
window.addEventListener('themechange', () => {
  const b = $('#theme-toggle');
  if (b) b.outerHTML = themeBtn(), bindThemeBtn();
});
const footer = () => `
  <footer class="site-foot"><div class="site-foot-in">
    <a class="logo" href="#/home"><img src="/assets/logo.svg" alt=""><span>퍼즐 친구들</span></a>
    <span>친구와 가족이 함께 맞추는 온라인 조각 퍼즐</span>
  </div></footer>`;
function shell(html) {
  app.innerHTML = topbar() + html + footer();
  $('#menu-open').addEventListener('click', openDrawer);
  $('#me-open').addEventListener('click', openDrawer);
  bindThemeBtn();
  updateBadges();
}
const fan = urls => `<div class="fan" aria-hidden="true">${urls.map(u => `<div class="pc" style="background-image:url('${u}')"></div>`).join('')}</div>`;
const wave = `<svg class="hero-wave" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true"><path d="M0 30C240 0 480 60 720 30S1200 0 1440 30V60H0Z" fill="var(--paper)"/></svg>`;

// ---------------- 로그인 / 가입 ----------------
function renderLogin(mode = 'login') {
  const signup = mode === 'signup';
  app.innerHTML = `
  <div class="auth">
    <section class="auth-art">
      <span class="logo"><img src="/assets/logo.svg" alt=""><span>퍼즐 친구들</span></span>
      <div>
        <span class="eyebrow">함께 맞추는 온라인 퍼즐</span>
        <h1 style="margin:16px 0 18px">한 조각씩,<br>함께 완성해요</h1>
        <p class="lead">멀리 있는 친구와 가족을 초대해 하나의 그림을 같이 맞춰 보세요. 10조각부터 1000조각까지 고를 수 있어요.</p>
      </div>
      ${fan(ART)}
    </section>
    <section class="auth-form">
      <div class="card stack">
        <h2 class="center">${signup ? '처음 오셨나요?' : '다시 오신 걸 환영해요'}</h2>
        <div class="google-box" id="google-box"></div>
        <div class="divider">또는 이메일로</div>
        <div class="tabs" role="tablist">
          <button class="tab ${signup ? '' : 'on'}" data-mode="login">로그인</button>
          <button class="tab ${signup ? 'on' : ''}" data-mode="signup">가입하기</button>
        </div>
        <form class="stack" id="auth-form" novalidate>
          <div class="field"><label for="f-email">이메일</label><input class="input" id="f-email" type="email" autocomplete="email" placeholder="예) puzzle@naver.com" required></div>
          <div class="field"><label for="f-pass">비밀번호 ${signup ? '(6글자 이상)' : ''}</label><input class="input" id="f-pass" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required></div>
          ${signup ? '<div class="field"><label for="f-nick">별명 (친구들에게 보여요)</label><input class="input" id="f-nick" maxlength="12" placeholder="예) 퍼즐왕" required></div>' : ''}
          <div class="error" id="f-err"></div>
          <button class="btn big wide" type="submit">${signup ? '가입하고 시작하기' : '로그인'}</button>
        </form>
      </div>
    </section>
  </div>`;
  $$('.tab', app).forEach(t => t.addEventListener('click', () => renderLogin(t.dataset.mode)));
  $('#auth-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('#auth-form button[type=submit]');
    btn.disabled = true;
    $('#f-err').textContent = '';
    try {
      const body = { email: $('#f-email').value, password: $('#f-pass').value };
      if (signup) body.nick = $('#f-nick').value;
      const d = await api(signup ? '/api/signup' : '/api/login', body);
      me = d.user;
      afterLogin();
    } catch (err) {
      $('#f-err').textContent = err.message;
      btn.disabled = false;
    }
  });
  setupGoogle($('#google-box'));
}

function setupGoogle(el) {
  const off = msg => { el.innerHTML = `<div class="google-off">${msg}</div>`; };
  if (!config.googleClientId) return off('구글 로그인은 준비 중이에요. 지금은 아래에서 이메일로 해 주세요.');
  const okHost = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if (!okHost) return off('이 주소에서는 구글 로그인이 안 돼요. 아래에서 이메일로 해 주세요.');
  const init = () => {
    google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: async r => {
        try {
          const d = await api('/api/google', { credential: r.credential });
          me = d.user;
          afterLogin();
        } catch (err) { toast(err.message); }
      },
    });
    google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: Math.min(400, el.clientWidth || 340), locale: 'ko' });
  };
  if (window.google?.accounts?.id) return init();
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.onload = init;
  s.onerror = () => off('구글 로그인을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
  document.head.appendChild(s);
}

// ---------------- 캐릭터 고르기 ----------------
function renderProfile() {
  let pick = me.setup ? me.avatar : null;
  const body = `
  <main class="page" style="max-width:780px">
    <div class="page-title center"><span class="eyebrow">내 정보</span><h2 style="margin-top:10px">나를 나타낼 캐릭터를 골라 주세요</h2><p>같이 퍼즐을 맞출 때 친구들에게 이 캐릭터와 별명이 보여요.</p></div>
    <div class="card stack" style="margin-top:20px">
      <div class="avatar-grid">
        ${AVATARS.map(a => `<button class="avatar-btn ${pick === a.id ? 'on' : ''}" data-id="${a.id}"><img src="${avatarUrl(a.id)}" alt="">${a.name}</button>`).join('')}
      </div>
      <div class="field"><label for="p-nick">별명 (친구들에게 보여요)</label><input class="input" id="p-nick" maxlength="12" value="${esc(me.nick)}"></div>
      <div class="error" id="p-err"></div>
      <button class="btn big wide" id="p-save">이걸로 할래요</button>
    </div>
  </main>`;
  if (me.setup) shell(body); else app.innerHTML = body;
  $$('.avatar-btn', app).forEach(b => b.addEventListener('click', () => {
    pick = b.dataset.id;
    $$('.avatar-btn', app).forEach(x => x.classList.toggle('on', x === b));
  }));
  $('#p-save').addEventListener('click', async () => {
    if (!pick) { $('#p-err').textContent = '캐릭터를 하나 눌러 주세요.'; return; }
    try {
      const d = await api('/api/profile', { nick: $('#p-nick').value, avatar: pick });
      me = d.user;
      toast('반가워요, ' + me.nick + '님!');
      afterLogin();
    } catch (err) { $('#p-err').textContent = err.message; }
  });
}

// ---------------- 홈 ----------------
const catTag = c => c === 'art' ? '<span class="tag">작품</span>' : c === 'kids' ? '<span class="tag kids">어린이</span>' : '<span class="tag mine">내 사진</span>';

async function renderHome() {
  shell(`
  <section class="hero-band"><div class="hero-in">
    <div>
      <span class="eyebrow">${esc(me.nick)}님, 반가워요</span>
      <h1>오늘은 어떤 그림을<br><em>함께</em> 맞춰 볼까요?</h1>
      <p class="lead">그림과 조각 수를 고르고 친구를 초대하세요. 친구가 초대를 수락하면 같은 퍼즐판에서 실시간으로 함께 맞출 수 있어요.</p>
      <div class="row"><a class="btn teal big" href="#/start">퍼즐 시작하기</a><a class="btn ghost-w big" href="#/create">내 사진으로 만들기</a></div>
    </div>
    ${fan(ART)}
  </div>${wave}</section>
  <main class="page">
    <div id="home-invites"></div>
    <section class="section">
      <div class="section-head"><div><span class="eyebrow">컬렉션</span><h2 style="margin-top:8px">오늘의 그림</h2><p>그림을 누르면 바로 조각 수를 고를 수 있어요.</p></div><a class="btn line" href="#/start">모든 그림 보기</a></div>
      <div class="gallery" id="home-gallery"></div>
    </section>
    <section class="section">
      <div class="section-head"><div><span class="eyebrow">친구</span><h2 style="margin-top:8px">함께하는 친구들</h2><p>초록 점이 있는 친구는 지금 접속해 있어요.</p></div><a class="btn line" href="#/friends">친구 관리</a></div>
      <div id="home-friends"></div>
    </section>
    <section class="section">
      <div class="section-head"><div><span class="eyebrow">이용 방법</span><h2 style="margin-top:8px">세 걸음이면 충분해요</h2></div></div>
      <div class="feature-grid">
        <div class="feature"><div class="num">01</div><h3>그림 고르기</h3><p>준비된 작품이나 내 사진을 고르고, 10조각부터 1000조각까지 정해요.</p></div>
        <div class="feature"><div class="num">02</div><h3>친구 초대하기</h3><p>친구 목록에서 초대를 보내거나 링크를 보내요. 친구가 수락하면 바로 들어와요.</p></div>
        <div class="feature"><div class="num">03</div><h3>함께 완성하기</h3><p>조각을 끌어다 놓고, 누르면 돌릴 수 있어요. 다 맞추면 기록이 남아요.</p></div>
      </div>
    </section>
    <section class="section">
      <div class="card join-box">
        <div style="flex:1 1 280px"><h3>방 번호를 받으셨나요?</h3><p class="muted">친구가 알려 준 6글자를 적고 들어가기를 눌러 주세요.</p></div>
        <input class="input" id="join-code" maxlength="6" placeholder="ABC123" aria-label="방 번호">
        <button class="btn big" id="join-go">들어가기</button>
      </div>
    </section>
  </main>`);
  const join = () => {
    const code = $('#join-code').value.trim().toUpperCase();
    if (code.length !== 6) return toast('방 번호 6글자를 적어 주세요.');
    go('/room/' + code);
  };
  $('#join-go').addEventListener('click', join);
  $('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') join(); });

  const drawSocial = () => {
    const inv = $('#home-invites');
    if (!inv) return;
    inv.innerHTML = social.invites.length ? `<div class="invite-strip"><div class="card"><h3>받은 초대 ${social.invites.length}개</h3><div class="invite-row">${noteCards('invites')}</div></div></div>` : '';
    $('#home-friends').innerHTML = social.friends.length
      ? `<div class="friends-strip">${social.friends.map(f => `<div class="fchip"><div class="av"><img src="${avatarUrl(f.avatar)}" alt=""><span class="dot ${f.online ? 'on' : ''}"></span></div><span>${esc(f.nick)}</span><small>${f.online ? '접속 중' : '쉬는 중'}</small></div>`).join('')}</div>`
      : `<div class="card row" style="justify-content:space-between"><div><h3>아직 친구가 없어요</h3><p class="muted">친구의 이메일이나 친구 코드로 친구를 추가해 보세요.</p></div><a class="btn" href="#/friends">친구 추가하기</a></div>`;
  };
  socialListeners.add(drawSocial);
  drawSocial();
  refreshSocial();

  try {
    const pics = (await api('/api/pictures')).pictures.filter(p => p.sample).slice(0, 8);
    $('#home-gallery').innerHTML = pics.map(p => `
      <a class="art-card" href="#/start/${p.id}"><div class="frame"><div class="thumb" style="background-image:url('${esc(p.url)}')"></div></div>
      <div class="meta"><b>${esc(p.title)}</b>${catTag(p.category)}</div></a>`).join('');
  } catch { /* 그림 목록 없어도 홈은 보이게 */ }
}

// 조각 수 고르기 (공통)
function countPicker(el, getAspect, onPick, current) {
  el.innerHTML = COUNTS.map(c => `<button class="count-btn ${current === c.n ? 'on' : ''}" data-n="${c.n}"><b>${c.n}</b><span>${c.label}</span></button>`).join('');
  $$('.count-btn', el).forEach(b => b.addEventListener('click', () => {
    $$('.count-btn', el).forEach(x => x.classList.toggle('on', x === b));
    const n = Number(b.dataset.n);
    onPick(n, gridFor(n, getAspect()));
  }));
}
// 조각 수 안내 + 그림이 많이 잘리면 알려 주기
function gridText(g, w, h) {
  let t = `가로 ${g.cols}칸 × 세로 ${g.rows}칸 = <b>${g.cols * g.rows}조각</b>`;
  if (w && h) {
    const c = cropRect(w, h, g.cols, g.rows);
    if (c.sw * c.sh < w * h * 0.9) t += `<br><span class="muted">조각 모양에 맞추느라 그림 ${c.sw < w ? '양옆이' : '위아래가'} 조금 잘려요. 아래 그림에서 확인하세요.</span>`;
  }
  return t;
}
// 퍼즐로 쓰일 부분과 조각 선을 미리 보여 주기
function drawGridPreview(cv, img, grid) {
  const ctx = cv.getContext('2d');
  const g = grid || { cols: 1, rows: 1 };
  const c = grid ? cropRect(img.width, img.height, g.cols, g.rows) : { sx: 0, sy: 0, sw: img.width, sh: img.height };
  const W = 900, H = Math.round(grid ? W * g.rows / g.cols : W * c.sh / c.sw);
  cv.width = W; cv.height = H;
  ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, 0, 0, W, H);
  if (!grid) return;
  ctx.strokeStyle = 'rgba(255,255,255,.85)';
  ctx.lineWidth = g.cols > 30 ? 1 : 3;
  ctx.beginPath();
  for (let i = 1; i < g.cols; i++) { const x = Math.round(W * i / g.cols) + .5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let i = 1; i < g.rows; i++) { const y = Math.round(H * i / g.rows) + .5; ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
}

async function startRoom(pictureId, grid, btn) {
  btn.disabled = true;
  try {
    const d = await api('/api/rooms', { pictureId, cols: grid.cols, rows: grid.rows });
    go('/room/' + d.code);
  } catch (err) { toast(err.message); btn.disabled = false; }
}

// ---------------- 퍼즐 고르기 ----------------
async function renderStart(preselect) {
  shell(`<main class="page"><div class="page-title"><span class="eyebrow">새 퍼즐</span><h2 style="margin-top:10px">어떤 퍼즐을 맞출까요?</h2></div><p class="muted">그림을 불러오는 중...</p></main>`);
  let pictures;
  try { pictures = (await api('/api/pictures')).pictures; } catch (err) { toast(err.message); return; }
  let pic = pictures.find(p => p.id === preselect) || null;
  let n = 0, grid = null, filter = pic ? pic.category : 'all';
  $('main', app).innerHTML = `
    <div class="page-title"><span class="eyebrow">새 퍼즐</span><h2 style="margin-top:10px">어떤 퍼즐을 맞출까요?</h2><p>그림을 고르고, 조각 수를 정한 다음 방을 만들어요. 방에 들어가서 친구를 초대할 수 있어요.</p></div>
    <div class="step-title"><span class="step-num">01</span><h3>그림 고르기</h3></div>
    <div class="filter" id="filter">
      <button data-f="all">전체</button><button data-f="art">작품</button><button data-f="kids">어린이</button><button data-f="mine">내 사진</button>
    </div>
    <div class="pick-grid" id="pick"></div>
    <div class="step-title"><span class="step-num">02</span><h3>조각 수 고르기</h3></div>
    <div class="count-grid" id="counts"></div>
    <p class="grid-note" id="grid-note">그림을 먼저 고르고, 조각 수를 눌러 주세요.</p>
    <div class="preview-box" id="start-pv" hidden style="max-width:680px;margin:20px auto 0"><canvas></canvas></div>
    <div class="sticky-go"><button class="btn big" id="go" disabled>방 만들고 시작하기</button></div>`;
  const drawPics = () => {
    $$('#filter button').forEach(b => b.classList.toggle('on', b.dataset.f === filter));
    const list = pictures.filter(p => filter === 'all' || p.category === filter);
    $('#pick').innerHTML = list.map(p => `
      <button class="art-card ${pic?.id === p.id ? 'on' : ''}" data-id="${p.id}"><div class="frame"><div class="thumb" style="background-image:url('${esc(p.url)}')"></div></div>
      <div class="meta"><b>${esc(p.title)}</b>${catTag(p.category)}</div></button>`).join('') + `
      <a class="art-card add-card" href="#/create"><div class="frame"><div class="thumb">＋</div></div><div class="meta"><b>내 사진으로 만들기</b></div></a>`;
    $$('#pick .art-card[data-id]').forEach(b => b.addEventListener('click', () => {
      pic = pictures.find(p => p.id === Number(b.dataset.id));
      $$('#pick .art-card').forEach(x => x.classList.toggle('on', x === b));
      refresh();
      if (!n) $('#counts').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }));
  };
  $$('#filter button').forEach(b => b.addEventListener('click', () => { filter = b.dataset.f; drawPics(); }));
  const refresh = () => {
    $('#go').disabled = !(pic && grid);
    if (pic && n) {
      grid = gridFor(n, pic.w / pic.h);
      $('#grid-note').innerHTML = gridText(grid, pic.w, pic.h);
      $('#go').disabled = false;
      const want = pic, g = grid;
      loadImage(pic.url).then(img => {
        if (want !== pic || g !== grid) return; // 그새 다른 걸 골랐으면 그리지 않기
        drawGridPreview($('#start-pv canvas'), img, g);
        $('#start-pv').hidden = false;
      }).catch(() => {});
    }
  };
  drawPics();
  countPicker($('#counts'), () => (pic ? pic.w / pic.h : 4 / 3), v => { n = v; refresh(); }, 0);
  $('#go').addEventListener('click', () => { if (pic && grid) startRoom(pic.id, grid, $('#go')); });
}

// ---------------- 내 사진으로 만들기 ----------------
function renderCreate() {
  let img = null, n = 0, grid = null;
  shell(`
  <main class="page">
    <div class="page-title"><span class="eyebrow">나만의 퍼즐</span><h2 style="margin-top:10px">내 사진으로 퍼즐 만들기</h2><p>가족사진, 여행 사진, 반려동물 사진으로 퍼즐을 만들어 친구와 함께 맞춰 보세요.</p></div>
    <div class="step-title"><span class="step-num">01</span><h3>사진 올리기</h3></div>
    <label class="drop-zone" id="drop">
      <div class="ic">＋</div>
      <h3>여기를 눌러 사진 고르기</h3>
      <div class="muted">사진 파일을 이곳으로 끌어다 놓아도 돼요</div>
      <input type="file" id="file" accept="image/*" hidden>
    </label>
    <div id="after" hidden>
      <div class="create-grid">
        <div class="preview-box"><canvas id="pv"></canvas></div>
        <div class="stack">
          <div class="field"><label for="c-title">퍼즐 이름</label><input class="input" id="c-title" maxlength="30" value="나의 퍼즐"></div>
          <button class="btn line" id="re-pick">다른 사진 고르기</button>
        </div>
      </div>
      <div class="step-title"><span class="step-num">02</span><h3>조각 수 고르기</h3></div>
      <div class="count-grid" id="counts"></div>
      <p class="grid-note" id="grid-note">조각 수를 눌러 주세요. 왼쪽 사진에 조각 선이 보여요.</p>
      <div class="sticky-go"><button class="btn big" id="go" disabled>퍼즐 만들고 시작하기</button></div>
    </div>
  </main>`);
  const drop = $('#drop'), file = $('#file');
  const draw = () => drawGridPreview($('#pv'), img, grid);

  const useFile = async f => {
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('사진 파일을 골라 주세요.');
    const url = URL.createObjectURL(f);
    try { img = await loadImage(url); } catch { return toast('이 사진 형식은 열 수 없어요. JPG나 PNG 사진을 골라 주세요.'); }
    const base = f.name.replace(/\.[^.]+$/, '').slice(0, 30);
    if (base && !/^(IMG|DSC|PXL|KakaoTalk|Screenshot|image)/i.test(base)) $('#c-title').value = base;
    drop.hidden = true;
    $('#after').hidden = false;
    if (n) grid = gridFor(n, img.width / img.height), $('#grid-note').innerHTML = gridText(grid, img.width, img.height);
    draw();
  };
  file.addEventListener('change', () => useFile(file.files[0]));
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => useFile(e.dataTransfer.files[0]));
  $('#re-pick').addEventListener('click', () => { file.value = ''; file.click(); });

  countPicker($('#counts'), () => img.width / img.height, (v, g) => {
    n = v; grid = g;
    $('#grid-note').innerHTML = gridText(g, img.width, img.height);
    $('#go').disabled = false;
    draw();
  }, 0);

  $('#go').addEventListener('click', async () => {
    if (!img || !grid) return;
    const btn = $('#go');
    btn.disabled = true;
    btn.textContent = '사진 올리는 중...';
    try {
      const max = 2400, k = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * k), h = Math.round(img.height * k);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const d = await api('/api/pictures', { title: $('#c-title').value, dataUrl: cv.toDataURL('image/jpeg', 0.88), w, h });
      await startRoom(d.picture.id, grid, btn);
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
      btn.textContent = '퍼즐 만들고 시작하기';
    }
  });
}

// ---------------- 친구 ----------------
function renderFriends() {
  shell(`
  <main class="page">
    <div class="page-title"><span class="eyebrow">친구</span><h2 style="margin-top:10px">친구와 함께해요</h2><p>친구가 되면 퍼즐 방에서 바로 초대를 보낼 수 있어요. 친구는 초대를 수락하고 들어와요.</p></div>
    <div class="friend-grid" style="margin-top:28px">
      <div class="stack">
        <div class="card stack">
          <h3>친구 추가하기</h3>
          <p class="muted">친구의 <b>이메일</b>이나 <b>친구 코드</b>(8글자)를 적어 주세요.</p>
          <input class="input" id="fr-q" placeholder="예) friend@naver.com 또는 AB12CD34" aria-label="친구 이메일 또는 친구 코드">
          <button class="btn big wide" id="fr-add">친구 신청 보내기</button>
        </div>
        <div class="card stack">
          <h3>내 친구 코드</h3>
          <div class="code-box"><span class="code-big" id="fr-code"></span><button class="btn light small" id="fr-copy">복사</button></div>
          <p class="muted">친구에게 이 코드를 알려 주면 나를 찾을 수 있어요.</p>
        </div>
      </div>
      <div class="stack" id="fr-lists"></div>
    </div>
  </main>`);
  const add = async () => {
    const q = $('#fr-q').value.trim();
    if (!q) return toast('친구의 이메일이나 친구 코드를 적어 주세요.');
    $('#fr-add').disabled = true;
    try { const d = await api('/api/friends/request', { query: q }); toast(d.message, 4500); $('#fr-q').value = ''; await refreshSocial(); }
    catch (err) { toast(err.message, 4000); }
    finally { $('#fr-add').disabled = false; }
  };
  $('#fr-add').addEventListener('click', add);
  $('#fr-q').addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  $('#fr-copy').addEventListener('click', async () => toast(await copyText(social.code) ? '친구 코드를 복사했어요.' : '복사가 안 됐어요. 코드를 직접 알려 주세요.'));

  const personRow = (p, right, sub) => `<div class="person"><div class="av"><img src="${avatarUrl(p.avatar)}" alt=""><span class="dot ${p.online ? 'on' : ''}"></span></div>
    <div class="nm">${esc(p.nick)}<small>${sub ?? (p.online ? '지금 접속 중' : '쉬는 중')}</small></div>${right}</div>`;
  const draw = () => {
    $('#fr-code').textContent = social.code;
    let h = '';
    if (social.requests.length) h += `<div class="card"><h3 style="margin-bottom:12px">받은 친구 신청</h3>${noteCards('requests')}</div>`;
    h += `<div class="card"><h3 style="margin-bottom:6px">내 친구 ${social.friends.length}명</h3>
      ${social.friends.length ? social.friends.map(f => personRow(f, `<button class="btn danger" data-act="friend-remove" data-id="${f.id}">빼기</button>`)).join('') : '<p class="muted" style="padding:10px 0">아직 친구가 없어요. 왼쪽에서 친구를 추가해 보세요.</p>'}</div>`;
    if (social.sent.length) h += `<div class="card"><h3 style="margin-bottom:6px">수락을 기다리는 신청</h3>${social.sent.map(s => personRow(s.to, `<button class="btn line" data-act="req-cancel" data-id="${s.id}">신청 취소</button>`, '수락을 기다리는 중')).join('')}</div>`;
    if (social.recent.length) h += `<div class="card"><h3 style="margin-bottom:6px">같이 퍼즐을 맞췄던 사람</h3>${social.recent.map(p => personRow(p, social.sent.some(s => s.to.id === p.id) ? '<span class="muted">신청함</span>' : `<button class="btn teal" data-act="friend-add" data-id="${p.id}">친구 신청</button>`)).join('')}</div>`;
    $('#fr-lists').innerHTML = h;
  };
  socialListeners.add(draw);
  draw();
  refreshSocial();
}

// ---------------- 내 기록 ----------------
async function renderRecords() {
  shell(`<main class="page"><div class="page-title"><span class="eyebrow">기록</span><h2 style="margin-top:10px">내가 완성한 퍼즐</h2></div><p class="muted">기록을 불러오는 중...</p></main>`);
  let records;
  try { records = (await api('/api/records')).records; } catch (err) { toast(err.message); return; }
  const total = records.length, pieces = records.reduce((a, r) => a + r.placed, 0);
  const best = records.reduce((m, r) => Math.max(m, r.pieces), 0);
  $('main', app).innerHTML = `
    <div class="page-title"><span class="eyebrow">기록</span><h2 style="margin-top:10px">내가 완성한 퍼즐</h2></div>
    <div class="stat-row">
      <div><b>${total}개</b>완성한 퍼즐</div>
      <div><b>${pieces}개</b>내가 맞춘 조각</div>
      <div><b>${best ? best + '조각' : '-'}</b>가장 큰 퍼즐</div>
    </div>
    ${total ? `<div class="rec-list">${records.map(r => `
      <div class="rec">
        <div class="thumb" style="background-image:url('${esc(r.url)}')"></div>
        <div>
          <h3>${esc(r.title)}</h3>
          <div class="facts">
            <span>조각 <b>${r.pieces}</b>개</span>
            <span>걸린 시간 <b>${fmtTime(r.seconds)}</b></span>
            <span>내가 맞춘 조각 <b>${r.placed}</b>개</span>
          </div>
          <p class="muted" style="margin-top:6px">${new Date(r.finished).toLocaleString('ko-KR', { dateStyle: 'long', timeStyle: 'short' })}
          ${r.friends.length ? ` · 함께한 친구: ${r.friends.map(esc).join(', ')}` : ' · 혼자서 완성'}</p>
        </div>
      </div>`).join('')}</div>`
    : `<div class="card empty"><img src="/assets/logo.svg" alt=""><h3>아직 완성한 퍼즐이 없어요</h3><p class="muted" style="margin:8px 0 22px">첫 퍼즐을 맞춰 볼까요?</p><a class="btn big" href="#/start">퍼즐 시작하기</a></div>`}`;
}

// ---------------- 시작 ----------------
(async () => {
  try { config = await api('/api/config'); } catch { /* 기본값 사용 */ }
  try { me = (await api('/api/me')).user; } catch { me = null; }
  if (me) connectNotify();
  route();
  if (me) {
    await refreshSocial();
    // 들어왔을 때 10분 안에 받은 초대가 있으면 바로 알려 준다
    const fresh = social.invites.find(i => Date.now() - i.created < 10 * 60e3 && i.room.code !== currentRoom);
    if (fresh) showInvitePopup(fresh);
  }
})();
