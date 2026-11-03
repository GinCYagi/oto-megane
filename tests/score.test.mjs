// 楽譜の読み込みを、合成の楽譜（このテストのために作った旋律と詞）で確かめる。
// songs/ に置いた楽譜があれば、それも全部、間違いなく読めるかを確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { parseScore, parseNotes, noteToMidi, timeline, accompaniment, barBeats, transposeOf } from '../js/score.js';

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

const WITH_PIANO = `# ためしのうた（伴奏つき）
拍子: 2/4
速さ: 120
構成: 前奏 1番 前奏

[前奏]
右手: mf C5+E5:4 R:4 / G4:2
左手: C3:2 / C3:2

[旋律]
音: E4:4 G4:4 / C5:2
右手: p E4+G4:8 E4+G4:8 R:4 / C5:4 > G4:4
左手: C3:2 / C3:4 G2:4

[1番]
詞: は|る|の
`;

test('拍子から 1 小節の長さ（4 分音符いくつ分か）', () => {
  assert.equal(barBeats('4/4'), 4);
  assert.equal(barBeats('3/4'), 3);
  assert.equal(barBeats('6/8'), 3);
  assert.equal(barBeats('よんぶんの'), null);
});

test('和音・強弱・小節の区切りを読む', () => {
  const { notes, error } = parseNotes('mf C4+G4+E4:4 R:4 / p G3:2', { bar: 2 });
  assert.equal(error, null);
  assert.deepEqual(notes[0].midis, [60, 64, 67]);
  assert.equal(notes[0].midi, 67);   // 一番上の音
  assert.equal(notes[0].dyn, 'mf');
  assert.equal(notes[2].dyn, 'p');
});

test('小節をまたぐタイは一つの音にし、小節の長さはそれぞれで数える', () => {
  const { notes, error } = parseNotes('E5:2 E5:2~ / E5:2 D5:2', { bar: 4 });
  assert.equal(error, null);
  assert.deepEqual(notes.map((n) => n.beats), [2, 4, 2]);
  assert.match(parseNotes('E5:2~ / D5:2', {}).error, /高さが違います/);
});

test('長さの合わない小節は、何小節目かを付けて知らせる', () => {
  const { error } = parseNotes('C4:4 D4:4 / E4:4 / F4:2', { bar: 2 });
  assert.match(error, /2 小節目が 1 拍です（2 拍のはず）/);
});

test('歌の旋律に和音は書けない', () => {
  const s = parseScore(WITH_PIANO.replace('音: E4:4 G4:4', '音: E4+G4:4 G4:4'));
  assert.ok(s.errors.some((e) => /和音は書けません/.test(e.message)), JSON.stringify(s.errors));
});

test('伴奏つきの楽譜を、間違いなしで読む', () => {
  const s = parseScore(WITH_PIANO);
  assert.deepEqual(s.errors, []);
  assert.deepEqual(s.form, ['前奏', '1番', '前奏']);
  assert.deepEqual(Object.keys(s.melody[0].parts), ['右手', '左手']);
});

test('伴奏の長さが、その段の旋律と合わなければ知らせる', () => {
  const s = parseScore(WITH_PIANO.replace('左手: C3:2 / C3:4 G2:4', '左手: C3:2 / C3:4'));
  assert.ok(s.errors.some((e) => /左手/.test(e.message)), JSON.stringify(s.errors));
});

test('構成の順に、前奏のあいだは歌を出さず時刻だけ進める', () => {
  const ev = timeline(parseScore(WITH_PIANO));
  assert.equal(ev[0].t, 2);          // 前奏 2 小節＝4 拍＝2 秒（速さ 120）
  assert.equal(ev[0].text, 'は');
  assert.equal(ev.length, 3);
});

test('伴奏の音を、構成の順に強弱つきで並べる（強弱は次の印まで続く）', () => {
  const acc = accompaniment(parseScore(WITH_PIANO));
  assert.equal(acc[0].t, 0);
  const first = acc.find((e) => e.part === '右手');
  assert.equal(first.vel, 85);                         // mf
  const inVerse = acc.filter((e) => e.part === '右手' && e.t >= 2 && e.t < 4);
  assert.ok(inVerse.every((e) => e.vel === 55), JSON.stringify(inVerse)); // p
  const last = acc.filter((e) => e.part === '左手').at(-1);
  assert.equal(last.t, 5);                            // 後の前奏（4 秒から）の 2 小節目
});

test('構成に、楽譜にない部分の名前があれば知らせる', () => {
  const s = parseScore(WITH_PIANO.replace('構成: 前奏 1番 前奏', '構成: 前奏 1番 2番'));
  assert.ok(s.errors.some((e) => /構成の「2番」/.test(e.message)));
});

test('「移調:」は、読んだ音はそのままにして、鳴らす高さ（歌と伴奏）だけを動かす', () => {
  const s = parseScore(WITH_PIANO.replace('構成:', '移調: -2\n構成:'));
  assert.deepEqual(s.errors, []);
  assert.equal(transposeOf(s), -2);
  assert.equal(s.melody[0].notes[0].midi, 64);                 // 楽譜は E4 のまま
  const plain = timeline(parseScore(WITH_PIANO)), moved = timeline(s);
  assert.deepEqual(moved.map((e) => e.midi), plain.map((e) => e.midi - 2));
  const pa = accompaniment(parseScore(WITH_PIANO)), ma = accompaniment(s);
  assert.deepEqual(ma.map((e) => e.midis), pa.map((e) => e.midis.map((m) => m - 2)));
});

test('「移調:」が整数でない・大きすぎるときは知らせる', () => {
  assert.ok(parseScore(WITH_PIANO.replace('構成:', '移調: 下げる\n構成:')).errors.some((e) => /整数/.test(e.message)));
  assert.ok(parseScore(WITH_PIANO.replace('構成:', '移調: -13\n構成:')).errors.some((e) => /-12〜12/.test(e.message)));
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

test('MIDI に書き出せる（ヘッダーと 2 本のトラック）', async () => {
  const { scoreToMidi } = await import('../tools/score2midi.mjs');
  const bytes = scoreToMidi(parseScore(WITH_PIANO));
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'MThd');
  const text = Buffer.from(bytes).toString('latin1');
  assert.equal(text.split('MTrk').length - 1, 2);
});
