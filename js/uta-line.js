// 歌モードの線。横＝時間（右から左へ流れる）、縦＝音の高さ。「いま」の縦線は左から 1/3 に止める。
// 決まり：意味を色だけに乗せない（過ぎた所とこの先は、明るさの差と「いま」の線の位置で分ける）。点滅させない。

export const WINDOW_SEC = 8;   // 一度に見える長さ（仕様書 3 章。父の反応を見て直す候補）
export const NOW_AT = 1 / 3;   // 「いま」の位置（横幅の割合）
const PAD_SEMI = 2;            // 音域の上下に足す半音の数
const GLIDE_SEC = 0.06;        // つながった音と音のあいだを、斜めの短い線でつなぐ長さ
const BASE_VEL = 85;           // mf。この強さのとき、太さは基準のまま

/**
 * 歌の音に、楽譜の強弱（伴奏の右手に書いた mp・mf など）を付ける。声を入れる T6 までは、これで線の太さを決める。
 * acc は accompaniment(score) の返り値。歌の音の頭の時刻に、右手で鳴っている強さを使う。右手がなければ mf。
 */
export function withDynamics(events, acc, part = '右手') {
  const hand = acc.filter((a) => a.part === part);
  let k = -1;
  return events.map((e) => {
    while (k + 1 < hand.length && hand[k + 1].t <= e.t + 1e-6) k++;
    return { ...e, vel: k >= 0 ? hand[k].vel : BASE_VEL };
  });
}

/** 強さを、線の太さの倍率に。差が目で分かるよう 1.5 乗にする（p 約 0.5・mp 約 0.75・mf 1・f 約 1.3） */
export function widthScale(vel = BASE_VEL) {
  return Math.min(1.5, Math.max(0.45, (vel / BASE_VEL) ** 1.5));
}

/** 曲の音域に上下 2 半音ずつ足した幅（休符は数えない） */
export function songRange(events) {
  const m = events.filter((e) => e.midi !== null).map((e) => e.midi);
  if (!m.length) return { lo: 60 - PAD_SEMI, hi: 60 + PAD_SEMI };
  return { lo: Math.min(...m) - PAD_SEMI, hi: Math.max(...m) + PAD_SEMI };
}

/**
 * 線を、つながった音のかたまりごとの折れ線にする。休符・時間のすき間で切る。
 * 返り値：[[{ t, midi }, …], …]。音の頭と終わりに点を置き、次の音へは GLIDE_SEC で斜めにつなぐ。
 */
export function lineRuns(events, { gap = false } = {}) {
  if (gap) return gapRuns(events);
  const runs = [];
  let run = null;
  let prev = null;
  for (const e of events) {
    if (e.midi === null) { run = null; prev = null; continue; }
    const joined = run && prev && Math.abs(prev.t + prev.dur - e.t) < 1e-6;
    if (!joined) { run = []; if (e.vel !== undefined) run.vel = e.vel; runs.push(run); run.push({ t: e.t, midi: e.midi }); }
    else {
      const g = Math.min(GLIDE_SEC, prev.dur / 3, e.dur / 3);
      run[run.length - 1] = { t: e.t - g, midi: prev.midi }; // 前の音の終わりを少し手前にして、斜めにつなぐ
      run.push({ t: e.t, midi: e.midi });
    }
    run.push({ t: e.t + e.dur, midi: e.midi });
    prev = e;
  }
  return runs;
}

/**
 * 音ごとに切った線（案：すき間）。どの音も、終わりを少し手前で止めて、次の音とのあいだにすき間を空ける。
 * 同じ高さが続いても、音の数だけ短い線が並ぶ。
 */
export const GAP_SEC = 0.09;
export function gapRuns(events) {
  // 「ー」（同じ字を伸ばして次の高さへ移る所）は、すき間を空けずに斜めにつなぐ。字と字のあいだだけを切る
  const runs = [];
  let prev = null;
  for (const e of events) {
    if (e.midi === null) { prev = null; continue; }
    const g = Math.min(GAP_SEC, e.dur * 0.25);
    const slur = prev && e.text === 'ー' && Math.abs(prev.t + prev.dur - e.t) < 1e-6;
    if (slur) {
      const run = runs[runs.length - 1];
      const glide = Math.min(GLIDE_SEC, prev.dur / 3, e.dur / 3);
      run[run.length - 1] = { t: e.t - glide, midi: prev.midi };
      run.push({ t: e.t, midi: e.midi }, { t: e.t + e.dur - g, midi: e.midi });
    } else {
      const run = [{ t: e.t, midi: e.midi }, { t: e.t + e.dur - g, midi: e.midi }];
      if (e.vel !== undefined) run.vel = e.vel;
      runs.push(run);
    }
    prev = e;
  }
  return runs;
}

