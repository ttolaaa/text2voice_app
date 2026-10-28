// UI for creating, choosing and deleting "My Voice" clones (recording dialog + voice panel).
import { VoiceRecorder, toWav } from './recorder.js';

const MIN_SECONDS = 10;
const CONSENT_SENTENCE = 'I am recording my own voice today, and I agree to let this app create a digital copy of it.';
const READING = `${CONSENT_SENTENCE}

Once upon a time, in a quiet little town by the river, there lived a curious girl who loved stories. Every evening she asked her grandfather, "What will we read tonight?" He would smile, open an old leather book, and begin to read… slowly, warmly, and full of wonder.

Can you imagine how exciting that was? What an adventure it turned out to be!`;

const $ = (id) => document.getElementById(id);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function initMyVoiceUI({ engine, onChange, onStatus = () => {} }) {
  const els = {
    panel: $('myvoice-panel'),
    empty: $('myvoice-empty'),
    has: $('myvoice-has'),
    select: $('myvoice-select'),
    del: $('myvoice-delete'),
    create: $('myvoice-new'),
    status: $('myvoice-status'),
    dialog: $('record-dialog'),
    name: $('rec-name'),
    consent: $('rec-consent'),
    script: $('rec-script'),
    recBtn: $('rec-btn'),
    time: $('rec-time'),
    level: $('rec-level'),
    playback: $('rec-playback'),
    file: $('rec-file'),
    recStatus: $('rec-status'),
    cancel: $('rec-cancel'),
    submit: $('rec-create'),
  };
  let take = null; // { wav, seconds, url }
  let busy = false;
  let statusTimer = null;
  const recorder = new VoiceRecorder({
    onLevel: (v) => (els.level.value = v),
    onTick: (s) => (els.time.textContent = fmt(s)),
    onAutoStop: () => stopRecording(),
  });

  const setRecStatus = (msg) => (els.recStatus.textContent = msg);

  function updateSubmit() {
    els.submit.disabled = busy || !els.name.value.trim() || !els.consent.checked || !take || take.seconds < MIN_SECONDS;
  }

  function setTake(next) {
    if (take?.url) URL.revokeObjectURL(take.url);
    take = next;
    els.playback.hidden = !take;
    if (take) {
      take.url = URL.createObjectURL(take.wav);
      els.playback.src = take.url;
      els.time.textContent = fmt(take.seconds);
      setRecStatus(
        take.seconds < MIN_SECONDS
          ? `That was ${Math.round(take.seconds)}s — please record at least ${MIN_SECONDS} seconds.`
          : `Got ${Math.round(take.seconds)}s of audio. Listen back, then create your voice (or record again).`,
      );
    } else {
      els.playback.removeAttribute('src');
    }
    updateSubmit();
  }

  async function startRecording() {
    if (!VoiceRecorder.supported) return setRecStatus('Recording is not supported in this browser — upload a file instead.');
    try {
      setTake(null);
      await recorder.start();
      els.recBtn.textContent = '■ Stop';
      els.recBtn.classList.add('recording');
      setRecStatus('Recording… read the passage above, then press Stop.');
    } catch (err) {
      setRecStatus(
        err && err.name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow it in your browser’s address bar, or upload a recording instead.'
          : `Could not start recording: ${err.message}`,
      );
    }
  }

  async function stopRecording() {
    const blob = await recorder.stop();
    els.recBtn.textContent = '● Record again';
    els.recBtn.classList.remove('recording');
    if (!blob) return;
    try {
      setTake(await toWav(blob));
    } catch (err) {
      setRecStatus(`Could not process the recording: ${err.message}`);
    }
  }

  function openDialog() {
    els.script.textContent = READING;
    els.name.value = '';
    els.consent.checked = false;
    els.recBtn.textContent = '● Record';
    els.time.textContent = '0:00';
    els.file.value = '';
    busy = false;
    setTake(null);
    setRecStatus('');
    els.dialog.showModal();
    els.name.focus();
  }

  async function submit() {
    if (els.submit.disabled) return;
    busy = true;
    updateSubmit();
    setRecStatus('Creating your voice… this usually takes 10–60 seconds.');
    try {
      const consentText = `${els.consent.parentElement.textContent.replace(/\s+/g, ' ').trim()} | Read aloud: "${CONSENT_SENTENCE}"`;
      const voice = await engine.create({ wav: take.wav, name: els.name.value.trim(), consentText });
      els.dialog.close();
      onChange(voice.id);
    } catch (err) {
      setRecStatus(`⚠️ ${err.message}`);
    } finally {
      busy = false;
      updateSubmit();
    }
  }

  async function refreshStatus() {
    clearTimeout(statusTimer);
    if (els.panel.hidden) return;
    let retry = 5000;
    try {
      const s = await engine.status();
      onStatus(s);
      if (s.ready) {
        retry = 0;
        els.status.textContent =
          s.device === 'cuda'
            ? 'Voice service ready on the GPU.'
            : 'Voice service ready. It runs on the CPU, so the app prepares a few seconds of audio before playback starts.';
      } else if (s.loading) {
        els.status.textContent = 'The voice model is starting on the server (the first start downloads its weights)…';
      } else {
        els.status.textContent = `⚠️ ${s.error || 'The voice service is not ready.'} Retrying…`;
        retry = 15000;
      }
    } catch (err) {
      els.status.textContent = `⚠️ ${err.message} Retrying…`;
      retry = 15000;
    }
    // Keep checking until the service is ready (e.g. while it starts or downloads its model).
    if (retry) statusTimer = setTimeout(refreshStatus, retry);
  }

  els.create.addEventListener('click', openDialog);
  els.recBtn.addEventListener('click', () => (recorder.recording ? stopRecording() : startRecording()));
  els.file.addEventListener('change', async () => {
    const file = els.file.files[0];
    if (!file) return;
    if (recorder.recording) recorder.cancel();
    setRecStatus('Reading file…');
    try {
      setTake(await toWav(file));
    } catch {
      setRecStatus('That file could not be read as audio. Try a WAV or MP3 file.');
    }
  });
  els.name.addEventListener('input', updateSubmit);
  els.consent.addEventListener('change', updateSubmit);
  els.submit.addEventListener('click', submit);
  els.cancel.addEventListener('click', () => els.dialog.close());
  els.dialog.addEventListener('close', () => {
    recorder.cancel();
    setTake(null);
  });
  els.select.addEventListener('change', () => onChange(els.select.value));
  els.del.addEventListener('click', async () => {
    const opt = els.select.selectedOptions[0];
    if (!opt || !window.confirm(`Delete the voice “${opt.textContent}” permanently from the server?`)) return;
    try {
      await engine.remove(opt.value);
      onChange(null);
    } catch (err) {
      els.status.textContent = `⚠️ ${err.message}`;
    }
  });

  return {
    /** Shows the user's voices; returns the selected voice id (or ''). */
    render(voices, selectedId) {
      els.select.replaceChildren(...voices.map((v) => Object.assign(new Option(v.label, v.id), { title: v.title })));
      els.has.hidden = !voices.length;
      els.empty.hidden = Boolean(voices.length);
      els.create.textContent = voices.length ? '🎤 Create another voice' : '🎤 Create my voice';
      const ids = voices.map((v) => v.id);
      els.select.value = ids.includes(selectedId) ? selectedId : ids[0] || '';
      return els.select.value;
    },
    selected: () => els.select.value,
    refreshStatus,
  };
}
