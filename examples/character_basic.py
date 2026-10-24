from google.adk.agents import LlmAgent
from google.genai import types

root_agent = LlmAgent(
    model='gemini-3.8-flash',
    name='companion_agent',
    instruction='あなたは親しみやすいAIアシスタントです。日本語で三文以内、絵文字なしで答えてください。',
    generate_content_config=types.GenerateContentConfig(
        max_output_tokens=2048, thinking_config=types.ThinkingConfig(thinking_level='LOW'),
    ),
)
