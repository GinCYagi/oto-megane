// 楽譜のデータ（songs/*.txt）を読む。書き方は docs/spec_uta.md の 5 章。
// 画面やブラウザの機能には触れない、字と数だけの関数。node --test で確かめられる。
//
// 読んだ結果：
//   { title, meta, form, melody: [行…], intros: { 前奏: { parts, slowTo, slowFrom } }, verses: [{ name, lines }], errors: [{ lineNo, message }] }
//   melody の行：{ notes, parts: { 右手: [音…], 左手: [音…], … }, lineNo }
//   音：{ midi, midis, beats, dyn }。休符は midi: null・midis: []。和音は midis に全部、midi は一番上の音。
//       beats は 4 分音符を 1 とした長さ。dyn はその音の前に書いた強弱（なければ null）。
//   番の行：{ notes, syllables: [{ text, ruby }], orig, disp, lineNo }。ruby は読みが字と違うときだけ入る。
//     orig：「元:」（元の本の表記、音ごと）。disp：「字:」（画面の歌詞。漢字＋ルビ）を区切ったもの [{ text, ruby, read, space }]。
// 「移調:」（半音いくつ上げ下げするか）は、読んだ音には掛けない（楽譜は元の本の高さのまま）。
// 鳴らす時刻を並べる timeline・accompaniment で掛ける。
// 間違いがあっても止めずに読み進め、行の番号を付けて errors に集める（打った人が一度に直せるように）。

const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DUR = new Set([1, 2, 4, 8, 16]);
const META_KEYS = ['作詞', '作曲', '出典', '拍子', '速さ', '構成', '移調', '元の調', '添え書き']; // 添え書き：曲の画面で、曲名のそばに小さく出す。元の調：移調した曲で、元の本の高さを選ぶ切り替えの名前に使う
const INSTRUMENTAL = new Set(['前奏', '間奏', '後奏']); // 歌のない、伴奏だけの部分
const PART_RE = /^(右手|左手)\d?$/;                       // 伴奏の声部：右手・右手2・左手・左手2 …
export const DYNAMICS = { pp: 40, p: 55, mp: 70, mf: 85, f: 100, ff: 115 }; // 強弱 → 鍵盤の強さ（MIDI の velocity）
export const HOLD = 'ー'; // 一つの字を伸ばして、二つ目からの音に当てる印

/** 「F#4」「Bb4」「C5」を MIDI の番号に（C4 = 60）。読めなければ null。 */
export function noteToMidi(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) return null;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + NOTE_BASE[m[1]] + acc;
}

/** 「4」「4.」「8」を、4 分音符を 1 とした長さに。読めなければ null。 */
function durToBeats(text) {
  const m = /^(\d+)(\.?)$/.exec(text);
  if (!m || !DUR.has(Number(m[1]))) return null;
  const beats = 4 / Number(m[1]);
  return m[2] ? beats * 1.5 : beats;
}

/** 「3/4」→ 1 小節が 4 分音符いくつ分か（3）。「6/8」→ 3。読めなければ null。 */
export function barBeats(sig) {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(sig || '');
  return m ? (Number(m[1]) * 4) / Number(m[2]) : null;
}

/**
 * 音の 1 行を読む。返り値：{ notes, error }。
 * 一つの音：「F4:4」。付点：「G4:4.」。休符：「R:8」。タイ：「F4:4~F4:8」（同じ高さをつないで一つの音）。
 * 和音：「C4+E4+G4:4」。小節の区切り：「/」（bar を渡すと、どの小節も bar 拍あるかを確かめる）。
 * 強弱：「mf」などを音の前に一語で。「<」「>」は読み飛ばす。
 * 小節をまたぐタイ：音の後ろに「~」を付けると、次の音（同じ高さ）とつないで一つの音にする（例「E5:1~ / E5:2」）。
 */
