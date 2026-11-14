// 카카오톡으로 초대 보내기
// 1) 카카오 번호(KAKAO_JS_KEY)가 있으면: 카카오 공식 초대 카드
// 2) 없으면 휴대폰 '공유하기' 창 (카카오톡·문자 고르기)
// 3) 그것도 없으면(대부분 PC): 링크 복사 + 붙여 넣기 안내
import { toast, copyText } from './util.js';

const SDK = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js';
let sdkPromise = null;

function loadKakao(key) {
  if (window.Kakao?.isInitialized?.()) return Promise.resolve(window.Kakao);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK;
      s.crossOrigin = 'anonymous';
      s.onload = () => {
        try {
          if (!window.Kakao.isInitialized()) window.Kakao.init(key);
          resolve(window.Kakao);
        } catch (err) { reject(err); }
      };
      s.onerror = () => reject(new Error('카카오 도구를 불러오지 못했어요'));
      document.head.appendChild(s);
      setTimeout(() => reject(new Error('카카오 도구가 너무 늦어요')), 8000);
    }).catch(err => { sdkPromise = null; throw err; });
  }
  return sdkPromise;
}

// 그림 주소를 인터넷 전체 주소로 (카카오 카드에 넣으려면 전체 주소가 필요)
export function absUrl(url, base) {
  if (!url) return '';
  try { return new URL(url, base || location.origin).href; } catch { return ''; }
}

const isPhone = () => window.matchMedia?.('(pointer: coarse)').matches && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

// { title, text, url, imageUrl, button } → 보낸 방법('kakao' | 'share' | 'copy' | 'cancel' | 'fail')
export async function shareInvite({ title, text, url, imageUrl, button = '같이 하기' }, config = {}) {
  // 1) 카카오 공식 초대 카드
  if (config.kakaoKey) {
    try {
      const Kakao = await loadKakao(config.kakaoKey);
      const link = { mobileWebUrl: url, webUrl: url };
      // 카카오 카드는 SVG 그림을 못 보여 줘서, 그럴 땐 글만 있는 카드로 보낸다
      if (imageUrl && !/\.svg(\?|$)/i.test(imageUrl)) {
        Kakao.Share.sendDefault({
          objectType: 'feed',
          content: { title, description: text, imageUrl, link },
          buttons: [{ title: button, link }],
        });
      } else {
        Kakao.Share.sendDefault({ objectType: 'text', text: `${title}\n${text}`, link, buttonTitle: button });
      }
      return 'kakao';
    } catch { /* 아래 방법으로 */ }
  }
  // 2) 휴대폰 공유하기 창
  if (navigator.share && isPhone()) {
    try {
      await navigator.share({ title, text: `${title}\n${text}`, url });
      return 'share';
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancel'; // 사용자가 그냥 닫음
    }
  }
  // 3) 링크 복사
  if (await copyText(`${title}\n${text}\n${url}`)) {
    toast('초대 글과 링크를 복사했어요! 카카오톡 대화창에 붙여 넣어 보내 주세요. (마우스 오른쪽 단추 → 붙여넣기)', 6000);
    return 'copy';
  }
  toast('복사가 안 됐어요. 아래 주소를 직접 알려 주세요.', 4000);
  return 'fail';
}
