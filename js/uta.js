// 歌モード：曲の一覧 → 曲名を押す → 線が流れる。
// T2b：伴奏を鳴らし、線と歌詞は伴奏の時計に合わせて流す。線の太さは楽譜の強弱（声を入れる T6 までの仮）。
import { parseScore, timeline, accompaniment } from './score.js?v=14';
import { UtaLine, withDynamics } from './uta-line.js?v=14';
import { UtaLyrics } from './uta-lyrics.js?v=14';
import { UtaAccompaniment, melodyEvents } from './uta-audio.js?v=14';

// 音の切れ目は「両方」（すき間＋字を音の頭に。Gin、2026-11-04）。確かめ用：?cut=none|gap|char で、ほかの案に切り替える。
// 下の歌詞のいまの字に下線を付ける（U3。Gin、2026-11-04）。確かめ用：?mark=0 で外す
const params = new URLSearchParams(location.search);
const CUT = params.get('cut') || 'both';
const MARK = params.get('mark') !== '0';
// 仮の主旋律：歌声が入る T6 までは、元の本の旋律の段を柔らかい音で重ねて鳴らす（Gin、2026-11-05「取りあえずこんな感じと父に見せる」）。?melody=0 で消す
const MELODY = params.get('melody') !== '0';
// 確かめ用：?debug=1 で、画面の下に音の仕組みの状態を出す（iPhone の手元で、何が起きているかを見るため）
const DEBUG = params.get('debug') === '1';
const WATCH_SEC = 1.5; // 押してからこの秒数たっても音の時計が進まなければ、伴奏なしで流す

const SONGS = ['songs/furusato.txt', 'songs/haru_no_ogawa.txt'];

const $ = (id) => document.getElementById(id);
const listView = $('list-view');
const playView = $('play-view');
const canvas = $('uta-line');
const status = $('play-status');

let current = null; // { line, lyrics, audio, end, t0, raf }
let audioCtx = null;
const LEAD_SEC = 0.5; // 押してから鳴り始めるまで（音の予約が間に合うように。「まもなく始まります」の 3 秒は T5 で）

/**
 * 伴奏の音の部品。曲名を押すたびに、前のものを閉じて新しく作る（一曲を最後まで流したあと、iPhone では
 * 前の部品が止まったまま起きないことがあったため。Gin、2026-11-05）。
 * iPhone は触った瞬間でないと鳴らせないので、押した処理の中で同期して呼ぶ。返り値：{ ctx, ready（起きたら解決する Promise） }
 */
function getAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  // iPhone は、消音（マナーモード）のとき Web Audio の音が消える。音楽の再生として扱ってもらうと鳴る（Audio Session API。いまは Safari だけ）
  if ('audioSession' in navigator) {
    try { navigator.audioSession.type = 'playback'; } catch { /* 使えない端末では何もしない */ }
  }
  if (audioCtx && audioCtx.state !== 'closed') audioCtx.close().catch(() => {});
  const ctx = new AC({ latencyHint: 'playback' });
  audioCtx = ctx;
  // 押した瞬間に、無音の短い音を一つ鳴らす（iPhone の音の仕組みを確実に起こすため）
  try {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
  } catch { /* 鳴らせなくても先へ進む */ }
  // running でなければ起こす。返事が来ないまま待ち続けないよう、WATCH_SEC で見切る
  const woke = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
  const timeout = new Promise((_, ng) => setTimeout(() => ng(new Error('timeout')), WATCH_SEC * 1000));
  const ready = Promise.race([woke, timeout]);
  if (DEBUG) ctx.onstatechange = () => { status.textContent = `音の仕組み：${ctx.state}`; };
  return { ctx, ready };
}

