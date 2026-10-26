"""Exercise the Antigravity launcher with a recording CLI."""
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def test_antigravity_launcher_forwards_model_and_working_directory(tmp_path):
    cli = tmp_path / 'agy'
    cli.write_text('#!/bin/bash\nprintf "%s\\n" "$PWD" "$@"\n')
    cli.chmod(0o755)
    env = os.environ.copy()
    env.pop('ANTIGRAVITY_MODEL', None)
    env['PATH'] = str(tmp_path) + ':/usr/bin:/bin'
    command = ['bash', str(ROOT / 'scripts/antigravity.sh'), '-p', 'explain this code', '--output-format', 'json']
    result = subprocess.run(command, env=env, cwd=tmp_path, text=True, capture_output=True)
    assert result.returncode == 0
    assert result.stdout.splitlines() == [str(ROOT), '--model', 'gemini-3.8-flash-medium', '-p', 'explain this code', '--output-format', 'json']
