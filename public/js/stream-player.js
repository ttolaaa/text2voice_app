// Gapless Web Audio playback of audio that arrives piece by piece while it is still being generated.

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
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.ctx.resume?.();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(this.ctx.destination);
    this.cursor = this.ctx.currentTime + 0.15;
    this.startCursor = this.cursor;
    this.marks = [];
    this.sources = [];
    this.finished = false;
    this.onUnit = onUnit;
    this.currentUnit = null;
    this.label = label;
    // "hold" buffers audio silently until release(), so slow generation doesn't cause gaps.
    this.holding = hold;
    this.userPaused = false;
    if (hold) this.ctx.suspend();
    this.setState('playing');
    this.timer = setInterval(() => this.tick(), 80);
  }

  get active() {
    return Boolean(this.ctx);
  }

  /** Seconds of audio (including pauses) queued so far. */
  get queuedSeconds() {
    return this.ctx ? this.cursor - this.startCursor : 0;
  }

  /** True when playback has caught up with generation (listener is waiting). */
  get starved() {
    return this.ctx && !this.holding && !this.finished && this.ctx.currentTime > this.cursor;
  }

  /** Starts audible playback of buffered audio (no-op unless holding). */
  release() {
    if (!this.ctx || !this.holding) return;
    this.holding = false;
    if (!this.userPaused) this.ctx.resume();
  }

  addPcm(samples, sampleRate, unit = null) {
    if (!this.ctx || !samples.length) return;
    const buffer = this.ctx.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    this.addBuffer(buffer, unit === null ? [] : [{ offset: 0, unit }]);
  }

  addBuffer(buffer, marks = []) {
    if (!this.ctx) return;
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

  addSilence(ms) {
    if (!this.ctx) return;
    this.cursor = Math.max(this.cursor, this.ctx.currentTime) + ms / 1000;
  }

  /** Signals that no more audio will be added; playback ends after what is queued. */
  end() {
    this.finished = true;
    this.release();
  }

  tick() {
    if (!this.ctx) return;
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

  pause() {
    if (this.state !== 'playing' || !this.ctx) return;
    this.userPaused = true;
    this.ctx.suspend();
    this.setState('paused');
  }

  resume() {
    if (this.state !== 'paused' || !this.ctx) return;
    this.userPaused = false;
    if (!this.holding) this.ctx.resume();
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
    this.onUnit(null);
    this.label = null;
    this.setState('idle');
  }
}
