"""My Voice: instant voice cloning with Chatterbox (MIT licence, Resemble AI).

Runs inside the private Docker network; only the Node app talks to it. Each cloned voice belongs to
the browser that created it: creation returns a random owner token, and only its SHA-256 is stored.
Every generated clip carries Chatterbox's inaudible Perth watermark marking it as synthetic.
"""

from __future__ import annotations

import hashlib
import hmac
import io
import json
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
import traceback
from collections import OrderedDict
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

DATA_DIR = Path(os.environ.get("VOICE_DATA_DIR", "/data/voices"))
DEVICE_PREF = os.environ.get("DEVICE", "auto")
# "turbo" (default) is ~2x faster; "standard" is slower but supports the expressiveness control.
MODEL_KIND = "standard" if os.environ.get("CLONE_MODEL", "turbo").lower() == "standard" else "turbo"
SAMPLE_RATE = 24000
MAX_UPLOAD_BYTES = 12 * 1024 * 1024
MIN_SECONDS = 8.0
MAX_SECONDS = 180.0
MAX_TEXT_CHARS = 600
MAX_NAME_CHARS = 40
CONSENT_VERSION = "2026-10"
ID_RE = re.compile(r"^[a-f0-9]{32}$")

state: dict = {"model": None, "device": None, "error": None, "loading": True}
model_lock = threading.Lock()
conds_cache: "OrderedDict[str, object]" = OrderedDict()


def pick_device() -> str:
    import torch

    if DEVICE_PREF != "auto":
        return DEVICE_PREF
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def model_module():
    if MODEL_KIND == "turbo":
        import chatterbox.tts_turbo as module

        return module, module.ChatterboxTurboTTS
    import chatterbox.tts as module

    return module, module.ChatterboxTTS


def load_model() -> None:
    try:
        _, model_cls = model_module()
        device = pick_device()
        started = time.time()
        state["model"] = model_cls.from_pretrained(device=device)
        state["device"] = device
        print(f"[voice-clone] {MODEL_KIND} model ready on {device} in {time.time() - started:.0f}s", flush=True)
    except Exception as exc:  # surfaced through /health
        state["error"] = f"{type(exc).__name__}: {exc}"
        print(f"[voice-clone] failed to load model: {state['error']}", flush=True)
        traceback.print_exc()
    finally:
        state["loading"] = False


@asynccontextmanager
async def lifespan(_app: FastAPI):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    # Load in the background so the container is healthy (and reports progress) while weights download.
    threading.Thread(target=load_model, daemon=True).start()
    yield


app = FastAPI(title="text2voice voice-clone", lifespan=lifespan, docs_url=None, redoc_url=None)


# ---------- helpers ----------


def require_model():
    if state["model"] is None:
        detail = state["error"] or "The voice model is still loading - try again in a minute."
        raise HTTPException(status_code=503, detail=detail)
    return state["model"]


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def voice_dir(voice_id: str) -> Path:
    if not ID_RE.match(voice_id or ""):
        raise HTTPException(status_code=404, detail="Voice not found.")
    return DATA_DIR / voice_id


def load_owned(voice_id: str, token: str | None) -> tuple[Path, dict]:
    folder = voice_dir(voice_id)
    meta_path = folder / "meta.json"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="Voice not found.")
    meta = json.loads(meta_path.read_text())
    if not token or not hmac.compare_digest(hash_token(token), meta["token_sha256"]):
        # Same response as "missing" so voice ids can't be probed.
        raise HTTPException(status_code=404, detail="Voice not found.")
    return folder, meta


def public_meta(meta: dict) -> dict:
    return {k: meta[k] for k in ("id", "name", "created", "seconds")}


def decode_with_ffmpeg(data: bytes) -> tuple[np.ndarray, int] | None:
    """Fallback for formats libsndfile can't read (M4A/AAC, WebM, ...). Returns None if ffmpeg is missing."""
    if not shutil.which("ffmpeg"):
        return None
    try:
        result = subprocess.run(
            ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
             "-t", str(MAX_SECONDS + 1), "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "wav", "pipe:1"],
            input=data, capture_output=True, timeout=120, check=True,
        )
        audio, sr = sf.read(io.BytesIO(result.stdout), dtype="float32", always_2d=True)
        return audio, sr
    except (subprocess.SubprocessError, RuntimeError, OSError):
        return None


def decode_audio(data: bytes) -> np.ndarray:
    try:
        audio, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    except Exception:
        decoded = decode_with_ffmpeg(data)
        if decoded is None:
            raise HTTPException(
                status_code=400, detail="Unsupported audio format - please record in the app or upload WAV, MP3, FLAC or OGG."
            ) from None
        audio, sr = decoded
    audio = audio.mean(axis=1)
    if sr != SAMPLE_RATE:
        import librosa

        audio = librosa.resample(audio, orig_sr=sr, target_sr=SAMPLE_RATE)
    return audio.astype(np.float32)


def clean_reference(audio: np.ndarray) -> np.ndarray:
    import librosa

    trimmed, _ = librosa.effects.trim(audio, top_db=35)
    # Shorten long silences between phrases; the model only looks at the first ~10 s of the reference.
    intervals = librosa.effects.split(trimmed, top_db=35)
    gap = np.zeros(int(0.25 * SAMPLE_RATE), dtype=np.float32)
    pieces = []
    for start, end in intervals:
        pieces.extend([trimmed[start:end], gap])
    cleaned = np.concatenate(pieces[:-1]) if pieces else trimmed
    peak = float(np.max(np.abs(cleaned))) if cleaned.size else 0.0
    if peak > 0:
        cleaned = cleaned * min(0.95 / peak, 8.0)
    return cleaned.astype(np.float32)


