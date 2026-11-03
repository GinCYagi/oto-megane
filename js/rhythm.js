// 拍の手がかり：音の立ち上がり（打楽器や、音の出だし）を見つける。
// 歌声だけの音がない曲で、高さの線の代わりに「大きさと拍」を見せるために使う。
//
// やり方：周波数ごとの強さ（dB）を前のコマと比べ、増えた分だけを足し合わせる（spectral flux）。
// 伴奏が混ざった曲では、全体の大きさはあまり変わらなくても、立ち上がりの瞬間には
// 多くの周波数で強さが一斉に増えるので、見つけやすい。
// 画面やブラウザの機能には触れない、数だけの関数。node --test で確かめられる。

const AVG_SEC = 1.0;    // 「ふだんの増え方」を追う時定数
const K = 1.5;          // ふだんの増え方より、ばらつきの何倍多ければ立ち上がりとするか
const MIN_FLUX = 1.0;   // これより小さい増え方は、立ち上がりとしない（静かなところの揺れを拾わない）
const GAP_SEC = 0.34;   // 立ち上がりどうしの最短の間（1 秒に 3 回まで。WCAG 2.3.2 の「3 回」に合わせ、速すぎる印でちらつかせない）

/** 前のコマより増えた分（dB）を、周波数ごとに足して平均する。 */
export function spectralFlux(prev, cur, maxBin = cur.length) {
  let sum = 0;
  const n = Math.min(maxBin, cur.length);
  for (let i = 1; i < n; i++) {
    const a = Number.isFinite(prev[i]) ? Math.max(prev[i], -100) : -100;
    const b = Number.isFinite(cur[i]) ? Math.max(cur[i], -100) : -100;
    const d = b - a;
    if (d > 0) sum += d;
  }
  return sum / (n - 1);
}

export class OnsetTracker {
  constructor() {
    this.prevSpec = null;
    this.mean = 0;
    this.varc = 0;
    this.prevFlux = 0;
    this.lastOnset = -Infinity;
  }

  /**
   * 1 コマごとに呼ぶ。spec：周波数ごとの強さ（dB、getFloatFrequencyData の値）。
   * maxBin：見る周波数の上限の番号。dt：前のコマからの秒。立ち上がりなら true。
   */
  update(t, spec, dt, maxBin) {
    if (!this.prevSpec) {
      this.prevSpec = Float32Array.from(spec);
      return false;
    }
    const flux = spectralFlux(this.prevSpec, spec, maxBin);
    this.prevSpec.set(spec);

    const limit = this.mean + K * Math.sqrt(this.varc);
    const onset = flux > MIN_FLUX && flux > limit && flux >= this.prevFlux && t - this.lastOnset > GAP_SEC;
    if (onset) this.lastOnset = t;

    const a = Math.min(1, dt / AVG_SEC);
    const diff = flux - this.mean;
    this.mean += diff * a;
    this.varc += (diff * diff - this.varc) * a;
    this.prevFlux = flux;
    return onset;
  }
}
