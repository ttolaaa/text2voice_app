// Kokoro-82M neural voices, generated in the browser (Web Worker + WebAssembly). Output: WAV.
import { chunkText, encodeWav, resample } from '../audio-utils.js';

const GRADE_SCORE = { A: 10, 'A-': 9.5, 'B+': 8.5, B: 8, 'B-': 7.5, 'C+': 6.5, C: 6, 'C-': 5.5, 'D+': 4.5, D: 4, 'D-': 3.5, 'F+': 2, F: 1 };

// id, display name, quality grade (from the Kokoro model card), trait emoji
const VOICES = [
  ['af_heart', 'Heart', 'A', '❤️'], ['af_bella', 'Bella', 'A-', '🔥'], ['af_nicole', 'Nicole', 'B-', '🎧'],
  ['af_aoede', 'Aoede', 'C+'], ['af_kore', 'Kore', 'C+'], ['af_sarah', 'Sarah', 'C+'], ['af_alloy', 'Alloy', 'C'],
  ['af_nova', 'Nova', 'C'], ['af_sky', 'Sky', 'C-'], ['af_jessica', 'Jessica', 'D'], ['af_river', 'River', 'D'],
  ['am_fenrir', 'Fenrir', 'C+'], ['am_michael', 'Michael', 'C+'], ['am_puck', 'Puck', 'C+'], ['am_echo', 'Echo', 'D'],
  ['am_eric', 'Eric', 'D'], ['am_liam', 'Liam', 'D'], ['am_onyx', 'Onyx', 'D'], ['am_santa', 'Santa', 'D-'],
  ['am_adam', 'Adam', 'F+'],
  ['bf_emma', 'Emma', 'B-'], ['bf_isabella', 'Isabella', 'C'], ['bf_alice', 'Alice', 'D'], ['bf_lily', 'Lily', 'D'],
  ['bm_fable', 'Fable', 'C'], ['bm_george', 'George', 'C'], ['bm_lewis', 'Lewis', 'D+'], ['bm_daniel', 'Daniel', 'D'],
];

const abortError = () => new DOMException('Cancelled', 'AbortError');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class KokoroEngine {
  id = 'kokoro';
  canDownload = true;
  splitClauses = false;
  defaults = { female: 'af_heart', male: 'am_michael' };

  constructor() {
    this.worker = null;
    this.loading = null;
    this.loaded = false;
    this.pending = new Map();
    this.seq = 0;
    this.files = {};
    this.onLoadProgress = () => {};
    this.devicePref = 'auto'; // 'auto' | 'gpu' | 'cpu'
    this.config = null; // the { device, dtype } actually in use
  }

  get supported() {
    return typeof Worker !== 'undefined' && typeof WebAssembly === 'object';
  }

  /** Switching device needs a fresh worker; the next use reloads the model. */
  setDevicePref(pref) {
    if (pref === this.devicePref) return;
    this.devicePref = pref;
    if (this.worker) this.reset();
  }

  reset() {
    this.worker?.terminate();
    this.worker = null;
    this.loading = null;
    this.loaded = false;
    this.config = null;
    this.files = {};
  }

  async pickConfig() {
    if (this.devicePref !== 'cpu' && navigator.gpu) {
      try {
        if (await navigator.gpu.requestAdapter()) return { device: 'webgpu', dtype: 'fp32' };
      } catch {
        /* no usable GPU */
      }
    }
    return { device: 'wasm', dtype: 'q8' };
  }

  async voices() {
    return VOICES.map(([id, name, grade, trait]) => ({
      id,
      name,
      label: `${trait ? `${trait} ` : ''}${name} · ${grade}`,
      title: `${name} — Kokoro quality grade ${grade}`,
      gender: id[1] === 'f' ? 'female' : 'male',
      lang: id[0] === 'b' ? 'en-GB' : 'en-US',
      quality: GRADE_SCORE[grade] || 0,
    }));
  }

  /** Loads the model once (GPU: ~330 MB, CPU: ~110 MB; cached by the browser afterwards). */
  load(onProgress = () => {}) {
    this.onLoadProgress = onProgress;
    if (!this.loading) {
      this.loading = (async () => {
        const preferred = await this.pickConfig();
        try {
          await this.startWorker(preferred);
        } catch (err) {
          if (preferred.device !== 'webgpu' || this.devicePref === 'gpu') throw err;
          console.warn('WebGPU voice engine failed, falling back to CPU:', err);
          this.reset();
          await this.startWorker({ device: 'wasm', dtype: 'q8' });
        }
      })();
      this.loading.catch(() => this.reset());
    }
    return this.loading;
  }

  startWorker(config) {
    this.config = config;
    this.worker = new Worker(new URL('../kokoro-worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.handleMessage(e.data);
    const ready = new Promise((resolve, reject) => {
      this.resolveLoad = resolve;
      this.rejectLoad = reject;
      this.worker.onerror = (e) => this.failLoad(new Error(e.message || 'Failed to start the voice engine.'));
    });
    this.worker.postMessage({ type: 'load', ...config });
    return ready;
  }

  failLoad(err) {
    this.rejectLoad?.(err);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  handleMessage(msg) {
    if (msg.type === 'progress' && msg.status === 'warmup') {
      this.onLoadProgress(1, 'warmup');
    } else if (msg.type === 'progress' && msg.file && msg.total) {
      this.files[msg.file] = { loaded: msg.loaded || 0, total: msg.total };
      const all = Object.values(this.files);
      const total = all.reduce((s, f) => s + f.total, 0);
      this.onLoadProgress(total ? all.reduce((s, f) => s + f.loaded, 0) / total : 0);
    } else if (msg.type === 'ready') {
      this.loaded = true;
      this.resolveLoad();
    } else if (msg.type === 'audio') {
      this.pending.get(msg.id)?.resolve(msg);
      this.pending.delete(msg.id);
    } else if (msg.type === 'error') {
      const err = new Error(msg.message);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        this.pending.get(msg.id).reject(err);
        this.pending.delete(msg.id);
      } else this.failLoad(err);
    }
  }

  synthesize(text, voice, speed) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'generate', id, text, voice, speed });
    });
  }

  async render(items, { voice, player = null, signal = null, onProgress = () => {} }) {
    await this.load((f, stage) => onProgress(f, stage === 'warmup' ? 'warmup' : 'loading'));
    let sampleRate = 24000;
    const chunks = [];
    const total = items.filter((it) => it.type === 'speak').length || 1;
    let done = 0;
    onProgress(0, 'generating');

    for (const item of items) {
      if (signal?.aborted) throw abortError();
      if (item.type === 'pause') {
        chunks.push(new Float32Array(Math.round((item.ms / 1000) * sampleRate)));
        player?.addSilence(item.ms);
        continue;
      }
      const pitch = item.pitch || 1;
      // Pitch is applied by resampling, which also speeds audio up; synthesise slower to compensate.
      const speed = clamp((item.rate || 1) / pitch, 0.5, 2);
      for (const piece of chunkText(item.text, 300)) {
        const out = await this.synthesize(piece, voice, speed);
        if (signal?.aborted) throw abortError();
        sampleRate = out.sampleRate;
        const samples = resample(out.samples, pitch);
        chunks.push(samples);
        player?.addPcm(samples, sampleRate, item.unit);
      }
      onProgress(++done / total, 'generating');
    }
    return { blob: new Blob([encodeWav(chunks, sampleRate)], { type: 'audio/wav' }), ext: 'wav' };
  }
}
