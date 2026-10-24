"""Exercise setup scripts with temporary project files and a recording CLI."""
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def test_legacy_project_setup(tmp_path):
    env = os.environ.copy()
    env.pop('GOOGLE_CLOUD_PROJECT', None)
    env['COMPANION_PROJECT_FILE'] = str(tmp_path / 'project.txt')
    init = subprocess.run(['bash', str(ROOT / 'init.sh')], input='hands-on-project\n', text=True, env=env, capture_output=True)
    assert init.returncode == 0
    assert (tmp_path / 'project.txt').read_text().strip() == 'hands-on-project'
    setup = subprocess.run(['bash', '-c', 'source "$1" && printf "%s|%s|%s|%s" "$GOOGLE_CLOUD_PROJECT" "$GOOGLE_CLOUD_LOCATION" "$GEMINI_MODEL" "$AGY_ADC_AUTH"', 'bash', str(ROOT / 'set_env.sh')], env=env, text=True, capture_output=True)
    assert setup.returncode == 0
    assert setup.stdout == 'hands-on-project|global|gemini-3.8-flash|true'


def test_missing_or_empty_project_file_fails(tmp_path):
    env = os.environ.copy()
    env.pop('GOOGLE_CLOUD_PROJECT', None)
    env['COMPANION_PROJECT_FILE'] = str(tmp_path / 'project.txt')
    for exists in [False, True]:
        if exists:
            (tmp_path / 'project.txt').touch()
        setup = subprocess.run(['bash', '-c', 'source "$1"', 'bash', str(ROOT / 'set_env.sh')], env=env, capture_output=True)
        assert setup.returncode != 0


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
