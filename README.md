# 🎙️ Storyteller — Text to Voice

Turn any text into speech that sounds like a storyteller. You can pick a natural **lady or man** voice, or use your
**own cloned voice**. Add pauses, pitch changes and question intonation, then **play it or download it** as an
audio file. It works in desktop and mobile browsers.

- ✨ **28 natural voices** (American and British English) that run inside your browser
- 🎤 **My Voice**: record about 30 seconds of yourself, then any script plays in your voice
- ☁️ **Azure voices** (optional): 400+ Microsoft voices in 140+ languages, with speaking styles
- ⏸️ Pauses, ↑↓ pitch, 🐢🐇 speed, ✨ emphasis and ❓ question tools, plus **Storyteller mode**
- ⬇️ Download as **WAV** or **MP3**
- 📱 Responsive design for phones and tablets
- 🐳 One-command **Docker** deployment, with automatic HTTPS and auto-redeploy on every commit

---

## Contents

1. [Quick start](#-quick-start)
2. [How to use](#-how-to-use)
3. [Use it on your phone](#-use-it-on-your-phone)
4. [Deploy with Docker](#-deploy-with-docker)
5. [Auto-update on every commit](#-auto-update-on-every-commit)
6. [Push to GitHub](#-push-to-github)
7. [Local development](#-local-development-without-docker)
8. [Privacy and security](#-privacy-and-security)
9. [Project layout](#-project-layout)

---

## 🚀 Quick start

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/Mac) or Docker Engine (Linux).

```powershell
git clone https://github.com/ttolaaa/text2voice_app.git
cd text2voice_app
copy .env.example .env          # Linux/Mac: cp .env.example .env
docker compose up -d --build
```

Open **http://localhost:8080**. The first build downloads the voice models, which takes several minutes. Later
starts are fast.

---

## 📖 How to use

### 1. Write your script
Type or paste text into **Your script**, or click **Load example** to try a short story. Your text is saved
automatically in your browser.

### 2. Choose a voice engine

| Engine | Best for | Download format |
| --- | --- | --- |
| ✨ **Natural** (default) | Human-like lady and man voices, free, private (runs on your device) | WAV |
| 🎤 **My Voice** | Speaking in **your own voice** | WAV |
| ☁️ **Azure** | Many languages and speaking styles (needs an Azure key, see [Configuration](#configuration)) | MP3 |
| 🖥️ **Basic** | Instant, offline browser voices (robotic; can't be downloaded) | — |

The first time you play a **Natural** voice, the browser downloads the voice model once (~110–330 MB) and caches it.

### 3. Pick a lady or man voice
Under **Voice**, choose 👩 **Lady** or 👨 **Man**, then pick a voice from the list. Voices are grouped by accent and
the best ones are listed first (the letter after a name is its quality grade, and A is best). Tap **▶ Hear sample**
to hear a short story in that voice.

### 4. Add expression
Select some words, then tap a tool in the toolbar, or type the tags yourself:

| Tool | Tag | What it does |
| --- | --- | --- |
| ⏸ Pause | `[pause 1s]`, `[pause 500ms]`, `[pause long]` | Silence |
| ↑ Pitch high / ↓ Pitch low | `[pitch high]…[/pitch]` (also `x-low`, `low`, `x-high`, `+20%`, `1.3`) | Higher or lower voice |
| 🐢 Slow / 🐇 Fast | `[slow]…[/slow]`, `[fast]…[/fast]`, `[slow 0.6]` | Speed |
| ✨ Emphasis | `[emph]…[/emph]` | Short pause, then slower and stronger |
| ❓ Question | `[ask]…[/ask]` | Question intonation, even without `?` |

Sentences ending in `?` automatically get question intonation, and `…` and new paragraphs add natural pauses.

### 5. Shape the delivery
Under **Delivery**:
- **Storyteller mode** adds breathing pauses, gentle pitch variation and livelier exclamations.
- **Question intonation**: *Natural*, *Strong rise* or *Off*.
- **Speed**, **Pitch**, **Pause length** and **Volume** sliders. **Reset delivery** restores the defaults.

The **Performance preview** shows exactly how your text will be performed, and highlights each sentence as it plays.

### 6. Play and download
- **▶ Play** / **⏸ Pause** / **■ Stop** are in the bar at the bottom. On a computer, `Ctrl+Enter` plays and `Esc` stops.
- **⬇ Download** saves the audio file. If you've just played the same text, the download is instant.
- Slow engines (e.g. My Voice on a computer without a graphics card) prepare audio first, then play without gaps.
  The status bar shows a countdown.

### 7. Create **My Voice**
1. Choose **🎤 My Voice**, then **Create my voice**.
2. Give it a name and tick the consent box (*it must be your own voice*).
3. Tap **● Record** and read the passage shown, about **20–30 seconds** (minimum 10 s). You can also **upload** a
   recording of yourself (WAV, MP3, FLAC, OGG; M4A/WebM in Docker).
4. Listen back, then tap **Create voice**. It's ready in about 10–60 seconds.

Tips for a good clone:
- Use a quiet room and start speaking right away. The model listens most closely to the first ~10 seconds.
- Read with the feeling you want, such as warmly or like a storyteller. The clone copies your style.
- Not happy with it? **🗑 Delete** it and record again.

---

## 📱 Use it on your phone

The page works in Safari (iPhone/iPad) and Chrome (Android). The layout adapts, buttons are large enough to tap,
and the recording screen opens full-screen.

> **Important:** browsers only allow the **microphone** (for My Voice) and fast voices on **secure pages**:
> `https://…` or `http://localhost`. Opening `http://192.168.x.x:8080` from your phone works for listening, but
> recording won't work. Use one of these options for full features:

**Option A: quick test from your PC (VS Code port forwarding)**
1. Start the app on your PC (`docker compose up -d`).
2. In VS Code, open the **Ports** panel (*View → Terminal*, then the **Ports** tab) and click **Forward a Port**. Enter
   `8080`.
3. Right-click the port and choose **Port Visibility → Public**. Then copy the **Forwarded Address**
   (`https://…devtunnels.ms`).
4. Open that address on your phone.

**Option B: a permanent HTTPS address.** Deploy on a server with your own domain. Caddy adds a free HTTPS certificate
automatically; see [Deploy on a server with HTTPS](#deploy-on-a-server-with-https).

Phone tips:
- On iPhone, playback works even with the **silent switch** on (iOS 16.4+). Otherwise, turn the ringer on.
- On phones, Natural voices use the smaller **~110 MB** model by default. Use Wi-Fi for the first load.
- Downloads go to *Files → Downloads* (iPhone) or the *Downloads* folder (Android).

---

## 🐳 Deploy with Docker

### What gets deployed

| Container | Purpose | Port |
| --- | --- | --- |
| `text2voice` | The web app and API (Node.js, non-root, read-only filesystem) | `8080` |
| `text2voice-voice-clone` | **My Voice** cloning service (Chatterbox) | internal only |
| `text2voice-caddy` | *Optional* HTTPS reverse proxy (Let's Encrypt) | `80`, `443` |

**Requirements:** about **12 GB free disk space** (images plus voice models) and **8 GB RAM** (16 GB recommended for
My Voice). An NVIDIA GPU is optional but makes My Voice much faster.

### Deploy on your computer

```powershell
copy .env.example .env               # optional settings (Azure key, port, ...)
docker compose up -d --build         # build and start in the background
docker compose ps                    # check: all containers should be "running" / "healthy"
```

Open **http://localhost:8080**. On first start, **My Voice** downloads its model (~4 GB). The app shows
*"Voice service ready"* when it's done.

### Deploy on a server with HTTPS
On a Linux server (VPS or cloud VM) with a domain name, for example `voice.example.com`:

1. **Point your domain** to the server: create a DNS **A record** pointing to the server's public IP.
2. **Open ports 80 and 443** in the server's firewall or cloud security group.
3. **Install Docker and get the code:**
   ```bash
   curl -fsSL https://get.docker.com | sh
   git clone https://github.com/ttolaaa/text2voice_app.git && cd text2voice_app
   cp .env.example .env
   ```
4. **Edit `.env`** and enable HTTPS:
   ```ini
   COMPOSE_PROFILES=https
   DOMAIN=voice.example.com
   TRUST_PROXY=1
   PORT=127.0.0.1:8080
   ```
5. **Start everything:**
   ```bash
   docker compose up -d --build
   ```
6. Open **https://voice.example.com**. Caddy gets and renews the certificate automatically.

### NVIDIA GPU (faster My Voice)
Install the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/), then run:
```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```

### Configuration
All settings live in `.env` (copy it from `.env.example`). After changing it, run `docker compose up -d`.

| Setting | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Port the app is published on (`127.0.0.1:8080` keeps it private behind the proxy) |
| `COMPOSE_PROFILES` | — | `https` turns on the Caddy HTTPS proxy |
| `DOMAIN` | `localhost` | Your domain name for HTTPS |
| `TRUST_PROXY` | `0` | `1` when behind Caddy or another reverse proxy |
| `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | — | Turn on ☁️ Azure voices (Azure portal → Speech service → *Keys and Endpoint*) |
| `AZURE_REQUESTS_PER_MINUTE`, `AZURE_CHARS_PER_HOUR` | `30`, `60000` | Per-user limits that protect your Azure bill |
| `CLONE_URL` | built-in service | Set to empty (`CLONE_URL=`) to turn off My Voice |
| `CLONE_MODEL` | `turbo` | `turbo` (faster) or `standard` (slower, adds an *Expressiveness* slider) |
| `CLONE_DEVICE` | `auto` | `auto`, `cpu` or `cuda` |

### Everyday commands

```bash
docker compose ps                         # status
docker compose logs -f                    # live logs (Ctrl+C to exit)
docker compose logs -f voice-clone        # logs of one service
docker compose restart                    # restart
docker compose down                       # stop (your data is kept)
git pull && docker compose up -d --build  # update to the latest version
```

**Back up cloned voices** (they're stored in a Docker volume):
```bash
docker run --rm -v text2voice_clone-voices:/data -v "$PWD":/backup alpine tar czf /backup/voices-backup.tgz -C /data .
```

### Troubleshooting

| Problem | Fix |
| --- | --- |
| "My Voice service is not reachable" / "starting" | The first start downloads ~4 GB. Wait, and check `docker compose logs -f voice-clone`. |
| Can't record on a phone | Use an **https://** address (see [Use it on your phone](#-use-it-on-your-phone)), and allow microphone access. |
| **Create voice** stays grey | Enter a name, tick consent, and record at least 10 seconds. |
| Port 8080 already in use | Set another port in `.env`, e.g. `PORT=9000`. |
| HTTPS certificate not issued | Make sure DNS points to the server and ports 80 and 443 are open. Check `docker compose logs caddy`. |
| Out of disk space | `docker system prune` removes old images. |

---

## 🔄 Auto-update on every commit

Turn on the git hooks once per clone:

```powershell
git config core.hooksPath .githooks      # or: ./scripts/install-hooks.ps1  /  sh scripts/install-hooks.sh
```

| Hook | What it does |
| --- | --- |
| `pre-commit` | Runs the unit tests. A failing test stops the commit. |
| `post-commit` | Rebuilds the images from the **committed** code and restarts the containers. |
| `post-merge` | Does the same after `git pull`. |

- If Docker isn't running, the deploy is skipped and the commit still succeeds.
- Use `TEXT2VOICE_SKIP_DEPLOY=1` to skip a single deploy, and `TEXT2VOICE_GPU=1` to deploy with the GPU override.
- Open browser tabs show a **"new version"** banner after each deploy.
- **GitHub Actions** (`.github/workflows/docker.yml`) tests and builds both images on every push. Pushes to `main`
  publish them to `ghcr.io/<owner>/<repo>` and `ghcr.io/<owner>/<repo>-voice-clone`.

---

## 📤 Push to GitHub

This project lives at **https://github.com/ttolaaa/text2voice_app**.

### Everyday: save and publish a change
```powershell
git add -A                          # stage everything you changed
git commit -m "Describe the change" # runs the tests first; redeploys Docker locally if installed
git push                            # uploads to GitHub; GitHub Actions then builds the images
```
Check the **Actions** tab on GitHub to follow the build. The first build of the large voice-clone image takes about
10–15 minutes.

### Connecting a brand-new repository
Only needed if you publish this project to a different, empty repository:
```powershell
git remote add origin https://github.com/<your-username>/<repo>.git
git push -u origin main               # -u makes later pushes a plain `git push`
```
The first push opens a browser window to sign in to GitHub.

### Troubleshooting

| Message | Fix |
| --- | --- |
| `fatal: No configured push destination` | No repository is linked yet. Run `git remote add origin <repo-url>`, then `git push -u origin main`. |
| `remote origin already exists` | Already linked. Check it with `git remote -v`, or change it with `git remote set-url origin <repo-url>`. |
| `rejected … (fetch first)` / `non-fast-forward` | GitHub has commits you don't have. Run `git pull --rebase`, then `git push`. |
| `Authentication failed` | Sign in again when asked, or use a [personal access token](https://github.com/settings/tokens) as the password. |
| Tests fail and the commit is stopped | Fix the failing test (`node --test`), or skip the check once with `git commit --no-verify`. |

> **Tip:** don't run GitHub's quick-start line `echo "# name" >> README.md` in Windows PowerShell 5.1. It writes
> UTF-16 text that corrupts a UTF-8 README. Edit the file in VS Code instead.

**Never commit secrets.** `.env` (your Azure key), downloaded voice models (`public/vendor`, `public/models`) and
cloned-voice data are already excluded by `.gitignore`.

---

## 💻 Local development (without Docker)

```powershell
node scripts/fetch-assets.mjs          # one-time: downloads and verifies the Natural voice models (~450 MB)
node server/index.js                   # http://localhost:8080
node --test                            # run the unit tests
```

Optional: run the My Voice service locally (Python 3.10+):
```powershell
cd voice-clone
python -m venv .venv
.venv\Scripts\pip install torch torchaudio -r requirements.txt
$env:VOICE_DATA_DIR="$PWD\data"; .venv\Scripts\uvicorn app:app --port 8000
# in another terminal, from the project folder:
$env:CLONE_URL="http://127.0.0.1:8000"; node server/index.js
```

`ASSETS_DIR` lets you keep the downloaded models outside the project folder, for example outside a OneDrive-synced
folder.

---

## 🔒 Privacy and security

- **Natural voices** run entirely in your browser. Your text isn't sent anywhere.
- **My Voice** recordings stay on your server in the `clone-voices` Docker volume, never with a third party. Each
  voice can only be used and deleted from the browser that created it: the server stores only a hash of a secret
  owner token. Creating a voice requires a consent statement, and every generated clip carries an inaudible
  [watermark](https://github.com/resemble-ai/Perth) marking it as AI-made.
- **Azure voices** send the text to Microsoft Azure AI Speech. Your key stays on the server and is never sent to the
  browser.
- The app sends strict security headers (CSP and others) and accepts API calls from its own pages only. It
  rate-limits paid and heavy endpoints, and runs as a non-root user.

---

## 🗂 Project layout

```
public/                 web app (HTML, CSS, JavaScript)
  js/app.js             UI
  js/parser.js          tags + punctuation -> what to say and where to pause
  js/engines/           kokoro.js (Natural), azure.js, myvoice.js, browser.js (Basic)
  js/stream-player.js   gapless playback (Web Audio)
  js/recorder.js        microphone recording -> WAV
server/                 Node.js server: static files, Azure proxy, My Voice proxy
voice-clone/            My Voice service (FastAPI + Chatterbox) with its own Dockerfile
scripts/                model download (pinned + verified), deploy, git hook installers
tests/                  unit tests (node --test)
Dockerfile, docker-compose.yml, docker-compose.gpu.yml, Caddyfile, .env.example
```

**Licences:** Kokoro-82M and kokoro-js (Apache-2.0), Chatterbox (MIT, Resemble AI), onnxruntime-web (MIT).
