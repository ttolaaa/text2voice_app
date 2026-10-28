import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyProsody,
  chunkText,
  downloadName,
  encodeWav,
  estimateMarks,
  groupItems,
  resample,
  timeStretch,
} from '../public/js/audio-utils.js';

const SR = 24000;
const sine = (freq, seconds) => Float32Array.from({ length: Math.round(SR * seconds) }, (_, i) => Math.sin((2 * Math.PI * freq * i) / SR));

/** Dominant frequency estimated from rising zero crossings (ignores the edges). */
function frequency(samples) {
  const start = Math.floor(samples.length * 0.1);
  const end = Math.floor(samples.length * 0.9);
  let crossings = 0;
  for (let i = start + 1; i < end; i++) if (samples[i - 1] < 0 && samples[i] >= 0) crossings++;
  return crossings / ((end - start) / SR);
}

test('resample shifts pitch and shortens audio', () => {
  const out = resample(sine(200, 1), 1.25);
  assert.ok(Math.abs(out.length - SR / 1.25) <= 1);
  assert.ok(Math.abs(frequency(out) - 250) < 5);
  const same = sine(200, 0.1);
  assert.equal(resample(same, 1), same);
});

test('timeStretch changes duration but keeps pitch', () => {
  for (const rate of [0.75, 1.4]) {
    const out = timeStretch(sine(220, 2), rate, SR);
    const expected = (2 * SR) / rate;
    assert.ok(Math.abs(out.length - expected) / expected < 0.03, `length for rate ${rate}`);
    assert.ok(Math.abs(frequency(out) - 220) < 4, `pitch kept for rate ${rate}: ${frequency(out)}`);
    assert.ok(Math.max(...out) <= 1.01);
  }
});

test('applyProsody gives independent pitch and speed', () => {
  const out = applyProsody(sine(200, 2), { pitch: 1.2, rate: 1 }, SR);
  assert.ok(Math.abs(out.length - 2 * SR) / (2 * SR) < 0.03, 'duration preserved');
  assert.ok(Math.abs(frequency(out) - 240) < 5, 'pitch raised');
});

test('encodeWav writes a valid 16-bit mono header and clamps samples', () => {
  const buf = encodeWav([Float32Array.from([0, 0.5, -1, 2])], SR);
  const v = new DataView(buf);
  const str = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
  assert.equal(str(0, 4), 'RIFF');
  assert.equal(str(8, 4), 'WAVE');
  assert.equal(v.getUint32(24, true), SR);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 8);
  assert.equal(v.getInt16(46, true), Math.floor(0.5 * 0x7fff));
  assert.equal(v.getInt16(48, true), -0x8000);
  assert.equal(v.getInt16(50, true), 0x7fff);
});

test('chunkText respects the limit and prefers clause boundaries', () => {
  const text = 'One two three, four five six seven, eight nine ten eleven twelve thirteen.';
  const pieces = chunkText(text, 40);
  assert.ok(pieces.every((p) => p.length <= 40));
  assert.equal(pieces.join(' '), text);
  assert.ok(pieces[0].endsWith(','));
  assert.deepEqual(chunkText('short', 40), ['short']);
});

test('groupItems batches by characters and drops pause-only batches', () => {
  const items = [
    { type: 'speak', text: 'a'.repeat(10) },
    { type: 'pause', ms: 300 },
    { type: 'speak', text: 'b'.repeat(10) },
    { type: 'speak', text: 'c'.repeat(10) },
  ];
  const groups = groupItems(items, 20);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].length, 3);
  assert.deepEqual(groupItems([{ type: 'pause', ms: 1 }], 20), []);
});

test('estimateMarks places phrases using exact pauses and proportional speech', () => {
  const items = [
    { type: 'speak', text: 'aaaa', rate: 1, unit: 0 },
    { type: 'pause', ms: 1000 },
    { type: 'speak', text: 'aaaa', rate: 1, unit: 1 },
  ];
  assert.deepEqual(estimateMarks(items, 3), [
    { offset: 0, unit: 0 },
    { offset: 2, unit: 1 },
  ]);
});

test('downloadName builds a safe file name', () => {
  const name = downloadName('Heart ❤️ / Voice', 'wav', new Date('2026-01-02T03:04:00Z'));
  assert.equal(name, 'storyteller-heart-voice-202601020304.wav');
});

test('bufferWaitSeconds starts fast engines at once and slow ones in time to avoid gaps', async () => {
  const { bufferWaitSeconds } = await import('../public/js/audio-utils.js');
  // Faster than real time: start immediately.
  assert.equal(bufferWaitSeconds({ elapsed: 1, queued: 2, fraction: 0.1 }), 0);
  // 4x slower than real time, 10% done: 5s of audio so far => ~50s total => must wait (4*1.15-1)*50 - 20 = 160s.
  assert.ok(Math.abs(bufferWaitSeconds({ elapsed: 20, queued: 5, fraction: 0.1 }) - 160) < 1e-9);
  assert.equal(bufferWaitSeconds({ elapsed: 5, queued: 0, fraction: 0 }), Infinity);
  assert.equal(bufferWaitSeconds({ elapsed: 99, queued: 1, fraction: 1 }), 0);
});

test('decodeWav reads what encodeWav writes (My Voice responses)', async () => {
  const { decodeWav } = await import('../public/js/engines/myvoice.js');
  const src = Float32Array.from([0, 0.25, -0.5, 0.75]);
  const { samples, sampleRate } = decodeWav(encodeWav([src], 22050));
  assert.equal(sampleRate, 22050);
  assert.equal(samples.length, 4);
  samples.forEach((v, i) => assert.ok(Math.abs(v - src[i]) < 1e-3));
  assert.throws(() => decodeWav(new ArrayBuffer(16)), /Invalid WAV/);
});
