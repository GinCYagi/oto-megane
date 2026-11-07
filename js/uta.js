// 歌モード：曲の一覧 → 曲名を押す → 線が流れる。
// T2b：伴奏を鳴らし、線と歌詞は伴奏の時計に合わせて流す。線の太さは楽譜の強弱（声を入れる T6 までの仮）。
import { parseScore, timeline, accompaniment, transposeOf, slowed, instrumentalSpans } from './score.js?v=40';
import { UtaLine, withDynamics, withLineHue } from './uta-line.js?v=40';
import { UtaLyrics } from './uta-lyrics.js?v=40';
import { UtaMap } from './uta-map.js?v=40';
import { initContrastToggle, contrastDebug } from './contrast.js?v=40';
import { UtaAccompaniment, melodyEvents, renderSong, encodeWav, EXPORT_HEAD_SEC } from './uta-audio.js?v=40';

// 音の切れ目は「両方」（すき間＋字を音の頭に。Gin、2026-11-04）。確かめ用：?cut=none|gap|char で、ほかの案に切り替える。
// 下の歌詞のいまの字に下線を付ける（U3。Gin、2026-11-04）。確かめ用：?mark=0 で外す
const params = new URLSearchParams(location.search);
const CUT = params.get('cut') || 'both';
const MARK = params.get('mark') !== '0';
// 仮の主旋律：歌声が入る T6 までは、元の本の旋律の段を柔らかい音で重ねて鳴らす（Gin、2026-11-05「取りあえずこんな感じと父に見せる」）。?melody=0 で消す
const MELODY = params.get('melody') !== '0';
// 確かめ用：?debug=1 で、画面の下に音の仕組みの状態を出す（iPhone の手元で、何が起きているかを見るため）
const DEBUG = params.get('debug') === '1';
// 確かめ用：?minfs=px で、1 行に替える字の大きさ（ONE_ROW_BELOW_PX）を試す
const MINFS = Number(params.get('minfs')) || 0;
// 書き出し：?export=1 で、一覧の曲ごとに「音を WAV で保存」を出す（デモ動画の音を、画面とは別に作るため。Gin、2026-11-05）
const EXPORT = params.get('export') === '1';
// 曲の時計：?clock=1（または ?export=1）で、画面の下に曲の何秒目かを出す。始まる前は「まもなく」、曲の 0 秒で「0 秒」に変わる。
// 画面収録の動画と、書き出した WAV（曲の 0 秒＝ファイルの 1 秒目）の頭を、編集で合わせる目印（Gin、2026-11-05）
const CLOCK = EXPORT || params.get('clock') === '1';
// 画面収録の途切れの確かめ用（2026-11-05）：音の仕組みの作り方を切り替える。
//   ?lat=interactive|balanced|playback（ふだんは playback）／?sr=44100 など（ふだんは端末まかせ）／?session=0（音楽の再生として扱う設定をしない）
const LAT = params.get('lat') || 'playback';
const SR = Number(params.get('sr')) || 0;
const SESSION = params.get('session') !== '0';
// ?debug=1 のとき、音の仕組みの出来事を時刻つきで残す（鳴らなかったあと、一覧へ戻っても見られるように。Gin、11/7）
const audioLog = [];
function logAudio(msg) {
  if (!DEBUG) return;
  audioLog.push(`${(performance.now() / 1000).toFixed(1)}s ${msg}`);
  if (audioLog.length > 14) audioLog.shift();
}
const WATCH_SEC = 1.5; // 押してからこの秒数たっても音の時計が進まなければ、伴奏なしで流す

const SONGS = ['songs/furusato.txt', 'songs/haru_no_ogawa.txt'];

const $ = (id) => document.getElementById(id);
const listView = $('list-view');
const playView = $('play-view');
const canvas = $('uta-line');
const status = $('play-status');
const clock = $('song-clock');
const cue = $('play-cue');
const howCard = $('how-card');
const howWait = $('how-wait');
const HOW_UNTIL_SEC = 1; // 見方の一枚は、最初の歌の音のこの秒数前に消す

