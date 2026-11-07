import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lyricLines, lineAt, charAt } from '../js/uta-lyrics.js';
import { gapRuns } from '../js/uta-line.js';
import { parseScore, timeline } from '../js/score.js';

const furusato = timeline(parseScore(readFileSync(new URL('../songs/furusato.txt', import.meta.url), 'utf8')));

test('歌詞は行ごとにまとまり、「ー」は前の字の続きになる', () => {
  const lines = lyricLines(furusato);
  assert.equal(lines.length, 12); // 3 番 × 4 行
  assert.equal(lines[0].syl.filter((s) => !s.hold).map((s) => s.text).join(''), 'うさぎおいしかのやま');
  assert.equal(lines[2].syl.filter((s) => !s.hold).map((s) => s.text).join(''), 'ゆめはいまもめぐりて');
});

test('前奏のあいだは 1 行目を出し、次の行の頭の少し前に替わる', () => {
  const lines = lyricLines(furusato);
  assert.equal(lineAt(lines, 0), 0);
  assert.equal(lineAt(lines, lines[1].t0 - 1), 0);
  assert.equal(lineAt(lines, lines[1].t0 - 0.3), 1);
});

test('いまの字は、伸ばしている間（「ー」の音）も同じ字のまま', () => {
  const ln = lyricLines(furusato)[2]; // ユ|ー|メ…
  assert.equal(charAt(ln, ln.t0 - 0.1), -1);
  assert.equal(charAt(ln, ln.syl[1].t + 0.01), 0); // 「ー」の間は「ユ」
  assert.equal(charAt(ln, ln.syl[2].t + 0.01), 2); // 「メ」
});

test('すき間の案では、同じ高さが 3 つ続いても（ウ・サ・ギ）短い線が 3 本になる', () => {
  const runs = gapRuns(furusato).slice(0, 3);
  assert.equal(runs.length, 3);
  assert.ok(runs.every((r) => r[0].midi === runs[0][0].midi));
  assert.ok(runs[1][0].t - runs[0][1].t > 0.05);
});

test('すき間の案でも、「ー」で伸ばす所（ユ・ー）は切らずにつなぐ', () => {
  const runs = gapRuns(furusato);
  const yu = runs.find((r) => r.length > 2);
  assert.ok(yu, '「ー」でつながった線がある');
  assert.ok(Math.abs(yu[0].t - lyricLines(furusato)[2].t0) < 1e-9); // 3 行目の「ユ」から始まる
});

test('「字:」の区切りに、音が当たる：兎（うさぎ）には 3 つの音、追（お）には 1 つ', async () => {
  const { segOfSyllables } = await import('../js/uta-lyrics.js');
  const s = parseScore(readFileSync(new URL('../songs/furusato.txt', import.meta.url), 'utf8'));
  const ln = lyricLines(timeline(s))[0];
  const segs = s.verses[0].lines[0].disp;
  const map = segOfSyllables(ln.syl, segs);
  assert.deepEqual(map.slice(0, 4).map((i) => segs[i].text), ['兎', '兎', '兎', '追']);
  const ln3 = lyricLines(timeline(s))[2]; // 夢(ゆめ)は… ユ|ー|メ
  const m3 = segOfSyllables(ln3.syl, s.verses[0].lines[2].disp);
  assert.deepEqual(m3.slice(0, 3).map((i) => s.verses[0].lines[2].disp[i].text), ['夢', '夢', '夢']);
});

test('「字:」の漢字にルビがない・読みが詞と合わないときは、行の番号を付けて知らせる', async () => {
  const { parseDisplay } = await import('../js/score.js');
  assert.match(parseDisplay('兎(うさぎ)追いし').error, /追/);
  const base = readFileSync(new URL('../songs/furusato.txt', import.meta.url), 'utf8');
  const bad = parseScore(base.replace('字: 兎(うさぎ)追(お)いし', '字: 兎(うさぎ)追(おい)いし'));
  assert.match(bad.errors[0].message, /字の読み/);
  const bad2 = parseScore(base.replace('元: ウ|サ|ギ|オ|ヒ|シ|カ|ノ|ヤ|マ', '元: ウ|サ|ギ|オ|ヒ|シ|カ|ノ|ヤ'));
  assert.match(bad2.errors[0].message, /元は 9 個/);
});

test('間奏・後奏：構成の位置で決まり、見出しがいまの行に、次の番の最初の行が次の行に出る', async () => {
  const { withBreaks } = await import('../js/uta-lyrics.js');
  const { instrumentalSpans, slowed } = await import('../js/score.js');
  const haru = parseScore(readFileSync(new URL('../songs/haru_no_ogawa.txt', import.meta.url), 'utf8'));
  const furu = parseScore(readFileSync(new URL('../songs/furusato.txt', import.meta.url), 'utf8'));
  assert.deepEqual(instrumentalSpans(haru).map((s) => s.kind), ['intro', 'interlude', 'interlude', 'outro']);
  assert.deepEqual(instrumentalSpans(furu).map((s) => s.kind), ['intro', 'outro']);

  const L = withBreaks(lyricLines(timeline(haru)), instrumentalSpans(haru));
  const k = L.findIndex((l) => l.label === 'interlude');
  const prev = L[k - 1], next = L[k + 1];
  assert.equal(L[k].text, '間奏'); // 括弧「（）」は画面で付ける（ルビを 2 字だけに振るため）
  assert.equal(lineAt(L, prev.t1 - 0.05), k - 1);    // 歌っているあいだは、その行
  assert.equal(lineAt(L, prev.t1 + 0.05), k);        // 主旋律の音が終わったら「間奏」
  assert.equal(next.verse, prev.verse + 1);          // 次の行は、次の番の最初の行
  assert.equal(next.line, 0);
  assert.equal(lineAt(L, next.t0 - 0.7), k);         // 歌い出しの少し前まで「間奏」
  assert.equal(lineAt(L, next.t0 - 0.5), k + 1);     // 前奏と同じく、LEAD_SEC 前に上がる
  const last = L[L.length - 1];
  assert.equal(last.label, 'outro');                 // 後奏が最後（次の行は空く）
  assert.equal(last.text, '後奏');

  // ゆっくりでも、同じ時計で決まる
  const S = slowed(furu);
  const Ls = withBreaks(lyricLines(timeline(S)), instrumentalSpans(S));
  assert.equal(Ls[Ls.length - 1].label, 'outro');
  assert.ok(Ls[Ls.length - 1].t0 > L.length && Ls[Ls.length - 1].t0 > 116.3);
});
