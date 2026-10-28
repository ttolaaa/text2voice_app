import { buildPlan, estimateDuration } from './parser.js';
import { groupVoices, languageOf, listLanguages } from './voices.js';
import { Player } from './player.js';
import { StreamPlayer } from './stream-player.js';
import { bufferWaitSeconds, downloadName } from './audio-utils.js';
import { KokoroEngine } from './engines/kokoro.js';
import { AzureEngine } from './engines/azure.js';
import { BrowserEngine } from './engines/browser.js';
import { MyVoiceEngine } from './engines/myvoice.js';
import { initMyVoiceUI } from './myvoice-ui.js';

const STORAGE_KEY = 'text2voice.settings.v2';
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
  myvoice:
    'Hello! This is my own voice, telling a story I never had to record. [pause 0.5s] ' +
    'Once upon a time, a little fox found a door hidden in the forest... ' +
    'Where could it lead? [pause 0.6s] There was only one way to find out!',
};

const EXAMPLE = `The Lantern of Willow Hill

Once upon a time, at the edge of a sleepy town, there stood a hill covered in silver willows. [pause 0.5s] Every evening, an old woman named Mira climbed it with a small, glowing lantern.

The children of the town were curious. "Where does she go?" they whispered. "And why does she always come back smiling?"

One night, a brave boy named Theo followed her... [pause 1s] step by step, [slow]quietly, carefully[/slow], until he reached the very top.

There, beneath the stars, Mira turned around. [pitch high]"I knew you would come,"[/pitch] she said with a wink. [pause] "Would you like to see the secret?"

Theo nodded. And what he saw next [emph]changed everything[/emph].`;

const ENGINE_NOTES = {
  kokoro: '28 natural, human-like voices generated on your device (American & British English). The first use downloads the voice model once (~110 MB); after that it is cached. Downloads as WAV.',
  azure: 'Microsoft Azure neural voices: 400+ voices in 140+ languages with speaking styles. Text is sent to Azure AI Speech. Downloads as MP3.',
  azureOff: 'Azure voices are not configured on this server. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION to enable them.',
  browser: 'Your browser’s built-in voices: instant and offline, but they often sound robotic and cannot be downloaded.',
  myvoice: 'Your own cloned voice, generated privately on this server with Chatterbox. Pause, pitch, speed and question tags all work. Downloads as WAV.',
  myvoiceOff: 'My Voice is not enabled on this server. Start the voice-clone service (see README) to use it.',
};

const DEFAULTS = {
  text: '',
  engine: 'kokoro',
  gender: 'female',
  voices: {},
  langs: {},
  azureStyle: '',
  kokoroDevice: 'auto',
  expressiveness: 0.5,
  storyteller: true,
  question: 'natural',
  rate: 0.95,
  pitch: 1,
  pauseScale: 1,
  volume: 1,
};
const DELIVERY_KEYS = ['storyteller', 'question', 'rate', 'pitch', 'pauseScale', 'volume', 'expressiveness'];
const SLIDERS = ['rate', 'pitch', 'pauseScale', 'volume', 'expressiveness'];

const $ = (id) => document.getElementById(id);
const els = {
  text: $('text-input'),
  charCount: $('char-count'),
  pauseBtn: $('pause-btn'),
  pauseLength: $('pause-length'),
  exampleBtn: $('example-btn'),
  clearBtn: $('clear-btn'),
  lang: $('lang-select'),
  engineNote: $('engine-note'),
  azureSub: $('azure-sub'),
  loadRow: $('load-row'),
  loadProgress: $('load-progress'),
  loadText: $('load-text'),
  deviceField: $('device-field'),
  kokoroDevice: $('kokoro-device'),
  voice: { female: $('voice-female'), male: $('voice-male') },
  count: { female: $('female-count'), male: $('male-count') },
  voiceHint: $('voice-hint'),
  storyteller: $('storyteller'),
  question: $('question-mode'),
  styleField: $('style-field'),
  style: $('style-select'),
  rate: $('rate'),
  pitch: $('pitch'),
  pauseScale: $('pause-scale'),
  volume: $('volume'),
  expressiveness: $('expressive'),
  expressiveField: $('expressive-field'),
  outputs: { rate: $('rate-out'), pitch: $('pitch-out'), pauseScale: $('pause-out'), volume: $('volume-out'), expressiveness: $('expressive-out') },
  genderGrid: document.querySelector('.gender-grid'),
  myvoicePanel: $('myvoice-panel'),
  myvoiceSub: $('myvoice-sub'),
  resetBtn: $('reset-btn'),
  preview: $('preview'),
  duration: $('duration'),
  playBtn: $('play-btn'),
  stopBtn: $('stop-btn'),
  downloadBtn: $('download-btn'),
  status: $('status'),
  jobProgress: $('job-progress'),
  version: $('version'),
  updateBanner: $('update-banner'),
  reloadBtn: $('reload-btn'),
  supportBanner: $('support-banner'),
};

