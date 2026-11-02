// マイク：声のための自動処理を切って開き、本当に切れたかを確かめ、
// 「静か」と「届いていない」を見分ける。

const PROCESSING = [
  ['noiseSuppression', '雑音消し'],
  ['autoGainControl', '音量の自動調整'],
  ['echoCancellation', 'エコー消し'],
];

/** マイクを開く。自動処理は 3 つとも切るように頼む。 */
export async function openMic(ctx, analyser) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
  const track = stream.getAudioTracks()[0];
  const src = ctx.createMediaStreamSource(stream);
  src.connect(analyser); // スピーカーにはつながない（ハウリングを防ぐ）
  return {
    track,
    stop() {
      src.disconnect();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

/**
 * 頼んだ設定が本当に効いたかを、track.getSettings() で読む。
 * 端末が報告しないものは「報告しない」とし、「切れた」とは見なさない。
 */
export function describeSettings(track) {
  const s = typeof track.getSettings === 'function' ? track.getSettings() : {};
  const rows = PROCESSING.map(([key, label]) => {
    let state, ok;
    if (!(key in s)) { state = 'この端末は報告しない'; ok = null; }
    else if (s[key] === false) { state = '切れた'; ok = true; }
    else { state = '切れていない'; ok = false; }
    return { label, state, ok };
  });
  const extra = [];
  if (s.sampleRate) extra.push(`${s.sampleRate} Hz`);
  if (s.channelCount) extra.push(`${s.channelCount} ch`);
  return { rows, extra: extra.join('・') };
}

const CALIB_SEC = 2;    // 始めに部屋の静けさを測る時間
const ZERO_SEC = 1;     // 値がまったくの 0 のまま、これだけ続いたら「届いていない」
const ENTER_DB = 8;     // 部屋の静けさより、これだけ大きくなれば「音あり」に入る
const LEAVE_DB = 5;     // これより小さくなれば「静か」に戻る候補（入る・戻るの幅を変え、行き来を抑える）
const HOLD_SEC = 0.4;   // 戻る候補がこれだけ続いたら「静か」に戻す（字をちらつかせない）

/** マイクが生きているかを見張る。 */
export class MicWatch {
  constructor(track, audioCtx) {
    this.track = track;
    this.audioCtx = audioCtx;
    this.start = null;
    this.calib = [];
    this.floor = null;
    this.lastNonZero = null;
    this.trackProblem = null;
    this.loud = false;
    this.belowSince = null;
    track.addEventListener('ended', () => { this.trackProblem = 'マイクが止まりました（ほかのアプリや設定で止められた可能性）'; });
    track.addEventListener('mute', () => { this.trackProblem = 'マイクの音が止められています（ほかのアプリが使っている・端末の設定など）'; });
    track.addEventListener('unmute', () => { this.trackProblem = null; });
    if (track.muted) this.trackProblem = 'マイクの音が止められています（ほかのアプリが使っている・端末の設定など）';
  }

  /**
   * 1 コマごとに呼ぶ。返り値 state：'none'（届いていない）| 'calibrating'（測っている）| 'quiet'（静か）| 'sound'（音あり）
   */
  update(now, peak, db) {
    if (this.start === null) { this.start = now; this.lastNonZero = now; }
    if (peak > 0) this.lastNonZero = now;

    if (this.track.readyState === 'ended') {
      return { state: 'none', reason: 'マイクが止まりました（ほかのアプリや設定で止められた可能性）' };
    }
    if (this.trackProblem) return { state: 'none', reason: this.trackProblem };
    if (this.audioCtx.state !== 'running') {
      return { state: 'none', reason: '音の処理が止まっています。画面のどこかをタップしてください' };
    }
    if (now - this.lastNonZero > ZERO_SEC) {
      return { state: 'none', reason: 'マイクから値が来ていません（ずっと 0）。マイクの許可や、ほかのアプリを確かめてください' };
    }

    if (this.floor === null) {
      if (Number.isFinite(db)) this.calib.push(db);
      if (now - this.start < CALIB_SEC) return { state: 'calibrating', reason: '部屋の静けさを測っています（2 秒）' };
      const sorted = this.calib.slice().sort((a, b) => a - b);
      // 下から 1 割の値を「部屋の静けさ」とする（測る間に誰かが話しても引きずられにくい）
      this.floor = sorted.length ? sorted[Math.floor(sorted.length * 0.1)] : -90;
    }
    if (db > this.floor + ENTER_DB) {
      this.loud = true;
      this.belowSince = null;
    } else if (this.loud && db < this.floor + LEAVE_DB) {
      if (this.belowSince === null) this.belowSince = now;
      if (now - this.belowSince > HOLD_SEC) this.loud = false;
    } else if (this.loud) {
      this.belowSince = null;
    }
    if (this.loud) return { state: 'sound', reason: '' };
    return { state: 'quiet', reason: 'マイクは聞こえています。いまは静かです' };
  }
}