async function loadSongs() {
  const list = $('song-list');
  for (const file of SONGS) {
    try {
      const res = await fetch(file, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${res.status}`);
      const score = parseScore(await res.text());
      if (score.errors.length) throw new Error(score.errors[0].message);
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'song-button';
      b.textContent = score.title;
      b.addEventListener('click', () => start(score));
      li.append(b);
      list.append(li);
    } catch (e) {
      $('list-status').textContent = `${file} を読めませんでした（${e.message}）`;
    }
  }
}

function start(score) {
  const acc = accompaniment(score);
  const events = withDynamics(timeline(score), acc);
  const ends = [...events, ...acc].map((e) => e.t + e.dur);
  listView.hidden = true;
  playView.hidden = false;
  $('play-title').textContent = score.title;
  $('play-note').textContent = score.meta['添え書き'] ?? '';
  status.textContent = '';
  const line = new UtaLine(canvas, events, { cut: CUT });
  line.fit();
  const lyrics = new UtaLyrics($('lyrics'), events, { markNow: MARK, score });
  current = { line, lyrics, audio: null, end: Math.max(...ends), t0: performance.now() + LEAD_SEC * 1000, raf: 0 };
  // 確かめ用：?t=秒 で、その時刻の絵で止める（写しを撮るため。音は鳴らさない）
  const at = Number(params.get('t'));
  if (at >= 0 && params.has('t')) { line.draw(at); lyrics.update(at); return; }
  // 確かめ用：?from=秒 で、その秒から流す（終わりの所を早く確かめるため）
  const from = Math.max(0, Number(params.get('from')) || 0);
  current.from = from;
  const audio = getAudio();
  if (audio) {
    const me = current;
    const sound = MELODY ? [...acc, ...melodyEvents(events)].sort((a, b) => a.t - b.t) : acc;
    current.audio = new UtaAccompaniment(audio.ctx, sound.filter((e) => e.t >= from));
    me.starting = audio.ready.then(() => {
      if (current !== me) return; // 起きるのを待つあいだに、一覧へ戻った
      me.audio.start(audio.ctx.currentTime + LEAD_SEC - from);
    }).catch(() => giveUp(me));
  } else {
    status.textContent = 'この端末では伴奏を鳴らせません（線と歌詞だけ流します）';
  }
  current.t0 -= from * 1000;
  tick();
}

/** 伴奏が始まらないとき：伴奏なしで、線と歌詞をいまの所から流し続け、どうすればよいかを出す */
function giveUp(c) {
  if (current !== c || !c.audio) return;
  const t = c.audio.started ? c.audio.songTime() : c.from - LEAD_SEC;
  c.audio.stop();
  c.audio = null;
  c.t0 = performance.now() - t * 1000;
  status.textContent = '伴奏が始まりませんでした。一覧へ戻って、もう一度曲名を押してください'
    + (DEBUG ? `（音の仕組み：${audioCtx?.state}）` : '');
}

function tick() {
  const c = current;
  // 見張り：鳴らし始めたのに、音の時計が WATCH_SEC のあいだ進まなければ、伴奏なしに切り替える
  if (c.audio?.started) {
    const now = performance.now();
    const ct = c.audio.ctx.currentTime;
    if (c.lastCt !== ct) { c.lastCt = ct; c.lastMove = now; }
    else if (now - c.lastMove > WATCH_SEC * 1000) giveUp(c);
  }
  if (DEBUG && c.audio) status.textContent = `音の仕組み：${c.audio.ctx.state}　時計：${c.audio.ctx.currentTime.toFixed(1)} 秒`;
  // 伴奏が鳴っていれば、伴奏の時計に合わせる（画面の時計とずれないように）
  // 伴奏が起きるのを待つあいだは、頭の少し前で止めておく
  const t = c.audio ? (c.audio.started ? c.audio.songTime() : c.from - LEAD_SEC) : (performance.now() - c.t0) / 1000;
  c.line.draw(t);
  c.lyrics.update(t);
  if (t > c.end + 1) { status.textContent = 'おしまい'; c.audio?.stop(); return; }
  c.raf = requestAnimationFrame(tick);
}

function back() {
  if (current) { cancelAnimationFrame(current.raf); current.audio?.stop(); }
  current = null;
  playView.hidden = true;
  listView.hidden = false;
}

$('btn-back').addEventListener('click', back);
$('btn-back-portrait').addEventListener('click', back);
// 大きさが変わると、キャンバスは空になる。止まっているときも、最後の時刻で描き直す
window.addEventListener('resize', () => { if (!current) return; current.line.fit(); current.line.draw(current.line.lastT ?? 0); });
loadSongs().then(() => {
  // 確かめ用：?song=番号 で、その曲をすぐ開く
  const n = new URLSearchParams(location.search).get('song');
  if (n !== null) document.querySelectorAll('.song-button')[Number(n)]?.click();
});
