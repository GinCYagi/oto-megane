// 歌モードの歌詞。線の下に、いまの行を大きく、次の行を小さく暗めに出す。
// 行が替わるときは、次の行がいまの行の場所へ上がるだけにする（明るさを急に変えない）。
import { HOLD } from './score.js?v=42';

const NEXT_SCALE = 0.62; // 次の行の大きさ（css/uta.css の .lyric[data-pos="next"] の scale と同じ）
// 縦の幅が足りないとき（ツールバーありの横など）は、次の行を出さず、いまの行だけを大きく出す（Gin、11/7）。
// 2 行にすると、いまの行の字がこれより小さくなるときだけ 1 行にする（仮の値。実際の数字を見て Gin と決める）
export const ONE_ROW_BELOW_PX = 24;
const ONE_ROW_MAX_PX = 112; // 1 行のときの字の上限（7rem）
const LEAD_SEC = 0.6; // 次の行の頭のこれだけ前に、行を替える（前の行が終わっていれば）

/**
 * 歌の音を、歌詞の行ごとにまとめる。返り値：[{ verse, line, t0, t1, syl: [{ text, ruby, t, hold }] }]。
 * 「ー」（伸ばす印）の音は、前の字の続き（hold: true）として入れる。字としては出さない。
 */
export function lyricLines(events) {
  const lines = [];
  let cur = null;
  for (const e of events) {
    if (e.midi === null) continue;
    if (!cur || cur.verse !== e.verse || cur.line !== e.line) {
      cur = { verse: e.verse, line: e.line, t0: e.t, t1: e.t + e.dur, syl: [] };
      lines.push(cur);
    }
    cur.t1 = e.t + e.dur;
    cur.syl.push({ text: e.text, ruby: e.ruby, t: e.t, hold: e.text === HOLD });
  }
  return lines;
}

/**
 * 「字:」の区切り（漢字＋ルビ）のうち、行の k 番目の音がどれに当たるか。返り値：音ごとの区切りの番号（「ー」の音は前の音と同じ）。
 * 音の字（今のかな）を頭からつないだときの位置で、区切りの読みの範囲を探す。
 */
export function segOfSyllables(syl, segs) {
  const ends = [];
  let acc = 0;
  segs.forEach((s) => { acc += s.read.length; ends.push(acc); });
  const out = [];
  let pos = 0;
  let last = -1;
  for (const s of syl) {
    if (s.hold) { out.push(last); continue; }
    const i = ends.findIndex((e, k) => !segs[k].space && pos < e);
    out.push(i);
    last = i;
    pos += s.text.length;
  }
  return out;
}

/**
 * 間奏・後奏の見出し。全角の括弧で囲んで「（間奏）」「（後奏）」と出す（Gin、2026-11-07）。
 * 括弧の中は「声に出さない補足」という、ふだんの文の約束があるので、色や大きさに頼らず「ここは歌わない」と伝わる。
 * ルビは「間奏」「後奏」の 2 字だけに振る（括弧には振らない）。字の大きさは歌詞と同じ、色は薄め（css の .lyric.label）。
 */
export const BREAK_LABEL = { interlude: { text: '間奏', ruby: 'かんそう' }, outro: { text: '後奏', ruby: 'こうそう' } };

/**
 * 歌詞の行の並びに、間奏・後奏の見出しの行を差し込む（Gin、2026-11-07：「まだ歌うのか」「止まったのか」が分かるように）。
 * spans：instrumentalSpans(score)。見出しは、直前の主旋律の音が終わった所（前の行の t1）で、いまの行になる。
 * 間奏のあいだは、次の番の最初の行が「次の行」に出る（前奏と同じく、歌い出しの LEAD_SEC 前に上がる）。後奏のあいだ、次の行は空く。
 * 残りの拍を数える表示は付けない（カラオケに見えないように）。
 */
