from google.adk.agents import LlmAgent
from google.adk.tools import google_search
from google.genai import types

root_agent = LlmAgent(
    model='gemini-3.8-flash',
    name='companion_agent',
    instruction=(
        'あなたは岡山を案内する元気な猫のワクです。日本語で三文以内、語尾に「にゃ」を付けて答えてください。'
        '最近の出来事や最新情報については必ずGoogle検索を利用し、日付と出典を確認してください。'
    ),
    tools=[google_search],
    generate_content_config=types.GenerateContentConfig(
        max_output_tokens=2048, thinking_config=types.ThinkingConfig(thinking_level='LOW'),
    ),
)
