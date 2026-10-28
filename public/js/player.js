// Plays a plan (from parser.buildPlan) through the Web Speech API, one phrase at a time.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Player {
  constructor({ onStateChange = () => {}, onError = () => {} } = {}) {
    this.synth = window.speechSynthesis;
    this.onStateChange = onStateChange;
    this.onError = onError;
    this.state = 'idle';
    this.label = null;
    this.session = null;
    this.paused = false;
  }

  setState(state) {
    this.state = state;
    this.onStateChange(state, this.label);
  }

  async play(items, { voice = null, volume = 1, onUnit = () => {}, label = null } = {}) {
    this.stop();
    const session = { cancelled: false, utterance: null, onUnit };
    this.session = session;
    this.label = label;
    this.setState('playing');
    // Chrome can silently drop utterances queued immediately after cancel().
    await sleep(60);

    for (const item of items) {
      if (session.cancelled) return;
      if (item.type === 'pause') await this.wait(item.ms, session);
      else await this.speakItem(item, voice, volume, session);
    }
    if (session.cancelled) return;
    onUnit(null);
    this.session = null;
    this.label = null;
    this.setState('idle');
  }

  speakItem(item, voice, volume, session) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(item.text);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.pitch = item.pitch;
      u.rate = item.rate;
      u.volume = volume;
      u.onstart = () => {
        if (!session.cancelled) session.onUnit(item.unit);
      };
      u.onend = () => resolve();
      u.onerror = (ev) => {
        if (!session.cancelled && ev.error !== 'interrupted' && ev.error !== 'canceled') this.onError(ev.error);
        resolve();
      };
      // Keep a reference: Chrome may garbage-collect the utterance and never fire onend.
      session.utterance = u;
      this.synth.speak(u);
    });
  }

  async wait(ms, session) {
    let remaining = ms;
    while (remaining > 0 && !session.cancelled) {
      const step = Math.min(50, remaining);
      await sleep(step);
      if (!this.paused) remaining -= step;
    }
  }

  pause() {
    if (this.state !== 'playing') return;
    this.paused = true;
    this.synth.pause();
    this.setState('paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.paused = false;
    this.synth.resume();
    this.setState('playing');
  }

  stop() {
    const wasActive = this.state !== 'idle';
    if (this.session) {
      this.session.cancelled = true;
      this.session.onUnit(null);
      this.session = null;
    }
    this.paused = false;
    this.synth.cancel();
    if (this.synth.paused) this.synth.resume();
    this.label = null;
    if (wasActive) this.setState('idle');
  }
}
