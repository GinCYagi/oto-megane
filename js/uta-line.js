// 歌モードの線。横＝時間（右から左へ流れる）、縦＝音の高さ。「いま」の縦線は左から 1/3 に止める。
// 決まり：意味を色だけに乗せない（過ぎた所とこの先は、明るさの差と「いま」の線の位置で分ける）。点滅させない。

export const WINDOW_SEC = 8;   // 一度に見える長さ（仕様書 3 章。父の反応を見て直す候補）
export const NOW_AT = 1 / 3;   // 「いま」の位置（横幅の割合）
const PAD_SEMI = 2;            // 音域の上下に足す半音の数
const GLIDE_SEC = 0.06;        // つながった音と音のあいだを、斜めの短い線でつなぐ長さ

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
export function lineRuns(events) {
  const runs = [];
  let run = null;
  let prev = null;
  for (const e of events) {
    if (e.midi === null) { run = null; prev = null; continue; }
    const joined = run && prev && Math.abs(prev.t + prev.dur - e.t) < 1e-6;
    if (!joined) { run = []; runs.push(run); run.push({ t: e.t, midi: e.midi }); }
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
  constructor(canvas, events) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.runs = lineRuns(events);
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
    const lw = Math.max(4, Math.min(w, h) * 0.022); // 太さは一定（声を入れる T6 で、声の大きさにする）
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
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const run of this.runs) {
        if (X(run[run.length - 1].t) < -lw || X(run[0].t) > w + lw) continue;
        ctx.beginPath();
        run.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.midi)) : ctx.moveTo(X(p.t), Y(p.midi))));
        ctx.stroke();
      }
      ctx.restore();
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
