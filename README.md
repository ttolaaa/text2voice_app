# 🎙️ Storyteller — Text to Voice

A client-side web app that reads your text aloud like a storyteller. It runs entirely in the browser using the
[Web Speech API](https://developer.mozilla.org/docs/Web/API/Web_Speech_API), so there is no backend, no API key, and
your text never leaves your device. It is packaged as a small, non-root nginx Docker image.

## Features

- **Text input** with autosave (stored in your browser), a character counter, and an example story.
- **Lady or Man voice**. Voices are grouped by gender and filtered by language, with natural/neural voices (✨) listed
  first. Voices whose gender can't be detected are pitch-adjusted to fit the voice type you picked.
- **Hear a sample** for each voice type: a short, expressive story clip.
- **Storyteller mode** adds breathing pauses at commas, sentence ends, `…` and paragraphs, varies the pitch slightly,
  and makes exclamations and dialogue livelier.
- **Expression tools**: select text and click a toolbar button, or type the tags yourself:

  | Tag | Effect |
  | --- | --- |
  | `[pause]`, `[pause 2s]`, `[pause 500ms]`, `[pause long]` | Silence (default 0.7 s × pause length setting) |
  | `[pitch high]…[/pitch]` (`x-low`, `low`, `high`, `x-high`, `+20%`, `1.3`) | Raise or lower the pitch |
  | `[slow]…[/slow]`, `[fast]…[/fast]` (optional factor, e.g. `[slow 0.6]`) | Change the speed |
  | `[emph]…[/emph]` | Emphasis: short pause, slower, slightly higher |
  | `[ask]…[/ask]` | Question intonation, even without a `?` |

- **Question intonation** for sentences ending in `?`: *Natural* (slight lift), *Strong rise* (the last words rise),
  or *Off*.
- **Delivery controls** for speed, pitch, pause length and volume.
- **Performance preview** that shows how the text will be performed (pauses, questions, emphasis) and highlights each
  phrase as it is spoken.
- **Update banner**: the page checks `version.json` every minute and offers a reload when a new commit is deployed.

> Voice quality depends on the browser and OS. **Microsoft Edge** has the most human-sounding free voices (for example
> "Aria", "Jenny" and "Guy" Online Natural voices). Browsers don't support downloading Web Speech output as an audio
> file.

## Run locally (no Docker)

```powershell
python -m http.server 8080 --directory public
# then open http://localhost:8080
```

## Run with Docker

```powershell
docker compose up -d --build      # http://localhost:8080  (change the port with PORT=9000)
```

Or build and run manually:

```powershell
docker build -t text2voice .
docker run -d -p 8080:8080 --name text2voice text2voice
```

The container runs as a non-root user with a read-only filesystem. It serves security headers (CSP and others) and
provides a `/healthz` endpoint for health checks.

## Always up to date on every commit

Enable the git hooks once per clone:

```powershell
git config core.hooksPath .githooks      # or: ./scripts/install-hooks.ps1  /  sh scripts/install-hooks.sh
```

| Hook | What it does |
| --- | --- |
| `pre-commit` | Runs the unit tests (`node --test`). A failing test aborts the commit. |
| `post-commit` | Runs `scripts/deploy.sh`, which builds the image from the **committed** tree (`git archive HEAD`), tags it `text2voice:<sha>` and `latest`, and restarts the container with `docker compose`. |
| `post-merge` | Runs the same deploy after `git pull` or `git merge`. |

- If Docker isn't installed or running, the deploy step is skipped and the commit still succeeds.
- To skip a single deploy, run `TEXT2VOICE_SKIP_DEPLOY=1 git commit …` (bash) or set the environment variable first in
  PowerShell.
- The deployed commit is shown in the app header, and open browser tabs show a "new version" banner.

**CI/CD:** `.github/workflows/docker.yml` runs the tests and builds the image on every push and pull request. On pushes
to `main`/`master`, it also publishes `ghcr.io/<owner>/<repo>:latest` and `:sha-<commit>`.

## Tests

```powershell
node --test
```

## Project layout

```
public/            static site (index.html, css/, js/, version.json)
  js/parser.js     tags + punctuation -> speak/pause plan (pure, unit-tested)
  js/voices.js     voice gender detection, grouping and ranking
  js/player.js     plays a plan through speechSynthesis (pause/resume/stop)
  js/app.js        UI wiring
tests/             node:test unit tests
Dockerfile, nginx.conf, docker-compose.yml
.githooks/         pre-commit, post-commit, post-merge
scripts/           deploy.sh, install-hooks.(sh|ps1)
```
