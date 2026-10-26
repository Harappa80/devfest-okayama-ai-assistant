"""FastAPI companion: Gemini text responses and Gemini TTS audio."""
from contextlib import asynccontextmanager
import logging
import os
from pathlib import Path
import re
from typing import Annotated, Literal

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import google.auth
from google.auth.exceptions import GoogleAuthError
from google import genai
from google.genai import errors, types
from pydantic import BaseModel, Field, StringConstraints, field_validator

from companion_agent import load_runner, run_turn

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
logger = logging.getLogger(__name__)
CHAT_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
TTS_MODEL = os.getenv("GEMINI_TTS_MODEL", "gemini-3.8-flash-tts")
SYSTEM_INSTRUCTION = os.getenv(
    "SYSTEM_INSTRUCTION",
    "You are WakuWaku, a friendly AI companion. Reply in the user's language. "
    "Keep answers concise and natural for spoken conversation.",
)
VOICES = (
    "Achernar", "Achird", "Algenib", "Algieba", "Alnilam", "Aoede",
    "Autonoe", "Callirrhoe", "Charon", "Despina", "Enceladus", "Erinome",
    "Fenrir", "Gacrux", "Iapetus", "Kore", "Laomedeia", "Leda", "Orus", "Puck",
    "Pulcherrima", "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar", "Sulafat",
    "Umbriel", "Vindemiatrix", "Zephyr", "Zubenelgenubi",
)
DEFAULT_VOICE = os.getenv("GEMINI_TTS_VOICE", "Kore")
VOICE_LABELS = {}
if DEFAULT_VOICE not in VOICES:
    if not re.fullmatch(r"voice_[A-Za-z0-9_-]{1,128}", DEFAULT_VOICE):
        raise ValueError("GEMINI_TTS_VOICE must be a standard voice name or a saved voice_... ID")
    VOICES += (DEFAULT_VOICE,)
    VOICE_LABELS[DEFAULT_VOICE] = os.getenv("GEMINI_TTS_VOICE_NAME", "").strip() or "カスタム音声"
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=8000)]


class Turn(BaseModel):
    role: Literal["user", "model"]
    text: Text


class ChatRequest(BaseModel):
    message: Text
    history: list[Turn] = Field(default_factory=list, max_length=20)


class Source(BaseModel):
    title: str
    url: str


class ChatResponse(BaseModel):
    response: str
    sources: list[Source] = Field(default_factory=list)
    grounding_html: str | None = None


class SpeechRequest(BaseModel):
    text: Text
    voice: str = Field(default=DEFAULT_VOICE, json_schema_extra={"enum": list(VOICES)})

    @field_validator("voice")
    @classmethod
    def configured_voice(cls, value: str) -> str:
        # Only offer and accept standard voices plus the configured saved voice.
        if value not in VOICES:
            raise ValueError("Select a configured voice")
        return value


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Defer authentication until startup, so importing the app needs no credentials.
    app.state.genai = None
    app.state.runner = None
    try:
        project = os.getenv("GOOGLE_CLOUD_PROJECT")
        if not project or project == "your-project-id":
            raise ValueError("Set GOOGLE_CLOUD_PROJECT in .env")
        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        app.state.genai = genai.Client(
            vertexai=True, project=project,
            location=os.getenv("GOOGLE_CLOUD_LOCATION", "global"), credentials=credentials,
            http_options=types.HttpOptions(
                timeout=120000,
                retry_options=types.HttpRetryOptions(
                    attempts=2, initial_delay=1, max_delay=2,
                    http_status_codes=[429, 500, 502, 503, 504],
                ),
            ),
        )
    except (ValueError, OSError, GoogleAuthError):
        logger.warning("Gemini authentication is not configured. See README.md.")
    if app.state.genai is not None:
        app.state.runner = load_runner(BASE_DIR, app.state.genai, CHAT_MODEL)
    try:
        yield
    finally:
        if app.state.runner is not None:
            await app.state.runner.close()
        if app.state.genai is not None:
            await app.state.genai.aio.aclose()
            app.state.genai.close()


