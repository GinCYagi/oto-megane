// 前もって用意した音：端末の中のファイル、またはコードで合成した「試しの音」。
// どちらの音も、この端末の外へは送らない。リポジトリに音のファイルは置かない。

/** 端末の中の音のファイルを読み込む。 */
export async function decodeFile(ctx, file) {
  const data = await file.arrayBuffer();
  return await ctx.decodeAudioData(data);
}

/**
 * 試しの音を合成する（権利の問題がない音）。
 * ドレミファソラシドを上って（だんだん大きく）、下りて（だんだん小さく）、最後に息のような雑音。
 */
export function makeTestBuffer(ctx) {
  const sr = ctx.sampleRate;
  const C4 = 261.63;
  const up = [0, 2, 4, 5, 7, 9, 11, 12];
  const steps = [...up, ...up.slice(0, -1).reverse()];
  const NOTE = 0.45, GAP = 0.05, NOISE = 1.2;
  const total = steps.length * (NOTE + GAP) + 0.3 + NOISE;
  const buf = ctx.createBuffer(1, Math.ceil(total * sr), sr);
  const out = buf.getChannelData(0);

  const fade = Math.floor(0.02 * sr); // 20 ms のフェードでプチ音を防ぐ
  const env = (i, n) => Math.min(1, i / fade, (n - i) / fade);

  let at = 0;
  steps.forEach((semi, k) => {
    const hz = C4 * 2 ** (semi / 12);
    // 上りは -42→-10 dB へ等しい段で大きく、下りはその逆（耳の感じに合わせ dB で刻む）
    const half = up.length - 1;
    const pos = k <= half ? k / half : (steps.length - 1 - k) / half;
    const db = -42 + 32 * pos;
    const amp = 10 ** (db / 20) / 0.523; // 0.523：この音の形の振幅と RMS の比
    const n = Math.floor(NOTE * sr);
    const start = Math.floor(at * sr);
    for (let i = 0; i < n; i++) {
      const t = (2 * Math.PI * hz * i) / sr;
      // 基音に少し倍音を足す（歌の声に少し近づける）
      const v = Math.sin(t) + 0.3 * Math.sin(2 * t) + 0.12 * Math.sin(3 * t);
      out[start + i] = (amp / 1.42) * v * env(i, n);
    }
    at += NOTE + GAP;
  });

  // 息のような雑音（高さの定まらない音の見本）
  at += 0.3;
  const start = Math.floor(at * sr);
  const n = Math.floor(NOISE * sr);
  let seed = 1;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const white = (seed / 0x7fffffff) * 2 - 1;
    prev = prev * 0.6 + white * 0.4; // 少しだけ高い音を丸める
    const swell = Math.sin((Math.PI * i) / n); // ふくらんでしぼむ
    out[start + i] = 0.12 * prev * swell;
  }
  return buf;
}

/**
 * 曲を鳴らし、歌声だけの音を（聞こえないように）同時に流して、それぞれの analyser に通す。
 * offsetSec：歌声だけの音の頭を切る秒（録音の立ち上がりの遅れをそろえる）。負なら歌声を遅らせる。
 * vocalBuffer が null なら、曲だけを鳴らす。止める関数を返す。
 */
export function playSong(ctx, songBuffer, vocalBuffer, offsetSec, songAnalyser, vocalAnalyser, onEnded, startSec = 0) {
  const t0 = ctx.currentTime + 0.1; // 二つを同じ時刻に始めるため、少し先に予約する
  const song = ctx.createBufferSource();
  song.buffer = songBuffer;
  song.connect(songAnalyser);
  songAnalyser.connect(ctx.destination);

  let vocal = null;
  let mute = null;
  if (vocalBuffer) {
    vocal = ctx.createBufferSource();
    vocal.buffer = vocalBuffer;
    // 歌声は聞かせない。音量 0 の出口につなぎ、どのブラウザでも analyser が動くようにする
    mute = ctx.createGain();
    mute.gain.value = 0;
    vocal.connect(vocalAnalyser);
    vocalAnalyser.connect(mute);
    mute.connect(ctx.destination);
  }

  const cleanup = () => {
    for (const n of [song, vocal, songAnalyser, vocalAnalyser, mute]) {
      try { n?.disconnect(); } catch { /* もう外れている */ }
    }
  };
  song.onended = () => {
    try { vocal?.stop(); } catch { /* もう止まっている */ }
    cleanup();
    onEnded?.();
  };

  // startSec：曲のどこから鳴らすか（秒）。歌声は「曲の時刻＋頭を切る秒」の所から鳴らす
  song.start(t0, startSec);
  if (vocal) {
    const v = startSec + offsetSec;
    if (v >= 0) vocal.start(t0, v);
    else vocal.start(t0 - v);
  }
  const stop = () => {
    song.onended = null;
    for (const n of [song, vocal]) {
      try { n?.stop(); } catch { /* もう止まっている */ }
    }
    cleanup();
  };
  // 曲の時刻（秒）を出すために、始めた時刻と位置も返す
  return { stop, t0, startSec };
}

/** 音を鳴らしながら analyser に通す。止める関数を返す。 */
export function playBuffer(ctx, audioBuffer, analyser, onEnded) {
  const src = ctx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(analyser);
  analyser.connect(ctx.destination);
  src.onended = () => {
    analyser.disconnect();
    onEnded?.();
  };
  src.start();
  return () => {
    src.onended = null;
    try { src.stop(); } catch { /* もう止まっている */ }
    src.disconnect();
    analyser.disconnect();
  };
}
