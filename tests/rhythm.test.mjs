// 拍の立ち上がりを、コードで合成した音で確かめる（外の音のファイルは使わない）。
// ブラウザの AnalyserNode の代わりに、テストの中で窓をかけて FFT し、dB の強さを作る。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OnsetTracker } from '../js/rhythm.js';

const SR = 48000;
const N = 2048;        // 画面と同じ窓の長さ
const FPS = 60;

/** 窓をかけた FFT（基数 2）。強さを dB で返す（AnalyserNode の getFloatFrequencyData に近い形）。 */
function spectrumDb(x) {
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < N; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const ar = re[i + k + len / 2], ai = im[i + k + len / 2];
        const tr = ar * wr - ai * wi, ti = ar * wi + ai * wr;
        re[i + k + len / 2] = re[i + k] - tr; im[i + k + len / 2] = im[i + k] - ti;
        re[i + k] += tr; im[i + k] += ti;
      }
    }
  }
  const out = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) out[i] = 20 * Math.log10(Math.hypot(re[i], im[i]) / N + 1e-12);
  return out;
}

/** 決まった種の擬似乱数（毎回同じ音にする） */
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
}

/** 伴奏に近い音：ずっと鳴る和音の上に、interval 秒ごとに打楽器のような雑音の立ち上がり。 */
function bandLike(interval, seconds) {
  const rand = rng(7);
  const x = new Float32Array(Math.ceil(seconds * SR));
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const since = t % interval;
    const chord = 0.15 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t));
    x[i] = chord + 0.4 * Math.exp(-since * 30) * rand();
  }
  return x;
}

function onsets(x) {
  const tr = new OnsetTracker();
  const times = [];
  for (let k = 0; ; k++) {
    const t = k / FPS;
    const end = Math.floor(t * SR);
    if (end > x.length) break;
    if (end < N) continue;
    if (tr.update(t, spectrumDb(x.subarray(end - N, end)), 1 / FPS, N / 2)) times.push(t);
  }
  return times;
}

test('ずっと鳴る和音の上の 0.5 秒ごとの拍を、ほぼ全部見つける（8 秒で 16 拍）', () => {
  const times = onsets(bandLike(0.5, 8));
  assert.ok(times.length >= 14 && times.length <= 16, `見つけた数 ${times.length}`);
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  const odd = gaps.filter((g) => Math.abs(g - 0.5) > 0.05);
  assert.ok(odd.length <= 1, `ずれた間 ${odd.map((g) => g.toFixed(2)).join(',')}`);
});

test('一定の大きさで続く和音には、拍を出さない', () => {
  const x = new Float32Array(SR * 4);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    x[i] = 0.15 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 330 * t));
  }
  assert.equal(onsets(x).length, 0);
});

test('拍は 1 秒に 3 回までしか出さない（速すぎる印でちらつかせない）', () => {
  const times = onsets(bandLike(0.1, 4));
  assert.ok(times.length <= 4 * 3 + 1, `見つけた数 ${times.length}`);
});