export function parseNotes(text, { bar = null, chords = true } = {}) {
  const notes = [];
  let dyn = null;
  let inBar = 0;
  let barNo = 1;
  const bars = [];
  let tieOpen = false; // 前の音が「~」で終わり、次の音とつなぐ
  for (const raw of text.split(/[\s　]+/).filter(Boolean)) {
    const tieNext = raw.endsWith('~');
    const token = tieNext ? raw.slice(0, -1) : raw;
    if (token === '/') { bars.push([barNo, inBar]); barNo++; inBar = 0; continue; }
    if (token === '<' || token === '>') continue;
    if (token in DYNAMICS) { dyn = token; continue; }
    let midis;
    let beats = 0;
    for (const part of token.split('~')) {
      const m = /^([^:]+):(.+)$/.exec(part);
      if (!m) return { notes, error: `「${token}」が読めません（「F4:4」のように、音名:長さ で書きます）` };
      const b = durToBeats(m[2]);
      if (b === null) return { notes, error: `「${token}」の長さ「${m[2]}」が読めません（1・2・4・8・16、付点は後ろに「.」）` };
      let mm = [];
      if (m[1] !== 'R') {
        const names = m[1].split('+');
        if (names.length > 1 && !chords) return { notes, error: `「${token}」：歌の旋律に和音は書けません` };
        mm = names.map(noteToMidi);
        const badIdx = mm.indexOf(null);
        if (badIdx >= 0) return { notes, error: `「${token}」の音名「${names[badIdx]}」が読めません（「C4」「F#4」「Bb4」のように書きます）` };
        mm.sort((a, b2) => a - b2);
      }
      if (midis !== undefined && mm.join() !== midis.join()) return { notes, error: `「${token}」のタイが、違う高さをつないでいます` };
      midis = mm;
      beats += b;
    }
    inBar += beats;
    if (tieOpen) {
      const prev = notes.at(-1);
      if (prev.midis.join() !== midis.join()) return { notes, error: `「${token}」：前の音から「~」でつないでいますが、高さが違います` };
      prev.beats += beats;
    } else {
      notes.push({ midi: midis.length ? midis.at(-1) : null, midis, beats, dyn });
    }
    dyn = null;
    tieOpen = tieNext;
  }
  if (tieOpen) return { notes, error: '行の最後の音が「~」で終わっています（次の音がありません）' };
  if (inBar > 0) bars.push([barNo, inBar]);
  if (bar && bars.length > 1) {
    const bad = bars.filter(([, b]) => Math.abs(b - bar) > 1e-9);
    if (bad.length) return { notes, error: bad.map(([n, b]) => `${n} 小節目が ${b} 拍です（${bar} 拍のはず）`).join('、') };
  }
  return { notes, error: null };
}

const sumBeats = (notes) => notes.reduce((s, n) => s + n.beats, 0);

/** 「詞:」「読:」の 1 行を「|」で区切る。全角の「｜」も受け付ける。 */
function splitSyllables(text) {
  return text.split(/[|｜]/).map((s) => s.trim());
}

/** 「作詞: 〜」「拍子：3/4」のような行。全角のコロンも受け付ける。 */
function keyValue(line) {
  const m = /^([^:：]+)[:：]\s*(.*)$/.exec(line);
  return m ? { key: m[1].trim(), value: m[2].trim() } : null;
}

const KANJI = /[\u3400-\u9fff\uf900-\ufaff々〆ヶ]/;

/**
 * 「字:」の行（例：兎(うさぎ)追(お)いし　かの山(やま)）を区切る。漢字の後ろの（）がルビ。
 * 返り値：{ segs: [{ text, ruby, read, space }], reading, error }。read はその区切りの読み（かな）。
 * 漢字にルビがなければ error（漢字には一つ残らずルビを付ける決まり）。
 */
export function parseDisplay(value) {
  const segs = [];
  let error = null;
  const re = /([\u3400-\u9fff\uf900-\ufaff々〆ヶ]+)[(（]([^)）]+)[)）]|([\s　]+)|(.)/gu;
  for (const m of value.trim().matchAll(re)) {
    if (m[1]) segs.push({ text: m[1], ruby: m[2], read: m[2], space: false });
    else if (m[3]) segs.push({ text: '　', ruby: null, read: '', space: true });
    else {
      if (KANJI.test(m[4])) error ??= `「${m[4]}」にルビがありません（漢字の後ろに（よみ）を書きます）`;
      if ('()（）'.includes(m[4])) error ??= `かっこ「${m[4]}」の前に漢字がありません`;
      segs.push({ text: m[4], ruby: null, read: m[4], space: false });
    }
  }
  return { segs, reading: segs.map((s) => s.read).join(''), error };
}

