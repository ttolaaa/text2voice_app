# 🎙️ Storyteller — Text to Voice

A web app that reads your text aloud like a storyteller. You can choose natural lady or man voices, use your
**own cloned voice**, control pauses, pitch and questions, and **download the audio**.

## Voice engines

| Engine | Voices | Runs where | Download | Needs |
| --- | --- | --- | --- | --- |
| ✨ **Natural** (default) | 28 human-like voices (Kokoro-82M; American and British English, lady and man) | In your browser (WebGPU, or WebAssembly) | WAV | Nothing; the model is self-hosted by this app |
| ☁️ **Azure** | 400+ Microsoft neural voices, 140+ languages, speaking styles (narration, cheerful, whisper…) | Azure AI Speech (cloud) | MP3 | `AZURE_SPEECH_KEY` + `AZURE_SPEECH_REGION` |
| 🎤 **My Voice** | Your own voice, cloned from about 30 s of recording | The bundled `voice-clone` container (Chatterbox, MIT) | WAV | The `voice-clone` service (included in `docker compose`) |
| 🖥️ **Basic** | The browser's built-in voices | Your browser | — | Nothing (offline, but robotic) |

The Natural engine picks the **graphics card (WebGPU)** automatically when one is available. That is faster than
real time (it downloads a ~330 MB model once). Otherwise it uses the **processor** (a ~110 MB model, slower than
real time on long sentences). You can override this under **Voice → Run natural voices on**. Playback starts after
the first sentence is ready, while the rest is generated in the background.

## Features

- **Text input** with autosave, a character counter and an example story.
- **Lady / Man** voice cards with a **Hear sample** story clip for each. Voices are grouped by accent and locale,
  with the best-sounding voices first.
- **Storyteller mode** adds breathing pauses at sentence ends, `…` and paragraphs, varies the pitch slightly, and
  makes exclamations and dialogue livelier.
- **Expression tools**: select text and click a toolbar button, or type the tags yourself:

  | Tag | Effect |
  | --- | --- |
  | `[pause]`, `[pause 2s]`, `[pause 500ms]`, `[pause long]` | Silence |
  | `[pitch high]…[/pitch]` (`x-low`, `low`, `high`, `x-high`, `+20%`, `1.3`) | Raise or lower the pitch |
  | `[slow]…[/slow]`, `[fast]…[/fast]` (optional factor, e.g. `[slow 0.6]`) | Change the speed |
  | `[emph]…[/emph]` | Emphasis |
  | `[ask]…[/ask]` | Question intonation, even without a `?` |

- **Question intonation** for sentences ending in `?`: *Natural*, *Strong rise* or *Off*.
- **Delivery controls**: speed, pitch, pause length and volume, plus a speaking style (Azure) and expressiveness
  (My Voice).
- **Download** the performance as WAV or MP3 (⬇ in the player bar). If you've just played the text, the download is
  instant.
- **Live preview** shows the pauses, questions and emphasis, and highlights each phrase while it plays.
- **Update banner**: the page offers to reload when a newer commit has been deployed.

## 🎤 My Voice (voice cloning)

1. Choose **🎤 My Voice**, then **Create my voice**.
2. Name the voice and confirm the consent statement: *this is your own voice*.
3. Read the short passage aloud (about 30 seconds in a quiet room), or upload a recording of yourself.
4. Click **Create voice**. A few seconds later, any script plays and downloads in your voice, with all the pause,
   pitch, speed and question controls.

**Privacy and safety**

- Recordings and voice data stay in the `clone-voices` Docker volume on your server. They are never sent to a third
  party.
- Each voice belongs to the browser that created it. The server returns a random owner token and stores only its
  SHA-256 hash, so other visitors can't list, use or delete your voice. **🗑 Delete** removes it from the server.
