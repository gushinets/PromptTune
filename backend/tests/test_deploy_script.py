import os
import shutil
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEPLOY_SCRIPT = REPO_ROOT / "infra" / "scripts" / "deploy-prod.sh"
EXTENSION_ORIGIN = "chrome-extension://fbageijibmjblopdbgpdcpkojhnjjbpe"


def _write_env(path: Path, allowed_origins: str) -> None:
    path.write_text(
        "\n".join(
            [
                "POSTGRES_PASSWORD=test-password",
                "DATABASE_URL=postgresql+asyncpg://prompttune:test-password@postgres/prompttune",
                "LLM_BACKEND=OPENROUTER",
                "OPENROUTER_API_KEY=test-key",
                "INSTALLATION_ID_SALT=test-installation-salt",
                "IP_SALT=test-ip-salt",
                "NTFY_TOPIC=test-topic",
                f"ALLOWED_ORIGINS={allowed_origins}",
            ]
        )
        + "\n"
    )


def _copy_deploy_script(tmp_path: Path) -> Path:
    script = tmp_path / "infra" / "scripts" / "deploy-prod.sh"
    script.parent.mkdir(parents=True)
    shutil.copy2(DEPLOY_SCRIPT, script)
    return script


def test_production_preflight_rejects_wildcard_cors(tmp_path: Path):
    script = _copy_deploy_script(tmp_path)
    _write_env(tmp_path / "infra" / ".env", "*")

    result = subprocess.run(
        ["bash", str(script), "--preflight-only"],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert (
        "ALLOWED_ORIGINS must list explicit origins; wildcard (*) is not allowed" in result.stderr
    )


def test_production_preflight_requires_smoke_origin_in_allowed_list(tmp_path: Path):
    script = _copy_deploy_script(tmp_path)
    _write_env(tmp_path / "infra" / ".env", "https://app.example.com")

    result = subprocess.run(
        ["bash", str(script), "--preflight-only"],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode != 0
    assert f"ALLOWED_ORIGINS must include CORS_SMOKE_ORIGIN ({EXTENSION_ORIGIN})" in result.stderr


def test_production_smoke_checks_cors_for_each_extension_endpoint(tmp_path: Path):
    script = _copy_deploy_script(tmp_path)
    _write_env(tmp_path / "infra" / ".env", EXTENSION_ORIGIN)
    fake_bin = tmp_path / "fake-bin"
    fake_bin.mkdir()
    command_log = tmp_path / "commands.log"

    fake_docker = fake_bin / "docker"
    fake_docker.write_text(
        """#!/usr/bin/env bash
set -eu
printf 'docker %s\\n' "$*" >> "${COMMAND_LOG}"
if [[ "$*" == "info --format {{.DockerRootDir}}" ]]; then
  printf '/tmp\\n'
elif [[ "$1" == "inspect" ]]; then
  printf 'healthy\\n'
elif [[ "$*" == *" ps -q "* ]]; then
  printf 'fake-container\\n'
fi
"""
    )
    fake_docker.chmod(0o755)

    fake_curl = fake_bin / "curl"
    fake_curl.write_text(
        f"""#!/usr/bin/env bash
set -eu
printf 'curl %s\\n' "$*" >> "${{COMMAND_LOG}}"
if [[ "$*" != *"-X OPTIONS"* ]]; then
  printf '200'
elif [[ "$*" == *"/v1/improve"* && "$*" == *"Origin: {EXTENSION_ORIGIN}"* && ! -e "${{CURL_STATE}}" ]]; then
  touch "${{CURL_STATE}}"
  exit 7
elif [[ "$*" == *"Origin: {EXTENSION_ORIGIN}"* ]]; then
  printf 'HTTP/1.1 200 OK\\r\\naccess-control-allow-origin: {EXTENSION_ORIGIN}\\r\\n\\r\\n'
else
  printf 'HTTP/1.1 400 Bad Request\\r\\n\\r\\n'
fi
"""
    )
    fake_curl.chmod(0o755)

    env = {
        **os.environ,
        "PATH": f"{fake_bin}:{os.environ['PATH']}",
        "COMMAND_LOG": str(command_log),
        "CURL_STATE": str(tmp_path / "curl-state"),
        "MIN_FREE_MB": "0",
    }
    result = subprocess.run(
        ["bash", str(script)],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    calls = command_log.read_text()
    endpoints = {
        "/v1/improve": "POST",
        "/v1/limits": "GET",
        "/v1/prompts": "POST",
        "/v1/events": "POST",
    }
    option_calls = [line for line in calls.splitlines() if "-X OPTIONS" in line]
    assert len(option_calls) == 9
    assert all("--connect-timeout 5 --max-time 15" in line for line in option_calls)
    for path, method in endpoints.items():
        assert (
            f"{path} -H Origin: {EXTENSION_ORIGIN} -H Access-Control-Request-Method: {method}"
        ) in calls
        assert (
            f"{path} -H Origin: https://unrelated.example "
            f"-H Access-Control-Request-Method: {method}"
        ) in calls