export function parseScore(text) {
  const out = { title: '', meta: {}, form: [], melody: [], intros: {}, verses: [], errors: [] };
  const err = (lineNo, message) => out.errors.push({ lineNo, message });
  let bar = null;

  let section = null;      // '旋律'・前奏などの名前・番の名前
  let verse = null;
  let intro = null;        // 前奏など：{ parts, lineNo }
  let pendingNotes = null; // 番の中で、次の「詞:」の旋律を上書きする「音:」
  let pendingNotesLine = 0;
  let pendingWords = null; // 「読:」を待っている「詞:」

  let pendingOrig = null;  // 次の「詞:」に添える「元:」
  const flushWords = () => {
    if (!pendingWords) return;
    const p = pendingWords;
    pendingWords = null;
    finishLine(p);
  };

  const finishLine = (p) => {
    const { readings, readLineNo } = p;
    const n = verse.lines.length; // この番の何行目か（0 から）
    const notes = p.notes ?? out.melody[n]?.notes;
    if (!notes) {
      err(p.lineNo, `${verse.name}の ${n + 1} 行目の詞に当たる旋律がありません（[旋律] は ${out.melody.length} 行です）`);
      verse.lines.push({ notes: [], syllables: [], lineNo: p.lineNo });
      return;
    }
    const sung = notes.filter((x) => x.midi !== null).length;
    if (p.words.length !== sung) {
      err(p.lineNo, `${verse.name}の ${n + 1} 行目：詞は ${p.words.length} 個、休符を除いた音は ${sung} 個で、数が合いません`);
    }
    if (readings && readings.length !== p.words.length) {
      err(readLineNo, `${verse.name}の ${n + 1} 行目：読は ${readings.length} 個、詞は ${p.words.length} 個で、数が合いません`);
    }
    if (p.orig && p.orig.words.length !== p.words.length) {
      err(p.orig.lineNo, `${verse.name}の ${n + 1} 行目：元は ${p.orig.words.length} 個、詞は ${p.words.length} 個で、数が合いません`);
    }
    let disp = null;
    if (p.disp) {
      const d = parseDisplay(p.disp.value);
      if (d.error) err(p.disp.lineNo, `${verse.name}の ${n + 1} 行目の字：${d.error}`);
      const sung = p.words.filter((w) => w !== HOLD).join('');
      if (!d.error && d.reading !== sung) {
        err(p.disp.lineNo, `${verse.name}の ${n + 1} 行目：字の読み「${d.reading}」と、詞「${sung}」が合いません`);
      }
      disp = d.segs;
    }
    const syllables = p.words.map((w, i) => {
      const r = readings?.[i];
      return { text: w, ruby: r && r !== w && w !== HOLD ? r : null };
    });
    verse.lines.push({ notes, syllables, orig: p.orig?.words ?? null, disp, lineNo: p.lineNo });
  };

  const closeSection = () => {
    if (verse) flushWords();
    if (pendingNotes) { err(pendingNotesLine, '上書きの「音:」のあとに「詞:」がありません'); pendingNotes = null; }
    if (pendingOrig) { err(pendingOrig.lineNo, '「元:」のあとに「詞:」がありません'); pendingOrig = null; }
  };

  /** 伴奏の 1 行（右手: 左手2: など）を、いまの行に足す。長さが合うかも確かめる。 */
  const addPart = (target, key, value, lineNo, expectBeats, where) => {
    const r = parseNotes(value, { bar });
    if (r.error) err(lineNo, `${key}：${r.error}`);
    if (target[key]) err(lineNo, `${where}に「${key}:」が 2 回あります（別の声部は「${key.replace(/\d$/, '')}2:」のように番号を付けます）`);
    target[key] = r.notes;
    const got = sumBeats(r.notes);
    if (!r.error && expectBeats !== null && Math.abs(got - expectBeats) > 1e-9) {
      err(lineNo, `${key}：長さが ${got} 拍で、${where}の ${expectBeats} 拍と合いません`);
    }
  };

  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line || line.startsWith('//')) return; // 空の行と、「//」で始まるメモの行は読み飛ばす

    if (line.startsWith('# ')) { out.title = line.slice(2).trim(); return; }

    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      closeSection();
      section = sec[1].trim();
      verse = null;
      intro = null;
      if (INSTRUMENTAL.has(section)) {
        intro = { parts: {}, lineNo };
        out.intros[section] = intro;
      } else if (section !== '旋律') {
        if (!out.melody.length) err(lineNo, '[旋律] より前に番があります（[旋律] を先に書きます）');
        verse = { name: section, lines: [] };
        out.verses.push(verse);
      }
      return;
    }

    const kv = keyValue(line);
    if (!kv) { err(lineNo, `この行が読めません：「${line}」`); return; }

    if (section === null) {
      if (!META_KEYS.includes(kv.key)) { err(lineNo, `「${kv.key}」は知らない項目です（${META_KEYS.join('・')} のどれか）`); return; }
      out.meta[kv.key] = kv.value;
      if (kv.key === '拍子') {
        bar = barBeats(kv.value);
        if (bar === null) err(lineNo, `拍子「${kv.value}」が読めません（「4/4」のように書きます）`);
      }
      if (kv.key === '構成') out.form = kv.value.split(/[\s　]+/).filter(Boolean);
      return;
    }

    if (intro) {
      if (kv.key === 'だんだん遅く') {
        const m = kv.value.trim().match(/^(?:(\d+)\s*小節目から[\s　]*)?(\d+)\s*[%％]$/);
        const pct = m ? Number(m[2]) : NaN;
        if (!(pct >= 30 && pct < 100)) { err(lineNo, '「だんだん遅く:」は、終わりの速さを元の速さの何 % かで書きます（30〜99%、例：70%、3 小節目から 70%）'); return; }
        const fromBar = m[1] ? Number(m[1]) : 1;
        if (fromBar < 1 || (fromBar > 1 && !bar)) { err(lineNo, '「だんだん遅く:」の小節は 1 からで、「拍子:」が要ります'); return; }
        intro.slowTo = pct / 100;
        intro.slowFrom = (fromBar - 1) * (bar || 0);
        return;
      }
      if (!PART_RE.test(kv.key)) { err(lineNo, `[${section}] の中には「右手:」「左手:」などの伴奏の行だけを書きます`); return; }
      const first = Object.values(intro.parts)[0];
      addPart(intro.parts, kv.key, kv.value, lineNo, first ? sumBeats(first) : null, `[${section}]`);
      return;
    }

    if (section === '旋律') {
      if (kv.key === '音') {
        const r = parseNotes(kv.value, { bar, chords: false });
        if (r.error) err(lineNo, r.error);
        out.melody.push({ notes: r.notes, parts: {}, lineNo });
      } else if (PART_RE.test(kv.key)) {
        const ml = out.melody.at(-1);
        if (!ml) { err(lineNo, `「${kv.key}:」の前に「音:」がありません（伴奏は、その段の「音:」のすぐ後に書きます）`); return; }
        addPart(ml.parts, kv.key, kv.value, lineNo, sumBeats(ml.notes), `${out.melody.length} 段目の旋律`);
      } else {
        err(lineNo, '[旋律] の中には「音:」と、伴奏の「右手:」「左手:」などの行だけを書きます');
      }
      return;
    }

    // 番の中
    if (kv.key === '音') {
      flushWords();
      const r = parseNotes(kv.value, { bar, chords: false });
      if (r.error) err(lineNo, r.error);
      pendingNotes = r.notes;
      pendingNotesLine = lineNo;
    } else if (kv.key === '元') {
      flushWords();
      if (pendingOrig) err(pendingOrig.lineNo, '「元:」のあとに「詞:」がありません');
      pendingOrig = { words: splitSyllables(kv.value), lineNo };
    } else if (kv.key === '詞') {
      flushWords();
      pendingWords = { words: splitSyllables(kv.value), notes: pendingNotes, lineNo, orig: pendingOrig };
      pendingNotes = null;
      pendingOrig = null;
    } else if (kv.key === '読') {
      if (!pendingWords || pendingWords.readings) { err(lineNo, '「読:」の前に「詞:」がありません'); return; }
      pendingWords.readings = splitSyllables(kv.value);
      pendingWords.readLineNo = lineNo;
    } else if (kv.key === '字') {
      if (!pendingWords || pendingWords.disp) { err(lineNo, '「字:」の前に「詞:」がありません'); return; }
      pendingWords.disp = { value: kv.value, lineNo };
    } else {
      err(lineNo, `番の中には「音:」「元:」「詞:」「読:」「字:」の行だけを書きます（「${kv.key}」）`);
    }
  });
  closeSection();

  if (!out.melody.length) err(0, '[旋律] がありません');
  if (!out.verses.length) err(0, '番（[1番] など）がありません');
  if (!out.meta['速さ'] || !(Number(out.meta['速さ']) > 0)) err(0, '「速さ:」（4 分音符が 1 分に何回か）がありません');
  if (out.meta['移調'] !== undefined && !/^[+-]?\d+$/.test(out.meta['移調'].trim())) err(0, '「移調:」は、半音いくつ上げ下げするかを整数で書きます（例：-2）');
  else if (Math.abs(Number(out.meta['移調'] ?? 0)) > 12) err(0, '「移調:」は -12〜12 の間で書きます');
  if (!out.form.length) out.form = out.verses.map((v) => v.name);
  for (const name of out.form) {
    if (!out.intros[name] && !out.verses.some((v) => v.name === name)) err(0, `構成の「${name}」に当たる [${name}] がありません`);
  }
  return out;
}

