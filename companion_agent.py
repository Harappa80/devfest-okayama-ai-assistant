"""ADK integration for the character.py created during the workshop."""
import importlib.util
from pathlib import Path
from uuid import uuid4

from google.adk.events import Event
from google.adk.models import Gemini
from google.adk.runners import InMemoryRunner
from google.genai import types


def load_runner(directory: Path, client, model: str):
    path = directory / 'character.py'
    if not path.is_file():
        return None
    spec = importlib.util.spec_from_file_location('workshop_character', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    agent = module.root_agent
    # Both ADK and TTS use the explicitly authenticated Vertex AI client.
    agent.model = Gemini(model=model, client=client)
    if agent.generate_content_config is None:
        agent.generate_content_config = types.GenerateContentConfig(
            max_output_tokens=2048, thinking_config=types.ThinkingConfig(thinking_level='LOW'),
        )
    return InMemoryRunner(agent=agent, app_name='WakuWaku')


async def run_turn(runner, body):
    user_id = str(uuid4())
    session = await runner.session_service.create_session(app_name=runner.app_name, user_id=user_id)
    text = ''
    grounding = None
    try:
        # Replay the bounded history supplied by this browser, never another user's session.
        for turn in body.history:
            await runner.session_service.append_event(session, Event(
                author='user' if turn.role == 'user' else runner.agent.name,
                invocation_id=str(uuid4()),
                content=types.Content(role=turn.role, parts=[types.Part(text=turn.text)]),
            ))
        async for event in runner.run_async(
            user_id=user_id, session_id=session.id,
            new_message=types.Content(role='user', parts=[types.Part(text=body.message)]),
        ):
            if event.error_code:
                raise RuntimeError('ADK model invocation failed')
            if event.grounding_metadata:
                grounding = event.grounding_metadata
            if event.is_final_response() and event.content:
                text += ''.join(part.text for part in event.content.parts or [] if part.text and not part.thought)
        return text, grounding
    finally:
        await runner.session_service.delete_session(app_name=runner.app_name, user_id=user_id, session_id=session.id)
