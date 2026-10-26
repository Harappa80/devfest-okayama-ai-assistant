import io
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
    response = http.post('/tts', json={'text': 'こんにちは', 'voice': 'Puck'})
    assert response.status_code == 200
    assert response.content == wav
    assert response.headers['content-type'] == 'audio/wav'
    assert response.headers['cache-control'] == 'no-store'
    call = sdk.aio.models.generate_content.call_args.kwargs
    assert call['model'] == 'gemini-3.8-flash-tts'
    assert call['config'].speech_config.voice_config.voice == 'Puck'
    assert http.post('/tts', json={'text': 'hi', 'voice': 'unknown'}).status_code == 422


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
    assert response.status_code == 502
    assert 'private connection data' not in response.text


def test_no_credentials_and_static_assets():
    # Exercise the actual dependency while avoiding any credential discovery.
    from unittest.mock import patch
    with patch.object(backend.genai, 'Client', side_effect=ValueError('missing key')):
        with TestClient(backend.app) as http:
            assert http.post('/chat', json={'message': 'hi'}).status_code == 503
            assert http.get('/').status_code == 200
            assert http.get('/static/app.js').status_code == 200
            assert http.get('/config').json()['default_voice'] == 'Kore'


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
