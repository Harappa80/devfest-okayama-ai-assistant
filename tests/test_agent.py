import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from google.genai import types
from companion_agent import load_runner, run_turn
from app import ChatRequest, chat_result


def test_character_load_uses_vertex_client(tmp_path):
    code = """
from google.adk.agents import LlmAgent
from google.adk.tools import google_search

root_agent = LlmAgent(
    model='gemini-3.8-flash',
    name='companion_agent',
    instruction='あなたは猫のワクです。最新情報はGoogle検索で調べてください。',
    tools=[google_search],
)
"""
    (tmp_path / 'character.py').write_text(code)
    from google import genai
    from google.auth.credentials import AnonymousCredentials
    client = genai.Client(vertexai=True, project='test-project', location='global', credentials=AnonymousCredentials())
    runner = load_runner(tmp_path, client, 'gemini-3.8-flash')
    assert runner.agent.model.client is client
    assert runner.agent.model.model == 'gemini-3.8-flash'
    assert len(runner.agent.tools) == 1
    assert 'ワク' in runner.agent.instruction
    asyncio.run(runner.close())
    client.close()


def test_adk_history_final_response_and_cleanup():
    service = SimpleNamespace(create_session=AsyncMock(return_value=SimpleNamespace(id='one')), append_event=AsyncMock(), delete_session=AsyncMock())
    async def events(**kwargs):
        yield SimpleNamespace(error_code=None, grounding_metadata=None, is_final_response=lambda: False, content=types.Content(parts=[types.Part(text='Intermediate')]))
        yield SimpleNamespace(error_code=None, grounding_metadata=None, is_final_response=lambda: True, content=types.Content(parts=[types.Part(text='Thought', thought=True), types.Part(text='Final')]))
    runner = SimpleNamespace(app_name='WakuWaku', agent=SimpleNamespace(name='companion_agent'), session_service=service, run_async=events)
    body = ChatRequest(message='next', history=[{'role': 'user', 'text': 'hello'}, {'role': 'model', 'text': 'hi'}])
    text, _ = asyncio.run(run_turn(runner, body))
    assert text == 'Final'
    assert service.append_event.await_count == 2
    assert service.append_event.await_args_list[1].args[1].author == 'companion_agent'
    service.delete_session.assert_awaited_once()


def test_grounding_metadata_sources_and_suggestions():
    metadata = types.GroundingMetadata(
        grounding_chunks=[types.GroundingChunk(web=types.GroundingChunkWeb(uri='https://example.com/news', title='News'))],
        search_entry_point=types.SearchEntryPoint(rendered_content='<div>Google Search</div>'),
    )
    result = chat_result('Answer', metadata)
    assert result.sources[0].url == 'https://example.com/news'
    assert result.grounding_html == '<div>Google Search</div>'
