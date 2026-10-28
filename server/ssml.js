// Builds Azure SSML from a client-side performance plan. All user text is XML-escaped and every
// numeric value is clamped, so clients can never inject raw SSML.

export const LIMITS = {
  maxItems: 400,
  maxItemChars: 1000,
  maxPauseMs: 10000,
  azureMaxBreakMs: 5000,
};

const VOICE_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]+){1,3}(:[A-Za-z0-9]+)?$/;
const STYLE_RE = /^[A-Za-z][A-Za-z0-9-]{0,40}$/;
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function escapeXml(text) {
  return String(text)
    // Strip characters that are illegal in XML 1.0.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

const percent = (factor) => {
  const p = Math.round((factor - 1) * 100);
  return `${p >= 0 ? '+' : ''}${p}%`;
};

/**
 * Validates a speak request body. Returns { value } or { error }.
 * `voices` (optional) is a Map of voice id -> { lang, styles } used to verify voice and style.
 */
export function validateSpeakRequest(body, { maxChars = 3000, voices = null } = {}) {
  if (!body || typeof body !== 'object') return { error: 'Invalid JSON body.' };
  const { voice, style = '', items } = body;
  if (typeof voice !== 'string' || voice.length > 100 || !VOICE_RE.test(voice)) return { error: 'Invalid voice.' };
  if (typeof style !== 'string' || (style && !STYLE_RE.test(style))) return { error: 'Invalid style.' };
  if (!Array.isArray(items) || !items.length || items.length > LIMITS.maxItems) return { error: 'Invalid items.' };

  let lang = typeof body.lang === 'string' && LANG_RE.test(body.lang) ? body.lang : voice.split('-').slice(0, 2).join('-');
  if (voices) {
    const info = voices.get(voice);
    if (!info) return { error: 'Unknown voice.' };
    if (style && !info.styles.includes(style)) return { error: 'Style not supported by this voice.' };
    lang = info.lang;
  }

  const clean = [];
  let chars = 0;
  for (const it of items) {
    if (!it || typeof it !== 'object') return { error: 'Invalid item.' };
    if (it.type === 'pause') {
      const ms = Number(it.ms);
      if (!Number.isFinite(ms)) return { error: 'Invalid pause.' };
      clean.push({ type: 'pause', ms: Math.round(clamp(ms, 0, LIMITS.maxPauseMs)) });
    } else if (it.type === 'speak') {
      if (typeof it.text !== 'string' || !it.text.trim() || it.text.length > LIMITS.maxItemChars) return { error: 'Invalid text.' };
      const pitch = Number(it.pitch ?? 1);
      const rate = Number(it.rate ?? 1);
      if (!Number.isFinite(pitch) || !Number.isFinite(rate)) return { error: 'Invalid prosody.' };
      chars += it.text.length;
      clean.push({ type: 'speak', text: it.text, pitch: clamp(pitch, 0.5, 2), rate: clamp(rate, 0.5, 3) });
    } else {
      return { error: 'Invalid item type.' };
    }
  }
  if (!chars) return { error: 'Nothing to speak.' };
  if (chars > maxChars) return { error: `Too much text in one request (max ${maxChars} characters).` };
  return { value: { voice, style, lang, items: clean, chars } };
}

export function buildSsml({ voice, style, lang, items }) {
  let body = '';
  for (const it of items) {
    if (it.type === 'pause') {
      let ms = it.ms;
      while (ms > 0) {
        const part = Math.min(ms, LIMITS.azureMaxBreakMs);
        body += `<break time="${part}ms"/>`;
        ms -= part;
      }
    } else {
      body += `<prosody pitch="${percent(it.pitch)}" rate="${percent(it.rate)}">${escapeXml(it.text)}</prosody> `;
    }
  }
  if (style) body = `<mstts:express-as style="${escapeXml(style)}">${body}</mstts:express-as>`;
  return (
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ' +
    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${escapeXml(lang)}">` +
    `<voice name="${escapeXml(voice)}">${body}</voice></speak>`
  );
}
