"""Local AI Gateway - Python model sidecar.

Exposes real CPU/GPU model backends over HTTP so the Next.js gateway can proxy
to them (the same way it proxies chat/vision to Ollama). Models are loaded
lazily on first use; /health reports which capabilities are actually available.

Run:
    cd model-service
    source .venv/bin/activate
    uvicorn app:app --host 127.0.0.1 --port 8000
"""
from __future__ import annotations

import importlib.util
import io
import shutil
import threading
from typing import Any

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response

app = FastAPI(title="LAG Model Sidecar")

# ---- capability availability (import-level) ----
def _has(mod: str) -> bool:
    try:
        return importlib.util.find_spec(mod) is not None
    except Exception:
        return False


def _cuda() -> bool:
    try:
        import torch  # type: ignore

        return bool(torch.cuda.is_available())
    except Exception:
        return False

CAPS = {
    "removebg": ["rembg"],
    "detect": ["ultralytics"],
    "stt": ["faster_whisper"],
    "ocr": ["rapidocr_onnxruntime"],
    "tts": ["kokoro"],  # bundles espeak via espeakng-loader
}

# ---- lazy singletons ----
_state: dict[str, Any] = {}
# Inference endpoints below are plain `def`, so FastAPI runs each in its worker
# threadpool -> the event loop is never blocked and concurrent requests run in
# parallel. This lock only guards the one-time lazy model load so two
# simultaneous first-hits can't double-initialize a model.
_init_lock = threading.Lock()


def _cap_available(name: str) -> bool:
    return all(_has(m) for m in CAPS[name])


# cap -> the _state keys that hold its loaded model(s)
_CAP_STATE = {
    "detect": ["yolo"],
    "stt": ["whisper:"],  # prefix match
    "ocr": ["ocr"],
    "tts": ["kokoro"],
    "removebg": [],  # rembg keeps its own session internally
}


@app.post("/unload")
def unload(cap: str = Form(...)):
    keys = _CAP_STATE.get(cap, [])
    removed = []
    for k in list(_state):
        if any(k == p or k.startswith(p) for p in keys):
            _state.pop(k, None)
            removed.append(k)
    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
    return {"unloaded": removed}


@app.get("/health")
def health():
    caps = {name: _cap_available(name) for name in CAPS}
    loaded = {k: (k in _state or any(s.startswith(k) for s in _state)) for k in CAPS}
    return {"ok": True, "capabilities": caps, "loaded": loaded, "cuda": _cuda()}


# ---- background removal (rembg) ----
@app.post("/remove-bg")
def remove_bg(file: UploadFile = File(...)):
    try:
        from rembg import remove  # type: ignore

        data = file.file.read()
        out = remove(data)  # returns PNG bytes with alpha
        return Response(content=out, media_type="image/png")
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)}, status_code=500)


# ---- object detection (Ultralytics YOLO) ----
@app.post("/detect")
def detect(file: UploadFile = File(...), model: str = Form("yolo11n.pt")):
    try:
        from ultralytics import YOLO  # type: ignore
        from PIL import Image  # type: ignore

        with _init_lock:
            if "yolo" not in _state:
                _state["yolo"] = YOLO(model)
        img = Image.open(io.BytesIO(file.file.read())).convert("RGB")
        dev = 0 if _cuda() else "cpu"
        res = _state["yolo"].predict(img, verbose=False, device=dev)[0]
        names = res.names
        dets = []
        for b in res.boxes:
            xyxy = [round(float(x), 1) for x in b.xyxy[0].tolist()]
            dets.append({
                "label": names[int(b.cls[0])],
                "confidence": round(float(b.conf[0]), 3),
                "box": xyxy,
            })
        return {"model": model, "count": len(dets), "detections": dets}
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)}, status_code=500)


# ---- speech to text (faster-whisper) ----
def _pcm16k_from_wav(data: bytes):
    """float32 samples of a 16 kHz mono 16-bit PCM WAV, else None."""
    try:
        import io
        import wave

        import numpy as np

        with wave.open(io.BytesIO(data)) as w:
            if w.getframerate() != 16000 or w.getnchannels() != 1 or w.getsampwidth() != 2 or w.getcomptype() != "NONE":
                return None
            return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    except Exception:  # noqa: BLE001 — not a plain WAV: the file path handles it
        return None


