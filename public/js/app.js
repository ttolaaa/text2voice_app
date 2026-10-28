import { buildPlan, estimateDuration } from './parser.js';
import { classifyVoice, groupVoices, isNaturalVoice, listLanguages, shortVoiceName } from './voices.js';
import { Player } from './player.js';

const STORAGE_KEY = 'text2voice.settings.v1';
const VERSION_POLL_MS = 60000;

const SAMPLES = {
  female:
    'Once upon a time, in a little village by the sea, there lived a girl named Lina. [pause 0.6s] ' +
    'Every night, she climbed the hill... and whispered to the stars. ' +
    '"Will tomorrow bring an adventure?" [pause 0.8s] ' +
    'And one quiet night, [slow]the stars [emph]answered[/emph].[/slow]',
  male:
    'Long ago, deep in the mountains, an old lighthouse keeper named Tomas kept a promise. [pause 0.6s] ' +
    'Every evening, he lit the lamp... and waited. ' +
    'Was anyone still sailing these dark waters? [pause 0.8s] ' +
    'Then, one stormy night, a tiny light blinked back. [pitch high]Someone was out there![/pitch]',
};

const EXAMPLE = `The Lantern of Willow Hill

Once upon a time, at the edge of a sleepy town, there stood a hill covered in silver willows. [pause 0.5s] Every evening, an old woman named Mira climbed it with a small, glowing lantern.

The children of the town were curious. "Where does she go?" they whispered. "And why does she always come back smiling?"

One night, a brave boy named Theo followed her... [pause 1s] step by step, [slow]quietly, carefully[/slow], until he reached the very top.

There, beneath the stars, Mira turned around. [pitch high]"I knew you would come,"[/pitch] she said with a wink. [pause] "Would you like to see the secret?"

Theo nodded. And what he saw next [emph]changed everything[/emph].`;

const DEFAULTS = {
  text: '',
  gender: 'female',
  voiceFemale: '',
  voiceMale: '',
  lang: '',
  storyteller: true,
  question: 'natural',
  rate: 0.95,
  pitch: 1,
  pauseScale: 1,
  volume: 1,
};
const DELIVERY_KEYS = ['storyteller', 'question', 'rate', 'pitch', 'pauseScale', 'volume'];

const $ = (id) => document.getElementById(id);
const els = {
  text: $('text-input'),
  charCount: $('char-count'),
  pauseBtn: $('pause-btn'),
  pauseLength: $('pause-length'),
  exampleBtn: $('example-btn'),
  clearBtn: $('clear-btn'),
  lang: $('lang-select'),
  voice: { female: $('voice-female'), male: $('voice-male') },
  count: { female: $('female-count'), male: $('male-count') },
  voiceHint: $('voice-hint'),
  storyteller: $('storyteller'),
  question: $('question-mode'),
  rate: $('rate'),
  pitch: $('pitch'),
  pauseScale: $('pause-scale'),
  volume: $('volume'),
  outputs: { rate: $('rate-out'), pitch: $('pitch-out'), pauseScale: $('pause-out'), volume: $('volume-out') },
  resetBtn: $('reset-btn'),
  preview: $('preview'),
  duration: $('duration'),
  playBtn: $('play-btn'),
  stopBtn: $('stop-btn'),
  status: $('status'),
  version: $('version'),
  updateBanner: $('update-banner'),
  reloadBtn: $('reload-btn'),
  supportBanner: $('support-banner'),
};

const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
let settings = loadSettings();
let voices = [];
let unitEls = new Map();
let activeUnitEl = null;
const player = supported ? new Player({ onStateChange: updatePlayerUI, onError: (err) => setStatus(`Speech error: ${err}`) }) : null;

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const merged = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (typeof saved[key] === typeof DEFAULTS[key]) merged[key] = saved[key];
    }
    return merged;
  } catch {
    return { ...DEFAULTS };
  }
}

let saveTimer = null;
function writeSettings() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage may be unavailable (private mode / quota) */
  }
}
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeSettings, 250);
}

function setStatus(message) {
  els.status.textContent = message;
}

// ---------- Voices ----------

function loadVoices() {
  voices = window.speechSynthesis.getVoices();
  populateLanguages();
  populateVoices();
}

