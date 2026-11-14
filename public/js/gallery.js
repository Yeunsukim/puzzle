// 랭킹 작품 전시: 첫 화면 '명예의 전당', 갤러리 화면, 내 트로피
// 1~5위는 순위마다 다른 액자에 담는다 (1위 황금 · 2위 은 · 3위 동 · 4위 원목 · 5위 흰 액자)
// 6~10위는 소박한 나무 테 액자에 걸어 전시만 한다 (선물 없음)
import { $, $$, esc, api, fmtTime } from './util.js';
import { renderArtwork, viewArtwork, dateText } from './artwork.js';

export const PRIZE = {
  1: { name: '황금 액자', gift: '왕관 트로피', icon: 'crown', cls: 'gold' },
  2: { name: '은 액자', gift: '은메달', icon: 'medal', cls: 'silver' },
  3: { name: '동 액자', gift: '동메달', icon: 'medal', cls: 'bronze' },
  4: { name: '원목 액자', gift: '상장', icon: 'award', cls: 'wood' },
  5: { name: '흰 액자', gift: '상장', icon: 'award', cls: 'white' },
};
const PLAIN = { name: '소박한 나무 테 액자', gift: '', icon: 'image', cls: 'plain' };
export const prizeOf = rank => PRIZE[rank] || PLAIN;
const typeName = t => (t === 'month' ? '월간' : '주간');

// 랭킹 항목 → 완성 그림을 그릴 때 쓰는 모양으로
const toRec = e => ({
  url: e.url, title: e.title, finished: e.finished, cols: e.cols, rows: e.rows, edges: e.edges, w: e.w, h: e.h,
  pieces: e.pieces, friends: e.people.slice(1).map(p => p.nick),
});
const artist = e => e.people.map(p => p.nick).join(' · ') || '알 수 없음';

// 액자에 담긴 작품 + 아래 설명표
function framed(e, data, big) {
  const pz = prizeOf(e.rank);
  return `
  <figure class="exhibit ${big ? 'big' : ''}">
    <button class="frame frame-${pz.cls}" data-art="${e.code}" aria-label="「${esc(e.title)}」 크게 보기">
      <span class="ribbon ${pz.cls}"><i class="fa-solid fa-${pz.icon}" aria-hidden="true"></i> ${e.rank}위</span>
      <span class="mat"><canvas></canvas></span>
    </button>
    <figcaption class="placard">
      <span class="pl-rank ${pz.cls}"><i class="fa-solid fa-${pz.icon}" aria-hidden="true"></i> ${esc(data.label)} · ${typeName(data.type)} ${e.rank}위</span>
      <b class="pl-title">「${esc(e.title)}」</b>
      <span class="pl-artist">${esc(artist(e))}</span>
      <span class="pl-meta">조각 퍼즐 ${e.pieces}조각 · ${fmtTime(e.seconds)} · 점수 ${e.score.toLocaleString('ko-KR')}</span>
      <span class="pl-date">${dateText(e.finished)} 완성 · ${pz.gift ? `선물: ${pz.name}과 ${pz.gift}` : '10위 안 전시 작품'}</span>
    </figcaption>
  </figure>`;
}

// 액자 안의 그림을 그리고, 누르면 크게 보기
async function fill(root, data) {
  const byCode = new Map(data.entries.map(e => [e.code, e]));
  $$('[data-art]', root).forEach(b => b.addEventListener('click', () => {
    const e = byCode.get(b.dataset.art);
    if (e) viewArtwork(toRec(e), e.people[0]?.nick || '');
  }));
  for (const b of $$('[data-art]', root)) {
    const e = byCode.get(b.dataset.art), cv = $('canvas', b);
    try {
      const art = await renderArtwork(toRec(e), e.people[0]?.nick || '', b.closest('.big') ? 1000 : 700);
      if (!cv.isConnected) return;
      cv.width = art.width; cv.height = art.height;
      cv.getContext('2d').drawImage(art, 0, 0);
    } catch { /* 그림을 못 불러오면 빈 액자 */ }
  }
}

const emptyText = (type, offset) => offset === 0
  ? `아직 ${type === 'month' ? '이번 달' : '이번 주'}에 완성된 퍼즐이 없어요. 첫 번째 작품의 주인공이 되어 보세요!`
  : '이 기간에는 완성된 퍼즐이 없어요.';

