// 線をなめらかにする：高さは直前の数コマの中央値、太さに使う大きさはゆっくり追う。
// 一瞬の跳び（倍・半分の高さの読み違いなど）と、太さのがたつきを抑える。
// 高さのないコマは、ならしても埋めない（隙間は隙間のまま見せる）。

const MEDIAN_N = 5;     // 中央値をとるコマの数（60 コマ/秒で約 0.08 秒）
const DB_TAU = 0.08;    // 大きさをならす時定数（秒）

export class LineSmoother {
  constructor() {
    this.hzs = [];
    this.db = null;
  }

  /** 1 コマごとに呼ぶ。dt は前のコマからの秒。 */
  push(hz, db, dt) {
    this.hzs.push(hz);
    if (this.hzs.length > MEDIAN_N) this.hzs.shift();

    const d = Number.isFinite(db) ? db : -120;
    if (this.db === null) this.db = d;
    this.db += (d - this.db) * Math.min(1, dt / DB_TAU);

    if (!hz) return { hz: null, db: this.db };
    const vals = this.hzs.filter(Boolean).sort((a, b) => a - b);
    return { hz: vals[Math.floor(vals.length / 2)], db: this.db };
  }
}
