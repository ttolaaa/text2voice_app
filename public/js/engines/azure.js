// Azure AI Speech neural voices through the server proxy (/api/azure/*). Output: MP3.
import { estimateMarks, groupItems } from '../audio-utils.js';

const abortError = () => new DOMException('Cancelled', 'AbortError');

export class AzureEngine {
  id = 'azure';
  canDownload = true;
  splitClauses = false;
  defaults = { female: 'en-US-AvaMultilingualNeural', male: 'en-US-AndrewMultilingualNeural' };

  constructor({ enabled = false, maxChars = 3000 } = {}) {
    this.enabled = enabled;
    this.maxChars = maxChars;
    this.cache = null;
  }

  get supported() {
    return this.enabled;
  }

  async voices() {
    if (!this.enabled) return [];
    if (!this.cache) {
      this.cache = fetch('/api/azure/voices')
        .then(async (res) => {
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
          return (await res.json()).voices;
        })
        .then((list) =>
          list.map((v) => ({
            ...v,
            label: `${v.name}${v.hd ? ' HD' : ''}${v.styles.length ? ` · ${v.styles.length} styles` : ''}`,
            title: v.id,
            quality: (v.hd ? 3 : 0) + (/multilingual/i.test(v.id) ? 2 : 0) + (v.styles.length ? 1 : 0),
          })),
        );
      this.cache.catch(() => {
        this.cache = null;
      });
    }
    return this.cache;
  }

  async render(items, { voice, style = '', player = null, signal = null, onProgress = () => {} }) {
    const groups = groupItems(items, Math.min(1500, this.maxChars));
    const parts = [];
    onProgress(0, 'generating');
    for (const [i, group] of groups.entries()) {
      if (signal?.aborted) throw abortError();
      const res = await fetch('/api/azure/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice, style, items: group }),
        signal,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Azure request failed (HTTP ${res.status})`);
      const mp3 = await res.arrayBuffer();
      parts.push(mp3);
      if (player?.active) {
        const buffer = await player.ctx.decodeAudioData(mp3.slice(0));
        if (player.active) player.addBuffer(buffer, estimateMarks(group, buffer.duration));
      }
      onProgress((i + 1) / groups.length, 'generating');
    }
    return { blob: new Blob(parts, { type: 'audio/mpeg' }), ext: 'mp3' };
  }
}
