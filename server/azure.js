// Thin proxy to Azure AI Speech. The subscription key never leaves the server.
import { buildSsml, validateSpeakRequest } from './ssml.js';

const VOICE_CACHE_MS = 24 * 60 * 60 * 1000;
const REGION_RE = /^[a-z0-9]{3,30}$/;

export function createAzure({ key, region, maxChars = 3000, fetchImpl = globalThis.fetch } = {}) {
  const enabled = Boolean(key && region && REGION_RE.test(region));
  const base = enabled ? `https://${region}.tts.speech.microsoft.com` : '';
  let cache = { at: 0, list: null, map: null };

  async function voices() {
    if (!enabled) throw Object.assign(new Error('Azure Speech is not configured.'), { status: 503 });
    if (cache.list && Date.now() - cache.at < VOICE_CACHE_MS) return cache;
    const res = await fetchImpl(`${base}/cognitiveservices/voices/list`, {
      headers: { 'Ocp-Apim-Subscription-Key': key },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw Object.assign(new Error(`Azure voices request failed (HTTP ${res.status}).`), { status: 502 });
    const raw = await res.json();
    const list = raw
      .filter((v) => /neural/i.test(v.VoiceType || '') && v.ShortName)
      .map((v) => ({
        id: v.ShortName,
        name: v.DisplayName || v.LocalName || v.ShortName,
        gender: /female/i.test(v.Gender) ? 'female' : /male/i.test(v.Gender) ? 'male' : 'unknown',
        lang: v.Locale,
        styles: Array.isArray(v.StyleList) ? v.StyleList.filter((s) => typeof s === 'string') : [],
        hd: /HD/i.test(v.ShortName),
      }));
    cache = { at: Date.now(), list, map: new Map(list.map((v) => [v.id, v])) };
    return cache;
  }

  async function speak(body) {
    const { map } = await voices();
    const { value, error } = validateSpeakRequest(body, { maxChars, voices: map });
    if (error) throw Object.assign(new Error(error), { status: 400 });
    const res = await fetchImpl(`${base}/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
        'User-Agent': 'text2voice',
      },
      body: buildSsml(value),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const status = res.status === 429 ? 429 : 502;
      throw Object.assign(new Error(`Azure synthesis failed (HTTP ${res.status}).`), { status });
    }
    return { audio: Buffer.from(await res.arrayBuffer()), chars: value.chars };
  }

  return { enabled, region: enabled ? region : null, maxChars, voices, speak };
}
