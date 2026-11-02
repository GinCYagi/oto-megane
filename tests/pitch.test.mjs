// 高さの読み取りを、コードで合成した音で確かめる（外の音のファイルは使わない）。
// 実行：node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yin, rmsDb, peakAbs, decimate, semitonesFrom } from '../js/pitch.js';

const SR = 48000;
const FACTOR = 4; // 画面と同じく 12 kHz に間引いてから測る

function sine(hz, n = 4096, amp = 0.5, sr = SR) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr);
  return b;
}

function cents(a, b) {
  return 100 * semitonesFrom(a, b);
}

for (const hz of [82.41, 110, 220, 261.63, 440, 880]) {
  test(`サイン波 ${hz} Hz の高さを ±10 セントで当てる`, () => {
    const r = yin(decimate(sine(hz), FACTOR), SR / FACTOR);
    assert.ok(r.hz !== null, '高さなしになった');
    assert.ok(Math.abs(cents(r.hz, hz)) < 10, `ずれ ${cents(r.hz, hz).toFixed(1)} セント（出した値 ${r.hz.toFixed(2)} Hz）`);
  });
}

test('倍音のある音（三角波に近い）でも基本の高さを当てる', () => {
  const hz = 196;
  const b = new Float32Array(4096);
  for (let i = 0; i < b.length; i++) {
    const t = (2 * Math.PI * hz * i) / SR;
    b[i] = 0.5 * Math.sin(t) + 0.2 * Math.sin(2 * t) + 0.1 * Math.sin(3 * t);
  }
  const r = yin(decimate(b, FACTOR), SR / FACTOR);
  assert.ok(r.hz !== null);
  assert.ok(Math.abs(cents(r.hz, hz)) < 10, `出した値 ${r.hz}`);
});

test('まったくの無音は高さなし・大きさ -Infinity・最大 0', () => {
  const z = new Float32Array(4096);
  assert.equal(yin(decimate(z, FACTOR), SR / FACTOR).hz, null);
  assert.equal(rmsDb(z), -Infinity);
  assert.equal(peakAbs(z), 0);
});

test('雑音は高さなし（になりやすい）', () => {
  // 決まった種の擬似乱数で、毎回同じ雑音にする
  let s = 12345;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const b = new Float32Array(4096);
  for (let i = 0; i < b.length; i++) b[i] = 0.3 * rand();
  assert.equal(yin(decimate(b, FACTOR), SR / FACTOR).hz, null);
});

test('大きさ：振幅 0.5 のサイン波は約 -9 dBFS', () => {
  const db = rmsDb(sine(440, 4800));
  assert.ok(Math.abs(db - -9.03) < 0.2, `${db}`);
});
