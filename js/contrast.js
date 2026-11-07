// 白黒（くっきり）のモード（T18、Gin 2026-11-07）。Windows のマウスカーソルの設定のように、正面ではなく奥の設定から、あえて選べる形。
// 決まり：自分で選んだもの（localStorage）があれば、それを優先。なければ端末の設定（コントラストを上げる・強制カラー）に合わせる。
// 最初の色は index.html の頭の小さなスクリプトで決める（紺から黒へ、明るさが急に替わって見えないように）。ここは同じ決まりで切り替えを受け持つ。

export const STORE_KEY = 'oto-megane-contrast';
const AUTO_QUERIES = ['(prefers-contrast: more)', '(forced-colors: active)'];

/** stored：'on'・'off'・null（選んでいない）。auto：端末の設定が「くっきり」を求めているか。返り値：白黒にするか */
export function decideContrast(stored, auto) {
  if (stored === 'on') return true;
  if (stored === 'off') return false;
  return !!auto;
}

function readStored() {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}
function writeStored(v) {
  try { localStorage.setItem(STORE_KEY, v); } catch { /* 覚えられなくても、いまの画面では効く */ }
}
function autoWanted() {
  return AUTO_QUERIES.some((q) => { try { return window.matchMedia(q).matches; } catch { return false; } });
}

/** いまの決まりで、画面の色を替える。返り値：白黒か */
export function applyContrast() {
  const on = decideContrast(readStored(), autoWanted());
  const root = document.documentElement;
  if (on) root.dataset.contrast = 'bw'; else delete root.dataset.contrast;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', on ? '#000000' : '#151b2d');
  return on;
}

/** 切り替え（チェック）をつなぐ。押したら覚える。端末の設定が替わったら、選んでいないときだけ合わせる */
export function initContrastToggle(input) {
  input.checked = applyContrast();
  input.addEventListener('change', () => {
    writeStored(input.checked ? 'on' : 'off');
    applyContrast();
  });
  for (const q of AUTO_QUERIES) {
    try { window.matchMedia(q).addEventListener('change', () => { input.checked = applyContrast(); }); } catch { /* 古いブラウザ */ }
  }
}
