// 楽譜のテキスト（songs/*.txt）から、耳で確かめるための MIDI ファイルを書き出す。
// 使い方：node tools/score2midi.mjs songs/haru_no_ogawa.txt 出力.mid
// トラック 1 が歌の旋律（音色：フルート）、トラック 2 が伴奏（ピアノ）。構成（前奏・番の並び）のとおりに並べる。
// 楽譜に間違いがあれば、書き出さずに行の番号つきで知らせる。

import { readFileSync, writeFileSync } from 'node:fs';
import { parseScore, timeline, accompaniment } from '../js/score.js';

const TPQ = 480; // 4 分音符 1 つの刻み

function varLen(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

/** [{ tick, data: [バイト…] }] を、MIDI のトラック 1 本のバイト列に */
function track(events) {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body = [];
  let last = 0;
  for (const e of events) {
    body.push(...varLen(e.tick - last), ...e.data);
    last = e.tick;
  }
  body.push(0, 0xff, 0x2f, 0); // トラックの終わり
  const len = body.length;
  return [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body];
}

const name = (text) => [...Buffer.from(text, 'utf8')];

export function scoreToMidi(score) {
  const bpm = Number(score.meta['速さ']);
  const toTick = (sec) => Math.round((sec * bpm * TPQ) / 60);
  const usPerQuarter = Math.round(60000000 / bpm);
  const [num, den] = (score.meta['拍子'] || '4/4').split('/').map(Number);

  const melody = [
    { tick: 0, order: 0, data: [0xff, 0x03, ...varLen(name('歌').length), ...name('歌')] },
    { tick: 0, order: 0, data: [0xff, 0x51, 3, (usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255] },
    { tick: 0, order: 0, data: [0xff, 0x58, 4, num, Math.log2(den), 24, 8] },
    { tick: 0, order: 1, data: [0xc0, 73] }, // フルート
  ];
  for (const e of timeline(score)) {
    if (e.midi === null) continue;
    melody.push({ tick: toTick(e.t), order: 3, data: [0x90, e.midi, 96] });
    melody.push({ tick: toTick(e.t + e.dur) - 1, order: 2, data: [0x80, e.midi, 0] });
  }

  const piano = [
    { tick: 0, order: 0, data: [0xff, 0x03, ...varLen(name('伴奏').length), ...name('伴奏')] },
    { tick: 0, order: 1, data: [0xc1, 0] }, // ピアノ
  ];
  for (const e of accompaniment(score)) {
    for (const m of e.midis) {
      piano.push({ tick: toTick(e.t), order: 3, data: [0x91, m, e.vel] });
      piano.push({ tick: toTick(e.t + e.dur) - 1, order: 2, data: [0x81, m, 0] });
    }
  }

  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, (TPQ >> 8) & 255, TPQ & 255];
  return Uint8Array.from([...header, ...track(melody), ...track(piano)]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [src, dst] = process.argv.slice(2);
  if (!src || !dst) {
    console.error('使い方：node tools/score2midi.mjs 楽譜.txt 出力.mid');
    process.exit(2);
  }
  const score = parseScore(readFileSync(src, 'utf8'));
  if (score.errors.length) {
    for (const e of score.errors) console.error(`${e.lineNo} 行目：${e.message}`);
    process.exit(1);
  }
  writeFileSync(dst, scoreToMidi(score));
  console.log(`書き出しました：${dst}`);
}
