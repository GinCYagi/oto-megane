// 線をなめらかにする：高さは直前の数コマの中央値、太さに使う大きさはゆっくり追う。
// 一瞬の跳び（倍・半分の高さの読み違いなど）と、太さのがたつきを抑える。
// 高さのないコマは、ならしても埋めない（隙間は隙間のまま見せる）。
//
// 倍音の取り違え：声の大きい所で、読み取りが声の倍音（ちょうど 2 倍・3 倍の高さ）を拾い、
// 線が上へ飛び離れることがある（作者の歌声で、0.2〜0.7 秒続く跳びを確かめた）。
// 直前まで歌っていた高さの、ちょうど 2 倍・3 倍に跳んだときは、元の高さに戻して描く。
// 歌が本当に 1 オクターブ跳ぶ所も戻してしまうが、唱歌の旋律ではまれなので、取り違えを消すほうを採る。

const MEDIAN_N = 5;     // 中央値をとるコマの数（60 コマ/秒で約 0.08 秒）
const DB_TAU = 0.08;    // 大きさをならす時定数（秒）
const REF_SEC = 0.6;    // 「直前まで歌っていた高さ」を、この秒の中央値でとる
const REF_KEEP = 1.5;   // 息つぎなどの隙間がこの秒までなら、直前の高さを覚えておく
const FOLD_CENTS = 100; // ちょうど 2 倍・3 倍から、このセント（半音）以内なら取り違えとみなす。ビブラートの揺れの分を見込む

export class LineSmoother {
  constructor() {
    this.hzs = [];
    this.db = null;
    this.t = 0;
    this.recent = []; // { t, hz }：描いた高さ（取り違えを戻したあと）
  }

  /** 直前まで歌っていた高さの、ちょうど 2 倍・3 倍なら、元の高さに戻す。 */
  fold(hz) {
    const ref = this.recent.filter((r) => this.t - r.t <= REF_SEC).map((r) => r.hz);
    // 0.6 秒の中に高さがなければ、隙間の前の最後の高さ（1.5 秒以内）を使う
    const last = this.recent.at(-1);
    const base = ref.length ? ref.sort((a, b) => a - b)[Math.floor(ref.length / 2)] : last?.hz;
    if (!base) return hz;
    for (const k of [2, 3]) {
      if (Math.abs(1200 * Math.log2(hz / (base * k))) < FOLD_CENTS) return hz / k;
    }
    return hz;
  }

  /** 1 コマごとに呼ぶ。dt は前のコマからの秒。 */
  push(hz, db, dt) {
    this.t += dt;
    this.recent = this.recent.filter((r) => this.t - r.t <= REF_KEEP);
    if (hz) hz = this.fold(hz);
    this.hzs.push(hz);
    if (this.hzs.length > MEDIAN_N) this.hzs.shift();

    const d = Number.isFinite(db) ? db : -120;
    if (this.db === null) this.db = d;
    this.db += (d - this.db) * Math.min(1, dt / DB_TAU);

    if (!hz) return { hz: null, db: this.db };
    const vals = this.hzs.filter(Boolean).sort((a, b) => a - b);
    const out = vals[Math.floor(vals.length / 2)];
    this.recent.push({ t: this.t, hz: out });
    return { hz: out, db: this.db };
  }
}
