// 音の読み取り：高さ（YIN 法）と大きさ（RMS を dB に）。
// 画面やブラウザの機能には触れない、数だけの関数。node --test で確かめられる。

/** 区間の大きさ（RMS）を dBFS で返す。まったくの無音は -Infinity。 */
export function rmsDb(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

/** 区間の絶対値の最大。0 なら「値がまったく来ていない」。 */
export function peakAbs(buf) {
  let m = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > m) m = a;
  }
  return m;
}

/**
 * 隣り合う factor 個を平均して間引く（荒い折り返し止めを兼ねる）。
 * 48 kHz の音を 12 kHz ほどに落とし、高さの計算を軽くする（廉価な機種のため）。
 */
export function decimate(buf, factor) {
  if (factor <= 1) return buf;
  const n = Math.floor(buf.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < factor; k++) s += buf[i * factor + k];
    out[i] = s / factor;
  }
  return out;
}

/**
 * YIN 法で基本の高さ（Hz）を出す。
 * de Cheveigné & Kawahara (2002) "YIN, a fundamental frequency estimator for speech and music" の手順を、論文から書き起こした。
 * 返り値：{ hz, clarity }。確からしくなければ hz は null。clarity は 0〜1（1 に近いほど確か）。
 */
export function yin(buf, sampleRate, { threshold = 0.15, minHz = 60, maxHz = 1100 } = {}) {
  const maxTau = Math.min(Math.floor(sampleRate / minHz), Math.floor(buf.length / 2));
  const minTau = Math.max(2, Math.floor(sampleRate / maxHz));
  if (maxTau <= minTau) return { hz: null, clarity: 0 };
  const W = buf.length - maxTau;

  // 1. 差の関数 d(tau)
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const diff = buf[i] - buf[i + tau];
      s += diff * diff;
    }
    d[tau] = s;
  }

  // 2. 累積平均で正規化した差 d'(tau)
  const dn = new Float32Array(maxTau + 1);
  dn[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    dn[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  // 3. しきい値を下回る最初の谷
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (dn[t] < threshold) {
      while (t + 1 <= maxTau && dn[t + 1] < dn[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return { hz: null, clarity: 0 };

  // 4. 放物線で谷の位置を細かく
  let better = tau;
  if (tau > 1 && tau < maxTau) {
    const a = dn[tau - 1], b = dn[tau], c = dn[tau + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) better = tau + (a - c) / (2 * denom);
  }
  return { hz: sampleRate / better, clarity: Math.max(0, 1 - dn[tau]) };
}

/** Hz を、基準の高さからの半音の数に。 */
export function semitonesFrom(hz, refHz) {
  return 12 * Math.log2(hz / refHz);
}