export function withBreaks(lines, spans) {
  const out = [...lines];
  for (const sp of spans) {
    const label = BREAK_LABEL[sp.kind];
    if (!label) continue;
    let k = -1;
    out.forEach((ln, i) => { if (!ln.label && ln.t1 <= sp.t0 + 1e-6) k = i; });
    if (k < 0) continue;
    const at = out[k].t1;
    out.splice(k + 1, 0, { label: sp.kind, text: label.text, ruby: label.ruby, t0: at, t1: at, syl: [] });
  }
  return out;
}

/** いま t 秒のとき、いまの行の番号。曲の頭（前奏）では 1 行目を出しておく */
export function lineAt(lines, t) {
  let i = 0;
  for (let k = 1; k < lines.length; k++) {
    const switchAt = Math.max(lines[k - 1].t1, lines[k].t0 - LEAD_SEC);
    if (t >= switchAt) i = k;
  }
  return i;
}

/** いまの行の中で、いま歌っている字の番号（伸ばしている間は、その字のまま）。まだ始まっていなければ -1 */
export function charAt(line, t) {
  let i = -1;
  line.syl.forEach((s, k) => { if (!s.hold && s.t <= t) i = k; });
  return t < line.t1 + 0.3 ? i : -1;
}

/** 画面の下の安全な余白（ホームの印など。env(safe-area-inset-bottom)）。曲の画面の下の padding から読む */
function safeBottom(box) {
  const v = box.parentElement && parseFloat(getComputedStyle(box.parentElement).paddingBottom);
  return Number.isFinite(v) ? v : 0;
}

export class UtaLyrics {
  /** score を渡すと、「字:」（漢字＋ルビ）で出す。なければ音ごとの字（詞）で出す */
  constructor(box, events, { markNow = false, score = null, spans = [], oneRowBelow = ONE_ROW_BELOW_PX } = {}) {
    this.box = box;
    this.oneRowBelow = oneRowBelow;
    this.lines = withBreaks(lyricLines(events), spans);
    this.markNow = markNow;
    this.cur = -1;
    this.charIdx = -2;
    box.replaceChildren(...this.lines.map((ln) => {
      const p = document.createElement('p');
      p.className = 'lyric';
      if (ln.label) {
        // 間奏・後奏の見出し「（間奏）」。字は歌詞と同じ大きさ、色は薄め（css の .lyric.label）
        p.classList.add('label');
        const r = document.createElement('ruby');
        r.className = 'label-text';
        r.append(ln.text);
        const rt = document.createElement('rt'); rt.textContent = ln.ruby; r.append(rt);
        p.append('（', r, '）');
        ln.spans = [];
        return p;
      }
      const segs = score?.verses[ln.verse]?.lines[ln.line]?.disp;
      if (segs) {
        const els = segs.map((s) => {
          const el = document.createElement(s.ruby ? 'ruby' : 'span');
          el.className = s.space ? 'gap' : 'syl';
          el.append(s.text);
          if (s.ruby) { const rt = document.createElement('rt'); rt.textContent = s.ruby; el.append(rt); }
          return el;
        });
        p.append(...els);
        ln.spans = segOfSyllables(ln.syl, segs).map((i) => els[i] ?? null);
        return p;
      }
      ln.spans = [];
      ln.syl.forEach((s) => {
        if (s.hold) { ln.spans.push(null); return; }
        const el = document.createElement(s.ruby ? 'ruby' : 'span');
        el.className = 'syl';
        el.append(s.text);
        if (s.ruby) { const rt = document.createElement('rt'); rt.textContent = s.ruby; el.append(rt); }
        p.append(el);
        ln.spans.push(el);
      });
      return p;
    }));
  }

