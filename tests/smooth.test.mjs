// 線をなめらかにする処理を確かめる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LineSmoother } from '../js/smooth.js';

test('一瞬だけ倍の高さに跳んだコマは、中央値で消える', () => {
  const sm = new LineSmoother();
  const seq = [220, 220, 220, 440, 220, 220];
  const out = seq.map((hz) => sm.push(hz, -20, 1 / 60).hz);
  assert.equal(out[3], 220);
});

test('高さのないコマは、ならしても埋めない', () => {
  const sm = new LineSmoother();
  for (let i = 0; i < 4; i++) sm.push(220, -20, 1 / 60);
  assert.equal(sm.push(null, -20, 1 / 60).hz, null);
});

test('大きさは急に変えず、ゆっくり追う', () => {
  const sm = new LineSmoother();
  sm.push(220, -40, 1 / 60);
  const db = sm.push(220, -10, 1 / 60).db;
  assert.ok(db > -40 && db < -25, `${db}`);
});
