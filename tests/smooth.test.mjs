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

test('歌っている高さのちょうど 2 倍・3 倍に、しばらく跳んだ所は元の高さに戻す（倍音の取り違え）', () => {
  const sm = new LineSmoother();
  const out = [];
  for (let i = 0; i < 60; i++) out.push(sm.push(262, -20, 1 / 60).hz);   // ド4 を 1 秒
  for (let i = 0; i < 30; i++) out.push(sm.push(524, -15, 1 / 60).hz);   // 2 倍に 0.5 秒
  for (let i = 0; i < 15; i++) out.push(sm.push(786, -15, 1 / 60).hz);   // 3 倍に 0.25 秒
  for (const hz of out) assert.ok(Math.abs(hz - 262) < 2, `${hz}`);
});

test('息つぎの隙間（1 秒）のあとの 2 倍の跳びも戻す', () => {
  const sm = new LineSmoother();
  for (let i = 0; i < 60; i++) sm.push(262, -20, 1 / 60);
  for (let i = 0; i < 60; i++) sm.push(null, -70, 1 / 60);
  let hz;
  for (let i = 0; i < 10; i++) hz = sm.push(524, -15, 1 / 60).hz;
  assert.ok(Math.abs(hz - 262) < 2, `${hz}`);
});

test('一音ずつ上がっていく旋律は、そのまま描く（ドレミファソラシド）', () => {
  const sm = new LineSmoother();
  let hz;
  for (const n of [262, 294, 330, 349, 392, 440, 494, 523]) {
    for (let i = 0; i < 20; i++) hz = sm.push(n, -20, 1 / 60).hz;
  }
  assert.ok(Math.abs(hz - 523) < 2, `${hz}`);
});
