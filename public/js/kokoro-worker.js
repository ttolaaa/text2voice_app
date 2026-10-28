// Runs the Kokoro neural TTS model off the main thread so the page stays responsive.

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const REMOTE_PREFIX = /^https:\/\/huggingface\.co\/onnx-community\/Kokoro-82M-v1\.0-ONNX\/resolve\/[^/]+\//;
const LOCAL_PREFIX = new URL('../models/kokoro/', import.meta.url).href;

// kokoro-js has Hugging Face URLs built in; serve the same files from our own origin instead.
const nativeFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return REMOTE_PREFIX.test(url) ? nativeFetch(url.replace(REMOTE_PREFIX, LOCAL_PREFIX), init) : nativeFetch(input, init);
};

let ttsPromise = null;

function load({ device = 'wasm', dtype = 'q8' } = {}) {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      const { KokoroTTS, env } = await import('../vendor/kokoro/kokoro.web.js');
      env.wasmPaths = new URL('../vendor/ort/', import.meta.url).href;
      const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype,
        device,
        progress_callback: (p) => self.postMessage({ type: 'progress', ...pick(p) }),
      });
      // The first run compiles GPU shaders / warms caches; do it now rather than on the user's first sentence.
      self.postMessage({ type: 'progress', status: 'warmup' });
      await tts.generate('Ready.', { voice: 'af_heart' });
      return tts;
    })();
    ttsPromise.catch(() => {
      ttsPromise = null;
    });
  }
  return ttsPromise;
}

const pick = ({ status, file, loaded, total }) => ({ status, file, loaded, total });

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      await load(data);
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'generate') {
      const tts = await load();
      const audio = await tts.generate(data.text, { voice: data.voice, speed: data.speed });
      const samples = audio.audio;
      self.postMessage({ type: 'audio', id: data.id, samples, sampleRate: audio.sampling_rate }, [samples.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: data.id, message: err && err.message ? err.message : String(err) });
  }
};
