import { hueColors } from './uta-line.js?v=22';

// 地図の帯（T4）：画面の上の細い帯に、曲全体を山脈の形で描き、いまの位置に印を付ける。
// 帯の山は「大きさ」だけを表す。音の高さは起伏に入れない（Gin、2026-11-07）。
// - 手前：旋律の一本の稜線。音ごとに、出だしで高く、伸ばすと少し下がる。休みでは谷に下りる。
//   楽譜の強弱（mp・mf など）は、全体の高さの係数にする。
// - 奥：伴奏。そのとき同時に鳴っている音の数と強さで高さを決める。手前より暗く淡く描く。
// 計算は楽譜から（開いた瞬間に済む）。盛り上がりは山の高さで、終わりの近さは帯の右端までの距離で分かる。

const ATTACK_SEC = 0.06;  // 出だしの立ち上がり
const SETTLE_SEC = 0.5;   // 伸ばすと下がっていく速さ
const HOLD_LEVEL = 0.3;   // 伸ばしきった所の高さ（出だしを 1 として）
const FALL_SEC = 0.12;    // 音が終わって谷へ下りる長さ
const ACC_SETTLE_SEC = 0.8;

/** 一つの音の、出だしからの経過 s 秒での高さ（0〜1）。dur：音の長さ */
export function noteShape(s, dur) {
  if (s < 0) return 0;
  if (s < ATTACK_SEC) return s / ATTACK_SEC;
  if (s <= dur) return HOLD_LEVEL + (1 - HOLD_LEVEL) * Math.exp(-(s - ATTACK_SEC) / SETTLE_SEC);
  const atEnd = noteShape(dur, dur);
  return s < dur + FALL_SEC ? atEnd * (1 - (s - dur) / FALL_SEC) : 0;
}

/** 時刻 u を、少しずつずらした数か所で測って平均する（細かい音も、帯の 1 区切りの中で消えないように） */
function sampled(bins, end, f) {
  const out = new Float32Array(bins);
  if (!(end > 0)) return out;
  const SUB = 4;
  for (let i = 0; i < bins; i++) {
    let s = 0;
    for (let j = 0; j < SUB; j++) s += f(((i + (j + 0.5) / SUB) / bins) * end);
    out[i] = s / SUB;
  }
  return out;
}

/**
 * 手前の稜線：曲全体を bins 個に区切り、それぞれの所の旋律の大きさ（0〜1）を返す。
 * events：timeline(score) を withDynamics に通したもの。休み（休符・前奏・後奏）は 0。
 * 強弱は、曲の中のいちばん弱い所〜強い所を 0.35〜1 の係数に広げてかける。
 */
export function mapProfile(events, end, bins = 240) {
  const notes = events.filter((e) => e.midi !== null);
  const vels = notes.map((e) => e.vel ?? 85);
  const lo = Math.min(...vels), hi = Math.max(...vels);
  const gain = (v) => (hi > lo ? 0.35 + 0.65 * (v - lo) / (hi - lo) : 1);
  return sampled(bins, end, (u) => {
    let v = 0;
    for (const e of notes) {
      if (e.t > u) break;
      if (u > e.t + e.dur + FALL_SEC) continue;
      v = Math.max(v, noteShape(u - e.t, e.dur) * gain(e.vel ?? 85));
    }
    return v;
  });
}

/**
 * 奥の山：伴奏の、同時に鳴っている音の数×強さ（鍵盤を押した所で強く、伸ばすと弱まる）。いちばん厚い所を 1 にする。
 * acc：accompaniment(score) の返り値（{ t, dur, midis, vel }）。
 */
export function accProfile(acc, end, bins = 240) {
  const sorted = [...acc].sort((a, b) => a.t - b.t);
  const out = sampled(bins, end, (u) => {
    let v = 0;
    for (const e of sorted) {
      if (e.t > u) break;
      if (u >= e.t + e.dur) continue;
      v += e.midis.length * ((e.vel ?? 85) / 127) * (0.45 + 0.55 * Math.exp(-(u - e.t) / ACC_SETTLE_SEC));
    }
    return v;
  });
  const max = Math.max(0, ...out);
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] /= max;
  return out;
}

/** となりの数画素と混ぜて、山の角を丸める（谷の 0 は 0 のまま残す） */
function soften(p) {
  const k = [0.1, 0.2, 0.4, 0.2, 0.1];
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i++) {
    if (!p[i]) continue;
    let s = 0;
    for (let j = -2; j <= 2; j++) s += k[j + 2] * (p[Math.min(p.length - 1, Math.max(0, i + j))]);
    out[i] = s;
  }
  return out;
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * 手前の稜線を、歌詞の行ごとの色で塗り分けるための区切り。返り値：[{ t0, t1, hue }]（曲の秒）。
 * 行の頭から次の行の頭までを一つにする（あいだの休みは谷なので、どちらの色でも見えない）。
 */
