import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSsml, escapeXml, validateSpeakRequest } from '../server/ssml.js';

const voices = new Map([
  ['en-US-JennyNeural', { lang: 'en-US', styles: ['cheerful', 'narration-relaxed'] }],
  ['en-US-Ava:DragonHDLatestNeural', { lang: 'en-US', styles: [] }],
]);
const speak = (text, extra = {}) => ({ type: 'speak', text, pitch: 1, rate: 1, ...extra });

test('escapeXml escapes markup and strips illegal control characters', () => {
  assert.equal(escapeXml(`<a & "b" 'c'>\u0001`), '&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;');
});

test('validateSpeakRequest accepts a good request and resolves the voice locale', () => {
  const { value, error } = validateSpeakRequest(
    { voice: 'en-US-JennyNeural', style: 'cheerful', items: [speak('Hi'), { type: 'pause', ms: 99999 }] },
    { voices },
  );
  assert.equal(error, undefined);
  assert.equal(value.lang, 'en-US');
  assert.equal(value.items[1].ms, 10000, 'pause clamped');
  assert.equal(value.chars, 2);
  assert.ok(validateSpeakRequest({ voice: 'en-US-Ava:DragonHDLatestNeural', items: [speak('x')] }, { voices }).value);
});

test('validateSpeakRequest rejects bad input', () => {
  const cases = [
    [null, 'Invalid JSON body.'],
    [{ voice: 'en-US-Jenny"/><x', items: [speak('a')] }, 'Invalid voice.'],
    [{ voice: 'en-US-JennyNeural', items: [] }, 'Invalid items.'],
    [{ voice: 'en-US-JennyNeural', items: [{ type: 'evil' }] }, 'Invalid item type.'],
    [{ voice: 'en-US-JennyNeural', items: [speak('   ')] }, 'Invalid text.'],
    [{ voice: 'en-US-JennyNeural', items: [speak('a', { pitch: 'x' })] }, 'Invalid prosody.'],
    [{ voice: 'en-US-JennyNeural', style: 'whisper"', items: [speak('a')] }, 'Invalid style.'],
    [{ voice: 'en-US-JennyNeural', style: 'angry', items: [speak('a')] }, 'Style not supported by this voice.'],
    [{ voice: 'en-US-GuyNeural', items: [speak('a')] }, 'Unknown voice.'],
  ];
  for (const [body, message] of cases) assert.equal(validateSpeakRequest(body, { voices }).error, message);
  assert.match(validateSpeakRequest({ voice: 'en-US-JennyNeural', items: [speak('a'.repeat(900)), speak('b'.repeat(900))] }, { voices, maxChars: 1000 }).error, /max 1000/);
});

test('buildSsml escapes text, maps prosody and splits long breaks', () => {
  const { value } = validateSpeakRequest(
    {
      voice: 'en-US-JennyNeural',
      style: 'narration-relaxed',
      items: [speak('Tom & "Jerry" <script>', { pitch: 1.1, rate: 0.9 }), { type: 'pause', ms: 7000 }],
    },
    { voices },
  );
  const ssml = buildSsml(value);
  assert.match(ssml, /<voice name="en-US-JennyNeural">/);
  assert.match(ssml, /<mstts:express-as style="narration-relaxed">/);
  assert.match(ssml, /<prosody pitch="\+10%" rate="-10%">Tom &amp; &quot;Jerry&quot; &lt;script&gt;<\/prosody>/);
  assert.match(ssml, /<break time="5000ms"\/><break time="2000ms"\/>/);
  assert.ok(!ssml.includes('<script>'));
});