// ---- 첫 화면: 명예의 전당 (이번 주 / 이번 달 5위까지) ----
export async function hallOfFame(el) {
  let type = 'week';
  const draw = async () => {
    el.innerHTML = `
      <div class="section-head"><div><span class="eyebrow">명예의 전당</span><h2 style="margin-top:8px">${type === 'month' ? '이번 달' : '이번 주'}의 작품</h2>
        <p>조각이 많을수록, 빨리 맞출수록 점수가 높아요. 5위까지 액자에 담아 전시해요.</p></div>
        <div class="row">
          <div class="seg"><button data-t="week" class="${type === 'week' ? 'on' : ''}">주간</button><button data-t="month" class="${type === 'month' ? 'on' : ''}">월간</button></div>
          <a class="btn line" href="#/gallery"><i class="fa-solid fa-landmark" aria-hidden="true"></i> 갤러리</a>
        </div></div>
      <div class="hall" id="hall-list"><p class="muted">불러오는 중...</p></div>`;
    $$('.seg button', el).forEach(b => b.addEventListener('click', () => { type = b.dataset.t; draw(); }));
    let data;
    try { data = await api(`/api/rankings?type=${type}`); } catch { $('#hall-list', el).innerHTML = '<p class="muted">랭킹을 불러오지 못했어요.</p>'; return; }
    const list = $('#hall-list', el);
    if (!list) return;
    data = { ...data, entries: data.entries.slice(0, 5) }; // 첫 화면은 5위까지만
    list.innerHTML = data.entries.length ? data.entries.map(e => framed(e, data, e.rank === 1)).join('') : `<div class="card empty-hall">${emptyText(type, 0)}</div>`;
    fill(list, data);
  };
  draw();
}

// ---- 갤러리 화면: 주간 / 월간, 지난 기간도 넘겨 보기 ----
export async function renderGallery(main) {
  let type = 'week', offset = 0;
  const draw = async () => {
    main.innerHTML = `
      <div class="page-title"><span class="eyebrow">갤러리</span><h2 style="margin-top:10px">랭킹 작품 전시관</h2>
        <p>주간·월간 랭킹 10위까지의 작품을 액자에 담아 전시해요. 1~5위는 특별한 액자와 선물, 6~10위는 소박한 나무 테 액자예요. 작품을 누르면 크게 보고 저장할 수 있어요.</p></div>
      <div class="gallery-bar">
        <div class="seg"><button data-t="week" class="${type === 'week' ? 'on' : ''}">주간</button><button data-t="month" class="${type === 'month' ? 'on' : ''}">월간</button></div>
        <div class="row">
          <button class="btn line small" id="gl-prev"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> 지난 ${type === 'month' ? '달' : '주'}</button>
          <b id="gl-label" class="gl-label">...</b>
          <button class="btn line small" id="gl-next" ${offset >= 0 ? 'disabled' : ''}>다음 ${type === 'month' ? '달' : '주'} <i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
        </div>
      </div>
      <div class="hall gallery-hall" id="gl-list"><p class="muted">불러오는 중...</p></div>
      <div class="card prize-guide">
        <h3 style="margin-bottom:10px"><i class="fa-solid fa-gift" aria-hidden="true"></i> 랭킹 선물</h3>
        <p class="muted" style="margin-bottom:12px">주간·월간 랭킹이 끝나면 5위까지의 작품을 함께 맞춘 사람 모두에게 선물을 드려요. 받은 선물은 "내 기록"에서 볼 수 있어요.</p>
        <div class="prize-row">${[1, 2, 3, 4, 5].map(r => `<span class="prize ${PRIZE[r].cls}"><i class="fa-solid fa-${PRIZE[r].icon}" aria-hidden="true"></i><b>${r}위</b>${PRIZE[r].name}<br>${PRIZE[r].gift}</span>`).join('')}</div>
      </div>`;
    $$('.seg button', main).forEach(b => b.addEventListener('click', () => { type = b.dataset.t; offset = 0; draw(); }));
    $('#gl-prev', main).addEventListener('click', () => { offset--; draw(); });
    $('#gl-next', main).addEventListener('click', () => { if (offset < 0) { offset++; draw(); } });
    let data;
    try { data = await api(`/api/rankings?type=${type}&offset=${offset}`); } catch { $('#gl-list', main).innerHTML = '<p class="muted">랭킹을 불러오지 못했어요.</p>'; return; }
    if (!$('#gl-list', main)) return;
    $('#gl-label', main).textContent = data.label + (data.range ? ` (${data.range})` : '');
    $('#gl-list', main).innerHTML = data.entries.length ? data.entries.map(e => framed(e, data, e.rank === 1)).join('') : `<div class="card empty-hall">${emptyText(type, offset)}</div>`;
    fill($('#gl-list', main), data);
  };
  draw();
}

// ---- 내 트로피 (내 기록 화면) ----
export async function trophyList(el) {
  let awards = [];
  try { awards = (await api('/api/awards')).awards; } catch { return; }
  if (!el.isConnected) return;
  el.innerHTML = `
    <div class="card trophies">
      <h3 style="margin-bottom:12px"><i class="fa-solid fa-trophy" aria-hidden="true"></i> 내 트로피 ${awards.length}개</h3>
      ${awards.length ? `<div class="trophy-row">${awards.map(a => {
        const pz = PRIZE[a.rank] || PRIZE[5]; // 트로피는 5위까지만
        return `<div class="trophy ${pz.cls}"><i class="fa-solid fa-${pz.icon}" aria-hidden="true"></i>
          <b>${esc(a.label)} ${a.type === 'month' ? '월간' : '주간'} ${a.rank}위</b><span>「${esc(a.title)}」</span><small>${pz.name} · ${pz.gift}</small></div>`;
      }).join('')}</div>`
      : '<p class="muted">아직 받은 트로피가 없어요. 주간·월간 랭킹 5위 안에 들면 트로피를 받아요!</p>'}
    </div>`;
}
