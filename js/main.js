// 画面のつなぎ：音の入口（試しの音・マイク・曲）→ 読み取り → 描く。

// ?v= は版の番号。push のあとも、ブラウザに残った前の版を使わず新しい版を読ませる（変えたら index.html とそろえて上げる）
import { yin, rmsDb, peakAbs, decimate } from './pitch.js?v=3';
import { Scope } from './draw.js?v=3';
import { decodeFile, makeTestBuffer, playBuffer, playSong } from './source-file.js?v=3';
import { OnsetTracker } from './rhythm.js?v=3';
import { LineSmoother } from './smooth.js?v=3';
import { openMic, describeSettings, MicWatch } from './source-mic.js?v=3';

const $ = (id) => document.getElementById(id);
const scope = new Scope($('scope'));

let audioCtx = null;
let current = null; // { analyser, stop, watch?, rhythm?, yinOpts? }
let lastFrame = null;
let smoothLevel = 0;

/** AudioContext はボタンを押したときに作る・起こす（スマホのブラウザの決まり）。 */
function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state !== 'running') audioCtx.resume();
  return audioCtx;
}

function newAnalyser(ctx, size = 4096) {
  const a = ctx.createAnalyser();
  a.fftSize = size;
  a.smoothingTimeConstant = 0;
  return a;
}

function setNow(text) { $('now-text').textContent = text; }

const LEGEND = {
  line: '上ほど高い音・太いほど大きい音。下の帯は、高さの定まらない音（息・雑音など）の大きさ。右寄りの動かない灰色の縦線が「いま」。',
  rhythm: 'この曲は歌声だけの音がないので、高さの線は出しません。上下の広がりが大きさ、右から流れてくる明るい線が拍の立ち上がり。右寄りの動かない灰色の縦線が「いま」。',
};
function setLegend(mode) { $('legend').textContent = LEGEND[mode]; }
setLegend('line');

function stopCurrent() {
  if (current) current.stop();
  current = null;
  $('song-time').hidden = true;
  shownTime = '';
  $('mic-panel').hidden = true;
  setNow('止まっています');
}

function start(entry, text) {
  if (!entry.rhythm) entry.smoother = new LineSmoother();
  entry.buf = new Float32Array(entry.analyser.fftSize);
  current = entry;
  setLegend(entry.rhythm ? 'rhythm' : 'line');
  setNow(text);
}

// ---- 試しの音 ----
$('btn-test').addEventListener('click', () => {
  stopCurrent();
  const ctx = getCtx();
  const analyser = newAnalyser(ctx);
  const stop = playBuffer(ctx, makeTestBuffer(ctx), analyser, stopCurrent);
  start({ analyser, stop }, '試しの音（ドレミの上り下りと、息のような音）を鳴らしています');
});

// ---- 曲を見る（曲＋歌声だけの音）----
const songInput = $('file-song');
const vocalInput = $('file-vocal');
let songFile = null;
let vocalFile = null;
for (const input of [songInput, vocalInput]) {
  input.addEventListener('click', () => { getCtx(); }); // 選ぶ前に音の処理を起こしておく
}
songInput.addEventListener('change', () => {
  songFile = songInput.files?.[0] || null;
  $('name-song').textContent = songFile ? songFile.name : 'まだ選んでいません';
});
vocalInput.addEventListener('change', () => {
  vocalFile = vocalInput.files?.[0] || null;
  $('name-vocal').textContent = vocalFile ? vocalFile.name : 'なし';
});

/** 曲の欄の知らせ：欄の中と、描く枠の下の両方に出す（押した所から見えるように） */
function songMsg(text) {
  setNow(text);
  $('song-status').textContent = text;
}

$('btn-play').addEventListener('click', async () => {
  stopCurrent();
  if (!songFile) { songMsg('先に「1. 曲」を選んでください'); return; }
  const offset = Number($('vocal-offset').value) || 0;
  songMsg('読み込んでいます…');
  const ctx = getCtx();
  let song, vocal = null;
  try {
    song = await decodeFile(ctx, songFile);
  } catch (e) {
    songMsg(`曲のファイルが読めませんでした（${e.message || e}）`); return;
  }
  if (vocalFile) {
    try {
      vocal = await decodeFile(ctx, vocalFile);
    } catch (e) {
      songMsg(`歌声だけの音のファイルが読めませんでした（${e.message || e}）`); return;
    }
  }
  const songAnalyser = newAnalyser(ctx, 2048);
  // 歌声だけの音は一人の声なので、窓を短く（約 43 ms）、しきい値を少し緩くして、速い動きにもついていく
  const vocalAnalyser = vocal ? newAnalyser(ctx, 2048) : null;
  const startAt = Math.min(Math.max(0, Number($('start-at').value) || 0), Math.max(0, song.duration - 1));
  const { stop, t0 } = playSong(ctx, song, vocal, offset, songAnalyser, vocalAnalyser, stopCurrent, startAt);
  $('song-status').textContent = '鳴らしています（上の枠に描きます）';
  // 押した所から描く枠まで画面を送る
  $('scope').scrollIntoView({ behavior: 'smooth', block: 'start' });
  const clock = { t0, startAt };
  if (vocal) {
    start({ analyser: vocalAnalyser, stop, clock, yinOpts: { threshold: 0.25 } },
      `「${songFile.name}」を鳴らし、歌声だけの音から線を描いています（歌声の頭を ${offset} 秒切っています）`);
  } else {
    start({ analyser: songAnalyser, stop, clock, rhythm: new OnsetTracker(),
      spec: new Float32Array(songAnalyser.frequencyBinCount) },
      `「${songFile.name}」を鳴らしています。歌声だけの音がないので、大きさと拍だけを見せます`);
  }
});

