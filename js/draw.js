// 音の形を描く。横＝時間（右から左へ流れる）、縦＝高さ、線の太さ＝大きさ。
// 決まり：意味を色だけに乗せない（位置と太さで伝える）。点滅させない。画面全体を光らせない。

const LOW_HZ = 65.41;   // C2
const OCTAVES = 4;      // C2〜C6
const SPEED = 90;       // 1 秒に流れる幅（CSS の px）
const NOW_AT = 0.85;    // 「いま」の位置（横幅の割合）
const BAND = 0.14;      // 下の帯（高さの定まらない音）の高さの割合
const DB_MIN = -60;     // これより小さい音は描かない
const THICK_LO = -45;   // 太さの幅：この大きさで最も細く
const THICK_HI = -6;    // この大きさで最も太く
const JOIN_SEC = 0.15;  // これより間があけば線を切る
const JOIN_SEMI = 2.5;  // これより跳べば線を切る（半音）

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** 大きさ（dBFS）を 0〜1 に。よく出る幅（-45〜-6 dB）に絞り、太さの差を見分けやすくする。 */
function loud01(db) {
  return Math.min(1, Math.max(0, (db - THICK_LO) / (THICK_HI - THICK_LO)));
}

export class Scope {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.frames = []; // { t, hz, db }
    this.colors = {
      line: cssVar('--line'),
      band: cssVar('--band'),
      rhythm: cssVar('--rhythm'),
      grid: cssVar('--grid'),
      now: cssVar('--now'),
    };
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** 高さの線を描くコマ（試しの音・マイク・歌声だけの音がある曲）。 */
  push(t, hz, db) {
    this.frames.push({ t, hz, db });
  }

  /** 大きさと拍だけを描くコマ（歌声だけの音がない曲）。beat：拍の立ち上がりなら true。 */
  pushRhythm(t, db, beat) {
    this.frames.push({ t, hz: null, db, rhythm: true, beat });
  }

  /** 高さ（Hz）→ 縦の位置。範囲の外は端に寄せる。 */
  yOf(hz) {
    const plotH = this.h * (1 - BAND);
    const pos = Math.min(1, Math.max(0, Math.log2(hz / LOW_HZ) / OCTAVES));
    const pad = 12;
    return pad + (1 - pos) * (plotH - pad * 2);
  }

  xOf(t, now) {
    return this.w * NOW_AT - (now - t) * SPEED;
  }

  draw(now) {
    const { ctx, w, h, colors } = this;
    ctx.clearRect(0, 0, w, h);

    // オクターブごとの薄い横線（C2〜C6）
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    for (let o = 0; o <= OCTAVES; o++) {
      const y = Math.round(this.yOf(LOW_HZ * 2 ** o)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // 下の帯との境（点線にして、オクターブの線と見分ける）
    const bandTop = h * (1 - BAND);
    ctx.strokeStyle = colors.now;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(0, Math.round(bandTop) + 0.5);
    ctx.lineTo(w, Math.round(bandTop) + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    // 「いま」の縦線
    ctx.strokeStyle = colors.now;
    ctx.beginPath();
    ctx.moveTo(Math.round(w * NOW_AT) + 0.5, 0);
    ctx.lineTo(Math.round(w * NOW_AT) + 0.5, h);
    ctx.stroke();

    // 画面から出た古いものを捨てる
    const oldest = now - (w * NOW_AT + 40) / SPEED;
    while (this.frames.length && this.frames[0].t < oldest) this.frames.shift();

    const fr = this.frames;
    ctx.lineCap = 'round';

    for (let i = 1; i < fr.length; i++) {
      const a = fr[i - 1], b = fr[i];
      const dt = b.t - a.t;

      // 高さのある音：線。太さ＝大きさ
      if (a.hz && b.hz && a.db > DB_MIN && b.db > DB_MIN && dt < JOIN_SEC &&
          Math.abs(12 * Math.log2(b.hz / a.hz)) < JOIN_SEMI) {
        ctx.strokeStyle = colors.line;
        ctx.lineWidth = 2 + 24 * loud01((a.db + b.db) / 2);
        ctx.beginPath();
        ctx.moveTo(this.xOf(a.t, now), this.yOf(a.hz));
        ctx.lineTo(this.xOf(b.t, now), this.yOf(b.hz));
        ctx.stroke();
      }

      // 歌声だけの音がない曲：真ん中から上下に広がる形＝大きさ、縦の線＝拍
      if (b.rhythm) {
        const plotH = h * (1 - BAND);
        const mid = plotH / 2;
        const x0 = Math.floor(this.xOf(a.t, now)), x1 = Math.ceil(this.xOf(b.t, now));
        if (b.db > DB_MIN && dt < JOIN_SEC) {
          // 面が広くなるので、暗めの色にし、高さも抑える（画面を光らせない）
          const half = plotH * 0.3 * loud01(b.db);
          ctx.fillStyle = colors.rhythm;
          ctx.fillRect(x0, mid - half, Math.max(1, x1 - x0), half * 2);
        }
        continue;
      }

      // 高さの定まらない音：下の帯に、大きさだけを柱で
      if (!b.hz && b.db > DB_MIN && dt < JOIN_SEC) {
        const bh = (h - bandTop - 6) * loud01(b.db);
        ctx.fillStyle = colors.band;
        // x を整数にそろえ、柱の間に筋が出ないようにする
        const x0 = Math.floor(this.xOf(a.t, now)), x1 = Math.ceil(this.xOf(b.t, now));
        ctx.fillRect(x0, h - 3 - bh, Math.max(1, x1 - x0), bh);
      }
    }

    // 拍の線は、面をすべて塗り終えてから描く（次の柱に上から塗られて細く切れないように）
    const plotH = h * (1 - BAND);
    ctx.fillStyle = colors.line;
    for (const f of fr) {
      if (f.beat) ctx.fillRect(Math.round(this.xOf(f.t, now)) - 2, plotH / 2 - plotH * 0.44, 3, plotH * 0.88);
    }
  }
}
