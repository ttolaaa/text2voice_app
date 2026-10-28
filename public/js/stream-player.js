// Gapless Web Audio playback of audio that arrives piece by piece while it is still being generated.
// Mobile-safe: the AudioContext is started (and "unlocked" on iOS) inside the user's tap and is never
// suspended by script while buffering; held audio is queued and scheduled when release() is called.

export class StreamPlayer {
  constructor({ onStateChange = () => {} } = {}) {
    this.onStateChange = onStateChange;
    this.state = 'idle';
    this.label = null;
    this.ctx = null;
  }

  setState(state) {
    this.state = state;
    this.onStateChange(state, this.label);
  }

  /** Must be called synchronously from a user gesture so the AudioContext may start. */
  begin({ label = null, volume = 1, onUnit = () => {}, hold = false } = {}) {
    this.stop();
    // iOS: play Web Audio even when the ring/silent switch is set to silent (Safari 16.4+).
    if (navigator.audioSession) {
      try {
        navigator.audioSession.type = 'playback';
      } catch {
        /* not supported */
      }
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.ctx.resume?.();
    // iOS unlock: start a tiny silent buffer during the tap so later audio is allowed to play.
    const unlock = this.ctx.createBufferSource();
    unlock.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    unlock.connect(this.ctx.destination);
    unlock.start(0);

    this.gain = this.ctx.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(this.ctx.destination);
    this.cursor = this.ctx.currentTime + 0.15;
    this.queued = 0;
    this.pending = [];
    this.marks = [];
    this.sources = [];
    this.finished = false;
    this.onUnit = onUnit;
    this.currentUnit = null;
    this.label = label;
    // "hold" collects audio silently until release(), so slow generation doesn't cause gaps.
    this.holding = hold;
    this.setState('playing');
    this.timer = setInterval(() => this.tick(), 80);
  }

  get active() {
    return Boolean(this.ctx);
  }

  /** Seconds of audio (including pauses) produced so far. */
  get queuedSeconds() {
    return this.ctx ? this.queued : 0;
  }

  /** True when playback has caught up with generation (listener is waiting). */
  get starved() {
    return Boolean(this.ctx && !this.holding && !this.finished && this.ctx.currentTime > this.cursor);
  }

  /** Starts audible playback of held audio (no-op unless holding). */
  release() {
    if (!this.ctx || !this.holding) return;
    this.holding = false;
    this.cursor = this.ctx.currentTime + 0.1;
    const pending = this.pending;
    this.pending = [];
    for (const p of pending) {
      if (p.buffer) this.schedule(p.buffer, p.marks);
      else this.cursor += p.seconds;
    }
  }

  addPcm(samples, sampleRate, unit = null) {
    if (!this.ctx || !samples.length) return;
    const buffer = this.ctx.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    this.addBuffer(buffer, unit === null ? [] : [{ offset: 0, unit }]);
  }

  addBuffer(buffer, marks = []) {
    if (!this.ctx) return;
    this.queued += buffer.duration;
    if (this.holding) this.pending.push({ buffer, marks });
    else this.schedule(buffer, marks);
  }

  addSilence(ms) {
    if (!this.ctx) return;
    this.queued += ms / 1000;
    if (this.holding) this.pending.push({ seconds: ms / 1000 });
    else this.cursor = Math.max(this.cursor, this.ctx.currentTime) + ms / 1000;
  }

  schedule(buffer, marks) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);
    const start = Math.max(this.cursor, this.ctx.currentTime + 0.05);
    src.start(start);
    this.sources.push(src);
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
    };
    for (const m of marks) this.marks.push({ time: start + m.offset, unit: m.unit });
    this.cursor = start + buffer.duration;
  }

  /** Signals that no more audio will be added; playback ends after what is queued. */
  end() {
    this.finished = true;
    this.release();
  }

  tick() {
    if (!this.ctx || this.holding) return;
    const now = this.ctx.currentTime;
    let unit = null;
    for (const m of this.marks) {
      if (m.time <= now) unit = m.unit;
      else break;
    }
    if (unit !== this.currentUnit) {
      this.currentUnit = unit;
      this.onUnit(unit);
    }
    if (this.finished && now >= this.cursor) this.stop();
  }

  setVolume(v) {
    if (this.gain) this.gain.gain.value = v;
  }

  // pause()/resume() are only called from button taps, so they are allowed on mobile.
  pause() {
    if (this.state !== 'playing' || !this.ctx) return;
    this.ctx.suspend();
    this.setState('paused');
  }

  resume() {
    if (this.state !== 'paused' || !this.ctx) return;
    this.ctx.resume();
    this.setState('playing');
  }

  stop() {
    if (!this.ctx) return;
    clearInterval(this.timer);
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.ctx.close().catch(() => {});
    this.ctx = null;
    this.sources = [];
    this.pending = [];
    this.onUnit(null);
    this.label = null;
    this.setState('idle');
  }
}
