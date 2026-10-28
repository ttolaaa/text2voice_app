// Turns user text (with optional expression tags) into a list of speak/pause steps.

export const BASE_PAUSE_MS = 700;
export const MAX_PAUSE_MS = 10000;

const TAG_RE = /\[(\/?)\s*(pause|break|pitch|slow|fast|emph|ask)\b([^\]]*)\]/gi;
const SENTENCE_END = /(\.{3,}|…|[.!?]+)(["'”’»)\]]*)(?=\s|$)|\n(?:[ \t]*\n)*/g;
const CLAUSE_END = /(\.{3,}|…|[.!?]+|[,;:—–])(["'”’»)\]]*)(?=\s|$)|\n(?:[ \t]*\n)*/g;
const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'mt', 'fig']);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const cleanArg = (arg) => (arg || '').replace(/^[\s=:]+/, '').trim().toLowerCase();
const isEllipsis = (punct) => punct === '…' || punct.startsWith('...');

export function parseDuration(arg, fallbackMs = BASE_PAUSE_MS) {
  const a = cleanArg(arg);
  if (!a) return fallbackMs;
  const named = { short: 350, medium: 700, long: 1400 };
  if (a in named) return named[a];
  const m = a.match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds?)?$/);
  if (!m) return fallbackMs;
  const n = parseFloat(m[1]);
  return Math.round(clamp(m[2] === 'ms' ? n : n * 1000, 0, MAX_PAUSE_MS));
}

function parseFactor(arg, named, fallback) {
  const a = cleanArg(arg);
  if (!a) return fallback;
  if (a in named) return named[a];
  const pct = a.match(/^([+-]\d+(?:\.\d+)?)%$/);
  if (pct) return clamp(1 + parseFloat(pct[1]) / 100, 0.25, 2);
  const n = parseFloat(a);
  return Number.isFinite(n) && n > 0 ? clamp(n, 0.25, 2) : fallback;
}

export const parsePitch = (arg) =>
  parseFactor(arg, { 'x-low': 0.65, low: 0.8, medium: 1, normal: 1, high: 1.25, 'x-high': 1.5 }, 1.25);

export const parseRate = (arg, fallback) =>
  parseFactor(arg, { 'x-slow': 0.6, slow: 0.78, medium: 1, normal: 1, fast: 1.25, 'x-fast': 1.5 }, fallback);

export function stripTags(text) {
  return text.replace(TAG_RE, '');
}

/** Splits text on expression tags into styled text segments and explicit pauses. */
export function parseMarkup(text, defaultPauseMs = BASE_PAUSE_MS) {
  const segments = [];
  const stack = [];
  let style = { pitch: 1, rate: 1, ask: false, emph: false };
  let last = 0;
  const pushText = (t) => {
    if (t) segments.push({ type: 'text', text: t, style });
  };

  for (const m of text.matchAll(TAG_RE)) {
    pushText(text.slice(last, m.index));
    last = m.index + m[0].length;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();

    if (tag === 'pause' || tag === 'break') {
      if (!closing) segments.push({ type: 'pause', ms: parseDuration(m[3], defaultPauseMs) });
      continue;
    }
    if (closing) {
      const idx = stack.map((s) => s.tag).lastIndexOf(tag);
      if (idx !== -1) {
        style = stack[idx].prev;
        stack.length = idx;
      }
      continue;
    }

    const next = { ...style };
    if (tag === 'pitch') next.pitch *= parsePitch(m[3]);
    else if (tag === 'slow') next.rate *= parseRate(m[3], 0.78);
    else if (tag === 'fast') next.rate *= parseRate(m[3], 1.25);
    else if (tag === 'emph') {
      next.emph = true;
      next.pitch *= 1.1;
      next.rate *= 0.9;
    } else if (tag === 'ask') next.ask = true;
    stack.push({ tag, prev: style });
    style = next;
  }
  pushText(text.slice(last));
  return segments;
}

function isAbbreviation(before) {
  const w = before.match(/([\p{L}.]+)$/u);
  if (!w) return false;
  const word = w[1];
  return ABBREVIATIONS.has(word.toLowerCase()) || /^\p{Lu}$/u.test(word);
}

/** Splits plain text into sentences (or clauses when `fine` is true). */
export function splitUnits(text, fine) {
  const units = [];
  let start = 0;
  for (const m of text.matchAll(fine ? CLAUSE_END : SENTENCE_END)) {
    const isBreak = m[1] === undefined;
    if (!isBreak && m[1] === '.' && isAbbreviation(text.slice(start, m.index))) continue;
    const end = m.index + m[0].length;
    const body = text.slice(start, isBreak ? m.index : end).trim();
    const br = isBreak ? (m[0].split('\n').length > 2 ? 2 : 1) : 0;
    const prev = units[units.length - 1];
    if (body && fine && prev && prev.br === 0 && /^[,;:—–]$/.test(prev.punct) && body.split(/\s+/).length <= 2) {
      // Avoid choppy micro-phrases like "a small, | glowing lantern."
      prev.text += ` ${body}`;
      prev.punct = isBreak ? '' : m[1];
      prev.br = br;
    } else if (body) units.push({ text: body, punct: isBreak ? '' : m[1], br });
    else if (br && prev) prev.br = Math.max(prev.br, br);
    start = end;
  }
  const rest = text.slice(start).trim();
  const last = units[units.length - 1];
  if (rest && fine && last && last.br === 0 && /^[,;:—–]$/.test(last.punct) && rest.split(/\s+/).length <= 2) {
    last.text += ` ${rest}`;
    last.punct = '';
  } else if (rest) units.push({ text: rest, punct: '', br: 0 });
  return units;
}

