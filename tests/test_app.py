import io
import importlib.util
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
import wave

import pytest
from fastapi.testclient import TestClient
from google.genai import errors, types

import app as backend


@pytest.fixture(autouse=True)
def isolate_workshop_config(monkeypatch):
    # Tests also run after the hands-on has created .env and character.py.
    monkeypatch.setenv('COMPANION_MODE', 'gemini')
    monkeypatch.setenv('GOOGLE_CLOUD_PROJECT', 'your-project-id')
    monkeypatch.setattr(backend, 'load_runner', lambda *args: None)


@pytest.fixture
def api():
    client = MagicMock()
    client.aio.models.generate_content = AsyncMock()
    backend.app.dependency_overrides[backend.get_client] = lambda: client
    with TestClient(backend.app) as http:
        yield http, client
    backend.app.dependency_overrides.clear()


def test_chat_model_history_and_no_shared_session(api):
    http, sdk = api
    sdk.aio.models.generate_content.return_value = SimpleNamespace(text='こんにちは！')
    reply = http.post('/chat', json={'message': '続けて', 'history': [{'role': 'user', 'text': 'こんにちは'}, {'role': 'model', 'text': 'やあ'}]})
    assert reply.json()['response'] == 'こんにちは！'
    call = sdk.aio.models.generate_content.call_args.kwargs
    assert call['model'] == 'gemini-3.8-flash'
    assert call['config'].thinking_config.thinking_level == 'LOW'
    assert [c.role for c in call['contents']] == ['user', 'model', 'user']
    assert call['contents'][-1].parts[0].text == '続けて'
    http.post('/chat', json={'message': '別のブラウザ'})
    assert len(sdk.aio.models.generate_content.call_args.kwargs['contents']) == 1


@pytest.mark.parametrize('body', [{}, {'message': ' '}, {'message': 3}, {'message': 'x'*8001}, {'message': 'x', 'history': [{'role': 'system', 'text': 'x'}]}, {'message': 'x', 'history': [{'role': 'user', 'text': 'x'}]*21}])
def test_invalid_chat(api, body):
    http, sdk = api
    assert http.post('/chat', json=body).status_code == 422
    sdk.aio.models.generate_content.assert_not_called()


def test_tts_returns_wav_without_double_header(api):
    http, sdk = api
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(24000)
        out.writeframes(b'\0\0'*240)
    wav = buffer.getvalue()
    sdk.aio.models.generate_content.return_value = types.GenerateContentResponse(candidates=[types.Candidate(content=types.Content(parts=[types.Part(inline_data=types.Blob(mime_type='audio/wav', data=wav))]))])
    voices = http.get('/config').json()['voices']
    assert len(voices) == len(set(voices))
    assert len([voice for voice in voices if not voice.startswith('voice_')]) == 30
    for voice in voices:
        response = http.post('/tts', json={'text': 'こんにちは', 'voice': voice})
        assert response.status_code == 200
        assert response.content == wav
        assert response.headers['content-type'] == 'audio/wav'
        assert response.headers['cache-control'] == 'no-store'
        call = sdk.aio.models.generate_content.call_args.kwargs
        assert call['model'] == 'gemini-3.8-flash-tts'
        assert call['config'].speech_config.voice_config.voice == voice
    assert http.post('/tts', json={'text': 'hi', 'voice': 'unknown'}).status_code == 422


@pytest.mark.parametrize('voice, name, expected_label, count', [
    ('Kore', 'unused', 'Kore', 30),
    ('voice_saved-anime', 'アニメキャラ', 'アニメキャラ', 31),
    ('voice_saved-anime', '', 'カスタム音声', 31),
])
def test_configured_voice_label_default_and_tts(monkeypatch, voice, name, expected_label, count):
    monkeypatch.setenv('GEMINI_TTS_VOICE', voice)
    monkeypatch.setenv('GEMINI_TTS_VOICE_NAME', name)
    spec = importlib.util.spec_from_file_location('voice_test_app', backend.__file__)
    configured = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(configured)
    sdk = MagicMock()
    wav = b'RIFF' + b'\0' * 4 + b'WAVE'
    sdk.aio.models.generate_content = AsyncMock(return_value=types.GenerateContentResponse(
        candidates=[types.Candidate(content=types.Content(parts=[
            types.Part(inline_data=types.Blob(mime_type='audio/wav', data=wav)),
        ]))]))
    configured.app.dependency_overrides[configured.get_client] = lambda: sdk
    with TestClient(configured.app) as http:
        config = http.get('/config').json()
        assert len(config['voices']) == len(set(config['voices'])) == count
        assert config['default_voice'] == voice
        assert config['voice_labels'].get(voice, voice) == expected_label
        schema = http.get('/openapi.json').json()['components']['schemas']['SpeechRequest']['properties']['voice']
        assert schema['enum'] == config['voices']
        assert schema['default'] == voice
        for body in [{'text': 'こんにちは'}, {'text': 'こんにちは', 'voice': voice}]:
            assert http.post('/tts', json=body).content == wav
            assert sdk.aio.models.generate_content.call_args.kwargs['config'].speech_config.voice_config.voice == voice
        sdk.aio.models.generate_content.reset_mock()
        assert http.post('/tts', json={'text': 'hi', 'voice': 'voice_not-configured'}).status_code == 422
        sdk.aio.models.generate_content.assert_not_called()


