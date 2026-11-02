// 画面のつなぎ：音の入口（試しの音・ファイル・マイク）→ 読み取り → 描く。

import { yin, rmsDb, peakAbs, decimate } from './pitch.js';
import { Scope } from './draw.js';
import { decodeFile, makeTestBuffer, playBuffer } from './source-file.js';
import { openMic, describeSettings, MicWatch } from './source-mic.js';

const $ = (id) => document.getElementById(id);
const scope = new Scope($('scope'));

let audioCtx = null;
let current = null; // { analyser, stop, watch? }
let buf = null;
let smoothLevel = 0;

/** AudioContext はボタンを押したときに作る・起こす（スマホのブラウザの決まり）。 */
function getCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state !== 'running') audioCtx.resume();
  return audioCtx;
}

function newAnalyser(ctx) {
  const a = ctx.createAnalyser();
  a.fftSize = 4096;
  a.smoothingTimeConstant = 0;
  buf = new Float32Array(a.fftSize);
  return a;
}

function setNow(text) { $('now-text').textContent = text; }

function stopCurrent() {
  if (current) current.stop();
  current = null;
  $('mic-panel').hidden = true;
  setNow('止まっています');
}

function start(entry, text) {
  current = entry;
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

// ---- 音のファイル ----
const fileInput = $('file-input');
fileInput.addEventListener('click', () => { getCtx(); }); // 選ぶ前に音の処理を起こしておく
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  stopCurrent();
  setNow('読み込んでいます…');
  try {
    const ctx = getCtx();
    const audio = await decodeFile(ctx, file);
    const analyser = newAnalyser(ctx);
    const stop = playBuffer(ctx, audio, analyser, stopCurrent);
    start({ analyser, stop }, `ファイル「${file.name}」を鳴らしています`);
  } catch (e) {
    setNow(`このファイルは読めませんでした（${e.message || e}）`);
  } finally {
    fileInput.value = ''; // 同じファイルをもう一度選べるように
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

// ---- 毎コマ：読み取って描く ----
function frame() {
  const now = performance.now() / 1000;
  if (current && audioCtx) {
    current.analyser.getFloatTimeDomainData(buf);
    const peak = peakAbs(buf);
    const db = rmsDb(buf);
    const factor = Math.max(1, Math.round(audioCtx.sampleRate / 12000));
    const r = db > -60 ? yin(decimate(buf, factor), audioCtx.sampleRate / factor) : { hz: null };
    scope.push(now, r.hz, db);

    if (current.watch) {
      const s = current.watch.update(now, peak, db);
      // 目盛りは、上がるときは速く、下がるときはゆっくり（ちらつかせない）
      const target = Number.isFinite(db) ? Math.min(1, Math.max(0, (db + 80) / 80)) : 0;
      smoothLevel = target > smoothLevel ? smoothLevel + (target - smoothLevel) * 0.5 : smoothLevel + (target - smoothLevel) * 0.08;
      setMicState(s.state, s.reason, smoothLevel);
    }
  }
  scope.draw(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
