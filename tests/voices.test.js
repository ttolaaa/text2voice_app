import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyVoice, groupVoices, languageOf, listLanguages, shortVoiceName } from '../public/js/voices.js';

const v = (name, lang = 'en-US', localService = true) => ({ name, lang, localService });

test('classifyVoice recognises common voice names', () => {
  assert.equal(classifyVoice(v('Microsoft Zira - English (United States)')), 'female');
  assert.equal(classifyVoice(v('Microsoft David - English (United States)')), 'male');
  assert.equal(classifyVoice(v('Microsoft Aria Online (Natural) - English (United States)')), 'female');
  assert.equal(classifyVoice(v('Microsoft Guy Online (Natural) - English (United States)')), 'male');
  assert.equal(classifyVoice(v('Google UK English Female', 'en-GB')), 'female');
  assert.equal(classifyVoice(v('Google UK English Male', 'en-GB')), 'male');
  assert.equal(classifyVoice(v('Google US English')), 'female');
  assert.equal(classifyVoice(v('Samantha')), 'female');
  assert.equal(classifyVoice(v('Daniel', 'en-GB')), 'male');
  assert.equal(classifyVoice(v('Microsoft Hedda - German (Germany)', 'de-DE')), 'unknown');
  assert.equal(classifyVoice(v('German Voice', 'de-DE')), 'unknown');
});

test('groupVoices filters by language and ranks natural voices first', () => {
  const voices = [
    v('Microsoft Zira - English (United States)'),
    v('Microsoft Jenny Online (Natural) - English (United States)', 'en-US', false),
    v('Microsoft David - English (United States)'),
    v('Microsoft Katja - German (Germany)', 'de-DE'),
    v('Mystery', 'en-US'),
  ];
  const groups = groupVoices(voices, 'en');
  assert.deepEqual(groups.female.map(shortVoiceName), ['Jenny', 'Zira']);
  assert.deepEqual(groups.male.map(shortVoiceName), ['David']);
  assert.deepEqual(groups.unknown.map((x) => x.name), ['Mystery']);
  assert.equal(groupVoices(voices, 'all').female.length, 3);
});

test('language helpers', () => {
  assert.equal(languageOf(v('x', 'en_GB')), 'en');
  assert.equal(languageOf(v('x', '')), 'und');
  const langs = listLanguages([v('a', 'en-US'), v('b', 'de-DE'), v('c', 'en-GB')]);
  assert.deepEqual(langs.map((l) => l.label), ['English', 'German']);
});