app = FastAPI(title="WakuWaku", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


def get_client(request: Request) -> genai.Client:
    client = request.app.state.genai
    if client is None:
        raise HTTPException(503, "Gemini authentication is not configured. See README.md.")
    return client


async def generate(client: genai.Client, **kwargs):
    try:
        return await client.aio.models.generate_content(**kwargs)
    except errors.APIError as exc:
        logger.warning("Gemini request failed (code=%s)", exc.code)
        if exc.code == 429:
            raise HTTPException(429, "Gemini quota exceeded. Please try again later.") from exc
        raise HTTPException(502, "Gemini request failed. Check model access and server configuration.") from exc
    except Exception as exc:
        # Never return SDK errors containing credentials or request details to the browser.
        logger.warning("Gemini connection failed (%s)", type(exc).__name__)
        raise HTTPException(502, "Could not connect to Gemini. Please try again later.") from exc


@app.get("/", include_in_schema=False)
async def index():
    return FileResponse(BASE_DIR / "templates" / "index.html")


@app.get("/config")
async def config():
    return {"voices": VOICES, "default_voice": DEFAULT_VOICE, "voice_labels": VOICE_LABELS}


@app.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, request: Request, client: genai.Client = Depends(get_client)):
    if request.app.state.runner is not None:
        try:
            text, grounding = await run_turn(request.app.state.runner, body)
        except errors.APIError as exc:
            logger.warning("ADK model request failed (code=%s)", exc.code)
            raise HTTPException(429 if exc.code == 429 else 502, "Agent request failed. Check quota and model access.") from exc
        except Exception as exc:
            logger.warning("ADK request failed (%s)", type(exc).__name__)
            raise HTTPException(502, "Agent request failed. Check model access and server configuration.") from exc
        if not text.strip():
            raise HTTPException(502, "The agent returned no text. Please rephrase your message.")
        return chat_result(text, grounding)
    if os.getenv("COMPANION_MODE", "gemini") == "echo":
        return ChatResponse(response=body.message)
    contents = [types.Content(role=turn.role, parts=[types.Part(text=turn.text)]) for turn in body.history]
    contents.append(types.Content(role="user", parts=[types.Part(text=body.message)]))
    result = await generate(
        client, model=CHAT_MODEL, contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION, max_output_tokens=2048,
            thinking_config=types.ThinkingConfig(thinking_level="LOW"),
        ),
    )
    text = result.text
    if not text or not text.strip():
        raise HTTPException(502, "Gemini returned no text. Please rephrase your message.")
    grounding = result.candidates[0].grounding_metadata if getattr(result, "candidates", None) else None
    return chat_result(text, grounding)


def chat_result(text, grounding):
    sources = []
    html = None
    if grounding:
        for chunk in grounding.grounding_chunks or []:
            if chunk.web and chunk.web.uri and chunk.web.uri.startswith(("https://", "http://")):
                sources.append(Source(title=chunk.web.title or chunk.web.uri, url=chunk.web.uri))
        if grounding.search_entry_point:
            html = grounding.search_entry_point.rendered_content
    return ChatResponse(response=text, sources=sources, grounding_html=html)


@app.post("/tts")
async def speech(body: SpeechRequest, client: genai.Client = Depends(get_client)):
    result = await generate(
        client, model=TTS_MODEL,
        contents=[types.Content(role="user", parts=[types.Part(text=body.text)])],
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(voice=body.voice)),
        ),
    )
    # Gemini 3.8 unary TTS returns a complete WAV container. Do not wrap it again.
    for candidate in result.candidates or []:
        for part in candidate.content.parts if candidate.content else []:
            audio = part.inline_data
            if audio and audio.data and audio.data.startswith(b"RIFF") and audio.data[8:12] == b"WAVE":
                return Response(content=audio.data, media_type="audio/wav", headers={"Cache-Control": "no-store"})
    raise HTTPException(502, "Gemini returned no WAV audio. Please try again.")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=int(os.getenv("PORT", "8000")))
