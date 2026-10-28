// Microphone recording for "My Voice", plus conversion of any recording/upload to 24 kHz mono WAV.
import { encodeWav } from './audio-utils.js';

export const TARGET_RATE = 24000;

export class VoiceRecorder {
  constructor({ onLevel = () => {}, onTick = () => {}, maxSeconds = 90, onAutoStop = () => {} } = {}) {
    Object.assign(this, { onLevel, onTick, maxSeconds, onAutoStop });
    this.recording = false;
  }

  static get supported() {
    return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    this.ctx.createMediaStreamSource(this.stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);

    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(250);
    this.recording = true;
    this.startedAt = performance.now();

    const loop = () => {
      if (!this.recording) return;
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      this.onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      const seconds = (performance.now() - this.startedAt) / 1000;
      this.onTick(seconds);
      if (seconds >= this.maxSeconds) this.onAutoStop();
      else this.frame = requestAnimationFrame(loop);
    };
    loop();
  }

  /** Stops recording and resolves with the raw recording Blob. */
  stop() {
    if (!this.recording) return Promise.resolve(null);
    this.recording = false;
    cancelAnimationFrame(this.frame);
    return new Promise((resolve) => {
      this.recorder.onstop = () => {
        resolve(new Blob(this.chunks, { type: this.recorder.mimeType || 'audio/webm' }));
        this.release();
      };
      this.recorder.stop();
    });
  }

  cancel() {
    this.recording = false;
    cancelAnimationFrame(this.frame);
    try {
      this.recorder?.stop();
    } catch {
      /* not started */
    }
    this.release();
  }

  release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
    this.onLevel(0);
  }
}

/** Decodes any browser-supported audio and returns a 24 kHz mono 16-bit WAV Blob. */
export async function toWav(blob, maxSeconds = 120) {
  const ctx = new OfflineAudioContext(1, 1, TARGET_RATE);
  // decodeAudioData resamples to the context's rate (24 kHz).
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  const length = Math.min(decoded.length, Math.round(maxSeconds * TARGET_RATE));
  const mono = new Float32Array(length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += ch[i] / decoded.numberOfChannels;
  }
  return { wav: new Blob([encodeWav([mono], TARGET_RATE)], { type: 'audio/wav' }), seconds: length / TARGET_RATE };
}