export function hueSpans(events, end) {
  const spans = [];
  for (const e of events) {
    if (e.midi === null || e.hue === undefined) continue;
    const last = spans[spans.length - 1];
    if (last && last.hue === e.hue) continue;
    if (last) last.t1 = e.t;
    spans.push({ t0: e.t, t1: end, hue: e.hue });
  }
  if (spans.length) spans[0].t0 = 0;
  return spans;
}

export class UtaMap {
  /** events：歌の音（withDynamics を通したもの）。acc：伴奏の音。end：曲の終わりの秒 */
  constructor(canvas, events, end, acc = []) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.end = end;
    this.events = events;
    this.acc = acc;
    this.spans = hueSpans(events, end);
    this.hues = hueColors();
    this.colors = {
      past: cssVar('--line'), future: cssVar('--future'), now: cssVar('--nowline'), base: cssVar('--grid'),
      backPast: cssVar('--map-back-past'), backFuture: cssVar('--map-back-future'),
    };
  }

  /** 帯の大きさに合わせて、画素を整え、山の形を 1 画素ごとに計算し直す */
  fit() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bins = Math.max(60, Math.round(r.width));
    if (bins !== this.bins) {
      this.bins = bins;
      this.front = mapProfile(this.events, this.end, bins);
      this.back = accProfile(this.acc, this.end, bins);
    }
    // 奥（伴奏）は帯の高さいっぱいまで、手前（旋律）は 9 割まで（奥の峰が手前の稜線の上にのぞくように）。
    // 奥は角が立ちすぎないよう 1〜2 画素ぶんならす。手前は音ごとの峰が消えないよう、ならさない
    this.backPath = this.pathOf(soften(this.back), 1);
    this.frontPath = this.pathOf(this.front, 0.9);
  }

  /** 左（過ぎた所）と右（この先）で色を変えて塗る */
  paint(path, nowX, past, future) {
    const { ctx, w, h } = this;
    for (const [x0, x1, color] of [[0, nowX, past], [nowX, w, future]]) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, x1 - x0, h);
      ctx.clip();
      ctx.fillStyle = color;
      ctx.fill(path);
      ctx.restore();
    }
  }

  /** t：曲の秒。過ぎた所は明るく、この先は暗めに。いまの所に縦の印 */
  draw(t) {
    const { ctx, w, h } = this;
    if (!w || !h || !this.front) return;
    ctx.clearRect(0, 0, w, h);
    const nowX = Math.max(0, Math.min(1, t / this.end)) * w;
    // 帯の底の細い線（休みの所も、帯がどこまであるか分かるように）
    ctx.fillStyle = this.colors.base;
    ctx.fillRect(0, h - 2, w, 2);
    // 奥：伴奏（手前より暗く淡く）
    this.paint(this.backPath, nowX, this.colors.backPast, this.colors.backFuture);
    // 手前：旋律の稜線。歌詞の行ごとの色（真ん中の線と同じ色）。明るさの差（過ぎた所・この先）はそのまま
    if (!this.spans.length) this.paint(this.frontPath, nowX, this.colors.past, this.colors.future);
    for (const sp of this.spans) {
      const c = this.hues[sp.hue] || {};
      ctx.save();
      ctx.beginPath();
      ctx.rect((sp.t0 / this.end) * w, 0, ((sp.t1 - sp.t0) / this.end) * w, h);
      ctx.clip();
      this.paint(this.frontPath, nowX, c.past || this.colors.past, c.future || this.colors.future);
      ctx.restore();
    }
    // いまの位置の印：縦の線（帯の上から下まで）。山と溶け合わないよう、両側に地の色のすき間を空ける
    const x = Math.round(nowX);
    ctx.clearRect(x - 4, 0, 8, h);
    ctx.fillStyle = this.colors.now;
    ctx.fillRect(x - 1.5, 0, 3, h);
  }

  pathOf(profile, scale) {
    const { w, h } = this;
    const n = profile.length;
    const base = h - 2;
    const p = new Path2D();
    p.moveTo(0, base);
    for (let i = 0; i < n; i++) p.lineTo(((i + 0.5) / n) * w, base - profile[i] * scale * (base - 1));
    p.lineTo(w, base);
    p.closePath();
    return p;
  }
}
