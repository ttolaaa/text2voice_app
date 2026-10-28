import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, parseDuration, parseMarkup, parsePitch, splitUnits, stripTags, estimateDuration } from '../public/js/parser.js';

const speaks = (plan) => plan.items.filter((i) => i.type === 'speak');
const pauses = (plan) => plan.items.filter((i) => i.type === 'pause');

test('parseDuration handles seconds, milliseconds, names and limits', () => {
  assert.equal(parseDuration(' 2s'), 2000);
  assert.equal(parseDuration('500ms'), 500);
  assert.equal(parseDuration('1.5'), 1500);
  assert.equal(parseDuration('long'), 1400);
  assert.equal(parseDuration('=3s'), 3000);
  assert.equal(parseDuration('999s'), 10000);
  assert.equal(parseDuration('', 700), 700);
  assert.equal(parseDuration('banana', 700), 700);
});

test('parsePitch handles names, percentages and numbers', () => {
  assert.equal(parsePitch(' high'), 1.25);
  assert.equal(parsePitch('low'), 0.8);
  assert.equal(parsePitch('+20%'), 1.2);
  assert.equal(parsePitch('1.4'), 1.4);
  assert.equal(parsePitch('9'), 2);
});

test('parseMarkup produces pauses and nested styles', () => {
  const segs = parseMarkup('Hi [pause 1s][pitch high]up [slow]slow[/slow][/pitch] end');
  assert.deepEqual(segs.map((s) => s.type), ['text', 'pause', 'text', 'text', 'text']);
  assert.equal(segs[1].ms, 1000);
  assert.equal(segs[2].style.pitch, 1.25);
  assert.equal(segs[3].style.pitch, 1.25);
  assert.equal(segs[3].style.rate, 0.78);
  assert.deepEqual(segs[4].style, { pitch: 1, rate: 1, ask: false, emph: false });
});

test('unclosed and unknown tags are tolerated', () => {
  const segs = parseMarkup('[/pitch]a [emph]b [unknown] c');
  assert.equal(segs.length, 2);
  assert.equal(segs[1].style.emph, true);
  assert.equal(segs[1].text, 'b [unknown] c');
});

test('stripTags removes only expression tags', () => {
  assert.equal(stripTags('Hi [pause] there [b]'), 'Hi  there [b]');
});

test('splitUnits splits sentences without breaking abbreviations or numbers', () => {
  const units = splitUnits('Dr. Smith paid 3.50 dollars. Was it fair? Yes!', false);
  assert.deepEqual(units.map((u) => u.text), ['Dr. Smith paid 3.50 dollars.', 'Was it fair?', 'Yes!']);
  assert.deepEqual(units.map((u) => u.punct), ['.', '?', '!']);
});

test('splitUnits in clause mode splits on commas and records paragraph breaks', () => {
  const units = splitUnits('Well, 3,000 stars shone.\n\nThe end', true);
  assert.deepEqual(units.map((u) => u.text), ['Well,', '3,000 stars shone.', 'The end']);
  assert.equal(units[1].br, 2);
});

test('clause mode merges very short trailing clauses to avoid choppy speech', () => {
  const units = splitUnits('She carried a small, glowing lantern. Yes, sir', true);
  assert.deepEqual(units.map((u) => u.text), ['She carried a small, glowing lantern.', 'Yes, sir']);
  assert.equal(units[0].punct, '.');
});

test('questions get a pitch lift in natural mode and a split rise in rise mode', () => {
  const natural = buildPlan('Is it you? It is.', { storyteller: false, question: 'natural' });
  const [q, s] = speaks(natural);
  assert.ok(q.pitch > s.pitch);
  assert.equal(natural.units[0].question, true);

  const rise = buildPlan('Will tomorrow bring a brand new adventure?', { storyteller: false, question: 'rise' });
  const parts = speaks(rise);
  assert.equal(parts.length, 2);
  assert.equal(parts[1].text, 'brand new adventure?');
  assert.ok(parts[1].pitch > parts[0].pitch);

  const off = buildPlan('Is it you?', { storyteller: false, question: 'off' });
  assert.equal(off.units[0].question, false);
  assert.equal(speaks(off)[0].pitch, 1);
});

test('[ask] turns a statement into a question', () => {
  const plan = buildPlan('[ask]You came back[/ask].', { storyteller: false });
  assert.equal(plan.units[0].question, true);
  assert.equal(speaks(plan)[0].text, 'You came back?');
});

test('storyteller mode adds natural pauses; plain mode does not', () => {
  const text = 'Once upon a time, in a land far away, there was a clever fox. It ran.';
  const story = buildPlan(text, { storyteller: true });
  const plain = buildPlan(text, { storyteller: false });
  assert.ok(pauses(story).length >= 3);
  assert.equal(pauses(plain).length, 0);
  assert.equal(story.items.at(-1).type, 'speak', 'no trailing pause');
});

test('explicit pauses are kept, merged and scaled defaults apply', () => {
  const plan = buildPlan('A. [pause 2s] [pause] B.', { storyteller: false, pauseScale: 2 });
  assert.deepEqual(pauses(plan).map((p) => p.ms), [3400]);
});

test('ellipsis becomes a pause instead of being read aloud', () => {
  const plan = buildPlan('She waited... and waited.', { storyteller: true });
  assert.equal(speaks(plan)[0].text, 'She waited');
  assert.ok(pauses(plan)[0].ms >= 800);
});

test('base pitch and rate are applied and clamped', () => {
  const plan = buildPlan('[pitch x-high][fast x-fast]Wow[/fast][/pitch]', { storyteller: false, pitch: 1.5, rate: 1.5 });
  const [s] = speaks(plan);
  assert.equal(s.pitch, 2);
  assert.ok(s.rate <= 4 && s.rate > 1.5);
});

test('punctuation after a closing tag attaches to the previous phrase', () => {
  const plan = buildPlan('[pitch high]Is it you[/pitch]?', { storyteller: false });
  assert.equal(plan.units.length, 1);
  assert.equal(plan.units[0].question, true);
  assert.equal(speaks(plan)[0].text, 'Is it you?');
});

test('neural engines get whole sentences and unsplit questions', () => {
  const text = 'Once upon a time, in a land far away, there lived a fox. Will tomorrow bring a brand new adventure?';
  const neural = buildPlan(text, { storyteller: true, question: 'rise', splitClauses: false, splitQuestions: false });
  assert.deepEqual(speaks(neural).map((s) => s.text), [
    'Once upon a time, in a land far away, there lived a fox.',
    'Will tomorrow bring a brand new adventure?',
  ]);
  assert.ok(speaks(neural)[1].pitch > 1.1, 'question still lifted');
  assert.equal(pauses(neural).length, 1, 'sentence pause kept');
});

test('empty and tag-only input yields an empty plan', () => {
  assert.deepEqual(buildPlan('').items, []);
  assert.deepEqual(buildPlan('   [pause 2s]  ').items, []);
});

test('estimateDuration sums speech and pauses', () => {
  const secs = estimateDuration([
    { type: 'speak', text: 'one two three four five six', rate: 1 },
    { type: 'pause', ms: 1000 },
  ]);
  assert.equal(secs, 3);
});