function populateLanguages() {
  if (!voices.length) {
    // Voices not loaded yet: don't overwrite the saved language choice.
    els.lang.replaceChildren(new Option('All languages', 'all'));
    return;
  }
  const langs = listLanguages(voices, navigator.language || 'en');
  const codes = langs.map((l) => l.code);
  const browserLang = (navigator.language || 'en').split('-')[0].toLowerCase();
  let selected = settings.lang;
  if (selected !== 'all' && !codes.includes(selected)) {
    selected = codes.includes(browserLang) ? browserLang : codes.includes('en') ? 'en' : 'all';
  }
  els.lang.replaceChildren(new Option('All languages', 'all'), ...langs.map((l) => new Option(l.label, l.code)));
  els.lang.value = selected;
  settings.lang = selected;
}

function voiceOption(v) {
  const opt = new Option(`${isNaturalVoice(v) ? '✨ ' : ''}${shortVoiceName(v)} (${v.lang})`, v.name);
  opt.title = v.name;
  return opt;
}

function populateVoices() {
  const groups = groupVoices(voices, settings.lang);
  for (const gender of ['female', 'male']) {
    const select = els.voice[gender];
    const key = gender === 'female' ? 'voiceFemale' : 'voiceMale';
    const children = [];
    if (groups[gender].length) {
      const group = document.createElement('optgroup');
      group.label = gender === 'female' ? 'Lady voices' : 'Man voices';
      group.append(...groups[gender].map(voiceOption));
      children.push(group);
    }
    if (groups.unknown.length) {
      const group = document.createElement('optgroup');
      group.label = 'Other voices (pitch-adjusted)';
      group.append(...groups.unknown.map(voiceOption));
      children.push(group);
    }
    if (!children.length) children.push(new Option('Browser default voice', ''));
    select.replaceChildren(...children);

    const names = [...select.options].map((o) => o.value);
    select.value = names.includes(settings[key]) ? settings[key] : names[0];
    if (voices.length) settings[key] = select.value; // keep the saved choice until voices have loaded
    const n = groups[gender].length;
    els.count[gender].textContent = n ? `${n} voice${n === 1 ? '' : 's'}` : 'using pitch-adjusted voice';
  }

  const hasNatural = voices.some(isNaturalVoice);
  els.voiceHint.textContent = !voices.length
    ? 'Loading voices… If none appear, your system may have no speech voices installed.'
    : hasNatural
      ? '✨ marks natural / neural voices — they sound the most human.'
      : 'Tip: for the most human-sounding voices, open this page in Microsoft Edge (natural online voices) or install extra voices in your OS settings.';
}

/** Returns the selected voice for a gender plus a pitch nudge for voices whose gender is unknown. */
function voiceProfile(gender) {
  const select = els.voice[gender];
  const voice = voices.find((v) => v.name === select.value) || null;
  const known = voice && classifyVoice(voice) === gender;
  const nudge = known ? 1 : gender === 'female' ? 1.15 : 0.85;
  return { voice, nudge };
}

// ---------- Plan & preview ----------

function planFor(text, gender, overrides = {}) {
  const { nudge } = voiceProfile(gender);
  return buildPlan(text, {
    storyteller: settings.storyteller,
    question: settings.question,
    rate: settings.rate,
    pitch: settings.pitch * nudge,
    pauseScale: settings.pauseScale,
    ...overrides,
  });
}

function unitClasses(unit) {
  const classes = ['unit'];
  if (unit.question) classes.push('question');
  if (unit.exclaim) classes.push('exclaim');
  if (unit.emph) classes.push('emph');
  if (unit.pitch > 1.02) classes.push('pitch-up');
  if (unit.pitch < 0.98) classes.push('pitch-down');
  if (unit.rate < 0.98) classes.push('slow');
  if (unit.rate > 1.02) classes.push('fast');
  return classes.join(' ');
}

function renderPreview() {
  if (player && player.label === 'script') return; // don't rebuild while highlighting playback
  const plan = planFor(els.text.value, settings.gender);
  unitEls = new Map();
  activeUnitEl = null;
  if (!plan.items.length) {
    const empty = document.createElement('p');
    empty.className = 'placeholder';
    empty.textContent = 'Your performance will appear here — pauses, questions and emphasis included.';
    els.preview.replaceChildren(empty);
    els.duration.textContent = '';
    return;
  }
  const frag = document.createDocumentFragment();
  let lastUnit = -1;
  for (const item of plan.items) {
    if (item.type === 'pause') {
      const chip = document.createElement('span');
      chip.className = 'pause-chip';
      chip.textContent = `⏸ ${(item.ms / 1000).toFixed(1)}s`;
      frag.append(chip, ' ');
    } else if (item.unit !== lastUnit) {
      lastUnit = item.unit;
      const unit = plan.units[item.unit];
      const span = document.createElement('span');
      span.className = unitClasses(unit);
      span.textContent = unit.text;
      unitEls.set(unit.id, span);
      frag.append(span, ' ');
    }
  }
  els.preview.replaceChildren(frag);
  els.duration.textContent = `≈ ${formatSeconds(estimateDuration(plan.items))}`;
}

