import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideContrast, nextStored } from '../js/contrast.js';

test('白黒（くっきり）：自分で選んだものを優先し、選んでいなければ端末の設定に合わせる', () => {
  assert.equal(decideContrast(null, false), false);
  assert.equal(decideContrast(null, true), true);
  assert.equal(decideContrast('on', false), true);
  assert.equal(decideContrast('off', true), false);
  assert.equal(decideContrast('へんな値', true), true);
});

test('白黒（くっきり）：押したあと、端末の設定と同じなら覚えた値を消し、違うときだけ on・off を覚える', () => {
  assert.equal(nextStored(false, false), null); // 外した・端末は求めていない → 端末に合わせる
  assert.equal(nextStored(false, true), 'off'); // 外した・端末は求めている → off を覚える
  assert.equal(nextStored(true, false), 'on');  // 付けた・端末は求めていない → on を覚える
  assert.equal(nextStored(true, true), null);   // 付けた・端末も求めている → 端末に合わせる
  // 覚えた値どおりに決まるか（往復）
  for (const auto of [false, true]) for (const checked of [false, true]) {
    assert.equal(decideContrast(nextStored(checked, auto), auto), checked);
  }
});