let current = null; // { line, lyrics, audio, end, t0, raf }
let audioCtx = null;
// 押してから鳴り始めるまで。「まもなく始まります」と出して約 3 秒待つ（4 章の手順 2。T5）。?lead=秒 で短くできる（確かめ用）
const LEAD_SEC = params.has('lead') ? Math.max(0.5, Number(params.get('lead')) || 0.5) : 3;
const END_BACK_SEC = 4; // 「おしまい」のあと、一覧に戻るまで
let wakeLock = null; // 曲の画面のあいだ、画面が暗くならないように（Screen Wake Lock API）

/**
 * 曲名を押したら全画面にする（ブラウザのアドレス欄が出たり消えたりして、録画で画面の位置がそろわなかったため。Gin、2026-11-06）。
 * 押した処理の中で呼ぶ。全画面にできない端末（iPhone の Safari など）では何もしない
 */
function enterFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req || document.fullscreenElement || document.webkitFullscreenElement) return;
  try {
    const p = req.call(el, { navigationUI: 'hide' });
    if (p && p.catch) p.catch(() => {});
  } catch { /* できなければ今のまま */ }
}
function exitFullscreen() {
  if (!(document.fullscreenElement || document.webkitFullscreenElement)) return;
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  try {
    const p = exit?.call(document);
    if (p && p.catch) p.catch(() => {});
  } catch { /* 抜けられなくても一覧は出す */ }
}

/** 画面を暗くしない。使えない端末・HTTPS でないページでは何もしない（README に、画面の消える時間を延ばす手順を書く） */
async function keepAwake() {
  if (!('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { wakeLock = null; }
}
function letSleep() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}
// ほかのアプリへ移ると、画面を暗くしない約束は自動で外れる。曲の画面に戻ったら、もう一度頼む
// 裏に回ったら（ほかのアプリに移った・画面を消した）、すぐ止める。戻っても自動では鳴らさず、
// 「触ると続きから」と出して待つ（iPhone では触らないと音を起こせないことがあるため。Gin、11/7）
document.addEventListener('visibilitychange', () => {
  const c = current;
  if (!c || c.done) return;
  if (document.visibilityState === 'hidden') { pause(c, 'hidden'); return; }
  keepAwake(); // 画面を暗くしない約束は、見えなくなると外れるので頼み直す
  if (c.paused && c.why === 'hidden') cue.textContent = PAUSE_TEXT.hidden;
});

/**
 * 伴奏の音の部品。曲名を押すたびに、前のものを閉じて新しく作る（一曲を最後まで流したあと、iPhone では
 * 前の部品が止まったまま起きないことがあったため。Gin、2026-11-05）。
 * iPhone は触った瞬間でないと鳴らせないので、押した処理の中で同期して呼ぶ。返り値：{ ctx, ready（起きたら解決する Promise） }
 */
function getAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  // iPhone は、消音（マナーモード）のとき Web Audio の音が消える。音楽の再生として扱ってもらうと鳴る（Audio Session API。いまは Safari だけ）
  if (SESSION && 'audioSession' in navigator) {
    try { navigator.audioSession.type = 'playback'; } catch { /* 使えない端末では何もしない */ }
  }
  if (audioCtx && audioCtx.state !== 'closed') audioCtx.close().catch(() => {});
  const opts = { latencyHint: LAT };
  if (SR) opts.sampleRate = SR;
  let ctx;
  try { ctx = new AC(opts); } catch { ctx = new AC({ latencyHint: LAT }); } // 選べない標本化周波数なら、端末まかせ
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
  if (DEBUG) {
    logAudio(`作った state=${ctx.state} ${ctx.sampleRate}Hz session=${navigator.audioSession?.type ?? 'なし'}`);
    woke.then(() => logAudio(`resume 済み state=${ctx.state}`), (e) => logAudio(`resume 失敗 ${e?.message ?? e}`));
    ready.catch(() => logAudio(`起きるのを ${WATCH_SEC} 秒待ちきれなかった state=${ctx.state}`));
    ctx.onstatechange = () => { logAudio(`state → ${ctx.state}`); status.textContent = `音の仕組み：${ctx.state}`; };
  }
  return { ctx, ready };
}

