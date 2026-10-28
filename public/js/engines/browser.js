// The browser's built-in speechSynthesis voices: instant and offline, but cannot be downloaded.
import { classifyVoice, isNaturalVoice, shortVoiceName, voiceQuality } from '../voices.js';

export class BrowserEngine {
  id = 'browser';
  canDownload = false;
  splitClauses = undefined; // follow storyteller mode
  defaults = { female: '', male: '' };

  get supported() {
    return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  async voices() {
    if (!this.supported) return [];
    return window.speechSynthesis.getVoices().map((v) => ({
      id: v.name,
      name: v.name,
      label: `${isNaturalVoice(v) ? '✨ ' : ''}${shortVoiceName(v)}`,
      title: v.name,
      gender: classifyVoice(v),
      lang: v.lang,
      quality: voiceQuality(v),
      raw: v,
    }));
  }
}