/**
 * 構成の順に、歌の音ごとの時刻を並べる（声に合わせた時刻は T6 で times.txt から入れる）。
 * 返り値：[{ t, dur, midi, text, ruby, verse, line }]。休符も midi: null で入る（線を切るため）。midi は「移調:」を掛けた高さ。
 * 前奏などの伴奏だけの所は、歌の音を出さず、時刻だけ進める。「速さ」は 4 分音符が 1 分に何回か。
 */
export function timeline(score) {
  const sec = 60 / Number(score.meta['速さ']);
  const shift = transposeOf(score);
  const events = [];
  let t = 0;
  for (const name of score.form) {
    const intro = score.intros[name];
    if (intro) { t += sectionClock(intro, sec)(introBeats(intro)); continue; }
    const vi = score.verses.findIndex((v) => v.name === name);
    if (vi < 0) continue;
    score.verses[vi].lines.forEach((ln, li) => {
      let s = 0;
      for (const n of ln.notes) {
        const dur = n.beats * sec;
        const syl = n.midi === null ? null : ln.syllables[s++];
        events.push({ t, dur, midi: n.midi === null ? null : n.midi + shift, text: syl?.text ?? null, ruby: syl?.ruby ?? null, verse: vi, line: li });
        t += dur;
      }
    });
  }
  return events;
}

