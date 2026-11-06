// 地図の帯（T4）：画面の上の細い帯に、曲全体の歌の大きさを山の形で描き、いまの位置に印を付ける。
// 締切までは小さな帯一本（Gin、2026-11-06）。山の高さは、線の太さと同じく楽譜の強弱から付ける（歌声はアプリに入れないため）。
// 盛り上がりは山の高さで、終わりの近さは帯の右端までの距離で分かる（spec 3 章「地図」）。

/**
 * 曲全体を bins 個に区切り、それぞれの所の歌の大きさ（0〜1）を返す。
 * events：timeline(score) を withDynamics に通したもの。休み（休符・前奏・後奏）は 0。
 */
export function mapProfile(events, end, bins = 240) {
  const out = new Float32Array(bins);
  if (!(end > 0)) return out;
  for (const e of events) {
    if (e.midi === null) continue;
    const v = (e.vel ?? 85) / 127;
    const a = Math.floor((e.t / end) * bins);
    const b = Math.ceil(((e.t + e.dur) / end) * bins);
    for (let i = Math.max(0, a); i < Math.min(bins, b); i++) out[i] = Math.max(out[i], v);
  }
  return out;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export class UtaMap {
  constructor(canvas, events, end) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.end = end;
    this.profile = mapProfile(events, end);
    // 強弱の差が見て分かるよう、曲の中のいちばん弱い所〜強い所を、帯の高さの 35%〜100% に広げる
    const sung = [...this.profile].filter((v) => v > 0);
    this.lo = sung.length ? Math.min(...sung) : 0;
    this.hi = sung.length ? Math.max(...sung) : 1;
    this.colors = { past: cssVar('--line'), future: cssVar('--future'), now: cssVar('--nowline'), base: cssVar('--grid') };
  }

  fit() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** t：曲の秒。過ぎた所は明るく、この先は暗めに。いまの所に縦の印 */
  draw(t) {
    const { ctx, w, h, profile } = this;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    const n = profile.length;
    const bw = w / n;
    const nowX = Math.max(0, Math.min(1, t / this.end)) * w;
    // 帯の底の細い線（休みの所も、帯がどこまであるか分かるように）
    ctx.fillStyle = this.colors.base;
    ctx.fillRect(0, h - 2, w, 2);
    for (let i = 0; i < n; i++) {
      if (!profile[i]) continue;
      const x = i * bw;
      const k = this.hi > this.lo ? (profile[i] - this.lo) / (this.hi - this.lo) : 1;
      const bh = Math.max(2, (0.35 + 0.65 * k) * (h - 4));
      ctx.fillStyle = x + bw / 2 <= nowX ? this.colors.past : this.colors.future;
      ctx.fillRect(x, h - bh, Math.ceil(bw), bh);
    }
    // いまの位置の印：縦の線（帯の上から下まで）。山と溶け合わないよう、両側に地の色のすき間を空ける
    const x = Math.round(nowX);
    ctx.clearRect(x - 4, 0, 8, h);
    ctx.fillStyle = this.colors.now;
    ctx.fillRect(x - 1.5, 0, 3, h);
  }
}
