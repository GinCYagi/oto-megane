// 歌モードの伴奏。楽譜のテキストから、アプリの中で音を作って鳴らす（Web Audio。音のファイルは使わない）。
// 音色は、ピアノに近い減衰する音（三角波＋1 オクターブ上の正弦波）。音の時刻は accompaniment(score) の秒のまま。
// 先読み：0.1 秒ごとに、これから 0.6 秒のうちに鳴る音だけを予約する（安い機種でも、一度に作る音の部品を少なくするため）。

const LOOKAHEAD_SEC = 0.6;
const TICK_MS = 100;
const RELEASE_SEC = 0.08; // 音の終わりの消え方（ぷつっと切れないように）

/** MIDI の音の番号を周波数に */
export function midiToHz(m) {
  return 440 * 2 ** ((m - 69) / 12);
}

/**
 * 仮の主旋律（歌声が入る T6 までの代わり）。元の本の旋律の段の音を、伴奏と同じ形の音の並びにする。
 * events は timeline(score)（withDynamics を通したもの）。休符は入れない。
 */
export function melodyEvents(events) {
  return events.filter((e) => e.midi !== null).map((e) => ({ t: e.t, dur: e.dur, midis: [e.midi], vel: e.vel ?? 85, part: '旋律' }));
}

/** 鍵盤の強さ（velocity 0〜127）を、一音の音量に。強さの差が耳で分かるよう、2 乗にする */
export function velToGain(vel) {
  return 0.16 * (vel / 127) ** 2;
}

export class UtaAccompaniment {
  /** ctx：AudioContext（押した瞬間に作る・resume する。iPhone は触った瞬間でないと鳴らせないため） */
  constructor(ctx, events) {
    this.ctx = ctx;
    this.events = events;
    this.next = 0;
    this.out = ctx.createGain();
    this.out.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor(); // 和音が重なっても割れないように
    this.out.connect(comp).connect(ctx.destination);
    this.timer = 0;
  }

  /** 曲の 0 秒を、AudioContext の時刻 startAt に合わせて鳴らし始める */
  start(startAt) {
    if (this.stopped) return;
    this.startAt = startAt;
    this.started = true;
    this.schedule();
    this.timer = setInterval(() => this.schedule(), TICK_MS);
  }

  /** いま聞こえている所が、曲の何秒目か（画面の線はこれに合わせて動かす）。出力の遅れの分を引く */
  songTime() {
    const lat = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return this.ctx.currentTime - lat - this.startAt;
  }

  schedule() {
    const until = this.ctx.currentTime + LOOKAHEAD_SEC;
    while (this.next < this.events.length && this.startAt + this.events[this.next].t < until) {
      const e = this.events[this.next++];
      const at = this.startAt + e.t;
      if (at < this.ctx.currentTime - 0.05) continue; // 遅れて予約しそこねた音は飛ばす（まとめて鳴らない）
      if (e.part === '旋律') { this.sing(e.midis[0], at, e.dur, velToGain(e.vel)); continue; }
      for (const m of e.midis) this.note(m, at, e.dur, velToGain(e.vel));
    }
  }

  note(midi, at, dur, peak) {
    const { ctx } = this;
    const hz = midiToHz(midi);
    const g = ctx.createGain();
    // 立ち上がり 5 ミリ秒 → 鍵盤を押している間に少しずつ減衰 → 離したら RELEASE_SEC で消える
    const end = at + Math.max(dur, 0.05);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.005);
    g.gain.setTargetAtTime(peak * 0.25, at + 0.005, 0.25 + 0.4 * Math.min(dur, 2));
    g.gain.setTargetAtTime(0, end, RELEASE_SEC / 3);
    g.connect(this.out);
    for (const [type, mul, amp] of [['triangle', 1, 1], ['sine', 2, 0.25]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz * mul;
      const a = ctx.createGain();
      a.gain.value = amp;
      o.connect(a).connect(g);
      o.start(at);
      o.stop(end + RELEASE_SEC * 2);
    }
  }

  /**
   * 仮の主旋律の音。笛に近い、伸びる音（正弦波＋少しの三角波）。伴奏より少し大きく、音の終わりまで保つ。
   * 次の音とつながって聞こえるよう、消え方を少し長めにする。
   */
  sing(midi, at, dur, gain) {
    const { ctx } = this;
    const peak = gain * 1.4;
    const end = at + Math.max(dur, 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.03);
    g.gain.setValueAtTime(peak, end - 0.02);
    g.gain.setTargetAtTime(0, end - 0.02, 0.04);
    g.connect(this.out);
    for (const [type, amp] of [['sine', 1], ['triangle', 0.3]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = midiToHz(midi);
      const a = ctx.createGain();
      a.gain.value = amp;
      o.connect(a).connect(g);
      o.start(at);
      o.stop(end + 0.25);
    }
  }

  /** 全部の音を一度に予約する（書き出し用。OfflineAudioContext は時計が動かないので、先読みの仕組みは使わない） */
  scheduleAll(startAt) {
    this.startAt = startAt;
    this.started = true;
    const until = this.ctx.currentTime;
    this.next = 0;
    while (this.next < this.events.length) {
      const e = this.events[this.next++];
      const at = startAt + e.t;
      if (at < until) continue;
      if (e.part === '旋律') this.sing(e.midis[0], at, e.dur, velToGain(e.vel));
      else for (const m of e.midis) this.note(m, at, e.dur, velToGain(e.vel));
    }
  }

  /** 止める。予約した音もすぐ消す */
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(0, now, 0.03);
    setTimeout(() => this.out.disconnect(), 300);
  }
}

// ---- 書き出し（デモ動画の音のため。Gin、2026-11-05）----
// iPhone の画面収録では、Web Audio の音が細かく途切れて録れた（約 21 ミリ秒ごとに、6 割ほどが無音）。
// 画面とは別に、同じ楽譜・同じ音色で音だけを作り、動画の編集でつなぐ。

export const EXPORT_HEAD_SEC = 1; // 書き出しの頭の無音。曲の 0 秒は、ファイルの 1 秒目（編集で合わせやすいように）

/**
 * 音の並びを、OfflineAudioContext で音の形（AudioBuffer）にする。鳴らしている時と同じ UtaAccompaniment を使う。
 * events：accompaniment(score) と melodyEvents(...) を合わせたもの。
 */
export async function renderSong(events, { sampleRate = 48000, OfflineCtx = globalThis.OfflineAudioContext } = {}) {
  const end = Math.max(0, ...events.map((e) => e.t + e.dur));
  const length = Math.ceil((EXPORT_HEAD_SEC + end + 1.5) * sampleRate);
  const ctx = new OfflineCtx({ numberOfChannels: 2, length, sampleRate });
  new UtaAccompaniment(ctx, events).scheduleAll(EXPORT_HEAD_SEC);
  return ctx.startRendering();
}

/** 音の形を 16 ビットの WAV に。channels：Float32Array の配列（左・右） */
export function encodeWav(channels, sampleRate) {
  const nch = channels.length;
  const n = channels[0].length;
  const buf = new ArrayBuffer(44 + n * nch * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * nch * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nch, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nch * 2, true); v.setUint16(32, nch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * nch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return buf;
}