/** 「移調:」の半音の数（書いていなければ 0） */
export function transposeOf(score) {
  const v = Number(score.meta['移調'] ?? 0);
  return Number.isInteger(v) ? v : 0;
}

/**
 * 部分の頭から b 拍目までの秒数を返す関数。「だんだん遅く: 70%」があれば、
 * 遅くし始める所（slowFrom 拍目、書かなければ頭）から部分の終わりまで、速さを拍に沿ってまっすぐ 70% へ落とす。
 * 速さ v(x) = v0·(1 − k·x/L)（k = 1 − 70%、L = 遅くする拍数、x = 遅くし始めてからの拍）を積分した形：
 * 秒 = (L·sec/k)·(−ln(1 − k·x/L))。
 */
export function sectionClock(intro, sec) {
  const from = intro.slowFrom || 0;
  const L = introBeats(intro) - from;
  const k = intro.slowTo ? 1 - intro.slowTo : 0;
  if (!k || L <= 0) return (b) => b * sec;
  return (b) => (b <= from ? b * sec : from * sec + ((L * sec) / k) * -Math.log(1 - (k * Math.min(b - from, L)) / L));
}

function introBeats(intro) {
  const first = Object.values(intro.parts)[0];
  return first ? sumBeats(first) : 0;
}

/**
 * 構成の順に、伴奏の音を並べる。返り値：[{ t, dur, midis, vel, part }]（休符は入れない）。
 * 強弱は声部ごとに、書いた所から次の強弱まで続く。何も書いていない所は mf。
 */
export function accompaniment(score) {
  const sec = 60 / Number(score.meta['速さ']);
  const shift = transposeOf(score);
  const events = [];
  const dynOf = {};
  let t = 0;
  const lay = (parts, t0, clock = (b) => b * sec) => {
    for (const [part, notes] of Object.entries(parts)) {
      let b = 0;
      for (const n of notes) {
        if (n.dyn) dynOf[part] = n.dyn;
        const u = t0 + clock(b), end = t0 + clock(b + n.beats);
        if (n.midis.length) events.push({ t: u, dur: end - u, midis: n.midis.map((m) => m + shift), vel: DYNAMICS[dynOf[part] || 'mf'], part });
        b += n.beats;
      }
    }
  };
  for (const name of score.form) {
    const intro = score.intros[name];
    if (intro) { const clock = sectionClock(intro, sec); lay(intro.parts, t, clock); t += clock(introBeats(intro)); continue; }
    const v = score.verses.find((x) => x.name === name);
    if (!v) continue;
    v.lines.forEach((ln, li) => {
      lay(score.melody[li]?.parts || {}, t);
      t += sumBeats(ln.notes) * sec;
    });
  }
  return events.sort((a, b) => a.t - b.t);
}