/** いま t 秒のとき、時刻 u が横のどこ（0〜1）に来るか */
export function xOf(u, t, win = WINDOW_SEC) {
  return NOW_AT + (u - t) / win;
}

/** 高さを縦の位置（0＝上、1＝下）に */
export function yOf(midi, range) {
  return 1 - (midi - range.lo) / (range.hi - range.lo);
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export class UtaLine {
  /** cut：音の切れ目の見せ方の案。'none'（いまの形）・'gap'（すき間）・'char'（字を音の頭に）・'both'（両方） */
  constructor(canvas, events, { cut = 'none' } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cut = cut;
    this.runs = lineRuns(events, { gap: cut === 'gap' || cut === 'both' });
    this.heads = events.filter((e) => e.midi !== null && e.text && e.text !== 'ー');
    this.range = songRange(events);
    this.colors = { past: cssVar('--line'), future: cssVar('--future'), now: cssVar('--nowline'), bg: cssVar('--bg') };
  }

  /** 画面の大きさに合わせて、キャンバスの画素を整える（高精細の画面でもにじまないように） */
  fit() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(t) {
    this.lastT = t;
    const { ctx, w, h } = this;
    ctx.fillStyle = this.colors.bg;
    ctx.fillRect(0, 0, w, h);
    const pad = h * 0.08;
    const lw = Math.max(5, Math.min(w, h) * 0.024); // 基準の太さ（mf）。音ごとに楽譜の強弱で変える（声を入れる T6 で、声の大きさにする）
    const nowX = Math.round(w * NOW_AT);
    const X = (u) => xOf(u, t) * w;
    const Y = (m) => pad + yOf(m, this.range) * (h - 2 * pad);

    // この先は暗め、過ぎた所は明るく。同じ線を、「いま」の左右で切り分けて 2 回描く
    for (const [x0, x1, color] of [[nowX, w, this.colors.future], [0, nowX, this.colors.past]]) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, x1 - x0, h);
      ctx.clip();
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const run of this.runs) {
        if (X(run[run.length - 1].t) < -lw || X(run[0].t) > w + lw) continue;
        ctx.lineWidth = Math.max(3, lw * widthScale(run.vel));
        ctx.beginPath();
        run.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.midi)) : ctx.moveTo(X(p.t), Y(p.midi))));
        ctx.stroke();
      }
      ctx.restore();
    }

    // 案：字を音の頭に。線のすぐ上に、その音で歌う字を置く（線と一緒に流れる。過ぎた所は明るく、この先は暗め）
    if (this.cut === 'char' || this.cut === 'both') {
      const fs = Math.max(14, h * 0.075);
      ctx.font = `${fs}px "Hiragino Sans", "Yu Gothic", "Noto Sans JP", sans-serif`;
      ctx.textBaseline = 'bottom';
      for (const e of this.heads) {
        const x = X(e.t);
        if (x < -fs || x > w) continue;
        ctx.fillStyle = x <= nowX ? this.colors.past : this.colors.future;
        ctx.fillText(e.text, x, Y(e.midi) - lw);
      }
    }

    // 「いま」の縦線（動かない）。太さは音の線に合わせ、上下の端に三角の印を付けて、形でも分かるようにする
    const nw = Math.max(2, lw / 2);
    const tri = lw * 1.4;
    ctx.strokeStyle = ctx.fillStyle = this.colors.now;
    ctx.lineWidth = nw;
    ctx.beginPath();
    ctx.moveTo(nowX, tri);
    ctx.lineTo(nowX, h - tri);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(nowX - tri, 0); ctx.lineTo(nowX + tri, 0); ctx.lineTo(nowX, tri * 1.2);
    ctx.moveTo(nowX - tri, h); ctx.lineTo(nowX + tri, h); ctx.lineTo(nowX, h - tri * 1.2);
    ctx.fill();
  }
}