def test_no_text_or_audio(api):
    http, sdk = api
    sdk.aio.models.generate_content.return_value = SimpleNamespace(text=None, candidates=[])
    assert http.post('/chat', json={'message': 'hi'}).status_code == 502
    assert http.post('/tts', json={'text': 'hi'}).status_code == 502


@pytest.mark.parametrize('code, expected', [(403, 502), (404, 502), (429, 429), (503, 502)])
def test_upstream_errors_are_sanitized(api, code, expected):
    http, sdk = api
    sdk.aio.models.generate_content.side_effect = errors.APIError(code, {'error': {'message': 'private upstream detail'}})
    response = http.post('/chat', json={'message': 'hi'})
    assert response.status_code == expected
    assert 'private upstream detail' not in response.text


def test_connection_failure(api):
    http, sdk = api
    sdk.aio.models.generate_content.side_effect = TimeoutError('private connection data')
    response = http.post('/tts', json={'text': 'hi'})
    assert response.status_code == 504
    assert 'private connection data' not in response.text


def test_no_credentials_and_static_assets():
    # Exercise the actual dependency while avoiding any credential discovery.
    from unittest.mock import patch
    with patch.object(backend.genai, 'Client', side_effect=ValueError('missing key')):
        with TestClient(backend.app) as http:
            assert http.post('/chat', json={'message': 'hi'}).status_code == 503
            assert http.get('/').status_code == 200
            assert http.get('/static/app.js').status_code == 200
            assert http.get('/config').json()['default_voice'] == backend.DEFAULT_VOICE


def test_vertex_adc_is_explicit_even_with_old_environment(monkeypatch):
    from unittest.mock import patch
    monkeypatch.setenv('GOOGLE_CLOUD_PROJECT', 'hands-on-project')
    monkeypatch.setenv('GOOGLE_CLOUD_LOCATION', 'global')
    monkeypatch.setenv('GOOGLE_GENAI_USE_VERTEXAI', 'false')
    monkeypatch.setenv('GOOGLE_API_KEY', 'unused-test-key')
    credentials = object()
    sdk = MagicMock()
    sdk.aio.aclose = AsyncMock()
    with patch.object(backend.google.auth, 'default', return_value=(credentials, None)) as adc:
        with patch.object(backend.genai, 'Client', return_value=sdk) as client:
            with TestClient(backend.app) as http:
                assert http.get('/config').status_code == 200
            kwargs = client.call_args.kwargs
            assert kwargs['vertexai'] is True
            assert kwargs['project'] == 'hands-on-project'
            assert kwargs['location'] == 'global'
            assert kwargs['credentials'] is credentials
            assert kwargs['http_options'].timeout == 120000
            assert kwargs['http_options'].retry_options.attempts == 2
            assert 'api_key' not in kwargs
            adc.assert_called_once_with(scopes=['https://www.googleapis.com/auth/cloud-platform'])
            sdk.aio.aclose.assert_awaited_once()


def test_missing_adc_returns_actionable_503(monkeypatch):
    from unittest.mock import patch
    from google.auth.exceptions import DefaultCredentialsError
    monkeypatch.setenv('GOOGLE_CLOUD_PROJECT', 'hands-on-project')
    with patch.object(backend.google.auth, 'default', side_effect=DefaultCredentialsError('not configured')):
        with TestClient(backend.app) as http:
            assert http.get('/').status_code == 200
            assert http.post('/chat', json={'message': 'hi'}).status_code == 503


def test_adk_route_uses_character_and_preserves_grounding(api):
    from unittest.mock import patch
    http, sdk = api
    backend.app.state.runner = object()
    with patch.object(backend, 'run_turn', new=AsyncMock(return_value=('キャラクター応答', None))) as run:
        response = http.post('/chat', json={'message': 'hi'})
        assert response.status_code == 200
        assert response.json()['response'] == 'キャラクター応答'
        run.assert_awaited_once()
        sdk.aio.models.generate_content.assert_not_called()
    backend.app.state.runner = None


@pytest.mark.parametrize('agent', [False, True])
def test_stalled_chat_returns_timeout(api, monkeypatch, agent):
    import asyncio
    http, sdk = api
    cancelled = []

    async def stalled(*args, **kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.append(True)

    monkeypatch.setattr(backend, 'REQUEST_TIMEOUT_SECONDS', 0.01)
    if agent:
        monkeypatch.setattr(backend.app.state, 'runner', SimpleNamespace(close=AsyncMock()))
        monkeypatch.setattr(backend, 'run_turn', stalled)
    else:
        sdk.aio.models.generate_content.side_effect = stalled
    response = http.post('/chat', json={'message': 'hi'})
    assert response.status_code == 504
    assert 'タイムアウト' in response.json()['detail']
    assert cancelled == [True]
