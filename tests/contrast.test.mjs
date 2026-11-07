import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideContrast } from '../js/contrast.js';

test('白黒（くっきり）：自分で選んだものを優先し、選んでいなければ端末の設定に合わせる', () => {
  assert.equal(decideContrast(null, false), false);
  assert.equal(decideContrast(null, true), true);
  assert.equal(decideContrast('on', false), true);
  assert.equal(decideContrast('off', true), false);
  assert.equal(decideContrast('へんな値', true), true);
});