- Creating a voice requires an explicit consent statement, which is stored with the voice.
- Every clip Chatterbox generates carries an inaudible
  [Perth watermark](https://github.com/resemble-ai/Perth) that marks it as AI-generated.
- Chatterbox's model is English-only.

**Performance**: the service uses **Chatterbox Turbo** by default. On a CPU it generates speech roughly 4–5× slower
than real time, so for longer scripts the app buffers first, then plays without gaps; the status bar counts down to
the start. Downloads aren't affected, because they just take a little longer. Set `CLONE_MODEL=standard` for the
original model, which adds an **Expressiveness** slider but is about 2× slower. An NVIDIA GPU makes both much faster:

```powershell
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build   # needs NVIDIA Container Toolkit
```

The first start of `voice-clone` downloads the Chatterbox weights (Turbo ~3.8 GB, standard ~3 GB) into the
`clone-models` volume. The app shows when the model is ready.

## Run with Docker (recommended)

```powershell
copy .env.example .env      # optional: add Azure keys, change the port
docker compose up -d --build
# open http://localhost:8080
```

- `text2voice` is a dependency-free Node server (static site, self-hosted voice model and API proxy). It runs as a
  non-root user on a read-only filesystem, sends a strict CSP and cross-origin isolation headers, and provides
  `/healthz`.
- `voice-clone` is a FastAPI and Chatterbox service. It is reachable only from the app over the private Docker
  network, never from the host.
- To disable My Voice, set `CLONE_URL=` (empty) in `.env` and run `docker compose up -d text2voice`.

### Azure voices

Create an Azure **Speech** resource, then put its key and region in `.env`:

```ini
AZURE_SPEECH_KEY=your-key
AZURE_SPEECH_REGION=eastus
```

The key stays on the server. The browser only talks to `/api/azure/*`, which accepts same-origin requests only,
validates and XML-escapes everything, and is rate-limited per client (`AZURE_REQUESTS_PER_MINUTE`,
`AZURE_CHARS_PER_HOUR`). If the app is behind a reverse proxy, set `TRUST_PROXY=1`.

## Always up to date on every commit

Enable the git hooks once per clone:

```powershell
git config core.hooksPath .githooks      # or: ./scripts/install-hooks.ps1  /  sh scripts/install-hooks.sh
```

| Hook | What it does |
| --- | --- |
| `pre-commit` | Runs the unit tests (`node --test`). A failing test aborts the commit. |
| `post-commit` | Runs `scripts/deploy.sh`, which exports the **committed** tree (`git archive HEAD`), builds both images and restarts the containers. |
| `post-merge` | Runs the same deploy after `git pull` or `git merge`. |

- If Docker isn't installed or running, the deploy is skipped and the commit still succeeds.
- Use `TEXT2VOICE_SKIP_DEPLOY=1` to skip a single deploy, and `TEXT2VOICE_GPU=1` to deploy with the GPU override.
- Docker layer caching keeps redeploys quick. The voice model download and the PyTorch install only rerun when
  `scripts/assets.lock.json` or `voice-clone/` change.

**CI/CD:** `.github/workflows/docker.yml` runs the tests, then builds `ghcr.io/<owner>/<repo>` and
`ghcr.io/<owner>/<repo>-voice-clone`. On pushes to `main`/`master` it publishes them (`:latest` and `:sha-…`).

## Local development (without Docker)

```powershell
node scripts/fetch-assets.mjs          # one-time: downloads and verifies the Natural voice model (~450 MB)
node server/index.js                   # http://localhost:8080
```

Optional My Voice service locally (Python 3.10+):

```powershell
cd voice-clone
python -m venv .venv; .venv\Scripts\pip install torch torchaudio -r requirements.txt
$env:VOICE_DATA_DIR="$PWD\data"; .venv\Scripts\uvicorn app:app --port 8000
# then start the app with:  $env:CLONE_URL="http://127.0.0.1:8000"; node server/index.js
```

`ASSETS_DIR` lets you keep the downloaded model outside the project folder, for example outside a OneDrive-synced
folder.

## Tests

```powershell
node --test
```

## Project layout

```
public/                 static site
  js/parser.js          tags + punctuation -> speak/pause plan
  js/audio-utils.js     resampling, WSOLA time-stretch, WAV encoding, chunking
  js/engines/           kokoro.js, azure.js, myvoice.js, browser.js
  js/kokoro-worker.js   in-browser neural TTS worker (self-hosted model)
  js/stream-player.js   gapless streaming playback (Web Audio)
  js/recorder.js        microphone recording -> 24 kHz WAV
  js/myvoice-ui.js      create / choose / delete cloned voices
server/                 Node server: static files, Azure proxy (ssml.js), My Voice proxy
voice-clone/            FastAPI + Chatterbox voice-cloning service (Dockerfile)
scripts/                fetch-assets.mjs (+ assets.lock.json), deploy.sh, install-hooks
tests/                  node:test unit tests
Dockerfile, docker-compose.yml, docker-compose.gpu.yml, .env.example
```

## Licences

Kokoro-82M (Apache-2.0) and kokoro-js (Apache-2.0); Chatterbox (MIT, Resemble AI); onnxruntime-web (MIT).
#   t e x t 2 v o i c e _ a p p  
 