function naturalPause({ punct, br }, storyteller) {
  let ms = 0;
  if (storyteller) {
    if (isEllipsis(punct)) ms = 800;
    else if (punct.includes('?')) ms = 460;
    else if (punct.includes('!')) ms = 420;
    else if (punct.includes('.')) ms = 380;
    else if (/[—–]/.test(punct)) ms = 300;
    else if (/[,;:]/.test(punct)) ms = 200;
    ms += br === 2 ? 700 : br === 1 ? 250 : 0;
  } else {
    if (isEllipsis(punct)) ms = 450;
    ms += br === 2 ? 450 : br === 1 ? 150 : 0;
  }
  return ms;
}

const speakStep = (text, pitch, rate, unit) => ({
  type: 'speak',
  text,
  pitch: Math.round(clamp(pitch, 0, 2) * 1000) / 1000,
  rate: Math.round(clamp(rate, 0.1, 4) * 1000) / 1000,
  unit,
});

/**
 * Builds a performance plan.
 * options: storyteller (bool), question ('natural' | 'rise' | 'off'), pitch, rate, pauseScale,
 *   splitClauses (default: storyteller) - speak comma clauses separately with breathing pauses,
 *   splitQuestions (default: true) - in 'rise' mode, speak the last words of a question separately.
 * Neural voices sound best with whole sentences, so they pass splitClauses/splitQuestions = false.
 * Returns { items: [{type:'speak'|'pause', ...}], units: [{id, text, question, exclaim, emph, pitch, rate}] }.
 */
export function buildPlan(text, options = {}) {
  const opts = { storyteller: true, question: 'natural', pitch: 1, rate: 1, pauseScale: 1, splitQuestions: true, ...options };
  const splitClauses = opts.splitClauses ?? opts.storyteller;
  const scale = clamp(Number(opts.pauseScale) || 1, 0.25, 4);
  const segments = parseMarkup(String(text || ''), Math.round(BASE_PAUSE_MS * scale));

  const entries = [];
  for (const seg of segments) {
    if (seg.type === 'pause') {
      entries.push(seg);
      continue;
    }
    for (const u of splitUnits(seg.text, splitClauses)) {
      if (!/[\p{L}\p{N}]/u.test(u.text)) {
        // Punctuation-only fragment (e.g. "?" right after a closing tag) belongs to the previous phrase.
        const prev = entries[entries.length - 1];
        if (prev && prev.type === 'unit') {
          prev.text += u.text;
          prev.punct = u.punct || prev.punct;
          prev.br = Math.max(prev.br, u.br);
        }
        continue;
      }
      entries.push({ type: 'unit', ...u, style: seg.style });
    }
  }

  const items = [];
  const units = [];
  const pushPause = (ms) => {
    if (!(ms > 0)) return;
    const last = items[items.length - 1];
    if (last && last.type === 'pause') last.ms = Math.min(MAX_PAUSE_MS, last.ms + ms);
    else items.push({ type: 'pause', ms });
  };

  for (const e of entries) {
    if (e.type === 'pause') {
      pushPause(e.ms);
      continue;
    }
    const id = units.length;
    const s = e.style;
    const question = opts.question !== 'off' && (e.punct.includes('?') || s.ask);
    const exclaim = e.punct.includes('!');
    const ellipsis = isEllipsis(e.punct);
    let pitch = opts.pitch * s.pitch;
    let rate = opts.rate * s.rate;

    if (opts.storyteller) {
      // Subtle, deterministic pitch drift keeps long narration from sounding robotic.
      pitch *= 1 + 0.03 * Math.sin((id + 1) * 2.399);
      if (exclaim) {
        pitch *= 1.06;
        rate *= 1.05;
      }
      if (ellipsis) rate *= 0.92;
      if (/^["“‘«]/.test(e.text)) pitch *= 1.04;
      if (s.emph) pushPause(Math.round(120 * scale));
    }

    let spoken = e.text;
    if (ellipsis) spoken = spoken.replace(/(?:\.{3,}|…)(?=["'”’»)\]]*$)/, '');
    if (s.ask && !e.punct.includes('?')) spoken = spoken.replace(/[.!,;:—–]*(["'”’»)\]]*)$/, '?$1');

    units.push({ id, text: e.text, question, exclaim, emph: s.emph, pitch: s.pitch, rate: s.rate });

    if (question && opts.question === 'rise') {
      const words = spoken.split(/\s+/);
      if (words.length > 4 && opts.splitQuestions) {
        items.push(speakStep(words.slice(0, -3).join(' '), pitch, rate, id));
        items.push(speakStep(words.slice(-3).join(' '), pitch * 1.22, rate * 0.95, id));
      } else {
        items.push(speakStep(spoken, pitch * 1.18, rate * 0.97, id));
      }
    } else if (question) {
      items.push(speakStep(spoken, pitch * 1.08, rate, id));
    } else {
      items.push(speakStep(spoken, pitch, rate, id));
    }
    pushPause(Math.round(naturalPause(e, opts.storyteller) * scale));
  }

  while (items.length && items[items.length - 1].type === 'pause') items.pop();
  return { items, units };
}

/** Rough duration estimate in seconds (about 2.6 words per second at rate 1). */
export function estimateDuration(items) {
  let seconds = 0;
  for (const it of items) {
    if (it.type === 'pause') seconds += it.ms / 1000;
    else seconds += it.text.split(/\s+/).filter(Boolean).length / (2.6 * (it.rate || 1));
  }
  return Math.round(seconds);
}