def wav_bytes(audio: np.ndarray, sample_rate: int = SAMPLE_RATE) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, np.clip(audio, -1.0, 1.0), sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def conds_path(folder: Path) -> Path:
    # Each model has its own speaker conditioning; it is rebuilt from reference.wav when missing.
    return folder / f"conds-{MODEL_KIND}.pt"


def prepare_conds(model, folder: Path) -> None:
    """Computes and saves the speaker conditioning ("training"). Caller must hold model_lock."""
    # Our reference is already level-normalised; Chatterbox's own loudness step breaks under NumPy 2.
    extra = {"norm_loudness": False} if MODEL_KIND == "turbo" else {}
    model.prepare_conditionals(str(folder / "reference.wav"), exaggeration=0.5, **extra)
    model.conds.save(conds_path(folder))


def get_conds(voice_id: str, folder: Path):
    """Returns cached conditioning for a voice. Caller must hold model_lock."""
    if voice_id in conds_cache:
        conds_cache.move_to_end(voice_id)
        return conds_cache[voice_id]
    if not conds_path(folder).exists():
        prepare_conds(state["model"], folder)
    module, _ = model_module()
    conds = module.Conditionals.load(conds_path(folder), map_location=state["device"]).to(state["device"])
    conds_cache[voice_id] = conds
    while len(conds_cache) > 16:
        conds_cache.popitem(last=False)
    return conds


# ---------- routes ----------


@app.get("/health")
def health():
    return {
        "ready": state["model"] is not None,
        "loading": state["loading"],
        "device": state["device"],
        "model": MODEL_KIND,
        "error": state["error"],
    }


@app.post("/voices", status_code=201)
def create_voice(
    audio: UploadFile = File(...),
    name: str = Form(...),
    consent: str = Form(...),
    consent_text: str = Form(...),
):
    model = require_model()
    name = " ".join(name.split())[:MAX_NAME_CHARS]
    if not name:
        raise HTTPException(status_code=400, detail="Please give your voice a name.")
    if consent != "yes" or len(consent_text.strip()) < 20:
        raise HTTPException(status_code=400, detail="Consent is required to create a voice.")

    data = audio.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Recording is too large (max 12 MB).")
    raw = decode_audio(data)
    seconds = raw.size / SAMPLE_RATE
    if seconds > MAX_SECONDS:
        raise HTTPException(status_code=400, detail="Recording is too long (max 3 minutes).")
    ref = clean_reference(raw)
    speech_seconds = ref.size / SAMPLE_RATE
    if speech_seconds < MIN_SECONDS:
        raise HTTPException(status_code=400, detail=f"Please record at least {MIN_SECONDS:.0f} seconds of speech.")
    if float(np.sqrt(np.mean(raw**2))) < 0.003:
        raise HTTPException(status_code=400, detail="The recording is almost silent - check your microphone.")

    voice_id = secrets.token_hex(16)
    token = secrets.token_urlsafe(32)
    folder = DATA_DIR / voice_id
    folder.mkdir(parents=True)
    try:
        sf.write(folder / "reference.wav", ref, SAMPLE_RATE, subtype="PCM_16")
        with model_lock:
            prepare_conds(model, folder)
        meta = {
            "id": voice_id,
            "name": name,
            "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "seconds": round(speech_seconds, 1),
            "token_sha256": hash_token(token),
            "consent": {"version": CONSENT_VERSION, "text": consent_text.strip()[:500], "accepted": True},
        }
        (folder / "meta.json").write_text(json.dumps(meta, indent=2))
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    return {**public_meta(meta), "token": token}


@app.get("/voices/{voice_id}")
def get_voice(voice_id: str, x_voice_token: str | None = Header(default=None)):
    _, meta = load_owned(voice_id, x_voice_token)
    return public_meta(meta)


@app.delete("/voices/{voice_id}", status_code=204)
def delete_voice(voice_id: str, x_voice_token: str | None = Header(default=None)):
    folder, _ = load_owned(voice_id, x_voice_token)
    conds_cache.pop(voice_id, None)
    shutil.rmtree(folder, ignore_errors=True)
    return Response(status_code=204)


class SpeakRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    exaggeration: float = Field(default=0.5, ge=0.25, le=2.0)
    cfg_weight: float = Field(default=0.5, ge=0.0, le=1.0)
    temperature: float = Field(default=0.8, ge=0.05, le=1.5)


@app.post("/voices/{voice_id}/speak")
def speak(voice_id: str, req: SpeakRequest, x_voice_token: str | None = Header(default=None)):
    model = require_model()
    folder, _ = load_owned(voice_id, x_voice_token)
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Nothing to speak.")
    with model_lock:
        model.conds = get_conds(voice_id, folder)
        if MODEL_KIND == "turbo":
            wav = model.generate(req.text.strip(), temperature=req.temperature)
        else:
            wav = model.generate(
                req.text.strip(),
                exaggeration=req.exaggeration,
                cfg_weight=req.cfg_weight,
                temperature=req.temperature,
            )
    audio = wav.squeeze(0).cpu().numpy()
    return Response(content=wav_bytes(audio, model.sr), media_type="audio/wav")