@app.post("/stt")
def stt(
    file: UploadFile = File(...),
    model: str = Form("small"),
    language: str = Form("ja"),
    # Decoding aids for ACCENTED speech (a Japanese speaker's English here).
    # beam_size>1 recovers a lot of what greedy decoding mangles; initial_prompt
    # biases the decoder toward the vocabulary this deployment actually uses
    # (names, place names, product names) instead of similar-sounding words.
    beam_size: int = Form(1),
    initial_prompt: str = Form(""),
    vad_filter: str = Form("0"),
):
    # Gateway sends registry ids like "faster-whisper-large-v3"; WhisperModel
    # wants the bare size ("large-v3"). Strip the prefix so both forms work.
    model = model.removeprefix("faster-whisper-")
    # Serve "large-v3" with the turbo variant: ~5x faster decode, near-equal
    # quality; the gateway keeps leasing under the registered large-v3 id.
    #
    # "near-equal" holds for clean native speech. It does NOT hold for accented
    # speech: turbo has 4 decoder layers against large-v3's 32, and the decoder
    # is exactly what recovers a word whose acoustics are ambiguous. A caller
    # whose speaker is, say, a native Japanese speaker talking English wants the
    # full model and can say so with "large-v3-full" — an explicit opt OUT of
    # the substitution, leaving every existing caller on turbo unchanged.
    if model == "large-v3":
        model = "large-v3-turbo"
    elif model == "large-v3-full":
        model = "large-v3"
    try:
        from faster_whisper import WhisperModel  # type: ignore
        import tempfile, os

        key = f"whisper:{model}"
        with _init_lock:
            if key not in _state:
                if _cuda():
                    try:
                        # int8 weights, fp16 compute: large-v3 held 5.6 GB of GPU0
                        # in float16 — room the LLM on the same card needs.
                        # WHISPER_COMPUTE_TYPE=float16 restores the old load.
                        _state[key] = WhisperModel(
                            model,
                            device="cuda",
                            compute_type=os.environ.get("WHISPER_COMPUTE_TYPE", "int8_float16"),
                        )
                    except Exception:
                        _state[key] = WhisperModel(model, device="cpu", compute_type="int8")
                else:
                    _state[key] = WhisperModel(model, device="cpu", compute_type="int8")
        data = file.file.read()
        # 16 kHz mono 16-bit WAV (what KEHAI sends): hand whisper the samples
        # themselves. Writing a temp file and letting faster-whisper decode it
        # through PyAV cost 86 ms of a 245 ms short-utterance request (measured
        # 2026-11-13) — the transcript then arrived after KEHAI's endpoint.
        # Anything else (ogg, other rates) still goes through the file.
        path = None
        source = _pcm16k_from_wav(data)
        if source is None:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
                tf.write(data)
                path = tf.name
            source = path
        try:
            # beam_size=1: ~1.5-2x faster than the default 5, fine for
            # conversational speech. language comes from the client (the app
            # sends its character language; "" = whisper auto-detect).
            segments, info = _state[key].transcribe(
                source,
                beam_size=max(1, int(beam_size)),
                language=(language or None),
                initial_prompt=(initial_prompt or None),
                # Drop non-speech spans before decoding: with an accented
                # speaker whisper otherwise "reads" breath and room tone as
                # words and emits confident nonsense.
                vad_filter=(str(vad_filter).lower() in ("1", "true", "yes")),
                condition_on_previous_text=False,
                # One decoding pass. The default re-decodes at temperature 0.2,
                # 0.4 ... 1.0 (five samples each) whenever a result looks unsure,
                # and accented speech from 2-3 m away often does: two PROTO
                # segments took 3.1 s and 2.6 s instead of ~0.4 s (2026-10-23).
                # In a conversation a fast first guess beats a slow second one.
                # WHISPER_TEMPERATURE="0,0.2,0.4,0.6,0.8,1" restores the default.
                temperature=tuple(
                    float(t) for t in os.environ.get("WHISPER_TEMPERATURE", "0").split(",")
                ),
            )
            text = "".join(s.text for s in segments).strip()
        finally:
            if path:
                os.unlink(path)
        return {"model": model, "language": info.language, "text": text}
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)}, status_code=500)


# ---- OCR (RapidOCR / onnxruntime) ----
@app.post("/ocr")
def ocr(file: UploadFile = File(...)):
    try:
        from rapidocr_onnxruntime import RapidOCR  # type: ignore
        import numpy as np  # type: ignore
        from PIL import Image  # type: ignore

        with _init_lock:
            if "ocr" not in _state:
                _state["ocr"] = RapidOCR()
        img = np.array(Image.open(io.BytesIO(file.file.read())).convert("RGB"))
        result, _elapse = _state["ocr"](img)
        lines = [
            {"text": str(txt), "confidence": round(float(score), 3)}
            for (_box, txt, score) in (result or [])
        ]
        return {"lines": lines, "text": "\n".join(x["text"] for x in lines)}
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)}, status_code=500)


# ---- TTS (Kokoro) - available once installed (+ espeak-ng) ----
@app.post("/tts")
def tts(text: str = Form(...), voice: str = Form("af_heart")):
    try:
        import soundfile as sf  # type: ignore
        from kokoro import KPipeline  # type: ignore

        with _init_lock:
            if "kokoro" not in _state:
                _state["kokoro"] = KPipeline(lang_code="a")
        buf = io.BytesIO()
        chunks = list(_state["kokoro"](text, voice=voice))
        import numpy as np  # type: ignore

        audio = np.concatenate([c[2] for c in chunks]) if chunks else np.zeros(1)
        sf.write(buf, audio, 24000, format="WAV")
        return Response(content=buf.getvalue(), media_type="audio/wav")
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"error": str(e)}, status_code=500)