  /**
   * 歌詞の欄に、いまの行と次の行（0.62 倍）が、ルビごといつでも収まるようにする（Gin、11/7：全画面の横で下の行が切れた）。
   * 行の高さ（行の箱の上にはみ出すルビも含む）を実際に測り、入らなければ字を小さくする。次の行は、いまの行の字の下に gap だけ空けて、ルビから置く。
   * 欄の大きさが替わったとき・書体が届いたときに呼ぶ。
   */
  fit() {
    const box = this.box;
    // 欄の高さは、欄の上の端から画面の下の端までに実際に残っている高さまでにする（欄が画面の外へはみ出していても、見える所だけで測る。OnePlus 6、11/7）
    const left = Math.floor((window.innerHeight || Infinity) - box.getBoundingClientRect().top - safeBottom(box));
    const H = Math.max(0, Math.min(box.clientHeight, left));
    const ps = [...box.children];
    if (!H || !ps.length) return;
    box.style.removeProperty('--lyric-fs');
    // 行ごとに、行の箱の上にはみ出す分（ルビ）A と、箱の上から字の下までの B、字の幅 Wd を測る（縮めて置いた行も、元の大きさに直して）
    const measure = () => {
      let A = 0, B = 0, Wd = 0;
      for (const p of ps) {
        const pr = p.getBoundingClientRect();
        const k = pr.height / (p.offsetHeight || 1) || 1;
        let top = pr.top, bottom = pr.bottom, left = Infinity, right = -Infinity;
        for (const e of p.querySelectorAll('rt, .syl, ruby')) {
          for (const r of e.getClientRects()) {
            top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom);
            left = Math.min(left, r.left); right = Math.max(right, r.right);
          }
        }
        A = Math.max(A, (pr.top - top) / k);
        B = Math.max(B, (bottom - pr.top) / k);
        if (right > left) Wd = Math.max(Wd, (right - left) / k);
      }
      return { A, B, Wd };
    };
    let { A, B, Wd } = measure();
    const css = parseFloat(getComputedStyle(ps[0]).fontSize); // CSS の決めた大きさ（2 行のための大きさ）
    const top = H * 0.02, gap = Math.max(6, H * 0.06);
    // 2 行にしたときの字の大きさ
    const need = top + (A + B) * (1 + NEXT_SCALE) + gap;
    const fs2 = need > H ? Math.floor(css * (H - top - gap) / ((A + B) * (1 + NEXT_SCALE))) : css;
    // 1 行にしたときの字の大きさ（上下に top を残して高さいっぱい。横は欄の幅の 96% まで。大きくしすぎない上限つき）
    const fs1 = Math.floor(Math.min(css * (H - 2 * top) / (A + B), Wd ? css * box.clientWidth * 0.96 / Wd : Infinity, ONE_ROW_MAX_PX));
    // 2 行だと、いまの行の字が ONE_ROW_BELOW_PX より小さくなるときだけ 1 行にする（ツールバーの有無ではなく、欄の高さで決める。Gin、11/7）
    const rows = fs2 < this.oneRowBelow && fs1 > fs2 ? 1 : 2;
    const fs = rows === 1 ? fs1 : fs2;
    box.dataset.rows = rows;
    if (fs !== css) {
      box.style.setProperty('--lyric-fs', `${fs}px`);
      ({ A, B } = measure());
    }
    const nowY = top + A;
    box.style.setProperty('--now-y', `${nowY}px`);
    box.style.setProperty('--next-y', `${nowY + B + gap + A * NEXT_SCALE}px`);
    this.fitInfo = { H, fs2, fs1, rows, fs };
    box.dataset.fit = `${fs2}/${fs1}`; // 確かめ用（2 行のとき／1 行のときの字の px）
  }

  /** 曲が終わって「おしまい」の札が出たら、残っている「（後奏）」を消す（Gin、11/7） */
  finish() {
    this.cur = this.lines.length;
    [...this.box.children].forEach((p) => { p.dataset.pos = 'past'; });
  }

  update(t) {
    const i = lineAt(this.lines, t);
    if (i !== this.cur) {
      this.cur = i;
      [...this.box.children].forEach((p, k) => {
        p.dataset.pos = k === i ? 'now' : k === i + 1 ? 'next' : k < i ? 'past' : 'later';
      });
    }
    if (!this.markNow) return;
    const ln = this.lines[i];
    const c = charAt(ln, t);
    if (c === this.charIdx) return;
    this.lines.forEach((l) => l.spans.forEach((s) => s?.classList.remove('now-char')));
    this.charIdx = c;
    if (c >= 0) ln.spans[c]?.classList.add('now-char');
  }
}