// ---- マイク ----
$('btn-mic').addEventListener('click', async () => {
  stopCurrent();
  const ctx = getCtx();
  const analyser = newAnalyser(ctx);
  try {
    const mic = await openMic(ctx, analyser);
    const watch = new MicWatch(mic.track, ctx);
    showSettings(describeSettings(mic.track));
    $('mic-panel').hidden = false;
    start({ analyser, stop: mic.stop, watch }, 'マイクの音を描いています');
  } catch (e) {
    $('mic-panel').hidden = false;
    $('settings').innerHTML = '';
    setMicState('none', `マイクを開けませんでした（${e.name || ''} ${e.message || ''}）。マイクの許可を確かめてください`, 0);
  }
});

$('btn-stop').addEventListener('click', stopCurrent);

// 画面に触れたら、止まっていた音の処理を起こす
document.addEventListener('pointerdown', () => {
  if (audioCtx && audioCtx.state !== 'running') audioCtx.resume();
});

function showSettings({ rows, extra }) {
  const ul = $('settings');
  ul.innerHTML = '';
  for (const r of rows) {
    const li = document.createElement('li');
    // 意味は字と印で伝える（色に頼らない）
    const mark = r.ok === true ? '✓' : r.ok === false ? '！' : '？';
    li.textContent = `${mark} ${r.label}：${r.state}`;
    ul.appendChild(li);
  }
  $('settings-extra').textContent = extra ? `受け取っている音：${extra}` : '';
}

const MIC_LABEL = {
  none: '✕ 届いていない',
  calibrating: '… 測っています',
  quiet: '○ 静か',
  sound: '● 音あり',
};

let shownState = '';
function setMicState(state, reason, level) {
  const key = state + '|' + reason;
  if (key !== shownState) {
    shownState = key;
    $('mic-state').dataset.state = state;
    $('mic-label').textContent = MIC_LABEL[state];
    $('mic-reason').textContent = reason;
  }
  $('mic-meter-fill').style.transform = `scaleX(${level.toFixed(3)})`;
}

/** 曲の時刻を「00:41」（分：秒）の形で出す。秒が変わったときだけ書き換える。 */
let shownTime = '';
function showSongTime(clock) {
  const sec = Math.max(0, audioCtx.currentTime - clock.t0 + clock.startAt);
  const whole = Math.floor(sec);
  const text = `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
  if (text !== shownTime) {
    shownTime = text;
    $('song-time').textContent = text;
    $('song-time').hidden = false;
  }
}

// ---- 毎コマ：読み取って描く ----
function frame() {
  const now = performance.now() / 1000;
  if (current && audioCtx) {
    const buf = current.buf;
    current.analyser.getFloatTimeDomainData(buf);
    const peak = peakAbs(buf);
    const db = rmsDb(buf);
    if (current.rhythm) {
      const dt = lastFrame === null ? 1 / 60 : Math.min(0.1, now - lastFrame);
      current.analyser.getFloatFrequencyData(current.spec);
      // 立ち上がりは 8 kHz までを見る（それより上は録音ごとの差が大きい）
      const maxBin = Math.round(8000 / (audioCtx.sampleRate / current.analyser.fftSize));
      scope.pushRhythm(now, db, current.rhythm.update(now, current.spec, dt, maxBin));
    } else {
      const factor = Math.max(1, Math.round(audioCtx.sampleRate / 12000));
      const r = db > -60 ? yin(decimate(buf, factor), audioCtx.sampleRate / factor, current.yinOpts) : { hz: null };
      const dt = lastFrame === null ? 1 / 60 : Math.min(0.1, now - lastFrame);
      const sm = current.smoother.push(r.hz, db, dt);
      scope.push(now, sm.hz, sm.db);
    }

    if (current.clock) showSongTime(current.clock);

    if (current.watch) {
      const s = current.watch.update(now, peak, db);
      // 目盛りは、上がるときは速く、下がるときはゆっくり（ちらつかせない）
      const target = Number.isFinite(db) ? Math.min(1, Math.max(0, (db + 80) / 80)) : 0;
      smoothLevel = target > smoothLevel ? smoothLevel + (target - smoothLevel) * 0.5 : smoothLevel + (target - smoothLevel) * 0.08;
      setMicState(s.state, s.reason, smoothLevel);
    }
  }
  lastFrame = now;
  scope.draw(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
