// Microphone recording for "My Voice". Captures raw PCM with an AudioWorklet, so it never needs to decode
// a compressed format (some browsers, e.g. VS Code's built-in one, record WebM/Opus but cannot decode it).
import { encodeWav } from './audio-utils.js';

export const TARGET_RATE = 24000;

/** Resamples mono PCM to 24 kHz with the browser's high-quality resampler (no decoding involved). */
async function toTargetRate(samples, sampleRate) {
  if (sampleRate === TARGET_RATE || !samples.length) return samples;
  const ctx = new OfflineAudioContext(1, Math.ceil((samples.length * TARGET_RATE) / sampleRate), TARGET_RATE);
  const buffer = ctx.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

export class VoiceRecorder {
  constructor({ onLevel = () => {}, onTick = () => {}, maxSeconds = 90, onAutoStop = () => {} } = {}) {
    Object.assign(this, { onLevel, onTick, maxSeconds, onAutoStop });
    this.recording = false;
  }

  static get supported() {
    return Boolean(navigator.mediaDevices?.getUserMedia && (window.AudioWorkletNode || window.ScriptProcessorNode));
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.resume();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.chunks = [];
    this.samples = 0;

    const onChunk = (chunk) => {
      if (!this.recording) return;
      this.chunks.push(chunk);
      this.samples += chunk.length;
      let sum = 0;
      for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
      this.onLevel(Math.min(1, Math.sqrt(sum / chunk.length) * 4));
      const seconds = this.samples / this.ctx.sampleRate;
      this.onTick(seconds);
      if (seconds >= this.maxSeconds) this.onAutoStop();
    };

    if (window.AudioWorkletNode) {
      await this.ctx.audioWorklet.addModule(new URL('./pcm-worklet.js', import.meta.url));
      this.node = new AudioWorkletNode(this.ctx, 'pcm-capture');
      this.node.port.onmessage = (e) => onChunk(e.data);
    } else {
      // Older browsers: ScriptProcessorNode is deprecated but widely available.
      this.node = this.ctx.createScriptProcessor(4096, 1, 1);
      this.node.onaudioprocess = (e) => onChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
    }
    // Route through a muted gain so the graph keeps processing without echoing the mic to the speakers.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    source.connect(this.node).connect(mute).connect(this.ctx.destination);
    this.recording = true;
  }

  /** Stops recording and resolves with { wav, seconds } (24 kHz mono WAV), or null if nothing was captured. */
  async stop() {
    if (!this.recording) return null;
    this.recording = false;
    const sampleRate = this.ctx.sampleRate;
    const merged = new Float32Array(this.samples);
    let offset = 0;
    for (const c of this.chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    this.release();
    if (!merged.length) return null;
    const pcm = await toTargetRate(merged, sampleRate);
    return { wav: new Blob([encodeWav([pcm], TARGET_RATE)], { type: 'audio/wav' }), seconds: pcm.length / TARGET_RATE };
  }

  cancel() {
    this.recording = false;
    this.release();
  }

  release() {
    try {
      this.node?.disconnect();
    } catch {
      /* already disconnected */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = null;
    this.ctx = null;
    this.node = null;
    this.chunks = [];
    this.onLevel(0);
  }
}

/**
 * Converts an uploaded file to a 24 kHz mono WAV in the browser when possible. If this browser can't decode
 * the format, the original file is returned (seconds: null) and the server converts it instead.
 */
export async function toWav(blob, maxSeconds = 120) {
  let decoded;
  try {
    const ctx = new OfflineAudioContext(1, 1, TARGET_RATE);
    // decodeAudioData resamples to the context's rate (24 kHz).
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    return { wav: blob, seconds: null, original: true };
  }
  const length = Math.min(decoded.length, Math.round(maxSeconds * TARGET_RATE));
  const mono = new Float32Array(length);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += ch[i] / decoded.numberOfChannels;
  }
  return { wav: new Blob([encodeWav([mono], TARGET_RATE)], { type: 'audio/wav' }), seconds: length / TARGET_RATE };
}
