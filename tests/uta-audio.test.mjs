import { test } from 'node:test';
import assert from 'node:assert/strict';
import { midiToHz, velToGain } from '../js/uta-audio.js';
import { withDynamics, widthScale, gapRuns } from '../js/uta-line.js';
import { parseScore, timeline, accompaniment, DYNAMICS } from '../js/score.js';
import { readFileSync } from 'node:fs';

test('音の番号を周波数に（A4＝440Hz、C4≒261.6Hz）', () => {
  assert.equal(midiToHz(69), 440);
  assert.ok(Math.abs(midiToHz(60) - 261.63) < 0.01);
});

test('強いほど音量が大きく、ff でも一音は小さめ（和音で割れないように）', () => {
  assert.ok(velToGain(DYNAMICS.p) < velToGain(DYNAMICS.mp));
  assert.ok(velToGain(DYNAMICS.mp) < velToGain(DYNAMICS.mf));
  assert.ok(velToGain(DYNAMICS.ff) < 0.2);
});

test('歌の音に、その時刻の右手の強弱が付く（左手は見ない）', () => {
  const ev = [{ t: 0, dur: 1, midi: 60 }, { t: 1, dur: 1, midi: 62 }, { t: 2, dur: 1, midi: 64 }];
  const acc = [
    { t: 0, dur: 1, midis: [48], vel: 85, part: '右手' },
    { t: 0.5, dur: 1, midis: [36], vel: 40, part: '左手' },
    { t: 1, dur: 1, midis: [48], vel: 70, part: '右手' },
  ];
  assert.deepEqual(withDynamics(ev, acc).map((e) => e.vel), [85, 70, 70]);
  assert.deepEqual(withDynamics(ev, []).map((e) => e.vel), [85, 85, 85]);
});

test('太さの倍率：mf が 1、p < mp < mf < f', () => {
  assert.equal(widthScale(DYNAMICS.mf), 1);
  assert.ok(widthScale(DYNAMICS.p) < widthScale(DYNAMICS.mp));
  assert.ok(widthScale(DYNAMICS.mp) < 1 && widthScale(DYNAMICS.f) > 1);
});

test('線のかたまりに強さが乗る', () => {
  const runs = gapRuns([{ t: 0, dur: 1, midi: 60, text: 'あ', vel: 70 }]);
  assert.equal(runs[0].vel, 70);
});

test('二曲とも、伴奏は後奏の終わりまであり、歌より後に終わる', () => {
  for (const f of ['songs/furusato.txt', 'songs/haru_no_ogawa.txt']) {
    const s = parseScore(readFileSync(f, 'utf8'));
    const acc = accompaniment(s);
    const ev = timeline(s);
    const end = (xs) => Math.max(...xs.map((e) => e.t + e.dur));
    assert.ok(acc.length > 0, f);
    assert.ok(end(acc) > end(ev), f);
  }
});

test('仮の主旋律：休符を除いた歌の音が、強さつきで並ぶ', async () => {
  const { melodyEvents } = await import('../js/uta-audio.js');
  const m = melodyEvents([{ t: 0, dur: 1, midi: 60, vel: 70 }, { t: 1, dur: 1, midi: null }, { t: 2, dur: 1, midi: 62 }]);
  assert.deepEqual(m.map((e) => [e.t, e.midis[0], e.vel, e.part]), [[0, 60, 70, '旋律'], [2, 62, 85, '旋律']]);
});

test('ふるさとだけ「元の調」があり、移調を 0 にすると全音（2 半音）高く鳴る', () => {
  const furu = parseScore(readFileSync('songs/furusato.txt', 'utf8'));
  const haru = parseScore(readFileSync('songs/haru_no_ogawa.txt', 'utf8'));
  assert.equal(furu.meta['元の調'], 'ト長調');
  assert.equal(haru.meta['元の調'], undefined);
  const f = timeline(furu).find((e) => e.midi !== null);
  const g = timeline({ ...furu, meta: { ...furu.meta, '移調': '0' } }).find((e) => e.midi !== null);
  assert.equal(g.midi - f.midi, 2);
  assert.equal(g.midi, 67); // ト長調の歌い出しは G4
});

test('WAV の書き出し：頭の形と、音の値が 16 ビットに入る', async () => {
  const { encodeWav } = await import('../js/uta-audio.js');
  const L = new Float32Array([0, 0.5, -1, 1]);
  const R = new Float32Array([0, -0.5, 2, -2]); // 範囲の外は端で止める
  const v = new DataView(encodeWav([L, R], 48000));
  const str = (o, n) => String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(o + i)));
  assert.equal(str(0, 4), 'RIFF');
  assert.equal(str(8, 4), 'WAVE');
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint32(40, true), 4 * 2 * 2);
  assert.equal(v.byteLength, 44 + 16);
  // 左右を交互に並べる：L0 R0 L1 R1 …
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => v.getInt16(44 + i * 2, true)), [0, 0, 16383, -16384, -32768, 32767, 32767, -32768]);
});
