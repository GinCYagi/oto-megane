// 歌モードの歌詞。線の下に、いまの行を大きく、次の行を小さく暗めに出す。
// 行が替わるときは、次の行がいまの行の場所へ上がるだけにする（明るさを急に変えない）。
import { HOLD } from './score.js?v=25';

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

export class UtaLyrics {
  /** score を渡すと、「字:」（漢字＋ルビ）で出す。なければ音ごとの字（詞）で出す */
  constructor(box, events, { markNow = false, score = null } = {}) {
    this.box = box;
    this.lines = lyricLines(events);
    this.markNow = markNow;
    this.cur = -1;
    this.charIdx = -2;
    box.replaceChildren(...this.lines.map((ln) => {
      const p = document.createElement('p');
      p.className = 'lyric';
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
