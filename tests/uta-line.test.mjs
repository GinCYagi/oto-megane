import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { songRange, lineRuns, xOf, yOf, NOW_AT, WINDOW_SEC } from '../js/uta-line.js';
import { parseScore, timeline } from '../js/score.js';

const ev = (t, dur, midi) => ({ t, dur, midi });

test('音域は、いちばん低い音と高い音に上下 2 半音ずつ足す（休符は数えない）', () => {
  assert.deepEqual(songRange([ev(0, 1, 60), ev(1, 1, null), ev(2, 1, 67)]), { lo: 58, hi: 69 });
});

test('線は休符で切れ、続いた音は一本につながる', () => {
  const runs = lineRuns([ev(0, 1, 60), ev(1, 1, 62), ev(2, 1, null), ev(3, 1, 64)]);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0].at(0), { t: 0, midi: 60 });
  assert.deepEqual(runs[0].at(-1), { t: 2, midi: 62 });
  assert.deepEqual(runs[1], [{ t: 3, midi: 64 }, { t: 4, midi: 64 }]);
});

test('いまの時刻は、いつも左から 3 分の 1 に来る。8 秒先が右の端', () => {
  assert.equal(xOf(10, 10), NOW_AT);
  assert.ok(Math.abs(xOf(10 + WINDOW_SEC * (1 - NOW_AT), 10) - 1) < 1e-12);
  assert.equal(yOf(58, { lo: 58, hi: 69 }), 1);
  assert.equal(yOf(69, { lo: 58, hi: 69 }), 0);
});

test('ふるさとは前奏のあいだ線がなく、1 番の頭から線が始まる', () => {
  const s = parseScore(readFileSync(new URL('../songs/furusato.txt', import.meta.url), 'utf8'));
  const runs = lineRuns(timeline(s));
  assert.ok(Math.abs(runs[0][0].t - 4 * 3 * 60 / 80) < 1e-9); // 前奏 4 小節 × 3 拍 × 0.75 秒 = 9 秒
});

test('音の頭の光：0.4 秒で一度だけ広がって消える（点滅しない）', async () => {
  const { glowAt, GLOW_SEC } = await import('../js/uta-line.js');
  assert.equal(GLOW_SEC, 0.4);
  assert.equal(glowAt(-0.01), null);
  assert.equal(glowAt(0.4), null);
  let prevR = 0, prevA = Infinity;
  for (let s = 0; s < 0.4; s += 0.01) {
    const g = glowAt(s);
    assert.ok(g.r >= prevR && g.a <= prevA, '広がるだけ・薄くなるだけ');
    assert.ok(g.a <= 0.6 && g.r <= 2.4, '小さく・淡く');
    prevR = g.r; prevA = g.a;
  }
});

test('vocalVels：歌声の大きい音ほど強く、休符・録音の外は null（?width=voice）', async () => {
  const { vocalVels, withVocalVels, VOICE_VEL_LO, VOICE_VEL_HI } = await import('../js/uta-line.js');
  const sr = 1000;
  const samples = new Float32Array(12 * sr);
  const amp = [0.02, 0.05, 0.1, 0.2, 0.4, 0.8];
  amp.forEach((a, k) => { for (let i = 0; i < sr; i++) samples[(k + 1) * sr + i] = a * Math.sin(i); });
  // 録音の 0 秒＝曲の -1 秒。音 k は曲の k 秒目から 1 秒
  const ev = amp.map((_, k) => ({ t: k, dur: 1, midi: 60 }));
  ev.splice(2, 0, { t: 1.5, dur: 0.5, midi: null });
  ev.push({ t: 30, dur: 1, midi: 60 }); // 録音の外
  const v = vocalVels(ev, samples, sr, -1);
  assert.equal(v.length, 7);
  assert.equal(v[6], null);
  for (let k = 1; k < 6; k++) assert.ok(v[k] > v[k - 1], `${v}`);
  assert.ok(v[0] >= VOICE_VEL_LO && v[5] <= VOICE_VEL_HI);
  const w = withVocalVels(ev.map((e) => ({ ...e, vel: 85 })), v);
  assert.equal(w[2].midi, null);
  assert.equal(w[2].vel, 85);
  assert.equal(w.at(-1).vel, 85);
  assert.equal(w[3].vel, v[2]);
});
