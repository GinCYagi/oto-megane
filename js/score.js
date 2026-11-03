// 楽譜のデータ（songs/*.txt）を読む。書き方は docs/spec_uta.md の 5 章。
// 画面やブラウザの機能には触れない、字と数だけの関数。node --test で確かめられる。
//
// 読んだ結果：
//   { title, meta, melody: [行…], verses: [{ name, lines: [{ notes, syllables, lineNo }] }], errors: [{ lineNo, message }] }
//   notes：その行の音（休符を含む）。{ midi, beats }。休符は midi が null。beats は 4 分音符を 1 とした長さ。
//   syllables：休符を除いた音一つずつに当たる字。{ text, ruby }。ruby は読みが字と違うときだけ入る。
// 間違いがあっても止めずに読み進め、行の番号を付けて errors に集める（打った人が一度に直せるように）。

const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DUR = new Set([1, 2, 4, 8, 16]);
const META_KEYS = ['作詞', '作曲', '出典', '拍子', '速さ'];
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

/**
 * 「音:」の 1 行を読む。返り値：{ notes, error }。
 * 一つの音：「F4:4」。付点：「G4:4.」。休符：「R:8」。タイ：「F4:4~F4:8」（同じ高さをつないで一つの音）。
 */
export function parseNotes(text) {
  const notes = [];
  for (const token of text.split(/[\s　]+/).filter(Boolean)) {
    const parts = token.split('~');
    let midi;
    let beats = 0;
    for (const part of parts) {
      const m = /^([^:]+):(.+)$/.exec(part);
      if (!m) return { notes, error: `「${token}」が読めません（「F4:4」のように、音名:長さ で書きます）` };
      const b = durToBeats(m[2]);
      if (b === null) return { notes, error: `「${token}」の長さ「${m[2]}」が読めません（1・2・4・8・16、付点は後ろに「.」）` };
      const isRest = m[1] === 'R';
      const mm = isRest ? null : noteToMidi(m[1]);
      if (!isRest && mm === null) return { notes, error: `「${token}」の音名「${m[1]}」が読めません（「C4」「F#4」「Bb4」のように書きます）` };
      if (midi !== undefined && mm !== midi) return { notes, error: `「${token}」のタイが、違う高さをつないでいます` };
      midi = mm;
      beats += b;
    }
    notes.push({ midi, beats });
  }
  return { notes, error: null };
}

/** 「詞:」「読:」の 1 行を「|」で区切る。全角の「｜」も受け付ける。 */
function splitSyllables(text) {
  return text.split(/[|｜]/).map((s) => s.trim());
}

/** 「作詞: 〜」「拍子：3/4」のような行。全角のコロンも受け付ける。 */
function keyValue(line) {
  const m = /^([^:：]+)[:：]\s*(.*)$/.exec(line);
  return m ? { key: m[1].trim(), value: m[2].trim() } : null;
}

export function parseScore(text) {
  const out = { title: '', meta: {}, melody: [], verses: [], errors: [] };
  const err = (lineNo, message) => out.errors.push({ lineNo, message });

  let section = null;      // '旋律' か、番の名前
  let verse = null;
  let pendingNotes = null; // 番の中で、次の「詞:」の旋律を上書きする「音:」
  let pendingNotesLine = 0;
  let pendingWords = null; // 「読:」を待っている「詞:」

  const flushWords = () => {
    if (!pendingWords) return;
    const p = pendingWords;
    pendingWords = null;
    finishLine(p, null);
  };

  const finishLine = (p, readings, readLineNo) => {
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
    const syllables = p.words.map((w, i) => {
      const r = readings?.[i];
      return { text: w, ruby: r && r !== w && w !== HOLD ? r : null };
    });
    verse.lines.push({ notes, syllables, lineNo: p.lineNo });
  };

  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();
    if (!line) return;

    if (line.startsWith('# ')) { out.title = line.slice(2).trim(); return; }

    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      if (verse) flushWords();
      if (pendingNotes) { err(pendingNotesLine, '上書きの「音:」のあとに「詞:」がありません'); pendingNotes = null; }
      section = sec[1].trim();
      if (section === '旋律') {
        verse = null;
      } else {
        if (!out.melody.length) err(lineNo, '[旋律] より前に番があります（[旋律] を先に書きます）');
        verse = { name: section, lines: [] };
        out.verses.push(verse);
      }
      return;
    }

    const kv = keyValue(line);
    if (!kv) { err(lineNo, `この行が読めません：「${line}」`); return; }

    if (section === null) {
      if (META_KEYS.includes(kv.key)) out.meta[kv.key] = kv.value;
      else err(lineNo, `「${kv.key}」は知らない項目です（${META_KEYS.join('・')} のどれか）`);
      return;
    }

    if (section === '旋律') {
      if (kv.key !== '音') { err(lineNo, '[旋律] の中には「音:」の行だけを書きます'); return; }
      const r = parseNotes(kv.value);
      if (r.error) err(lineNo, r.error);
      out.melody.push({ notes: r.notes, lineNo });
      return;
    }

    // 番の中
    if (kv.key === '音') {
      flushWords();
      const r = parseNotes(kv.value);
      if (r.error) err(lineNo, r.error);
      pendingNotes = r.notes;
      pendingNotesLine = lineNo;
    } else if (kv.key === '詞') {
      flushWords();
      pendingWords = { words: splitSyllables(kv.value), notes: pendingNotes, lineNo };
      pendingNotes = null;
    } else if (kv.key === '読') {
      if (!pendingWords) { err(lineNo, '「読:」の前に「詞:」がありません'); return; }
      const p = pendingWords;
      pendingWords = null;
      finishLine(p, splitSyllables(kv.value), lineNo);
    } else {
      err(lineNo, `番の中には「音:」「詞:」「読:」の行だけを書きます（「${kv.key}」）`);
    }
  });
  if (verse) flushWords();
  if (pendingNotes) err(pendingNotesLine, '上書きの「音:」のあとに「詞:」がありません');

  if (!out.melody.length) err(0, '[旋律] がありません');
  if (!out.verses.length) err(0, '番（[1番] など）がありません');
  if (!out.meta['速さ'] || !(Number(out.meta['速さ']) > 0)) err(0, '「速さ:」（4 分音符が 1 分に何回か）がありません');
  return out;
}

/**
 * 楽譜の速さのまま、音ごとの時刻を並べる（声に合わせた時刻は T6 で times.txt から入れる）。
 * 返り値：[{ t, dur, midi, text, ruby, verse, line }]。休符も midi: null で入る（線を切るため）。
 * 「速さ」は 4 分音符が 1 分に何回か。
 */
export function timeline(score) {
  const sec = 60 / Number(score.meta['速さ']);
  const events = [];
  let t = 0;
  score.verses.forEach((v, vi) => {
    v.lines.forEach((ln, li) => {
      let s = 0;
      for (const n of ln.notes) {
        const dur = n.beats * sec;
        const syl = n.midi === null ? null : ln.syllables[s++];
        events.push({ t, dur, midi: n.midi, text: syl?.text ?? null, ruby: syl?.ruby ?? null, verse: vi, line: li });
        t += dur;
      }
    });
  });
  return events;
}
