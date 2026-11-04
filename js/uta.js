// 歌モード：曲の一覧 → 曲名を押す → 線が流れる。
// T2：声と伴奏はまだ鳴らさず、楽譜の速さのまま線を流す（太さは一定）。
import { parseScore, timeline } from './score.js?v=5';
import { UtaLine } from './uta-line.js?v=5';

const SONGS = ['songs/furusato.txt', 'songs/haru_no_ogawa.txt'];

const $ = (id) => document.getElementById(id);
const listView = $('list-view');
const playView = $('play-view');
const canvas = $('uta-line');
const status = $('play-status');

let current = null; // { line, events, end, t0, raf }

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
  const events = timeline(score);
  const last = events[events.length - 1];
  listView.hidden = true;
  playView.hidden = false;
  $('play-title').textContent = score.title;
  status.textContent = '';
  const line = new UtaLine(canvas, events);
  line.fit();
  current = { line, end: last.t + last.dur, t0: performance.now(), raf: 0 };
  // 確かめ用：?t=秒 で、その時刻の絵で止める（写しを撮るため）
  const at = Number(new URLSearchParams(location.search).get('t'));
  if (at >= 0 && new URLSearchParams(location.search).has('t')) { line.draw(at); return; }
  tick();
}

function tick() {
  const c = current;
  const t = (performance.now() - c.t0) / 1000;
  c.line.draw(t);
  if (t > c.end + 1) { status.textContent = 'おしまい'; return; }
  c.raf = requestAnimationFrame(tick);
}

function back() {
  if (current) cancelAnimationFrame(current.raf);
  current = null;
  playView.hidden = true;
  listView.hidden = false;
}

$('btn-back').addEventListener('click', back);
// 大きさが変わると、キャンバスは空になる。止まっているときも、最後の時刻で描き直す
window.addEventListener('resize', () => { if (!current) return; current.line.fit(); current.line.draw(current.line.lastT ?? 0); });
loadSongs().then(() => {
  // 確かめ用：?song=番号 で、その曲をすぐ開く
  const n = new URLSearchParams(location.search).get('song');
  if (n !== null) document.querySelectorAll('.song-button')[Number(n)]?.click();
});