function formatSeconds(total) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

function highlightUnit(id) {
  if (activeUnitEl) activeUnitEl.classList.remove('active');
  activeUnitEl = id === null ? null : unitEls.get(id) || null;
  if (!activeUnitEl) return;
  activeUnitEl.classList.add('active');
  const box = els.preview;
  const top = activeUnitEl.offsetTop;
  if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 40) {
    box.scrollTo({ top: Math.max(0, top - 40), behavior: 'smooth' });
  }
}

let previewTimer = null;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 200);
}

// ---------- Playback ----------

function playScript() {
  if (!player) return;
  if (player.label === 'script' && player.state === 'playing') return player.pause();
  if (player.label === 'script' && player.state === 'paused') return player.resume();
  if (!els.text.value.trim()) {
    setStatus('Type something to speak first.');
    els.text.focus();
    return;
  }
  player.stop();
  renderPreview();
  const plan = planFor(els.text.value, settings.gender);
  const { voice } = voiceProfile(settings.gender);
  setStatus(`Speaking with ${voice ? shortVoiceName(voice) : 'the default voice'}… (≈ ${formatSeconds(estimateDuration(plan.items))})`);
  player.play(plan.items, { voice, volume: settings.volume, onUnit: highlightUnit, label: 'script' });
}

function playSample(gender) {
  if (!player) return;
  const label = `sample-${gender}`;
  if (player.label === label) {
    player.stop();
    return;
  }
  const plan = planFor(SAMPLES[gender], gender, {
    storyteller: true,
    question: settings.question === 'off' ? 'natural' : settings.question,
  });
  const { voice } = voiceProfile(gender);
  setStatus(`Playing ${gender === 'female' ? 'lady' : 'man'} sample${voice ? ` — ${shortVoiceName(voice)}` : ''}…`);
  player.play(plan.items, { voice, volume: settings.volume, label });
}

function updatePlayerUI(state, label) {
  const scriptActive = label === 'script';
  els.playBtn.textContent = scriptActive && state === 'playing' ? '⏸ Pause' : scriptActive && state === 'paused' ? '▶ Resume' : '▶ Play';
  els.stopBtn.disabled = state === 'idle';
  document.querySelectorAll('.sample-btn').forEach((btn) => {
    btn.textContent = label === `sample-${btn.dataset.sample}` && state !== 'idle' ? '■ Stop sample' : '▶ Hear sample';
  });
  if (state === 'paused') setStatus('Paused');
  if (state === 'idle') setStatus('Ready');
}

// ---------- Editing tools ----------

