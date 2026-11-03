// 楽譜の読み込みを、合成の楽譜（このテストのために作った旋律と詞）で確かめる。
// songs/ に置いた楽譜があれば、それも全部、間違いなく読めるかを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { parseScore, parseNotes, noteToMidi, timeline } from '../js/score.js';

const SAMPLE = `# ためしのうた
作詞: ためし
作曲: ためし
出典: なし
拍子: 3/4
速さ: 60

[旋律]
音: C4:4 D4:4 E4:4. R:8 F4:4~F4:8 G4:8
音: G4:2 R:4

[1番]
詞: あ|さ|日|ー|の
読: あ|さ|ひ|ー|の
詞: 山
読: やま

[2番]
音: A4:4 G4:4 R:4
詞: そ|ら
読: そ|ら
詞: 川
読: かわ
`;

test('音名を MIDI の番号に（C4 = 60、# と b）', () => {
  assert.equal(noteToMidi('C4'), 60);
  assert.equal(noteToMidi('A4'), 69);
  assert.equal(noteToMidi('F#4'), 66);
  assert.equal(noteToMidi('Bb4'), 70);
  assert.equal(noteToMidi('C5'), 72);
  assert.equal(noteToMidi('H4'), null);
});

test('長さ・付点・休符・タイを読む', () => {
  const { notes, error } = parseNotes('C4:4 E4:4. R:8 F4:4~F4:8 G4:16');
  assert.equal(error, null);
  assert.deepEqual(notes.map((n) => n.beats), [1, 1.5, 0.5, 1.5, 0.25]);
  assert.equal(notes[2].midi, null);
  assert.equal(notes[3].midi, 65);
});

test('違う高さをつなぐタイと、読めない長さは間違いにする', () => {
  assert.match(parseNotes('F4:4~G4:8').error, /違う高さ/);
  assert.match(parseNotes('F4:3').error, /長さ/);
  assert.match(parseNotes('F4').error, /読めません/);
});

test('合成の楽譜を、間違いなしで読む', () => {
  const s = parseScore(SAMPLE);
  assert.deepEqual(s.errors, []);
  assert.equal(s.title, 'ためしのうた');
  assert.equal(s.meta['拍子'], '3/4');
  assert.equal(s.melody.length, 2);
  assert.equal(s.verses.length, 2);
  assert.equal(s.verses[0].name, '1番');
});

test('読みが字と違う所だけにルビが付く（伸ばす印「ー」には付けない）', () => {
  const s = parseScore(SAMPLE);
  const syl = s.verses[0].lines[0].syllables;
  assert.deepEqual(syl.map((x) => x.ruby), [null, null, 'ひ', null, null]);
  assert.equal(s.verses[0].lines[1].syllables[0].ruby, 'やま');
});

test('番の中の「音:」は、その次の詞の行だけ旋律を上書きする', () => {
  const s = parseScore(SAMPLE);
  assert.equal(s.verses[1].lines[0].notes[0].midi, 69);       // 上書きした A4
  assert.equal(s.verses[1].lines[1].notes[0].midi, 67);       // 2 行目は [旋律] の G4 のまま
});

test('音と字の数が合わない行は、行の番号を付けて知らせる', () => {
  const bad = SAMPLE.replace('詞: あ|さ|日|ー|の', '詞: あ|さ|日|の');
  const s = parseScore(bad);
  assert.equal(s.errors.length, 2); // 詞の数と、読の数
  const lineNo = bad.split('\n').findIndex((l) => l.startsWith('詞: あ|さ|日|の')) + 1;
  assert.equal(s.errors[0].lineNo, lineNo);
  assert.match(s.errors[0].message, /1番の 1 行目：詞は 4 個、休符を除いた音は 5 個/);
});

test('[旋律] より行の多い番は、行の番号を付けて知らせる', () => {
  const s = parseScore(SAMPLE + '詞: う|み\n');
  assert.ok(s.errors.some((e) => /3 行目の詞に当たる旋律がありません/.test(e.message)), JSON.stringify(s.errors));
});

test('全角のコロンと「｜」も受け付ける（打ちやすさのため）', () => {
  const s = parseScore(SAMPLE.replace('詞: そ|ら', '詞：そ｜ら'));
  assert.deepEqual(s.errors, []);
});

test('楽譜の速さのまま、音ごとの時刻を並べる（速さ 60 なら 4 分音符 1 秒）', () => {
  const ev = timeline(parseScore(SAMPLE));
  assert.deepEqual(ev.slice(0, 6).map((e) => [e.t, e.dur]), [[0, 1], [1, 1], [2, 1.5], [3.5, 0.5], [4, 1.5], [5.5, 0.5]]);
  assert.equal(ev[3].midi, null);         // 休符
  assert.equal(ev[3].text, null);
  assert.equal(ev[4].text, 'ー');         // タイでつないだ音は一つの音として「ー」が当たる
  assert.equal(ev[2].ruby, 'ひ');
  const last = ev.at(-1);
  assert.equal(last.verse, 1);
});

// songs/ に置いた楽譜は、全部、間違いなく読めること
const songsDir = new URL('../songs/', import.meta.url);
const files = existsSync(songsDir) ? readdirSync(songsDir).filter((f) => f.endsWith('.txt') && !f.endsWith('.times.txt')) : [];
for (const f of files) {
  test(`songs/${f} を間違いなく読める`, () => {
    const s = parseScore(readFileSync(new URL(f, songsDir), 'utf8'));
    assert.deepEqual(s.errors.map((e) => `${e.lineNo} 行目：${e.message}`), []);
  });
}
