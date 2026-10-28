// Pure audio/text helpers (no DOM) shared by the neural engines; unit-tested in tests/audio-utils.test.js.

/**
 * Pitch shift by resampling: playing samples `factor` times faster raises pitch by `factor` and
 * shortens the audio by 1/factor. Callers compensate by synthesising at speed / factor.
 */
export function resample(samples, factor) {
  if (!(factor > 0) || Math.abs(factor - 1) < 1e-3) return samples;
  const outLength = Math.max(1, Math.floor(samples.length / factor));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * factor;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = pos - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

/**
 * Changes speed without changing pitch (WSOLA: overlap-add of 30 ms windows, each aligned to the
 * previous one by cross-correlation so the waveform stays continuous). rate > 1 = faster/shorter.
 */
export function timeStretch(samples, rate, sampleRate = 24000) {
  if (!(rate > 0) || Math.abs(rate - 1) < 0.01) return samples;
  const frame = Math.round(sampleRate * 0.03);
  if (samples.length < frame * 4) return samples;
  const hopOut = Math.floor(frame / 2);
  const hopIn = hopOut * rate;
  const tol = Math.round(sampleRate * 0.008);
  const overlap = frame - hopOut;
  const win = new Float32Array(frame);
  for (let i = 0; i < frame; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);

  const outLength = Math.ceil(samples.length / rate) + frame;
  const out = new Float32Array(outLength);
  const norm = new Float32Array(outLength);
  let prev = -1;
  let written = 0;
  for (let k = 0; ; k++) {
    const nominal = Math.round(k * hopIn);
    if (nominal + frame > samples.length) break;
    let best = nominal;
    if (prev >= 0) {
      // Pick the frame that best continues the previously copied one.
      const target = prev + hopOut;
      let bestScore = -Infinity;
      for (let d = -tol; d <= tol; d += 2) {
        const cand = nominal + d;
        if (cand < 0 || cand + frame > samples.length || target + overlap > samples.length) continue;
        let score = 0;
        for (let i = 0; i < overlap; i += 2) score += samples[target + i] * samples[cand + i];
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    const outPos = k * hopOut;
    for (let i = 0; i < frame; i++) {
      out[outPos + i] += samples[best + i] * win[i];
      norm[outPos + i] += win[i];
    }
    written = outPos + frame;
    prev = best;
  }
  const result = out.subarray(0, written);
  for (let i = 0; i < result.length; i++) if (norm[i] > 1e-3) result[i] /= norm[i];
  return result.slice();
}

/** Independent pitch and speed for engines without native controls: resample for pitch, then stretch back. */
export function applyProsody(samples, { pitch = 1, rate = 1 } = {}, sampleRate = 24000) {
  const shifted = resample(samples, pitch);
  return timeStretch(shifted, rate / pitch, sampleRate);
}

/** Encodes mono Float32 PCM chunks as a 16-bit PCM WAV file (returns an ArrayBuffer). */
export function encodeWav(chunks, sampleRate) {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset, s) => [...s].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return buffer;
}

/** Splits long text into pieces of at most `max` chars, preferring clause, then word boundaries. */
export function chunkText(text, max = 300) {
  const pieces = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(': '), window.lastIndexOf(' — '));
    if (cut < max * 0.4) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = max;
    else cut += 1;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Groups plan items into request-sized batches (by character count) without splitting an item. */
export function groupItems(items, maxChars = 1500) {
  const groups = [];
  let current = [];
  let chars = 0;
  for (const it of items) {
    const n = it.type === 'speak' ? it.text.length : 0;
    if (current.length && chars + n > maxChars) {
      groups.push(current);
      current = [];
      chars = 0;
    }
    current.push(it);
    chars += n;
  }
  if (current.length) groups.push(current);
  // Leading pauses belong to the silence between requests, not inside a request.
  return groups.filter((g) => g.some((it) => it.type === 'speak'));
}

/**
 * Estimates where each phrase starts inside a synthesized batch: pauses are exact, speech time is
 * shared out by character count / rate. Returns [{ offset (seconds), unit }].
 */
export function estimateMarks(items, totalSeconds) {
  const pauseSeconds = items.reduce((s, it) => s + (it.type === 'pause' ? it.ms / 1000 : 0), 0);
  const weights = items.map((it) => (it.type === 'speak' ? it.text.length / (it.rate || 1) : 0));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const speechSeconds = Math.max(0, totalSeconds - pauseSeconds);
  const marks = [];
  let t = 0;
  items.forEach((it, i) => {
    if (it.type === 'pause') {
      t += it.ms / 1000;
      return;
    }
    if (!marks.length || marks[marks.length - 1].unit !== it.unit) marks.push({ offset: t, unit: it.unit });
    t += (weights[i] / totalWeight) * speechSeconds;
  });
  return marks;
}

export const ensureExtension = (name, ext) => (name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`);

/**
 * How many more seconds to buffer before playback can run to the end without gaps (0 = start now).
 * elapsed: generation wall-time so far; queued: seconds of audio produced; fraction: share of the script done.
 * With a real-time factor r (> 1 = slower than playback) and total audio A, playback started at time s never
 * starves if s >= (r - 1) * A.
 */
export function bufferWaitSeconds({ elapsed, queued, fraction, margin = 1.15 }) {
  if (fraction >= 1) return 0;
  if (!(fraction > 0) || !(queued > 0)) return Infinity;
  const rtf = elapsed / queued;
  const totalAudio = queued / fraction;
  return Math.max(0, (rtf * margin - 1) * totalAudio - elapsed);
}

export function downloadName(voiceName, ext, date = new Date()) {
  const slug = String(voiceName || 'voice').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'voice';
  const stamp = date.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return ensureExtension(`storyteller-${slug}-${stamp}`, ext);
}