function replaceSelection(replacement, selectInner = null) {
  const ta = els.text;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  ta.focus();
  // execCommand keeps the native undo stack (Ctrl+Z); fall back to setRangeText.
  const ok = replacement
    ? document.execCommand('insertText', false, replacement)
    : ta.selectionStart === ta.selectionEnd || document.execCommand('delete');
  if (!ok) {
    ta.setRangeText(replacement, start, end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (selectInner) ta.setSelectionRange(start + selectInner[0], start + selectInner[1]);
}

function wrapSelection(tag) {
  const ta = els.text;
  const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  const open = `[${tag}]`;
  const close = `[/${tag.split(' ')[0]}]`;
  replaceSelection(open + selected + close, [open.length, open.length + selected.length]);
}

function insertPause() {
  const ta = els.text;
  const before = ta.value.slice(0, ta.selectionStart);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  replaceSelection(`${lead}[pause ${els.pauseLength.value}] `);
}

function onTextChanged() {
  settings.text = els.text.value;
  const n = els.text.value.length;
  els.charCount.textContent = `${n.toLocaleString()} character${n === 1 ? '' : 's'}`;
  saveSettings();
  schedulePreview();
}

// ---------- Delivery controls ----------

function syncDeliveryControls() {
  els.storyteller.checked = settings.storyteller;
  els.question.value = settings.question;
  for (const key of ['rate', 'pitch', 'pauseScale', 'volume']) {
    els[key].value = String(settings[key]);
    updateOutput(key);
  }
}

function updateOutput(key) {
  const v = settings[key];
  els.outputs[key].textContent = key === 'volume' ? `${Math.round(v * 100)}%` : `${v.toFixed(2)}×`;
}

function syncGender() {
  document.querySelectorAll('input[name="gender"]').forEach((r) => {
    r.checked = r.value === settings.gender;
  });
  document.querySelectorAll('.gender-option').forEach((card) => {
    card.classList.toggle('selected', card.dataset.gender === settings.gender);
  });
}

// ---------- Version / auto-update ----------

let deployedCommit = null;
async function checkVersion() {
  try {
    const res = await fetch('version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const info = await res.json();
    if (deployedCommit === null) {
      deployedCommit = String(info.commit);
      const shortCommit = /^[0-9a-f]{12,}$/i.test(deployedCommit) ? deployedCommit.slice(0, 7) : deployedCommit;
      els.version.textContent = `v${info.version} · ${shortCommit}`;
      els.version.title = info.builtAt ? `Built ${info.builtAt}` : 'Local development build';
    } else if (String(info.commit) !== deployedCommit) {
      els.updateBanner.hidden = false;
    }
  } catch {
    /* offline or not served over HTTP */
  }
}

// ---------- Wiring ----------

function init() {
  els.text.value = settings.text;
  syncDeliveryControls();
  syncGender();
  onTextChanged();

  els.text.addEventListener('input', onTextChanged);
  els.text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      playScript();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && player) player.stop();
  });

  els.pauseBtn.addEventListener('click', insertPause);
  document.querySelectorAll('[data-wrap]').forEach((btn) => btn.addEventListener('click', () => wrapSelection(btn.dataset.wrap)));
  els.exampleBtn.addEventListener('click', () => {
    els.text.select();
    replaceSelection(EXAMPLE);
  });
  els.clearBtn.addEventListener('click', () => {
    els.text.select();
    replaceSelection('');
  });

  els.lang.addEventListener('change', () => {
    settings.lang = els.lang.value;
    populateVoices();
    saveSettings();
    schedulePreview();
  });
  for (const gender of ['female', 'male']) {
    els.voice[gender].addEventListener('change', () => {
      settings[gender === 'female' ? 'voiceFemale' : 'voiceMale'] = els.voice[gender].value;
      settings.gender = gender;
      syncGender();
      saveSettings();
    });
  }
  document.querySelectorAll('input[name="gender"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      settings.gender = radio.value;
      syncGender();
      saveSettings();
    }),
  );
  document.querySelectorAll('.gender-option').forEach((card) =>
    card.addEventListener('click', (e) => {
      if (e.target.closest('select, button')) return;
      settings.gender = card.dataset.gender;
      syncGender();
      saveSettings();
    }),
  );
  document.querySelectorAll('.sample-btn').forEach((btn) => btn.addEventListener('click', () => playSample(btn.dataset.sample)));

  els.storyteller.addEventListener('change', () => {
    settings.storyteller = els.storyteller.checked;
    saveSettings();
    schedulePreview();
  });
  els.question.addEventListener('change', () => {
    settings.question = els.question.value;
    saveSettings();
    schedulePreview();
  });
  for (const key of ['rate', 'pitch', 'pauseScale', 'volume']) {
    els[key].addEventListener('input', () => {
      settings[key] = Number(els[key].value);
      updateOutput(key);
      saveSettings();
      schedulePreview();
    });
  }
  els.resetBtn.addEventListener('click', () => {
    for (const key of DELIVERY_KEYS) settings[key] = DEFAULTS[key];
    syncDeliveryControls();
    saveSettings();
    schedulePreview();
  });

  els.playBtn.addEventListener('click', playScript);
  els.stopBtn.addEventListener('click', () => player && player.stop());
  els.reloadBtn.addEventListener('click', () => window.location.reload());

  checkVersion();
  setInterval(checkVersion, VERSION_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkVersion();
    else if (saveTimer) writeSettings();
  });
  window.addEventListener('pagehide', () => {
    if (saveTimer) writeSettings();
  });

  if (!supported) {
    els.supportBanner.hidden = false;
    els.playBtn.disabled = true;
    document.querySelectorAll('.sample-btn').forEach((b) => (b.disabled = true));
    setStatus('Speech synthesis is not available in this browser.');
    return;
  }

  const synth = window.speechSynthesis;
  if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', loadVoices);
  else synth.onvoiceschanged = loadVoices;
  loadVoices();
  // Some browsers populate voices late without firing voiceschanged.
  let retries = 0;
  const retry = setInterval(() => {
    if (voices.length || ++retries > 20) return clearInterval(retry);
    loadVoices();
  }, 250);

  // Stop speaking when leaving the page (some browsers keep talking otherwise).
  window.addEventListener('pagehide', () => synth.cancel());
}

init();