/** 書き出しの設定（?export=1 のときだけ、一覧の上に出す）：仮の主旋律を WAV に入れるか */
function exportOptions() {
  const label = document.createElement('label');
  label.className = 'key-choice';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.id = 'export-melody';
  box.checked = MELODY;
  label.append(box, '書き出す WAV に仮の主旋律を入れる（外すと伴奏だけ）');
  $('song-list').before(label);
}

/**
 * 書体（Zen Maru Gothic）は、字の組ごとに分けて届く。歌の途中で新しい字が出たときに書体が替わらないよう、
 * 一覧を出す時に、楽譜にある字の分を先に取りに行く。届かなくても、今の書体のまま動く（待たせない）
 */
function preloadFont(text) {
  try { document.fonts?.load('500 1em "Zen Maru Gothic"', text).catch(() => {}); } catch { /* 書体の読み込みを知らないブラウザ */ }
}

async function loadSongs() {
  const list = $('song-list');
  if (EXPORT) exportOptions();
  for (const file of SONGS) {
    try {
      const res = await fetch(file, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${res.status}`);
      const text = await res.text();
      const score = parseScore(text);
      if (score.errors.length) throw new Error(score.errors[0].message);
      preloadFont(text);
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'song-button';
      b.textContent = score.title;
      li.append(b);
      // 高さを選べるのは、「移調」と「元の調」を書いた曲だけ（いまはふるさと。Gin、2026-11-05）。ふだんは移調した高さ
      let orig = null;
      if (transposeOf(score) !== 0 && score.meta['元の調']) {
        const label = document.createElement('label');
        label.className = 'key-choice';
        orig = document.createElement('input');
        orig.type = 'checkbox';
        label.append(orig, `元の本の高さ（${score.meta['元の調']}）で鳴らす`);
        li.append(label);
      }
      // ゆっくり（4 分の 3 の速さ）。どの曲にも一つ。ふだんは元の速さ
      const slowLabel = document.createElement('label');
      slowLabel.className = 'key-choice';
      const slow = document.createElement('input');
      slow.type = 'checkbox';
      const slowText = document.createElement('span');
      slowText.innerHTML = 'ゆっくり（4<ruby>分<rt>ぶん</rt></ruby>の3の<ruby>速<rt>はや</rt></ruby>さ）';
      slowLabel.append(slow, slowText);
      li.append(slowLabel);
      const chosen = () => {
        const sc = orig?.checked ? originalKey(score) : score;
        return slow.checked ? slowed(sc) : sc;
      };
      b.addEventListener('click', () => start(chosen()));
      if (EXPORT) li.append(exportButton(chosen));
      list.append(li);
    } catch (e) {
      $('list-status').textContent = `${file} を読めませんでした（${e.message}）`;
    }
  }
}

/** 書き出しのボタン。鳴らすときと同じ音の並び（伴奏＋仮の主旋律）を WAV にして保存する */
function exportButton(getScore) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'export-button';
  b.textContent = '音を WAV で保存';
  b.addEventListener('click', async () => {
    const score = getScore();
    const st = $('list-status');
    if (!window.OfflineAudioContext) { st.textContent = 'この端末では書き出せません'; return; }
    b.disabled = true;
    st.textContent = `${score.title}：音を作っています…`;
    try {
      const acc = accompaniment(score);
      const events = withDynamics(timeline(score), acc);
      const withMelody = $('export-melody')?.checked ?? MELODY;
      const sound = withMelody ? [...acc, ...melodyEvents(events)].sort((x, y) => x.t - y.t) : acc;
      const buf = await renderSong(sound, { sampleRate: SR || 48000 });
      const wav = encodeWav([buf.getChannelData(0), buf.getChannelData(1)], buf.sampleRate);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      const key = score.keyNote ? '_元の調' : '';
      a.download = `${score.title}${key}${score.slow ? '_ゆっくり' : ''}${withMelody ? '' : '_伴奏のみ'}.wav`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      st.textContent = `${a.download} を保存しました（${buf.sampleRate} Hz・${buf.duration.toFixed(1)} 秒。曲の 0 秒はファイルの ${EXPORT_HEAD_SEC} 秒目）`;
    } catch (e) {
      st.textContent = `書き出せませんでした（${e.message}）`;
    } finally {
      b.disabled = false;
    }
  });
  return b;
}

/** 元の本の高さで鳴らす形（移調を 0 にした写し。楽譜の音はもとから元の本の高さで書いてある） */
function originalKey(score) {
  return { ...score, meta: { ...score.meta, '移調': '0' }, keyNote: `元の本の高さ（${score.meta['元の調']}）` };
}

function start(score) {
  enterFullscreen();
  const acc = accompaniment(score);
  const events = withLineHue(withDynamics(timeline(score), acc));
  const ends = [...events, ...acc].map((e) => e.t + e.dur);
  listView.hidden = true;
  playView.hidden = false;
  $('play-title').textContent = score.title;
  $('play-note').textContent = [score.meta['添え書き'], score.keyNote, score.slow ? 'ゆっくり' : ''].filter(Boolean).join('　');
  status.textContent = '';
  cue.textContent = 'まもなく始まります';
  clock.hidden = !CLOCK;
  clock.textContent = CLOCK ? 'まもなく' : '';
  const line = new UtaLine(canvas, events, { cut: CUT });
  line.fit();
  const lyrics = new UtaLyrics($('lyrics'), events, { markNow: MARK, score, spans: instrumentalSpans(score), ...(MINFS ? { oneRowBelow: MINFS } : {}) });
  const map = new UtaMap($('uta-map'), events, Math.max(...ends), acc);
  map.fit();
  lyrics.fit();
  const firstSing = events.find((e) => e.midi !== null)?.t ?? 0;
  current = { line, lyrics, audio: null, end: Math.max(...ends), t0: performance.now() + LEAD_SEC * 1000, map, raf: 0, howUntil: firstSing - HOW_UNTIL_SEC };
  placeHowCard();
  // 確かめ用：?t=秒 で、その時刻の絵で止める（写しを撮るため。音は鳴らさない）
  const at = Number(params.get('t'));
  if (at >= 0 && params.has('t')) { cue.textContent = ''; line.draw(at); lyrics.update(at); showHow(current, at); map.draw(at); return; }
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
      me.ready = true;
      if (!me.paused) beginAudio(me); // 縦向き・裏に回ったあいだは始めずに待つ（続けるときに始める）
    }).catch(() => giveUp(me));
  } else {
    status.textContent = 'この端末では伴奏を鳴らせません（線と歌詞だけ流します）';
  }
  current.t0 -= from * 1000;
  keepAwake();
  if (isPortrait()) pause(current, 'portrait'); // 縦のあいだは、音を始めずに待つ
  tick();
}

/** 伴奏を鳴らし始める。曲の頭の LEAD_SEC 前から数える（待ったあとも「まもなく始まります」から） */
function beginAudio(c) {
  logAudio(`鳴らし始め state=${c.audio.ctx.state} 時計=${c.audio.ctx.currentTime.toFixed(2)}`);
  c.audio.start(c.audio.ctx.currentTime + LEAD_SEC - c.from);
}

const portraitQuery = window.matchMedia?.('(orientation: portrait)');
function isPortrait() { return !!portraitQuery?.matches; }

/** 見方の一枚を、線の段にぴったり重ねる。知らせの札は線の段の中ほどに */
function placeHowCard() {
  // 知らせの札（「触ると続きから」など）も、線の段の中ほどに置く。地図の帯といまの位置の印を隠さないように（11/7）
  cue.style.top = `${canvas.offsetTop + canvas.offsetHeight / 2}px`;
  // 困ったときの知らせと ?debug=1 の表示は、線の段の上の端に（歌詞の 2 行にかぶらないように。11/7）
  status.style.top = `${canvas.offsetTop}px`;
  if (DEBUG) status.classList.add('debug');
  howCard.style.top = `${canvas.offsetTop}px`;
  howCard.style.height = `${canvas.offsetHeight}px`;
}

/** 見方の一枚：前奏が終わる（歌が始まる約 1 秒前）まで出す。止めているあいだは「とまっています」を見せるため隠す */
function showHow(c, t) {
  const show = !c.paused && !c.done && t < c.howUntil;
  if (howCard.hidden === show) howCard.hidden = !show;
  const wait = t < 0;
  if (howWait.hidden === wait) howWait.hidden = !wait;
  return show;
}

/**
 * 止める（4 章の手順 3 の仕組み）。why：'tap'（触った）・'portrait'（縦になった）・'hidden'（裏に回った）。
 * 止めている理由は一つだけ持つ。あとから来た理由で上書きする（縦のまま裏に回ったら、戻っても触るまで待つ）。
 */
const PAUSE_TEXT = { tap: 'とまっています（触ると続き）', portrait: 'とまっています（触ると続き）', hidden: '触ると続きから' };
function pause(c, why) {
  if (c.done) return;
  if (!c.paused) {
    const now = performance.now();
    c.paused = true;
    if (c.audio && !c.audio.started) c.pausedT = c.from - LEAD_SEC; // まだ鳴らし始めていない：頭の前で待つ
    else c.pausedT = c.audio ? c.audio.songTime() : (now - c.t0) / 1000;
    if (c.audio?.started) c.audio.ctx.suspend().catch(() => {});
  }
  c.why = why;
  cue.textContent = PAUSE_TEXT[why];
}

/** 続きから。触った処理の中で呼べば、iPhone でも音を起こせる */
function resume(c) {
  if (c.done || !c.paused) return;
  const now = performance.now();
  c.paused = false;
  c.why = null;
  cue.textContent = '';
  if (c.audio) {
    if (!c.audio.started) {
      // 縦のまま始まりを待っていた：いま鳴らし始める（音の部品が起きるのを待っているなら、起きたときに始まる）
      c.audio.ctx.resume().catch(() => {});
      if (c.ready) beginAudio(c);
      return;
    }
    // 起きなければ、見張りが伴奏なしに切り替える
    c.lastMove = now;
    c.lastCt = undefined;
    logAudio(`続ける state=${c.audio.ctx.state}`);
    c.audio.ctx.resume().catch(() => giveUp(c));
  } else {
    c.t0 = now - c.pausedT * 1000;
  }
}

/** 画面に触ると止まる。もう一度触ると、続きから（4 章の手順 3） */
function togglePause(c) {
  if (c.done) return;
  if (c.paused) { resume(c); return; }
  if (c.audio && !c.audio.started) return; // 鳴り始める前は止めない
  pause(c, 'tap');
}

// 縦になったら止め、横に戻ったら続きから（触らずに起こす）。
// 触らずに起こせない端末（iPhone で起きないことがある）では、「触ると続き」と出して待つ
portraitQuery?.addEventListener?.('change', () => {
  const c = current;
  if (!c || c.done) return;
  if (isPortrait()) { if (!c.paused || c.why === 'tap') pause(c, 'portrait'); return; }
  if (!(c.paused && c.why === 'portrait')) return;
  resume(c);
  const ctx = c.audio?.ctx;
  if (!ctx) return;
  setTimeout(() => {
    if (current !== c || c.paused || c.done || ctx.state === 'running') return;
    // 起きなかった：止めた形に戻して、触るのを待つ
    c.paused = true;
    c.pausedT = c.audio?.started ? c.audio.songTime() : c.from - LEAD_SEC;
    c.why = 'tap';
    cue.textContent = PAUSE_TEXT.tap;
  }, 600);
});

/** 伴奏が始まらないとき：伴奏なしで、線と歌詞をいまの所から流し続け、どうすればよいかを出す */
function giveUp(c) {
  if (current !== c || !c.audio) return;
  logAudio(`伴奏なしに切り替え state=${c.audio.ctx.state} 時計=${c.audio.ctx.currentTime.toFixed(2)}`);
  const t = c.paused ? c.pausedT : c.audio.started ? c.audio.songTime() : c.from - LEAD_SEC;
  c.audio.stop();
  c.audio = null;
  c.t0 = performance.now() - t * 1000;
  // 始まらなかったと分かったら、「触ると続きから」などの札は下げ、知らせだけにする（案内が食い違わないように。11/7 Gin）。
  // 線と歌詞は、伴奏なしでいまの所から流し続ける
  c.paused = false;
  c.why = null;
  cue.textContent = '';
  status.textContent = '伴奏が始まりませんでした。一覧へ戻って、もう一度曲名を押してください'
    + (DEBUG ? `（音の仕組み：${audioCtx?.state}）` : '');
}

function tick() {
  const c = current;
  // 見張り：鳴らし始めたのに、音の時計が WATCH_SEC のあいだ進まなければ、伴奏なしに切り替える
  if (c.audio?.started && !c.paused) {
    const now = performance.now();
    const ct = c.audio.ctx.currentTime;
    if (c.lastCt !== ct) { c.lastCt = ct; c.lastMove = now; }
    else if (now - c.lastMove > WATCH_SEC * 1000) giveUp(c);
  }
  if (DEBUG && c.audio) {
    const x = c.audio.ctx;
    status.textContent = `${lyricGapText()}画面：${wakeLock ? '暗くしない' : 'ふつう'}　音の仕組み：${x.state}　時計：${x.currentTime.toFixed(1)} 秒　${x.sampleRate} Hz　遅れ ${((x.baseLatency || 0) * 1000).toFixed(1)}+${((x.outputLatency || 0) * 1000).toFixed(1)} ms　${LAT}${SESSION ? '' : '　session=0'}　${audioLog.slice(-2).join('　')}`;
  }
  // 伴奏が鳴っていれば、伴奏の時計に合わせる（画面の時計とずれないように）
  // 伴奏が起きるのを待つあいだは、頭の少し前で止めておく
  const t = c.paused ? c.pausedT
    : c.audio ? (c.audio.started ? c.audio.songTime() : c.from - LEAD_SEC) : (performance.now() - c.t0) / 1000;
  const how = showHow(c, t);
  if (!c.paused) {
    const msg = t < 0 && !how ? 'まもなく始まります' : ''; // 一枚を出しているときは、一枚の中に出す
    if (cue.textContent !== msg) cue.textContent = msg;
  }
  c.line.draw(t);
  c.map.draw(t);
  c.lyrics.update(t);
  if (CLOCK) {
    const txt = t < 0 ? 'まもなく' : `${Math.floor(t)} 秒`;
    if (clock.textContent !== txt) clock.textContent = txt;
  }
  if (t > c.end + 1) {
    // おしまい：数秒たつと、一覧に戻る（4 章の手順 4）
    c.done = true;
    cue.textContent = 'おしまい';
    c.lyrics.finish(); // 下に残る「（後奏）」は消す
    c.audio?.stop();
    letSleep();
    setTimeout(() => { if (current === c) back(); }, END_BACK_SEC * 1000);
    return;
  }
  c.raf = requestAnimationFrame(tick);
}

function back() {
  if (current) { cancelAnimationFrame(current.raf); current.audio?.stop(); }
  current = null;
  cue.textContent = '';
  howCard.hidden = true;
  exitFullscreen();
  letSleep();
  playView.hidden = true;
  listView.hidden = false;
  renderListDebug();
}

/** ?debug=1：歌詞のいまの行の字の下と、次の行のルビの上のすき間（px）。マイナスなら重なっている。0.5 秒ごとに測る */
let gapAt = 0, gapText = '';
function lyricGapText() {
  const now = performance.now();
  if (now - gapAt < 500) return gapText;
  gapAt = now;
  const a = document.querySelector('.lyric[data-pos="now"]'), b = document.querySelector('.lyric[data-pos="next"]');
  if (!a) { gapText = ''; return gapText; }
  const bottom = Math.max(...[...a.querySelectorAll('.syl')].map((e) => e.getClientRects()[0]?.bottom ?? -Infinity));
  const tops = b ? [...b.querySelectorAll('rt, .syl')].map((e) => e.getClientRects()[0]?.top ?? Infinity) : [];
  const f = current?.lyrics.fitInfo;
  const px = (v) => `${Math.round(v * 10) / 10}px`;
  const rowsText = f ? `歌詞 ${f.rows} 行・字 ${px(f.fs)}（2 行なら ${px(f.fs2)}・1 行なら ${px(f.fs1)}、1 行にするのは 2 行で ${current.lyrics.oneRowBelow}px 未満、欄の高さ ${f.H}px・画面 ${innerWidth}×${innerHeight}）　` : '';
  // 次の行がない（後奏のあいだなど）か、字がまだ並んでいないときは「—」
  const g = Math.min(...tops) - bottom;
  gapText = `${rowsText}行の間 ${Number.isFinite(g) ? `${Math.round(g)}px` : '—'}　`;
  return gapText;
}

/** ?debug=1：一覧の下に、白黒（くっきり）の決まりの材料と、音の仕組みの記録を出す（曲を始める前にも見られるように） */
const debugInfo = document.getElementById('debug-info');
function renderListDebug() {
  if (!DEBUG || !debugInfo) return;
  const c = contrastDebug();
  debugInfo.hidden = false;
  debugInfo.textContent = [
    `localStorage oto-megane-contrast：${c.stored}`,
    `matchMedia('(prefers-contrast: more)')：${c.contrastMore}`,
    `matchMedia('(forced-colors: active)')：${c.forcedColors}`,
    `data-contrast：${c.dataContrast}`,
    `音の仕組み（いま）：${audioCtx?.state ?? 'まだ作っていない'}`,
    '音の仕組みの記録：',
    ...(audioLog.length ? audioLog : ['（まだない）']),
  ].join('\n');
}
if (DEBUG) setInterval(() => { if (!listView.hidden) renderListDebug(); }, 1000);

$('btn-back').addEventListener('click', back);
$('btn-back-portrait').addEventListener('click', back);
// 曲の画面のどこかに触ると、止める／続ける（ボタンと、縦向きの案内の上は除く）
playView.addEventListener('click', (e) => {
  if (!current || e.target.closest('button, .rotate-note')) return;
  togglePause(current);
});
// 大きさが変わると、キャンバスは空になる。止まっているときも、最後の時刻で描き直す
window.addEventListener('resize', () => { if (!current) return; placeHowCard(); current.map.fit(); current.map.draw(current.line.lastT ?? 0); current.line.fit(); current.line.draw(current.line.lastT ?? 0); current.lyrics.fit(); });
// 書体が届くと字の高さが変わるので、歌詞の欄を合わせ直す
document.fonts?.addEventListener?.('loadingdone', () => current?.lyrics.fit());
loadSongs().then(() => {
  // 確かめ用：?song=番号 で、その曲をすぐ開く
  const n = new URLSearchParams(location.search).get('song');
  if (n !== null) document.querySelectorAll('.song-button')[Number(n)]?.click();
});

// 見やすさ：白黒（くっきり）の切り替え（T18）。色は曲を始めるときに読むので、一覧で替えれば次の曲から効く
const contrastToggle = document.getElementById('contrast-toggle');
// 白黒（くっきり）が替わったら（押したとき・端末の設定が替わったとき）、曲の途中でも線の画面と帯をその場で描き直し、ページの色とそろえる（11/7）
function onContrastChange() {
  renderListDebug();
  if (!current) return;
  const t = current.line.lastT ?? 0;
  current.line.refreshColors();
  current.map.refreshColors();
  current.line.fit();
  current.line.draw(t);
  current.map.draw(t);
}
if (contrastToggle) initContrastToggle(contrastToggle, onContrastChange);
renderListDebug();
