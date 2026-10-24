"""Run both real Vertex AI endpoints of a running companion app."""
import argparse
from pathlib import Path
import wave
import io

import httpx


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:8000')
    parser.add_argument('--output', default='/tmp/companion-check.wav')
    args = parser.parse_args()
    with httpx.Client(base_url=args.base_url, timeout=300, trust_env=False) as http:
        for route in ['/', '/config', '/openapi.json', '/static/app.js', '/static/images/char-mouth-open.png', '/static/images/char-mouth-closed.png']:
            result = http.get(route)
            result.raise_for_status()
            print(f'GET {route}: {result.status_code}')
        result = http.post('/chat', json={'message': '日本語で一文だけ挨拶してください。'})
        if not result.is_success:
            raise SystemExit(f'POST /chat: {result.status_code} {result.text}')
        text = result.json()['response']
        if not text.strip():
            raise SystemExit('Chat returned no text')
        print(f'POST /chat: 200 ({len(text)} characters)')
        speech = http.post('/tts', json={'text': text, 'voice': 'Kore'})
        if not speech.is_success:
            raise SystemExit(f'POST /tts: {speech.status_code} {speech.text}')
        with wave.open(io.BytesIO(speech.content)) as wav:
            duration = wav.getnframes() / wav.getframerate()
            if duration <= 0:
                raise SystemExit('TTS returned empty audio')
            print(f'POST /tts: 200 (WAV {wav.getframerate()} Hz, {duration:.2f}s)')
        Path(args.output).write_bytes(speech.content)
        print(f'Saved {args.output}')


if __name__ == '__main__':
    main()