const engines = {
  kokoro: new KokoroEngine(),
  azure: new AzureEngine(),
  browser: new BrowserEngine(),
  myvoice: new MyVoiceEngine(),
};
let settings = loadSettings();
let engineVoices = [];
let unitEls = new Map();
let activeUnitEl = null;
let job = null; // current render: { kind: 'play' | 'download', label, key, controller, promise }
let lastRender = null; // { key, blob, ext, voiceName }
let lastPlaybackState = 'idle';

const speech = engines.browser.supported
  ? new Player({ onStateChange: updatePlayerUI, onError: (err) => setStatus(`Speech error: ${err}`) })
  : null;
const stream = new StreamPlayer({ onStateChange: updatePlayerUI });
const myVoiceUI = initMyVoiceUI({
  engine: engines.myvoice,
  onChange: (id) => {
    if (id) settings.voices.myvoice = id;
    lastRender = null;
    saveSettings();
    if (settings.engine === 'myvoice') refreshVoices();
  },
  onStatus: () => syncExpressiveField(),
});

function syncExpressiveField() {
  els.expressiveField.hidden = !(settings.engine === 'myvoice' && engines.myvoice.model === 'standard');
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const merged = structuredClone(DEFAULTS);
    for (const key of Object.keys(DEFAULTS)) {
      if (typeof saved[key] !== typeof DEFAULTS[key] || saved[key] === null) continue;
      if (typeof DEFAULTS[key] === 'object') {
        for (const [k, v] of Object.entries(saved[key])) if (typeof v === 'string') merged[key][k] = v;
      } else merged[key] = saved[key];
    }
    return merged;
  } catch {
    return structuredClone(DEFAULTS);
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

const engine = () => engines[settings.engine];

// ---------- Engines & voices ----------

function syncEngineUI() {
  document.querySelectorAll('input[name="engine"]').forEach((r) => {
    r.checked = r.value === settings.engine;
    r.disabled = !engines[r.value].supported;
  });
  const eng = engine();
  els.azureSub.textContent = engines.azure.supported ? 'Neural · cloud' : 'Not configured';
  const kokoroOn = eng.id === 'kokoro' && eng.loaded && eng.config;
  els.engineNote.textContent = kokoroOn
    ? `Natural voice model loaded ✓ (running on your ${eng.config.device === 'webgpu' ? 'graphics card' : 'processor'}) — 28 human-like voices. Downloads as WAV.`
    : ENGINE_NOTES[eng.id];
  els.deviceField.hidden = eng.id !== 'kokoro';
  els.kokoroDevice.value = settings.kokoroDevice;
  const mine = eng.id === 'myvoice';
  els.myvoiceSub.textContent = engines.myvoice.supported ? 'Your own voice' : 'Not enabled';
  els.genderGrid.hidden = mine;
  els.voiceHint.hidden = mine;
  els.myvoicePanel.hidden = !mine;
  els.lang.hidden = mine;
  syncExpressiveField();
  if (mine) myVoiceUI.refreshStatus();
  els.loadRow.hidden = true;
  els.downloadBtn.disabled = !eng.canDownload;
  els.downloadBtn.title = eng.canDownload ? `Download as ${eng.id === 'azure' ? 'MP3' : 'WAV'}` : 'Choose a Natural, Azure or My Voice voice to download audio';
}

async function selectEngine(id) {
  if (!engines[id] || !engines[id].supported) return;
  stopAll();
  settings.engine = id;
  saveSettings();
  syncEngineUI();
  await refreshVoices();
  schedulePreview();
}

async function refreshVoices() {
  const eng = engine();
  let list = [];
  try {
    list = await eng.voices();
  } catch (err) {
    setStatus(`Could not load ${eng.id} voices: ${err.message}`);
  }
  if (eng !== engine()) return; // engine changed while loading
  engineVoices = list;
  if (eng.id === 'myvoice') {
    settings.voices.myvoice = myVoiceUI.render(engineVoices, settings.voices.myvoice) || settings.voices.myvoice || '';
    populateStyles();
    return;
  }
  populateLanguages();
  populateVoices();
}

function populateLanguages() {
  const id = settings.engine;
  if (!engineVoices.length) {
    // Voices not loaded yet: keep the saved language choice.
    els.lang.replaceChildren(new Option('All languages', 'all'));
    return;
  }
  const langs = listLanguages(engineVoices, navigator.language || 'en');
  const codes = langs.map((l) => l.code);
  const browserLang = (navigator.language || 'en').split('-')[0].toLowerCase();
  let selected = settings.langs[id] || '';
  if (selected !== 'all' && !codes.includes(selected)) {
    selected = codes.includes(browserLang) ? browserLang : codes.includes('en') ? 'en' : 'all';
  }
  els.lang.replaceChildren(new Option('All languages', 'all'), ...langs.map((l) => new Option(l.label, l.code)));
  els.lang.value = selected;
  settings.langs[id] = selected;
}

let localeNames = null;
function localeLabel(tag) {
  try {
    localeNames ||= new Intl.DisplayNames([navigator.language || 'en', 'en'], { type: 'language' });
    return localeNames.of(tag) || tag;
  } catch {
    return tag;
  }
}

function voiceOption(v) {
  const opt = new Option(v.label || v.name, v.id);
  opt.title = v.title || v.name;
  return opt;
}

/** Optgroups per locale (e.g. American vs British English), or one group when there's a single locale. */
function voiceGroups(list, fallbackLabel) {
  const byLocale = new Map();
  for (const v of list) {
    if (!byLocale.has(v.lang)) byLocale.set(v.lang, []);
    byLocale.get(v.lang).push(v);
  }
  return [...byLocale.entries()].map(([lang, voices]) => {
    const group = document.createElement('optgroup');
    group.label = byLocale.size > 1 ? localeLabel(lang) : fallbackLabel;
    group.append(...voices.map(voiceOption));
    return group;
  });
}

function populateVoices() {
  const eng = engine();
  const groups = groupVoices(engineVoices, settings.langs[eng.id] || 'all');
  for (const gender of ['female', 'male']) {
    const select = els.voice[gender];
    const key = `${eng.id}:${gender}`;
    const children = voiceGroups(groups[gender], gender === 'female' ? 'Lady voices' : 'Man voices');
    if (groups.unknown.length) {
      const other = document.createElement('optgroup');
      other.label = eng.id === 'browser' ? 'Other voices (pitch-adjusted)' : 'Other voices';
      other.append(...groups.unknown.map(voiceOption));
      children.push(other);
    }
    if (!children.length) children.push(new Option(eng.id === 'browser' ? 'Browser default voice' : 'No voices for this language', ''));
    select.replaceChildren(...children);

    const ids = [...select.options].map((o) => o.value);
    const preferred = [settings.voices[key], eng.defaults[gender]].find((v) => v && ids.includes(v));
    select.value = preferred || ids[0];
    if (engineVoices.length) settings.voices[key] = select.value; // keep the saved choice until voices have loaded
    const n = groups[gender].length;
    els.count[gender].textContent = n ? `${n} voice${n === 1 ? '' : 's'}` : eng.id === 'browser' ? 'using pitch-adjusted voice' : 'none in this language';
  }

  if (eng.id === 'browser') {
    els.voiceHint.textContent = !engineVoices.length
      ? 'Loading voices… If none appear, your system may have no speech voices installed.'
      : 'Sounds robotic? Switch to ✨ Natural above for human-like voices you can download.';
  } else if (eng.id === 'kokoro') {
    els.voiceHint.textContent = 'Letters after each name are quality grades (A is best). ❤️ Heart, 🔥 Bella and Emma are great storytellers.';
  } else {
    els.voiceHint.textContent = 'HD and Multilingual voices sound the most natural. Voices with styles can narrate, whisper, cheer and more.';
  }
  populateStyles();
}

/** Returns the selected voice (for a gender) plus a pitch nudge for browser voices of unknown gender. */
function voiceProfile(gender) {
  const id = settings.engine === 'myvoice' ? myVoiceUI.selected() : els.voice[gender].value;
  const voice = engineVoices.find((v) => v.id === id) || null;
  const nudge = settings.engine !== 'browser' || (voice && voice.gender === gender) ? 1 : gender === 'female' ? 1.15 : 0.85;
  return { voice, nudge };
}

function populateStyles() {
  const { voice } = voiceProfile(settings.gender);
  const styles = settings.engine === 'azure' && voice && voice.styles ? voice.styles : [];
  els.styleField.hidden = !styles.length;
  const pretty = (s) => s.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  els.style.replaceChildren(new Option('Default', ''), ...styles.map((s) => new Option(pretty(s), s)));
  els.style.value = styles.includes(settings.azureStyle) ? settings.azureStyle : '';
}

const currentStyle = () => (settings.engine === 'azure' && !els.styleField.hidden ? els.style.value : '');

// ---------- Plan & preview ----------

function planFor(text, gender, overrides = {}) {
  const eng = engine();
  const { nudge } = voiceProfile(gender);
  return buildPlan(text, {
    storyteller: settings.storyteller,
    question: settings.question,
    rate: settings.rate,
    pitch: settings.pitch * nudge,
    pauseScale: settings.pauseScale,
    splitClauses: eng.splitClauses,
    splitQuestions: eng.id === 'browser',
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

function renderPreview(force = false) {
  if (!force && activeLabel() === 'script') return; // don't rebuild while highlighting playback
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

// ---------- Playback, rendering & download ----------

function activeOutput() {
  if (speech && speech.state !== 'idle') return speech;
  if (stream.state !== 'idle') return stream;
  return null;
}
const activeLabel = () => activeOutput()?.label ?? job?.label ?? null;

function stopAll() {
  if (job) {
    job.controller.abort();
    job = null;
  }
  speech?.stop();
  stream.stop();
  els.jobProgress.hidden = true;
  els.loadRow.hidden = true;
  updatePlayerUI();
}

const renderKey = (eng, voice, style, plan) =>
  JSON.stringify([eng.id, voice?.id ?? '', style, eng.id === 'myvoice' ? settings.expressiveness : null, plan.items]);

function playScript() {
  const out = activeOutput();
  if (out && out.label === 'script') return out.state === 'playing' ? out.pause() : out.resume();
  if (!els.text.value.trim()) {
    setStatus('Type something to speak first.');
    els.text.focus();
    return;
  }
  startPlayback('script', els.text.value, settings.gender);
}

function playSample(gender) {
  if (activeLabel() === `sample-${gender}`) {
    stopAll();
    setStatus('Ready');
    return;
  }
  startPlayback(`sample-${gender}`, SAMPLES[gender], gender, {
    storyteller: true,
    question: settings.question === 'off' ? 'natural' : settings.question,
  });
}

function startPlayback(label, text, gender, overrides = {}) {
  stopAll();
  const eng = engine();
  if (label === 'script') renderPreview(true);
  const plan = planFor(text, gender, overrides);
  const { voice } = voiceProfile(gender);
  const onUnit = label === 'script' ? highlightUnit : () => {};
  const who = voice ? voice.name : 'the default voice';

  if (eng.id === 'browser') {
    if (!speech) return setStatus('Speech synthesis is not available in this browser.');
    setStatus(`Speaking with ${who}… (≈ ${formatSeconds(estimateDuration(plan.items))})`);
    speech.play(plan.items, { voice: voice?.raw ?? null, volume: settings.volume, onUnit, label });
    return;
  }
  // Create the AudioContext now, inside the click handler, so the browser allows audio. It stays
  // silent ("hold") until enough audio is buffered to play through without gaps.
  stream.begin({ label, volume: settings.volume, onUnit, hold: true });
  runJob({ kind: 'play', label, eng, plan, voice, style: gender === settings.gender ? currentStyle() : '', player: stream });
}

function runJob({ kind, label, eng, plan, voice, style, player }) {
  const controller = new AbortController();
  const j = { kind, label, key: renderKey(eng, voice, style, plan), controller };
  job = j;
  els.jobProgress.value = 0;
  els.jobProgress.hidden = false;
  setStatus(kind === 'play' ? `Preparing ${voice ? voice.name : 'voice'}…` : 'Preparing download…');

  j.promise = eng
    .render(plan.items, {
      voice: voice?.id,
      style,
      expressiveness: settings.expressiveness,
      player,
      signal: controller.signal,
      onProgress: (fraction, phase) => reportProgress(j, fraction, phase, voice),
    })
    .then((result) => {
      lastRender = { key: j.key, ...result, voiceName: voice?.name };
      if (job === j) {
        job = null;
        els.jobProgress.hidden = true;
        player?.end();
        if (kind === 'download') saveAudio(lastRender);
        else setStatus(`Playing ${voice ? voice.name : ''} — audio ready to download`);
        updatePlayerUI();
      }
      return lastRender;
    })
    .catch((err) => {
      if (job === j) {
        job = null;
        els.jobProgress.hidden = true;
        els.loadRow.hidden = true;
        player?.stop();
        updatePlayerUI();
      }
      if (err.name !== 'AbortError') setStatus(`⚠️ ${err.message}`);
      throw err;
    });
  j.promise.catch(() => {});
  updatePlayerUI();
  return j;
}

function reportProgress(j, fraction, phase, voice) {
  if (job !== j) return;
  j.fraction = fraction;
  j.phase = phase;
  j.voiceName = voice ? voice.name : '';
  const pct = Math.round(fraction * 100);
  if (phase === 'loading' || phase === 'warmup') {
    els.loadRow.hidden = false;
    els.loadProgress.value = phase === 'warmup' ? 1 : fraction;
    els.loadText.textContent =
      phase === 'warmup' ? 'Warming up the voice engine…' : `Downloading voice model… ${pct}% (one time only)`;
    setStatus(phase === 'warmup' ? 'Almost ready…' : 'Loading the natural voice model…');
    return;
  }
  if (!els.loadRow.hidden) syncEngineUI();
  els.jobProgress.value = fraction;
  j.genStart ??= performance.now();
  if (j.kind === 'download') {
    setStatus(`Rendering audio… ${pct}%`);
    return;
  }
  if (stream.holding) {
    const wait = bufferWaitSeconds({
      elapsed: (performance.now() - j.genStart) / 1000,
      queued: stream.queuedSeconds,
      fraction,
    });
    if (wait <= 0) stream.release();
    else {
      const eta = Number.isFinite(wait) ? ` — playback starts in about ${formatSeconds(Math.ceil(wait))}` : '';
      setStatus(`Preparing ${j.voiceName || 'audio'}… ${pct}%${eta}`);
      return;
    }
  }
  setStatus(stream.starved ? `Generating speech… ${pct}%` : `Playing ${j.voiceName} — generating ahead ${pct}%`);
}

// Playback can catch up with (or overtake) generation between progress events; keep the status current.
setInterval(() => {
  if (job && job.phase === 'generating' && job.kind === 'play') reportProgress(job, job.fraction, job.phase, { name: job.voiceName });
}, 500);

async function download() {
  const eng = engine();
  if (!eng.canDownload) return;
  if (!els.text.value.trim()) {
    setStatus('Type something to download first.');
    els.text.focus();
    return;
  }
  const plan = planFor(els.text.value, settings.gender);
  const { voice } = voiceProfile(settings.gender);
  const key = renderKey(eng, voice, currentStyle(), plan);
  if (lastRender && lastRender.key === key) return saveAudio(lastRender);
  if (job && job.key === key) {
    if (job.kind === 'download') return;
    setStatus('Finishing the audio — the download will start when it is ready…');
    try {
      saveAudio(await job.promise);
    } catch {
      /* reported by runJob */
    }
    return;
  }
  stopAll();
  runJob({ kind: 'download', label: 'download', eng, plan, voice, style: currentStyle(), player: null });
}

function saveAudio({ blob, ext, voiceName }) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName(voiceName, ext);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  setStatus(`Saved ${a.download} (${(blob.size / 1048576).toFixed(1)} MB)`);
}

function updatePlayerUI() {
  const out = activeOutput();
  const label = out?.label ?? null;
  const state = out?.state ?? 'idle';
  const script = label === 'script';
  els.playBtn.textContent = script && state === 'playing' ? '⏸ Pause' : script && state === 'paused' ? '▶ Resume' : '▶ Play';
  els.stopBtn.disabled = !out && !job;
  els.downloadBtn.textContent = job?.kind === 'download' ? '⏳ Rendering…' : '⬇ Download';
  document.querySelectorAll('.sample-btn').forEach((btn) => {
    btn.textContent = activeLabel() === `sample-${btn.dataset.sample}` ? '■ Stop sample' : '▶ Hear sample';
  });
  if (state === 'paused') setStatus('Paused');
  else if (state === 'idle' && lastPlaybackState !== 'idle' && !job) setStatus('Ready');
  lastPlaybackState = state;
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
  for (const key of SLIDERS) {
    els[key].value = String(settings[key]);
    updateOutput(key);
  }
}

function updateOutput(key) {
  const v = settings[key];
  els.outputs[key].textContent = key === 'volume' ? `${Math.round(v * 100)}%` : `${v.toFixed(2)}×`;
}

function setGender(gender) {
  settings.gender = gender;
  document.querySelectorAll('input[name="gender"]').forEach((r) => {
    r.checked = r.value === gender;
  });
  document.querySelectorAll('.gender-option').forEach((card) => {
    card.classList.toggle('selected', card.dataset.gender === gender);
  });
  populateStyles();
  saveSettings();
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

async function loadServerConfig() {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) return;
    const { azure, myVoice } = await res.json();
    engines.azure = new AzureEngine({ enabled: Boolean(azure && azure.enabled), maxChars: azure?.maxChars });
    engines.myvoice.enabled = Boolean(myVoice && myVoice.enabled);
  } catch {
    /* static hosting without the API server: Azure and My Voice stay disabled */
  }
}

// ---------- Wiring ----------

function bindEvents() {
  els.text.addEventListener('input', onTextChanged);
  els.text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      playScript();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (activeOutput() || job)) stopAll();
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

  document.querySelectorAll('input[name="engine"]').forEach((radio) =>
    radio.addEventListener('change', () => selectEngine(radio.value)),
  );
  els.lang.addEventListener('change', () => {
    settings.langs[settings.engine] = els.lang.value;
    populateVoices();
    saveSettings();
    schedulePreview();
  });
  for (const gender of ['female', 'male']) {
    els.voice[gender].addEventListener('change', () => {
      settings.voices[`${settings.engine}:${gender}`] = els.voice[gender].value;
      setGender(gender);
    });
  }
  document.querySelectorAll('input[name="gender"]').forEach((radio) => radio.addEventListener('change', () => setGender(radio.value)));
  document.querySelectorAll('.gender-option').forEach((card) =>
    card.addEventListener('click', (e) => {
      if (!e.target.closest('select, button')) setGender(card.dataset.gender);
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
  els.style.addEventListener('change', () => {
    settings.azureStyle = els.style.value;
    saveSettings();
  });
  els.kokoroDevice.addEventListener('change', () => {
    stopAll();
    settings.kokoroDevice = els.kokoroDevice.value;
    engines.kokoro.setDevicePref(settings.kokoroDevice);
    lastRender = null;
    saveSettings();
    syncEngineUI();
  });
  for (const key of SLIDERS) {
    els[key].addEventListener('input', () => {
      settings[key] = Number(els[key].value);
      updateOutput(key);
      if (key === 'volume') stream.setVolume(settings.volume);
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
  els.stopBtn.addEventListener('click', () => {
    stopAll();
    setStatus('Stopped');
  });
  els.downloadBtn.addEventListener('click', download);
  els.reloadBtn.addEventListener('click', () => window.location.reload());

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkVersion();
    else if (saveTimer) writeSettings();
  });
  window.addEventListener('pagehide', () => {
    if (saveTimer) writeSettings();
    if (speech) window.speechSynthesis.cancel();
  });
}

async function init() {
  els.text.value = settings.text;
  syncDeliveryControls();
  setGender(settings.gender);
  onTextChanged();
  bindEvents();
  checkVersion();
  setInterval(checkVersion, VERSION_POLL_MS);

  await loadServerConfig();
  engines.kokoro.setDevicePref(settings.kokoroDevice);
  if (!engines[settings.engine]?.supported) {
    settings.engine = ['kokoro', 'azure', 'browser'].find((id) => engines[id].supported) || 'browser';
  }
  if (!Object.values(engines).some((e) => e.supported)) {
    els.supportBanner.hidden = false;
    els.playBtn.disabled = true;
    setStatus('Speech is not available in this browser.');
  }
  syncEngineUI();
  await refreshVoices();
  renderPreview();

  if (speech) {
    const synth = window.speechSynthesis;
    const onVoices = () => settings.engine === 'browser' && refreshVoices();
    if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', onVoices);
    else synth.onvoiceschanged = onVoices;
    // Some browsers populate voices late without firing voiceschanged.
    let retries = 0;
    const retry = setInterval(() => {
      if (synth.getVoices().length || ++retries > 20) {
        clearInterval(retry);
        onVoices();
      }
    }, 250);
  }
}

init();