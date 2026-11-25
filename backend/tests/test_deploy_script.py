import os
import shutil
import subprocess
from pathlib import Path

import pytest

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


@pytest.mark.parametrize(
    ("release_arch", "running_image", "post_start_image", "scenario"),
    [
        (None, None, None, None),
        ("linux/amd64", None, None, None),
        ("linux/arm64", None, None, None),
        ("linux/amd64", "wrong", None, None),
        ("linux/amd64", None, "wrong", None),
        ("linux/amd64", "inspect-error", None, None),
        ("linux/amd64", None, None, "missing-support"),
        ("linux/amd64", None, None, "oneoff-leftovers"),
        ("linux/amd64", None, None, "oneoff-support-only"),
        ("linux/amd64", None, None, "multiple-api"),
        ("linux/amd64", None, None, "migration-failure"),
    ],
)
@pytest.mark.parametrize("start_caddy", ["true", "false"])
def test_production_smoke_checks_cors_for_each_extension_endpoint(
    tmp_path: Path, release_arch, running_image, post_start_image, scenario, start_caddy
):
    script = _copy_deploy_script(tmp_path)
    _write_env(tmp_path / "infra" / ".env", EXTENSION_ORIGIN)
    with (tmp_path / "infra" / ".env").open("a") as env_file:
        env_file.write(f"PROMPTTUNE_START_CADDY={start_caddy}\n")
    fake_bin = tmp_path / "fake-bin"
    fake_bin.mkdir()
    command_log = tmp_path / "commands.log"

    fake_docker = fake_bin / "docker"
    fake_docker.write_text(
        """#!/usr/bin/env bash
set -eu
printf 'docker %s\\n' "$*" >> "${COMMAND_LOG}"
if [[ "$1 ${2:-}" == "image inspect" ]]; then
  printf '%s\\n' "${RELEASE_ARCH}"
elif [[ "$*" == "info --format {{.DockerRootDir}}" ]]; then
  printf '/tmp\\n'
elif [[ "$1" == "inspect" ]]; then
  if [[ "$*" == *'com.docker.compose.oneoff'* ]]; then
    if [[ "${!#}" == "one-off" ]]; then printf 'True\\n'; else printf 'False\\n'; fi
  elif [[ "$*" == *'{{.Image}}'* ]]; then
    [[ "${RUNNING_IMAGE}" != "inspect-error" ]] || exit 1
    if [[ -e "${API_STARTED}" ]]; then
      printf '%s\\n' "${POST_START_IMAGE}"
    else
      printf '%s\\n' "${RUNNING_IMAGE}"
    fi
  else
    printf 'healthy\\n'
  fi
elif [[ "$*" == *" api alembic upgrade head" && "${SCENARIO}" == "migration-failure" ]]; then
  exit 42
elif [[ "$1" == "start" ]]; then
  touch "${API_STARTED}"
elif [[ "$*" == *" ps "* && "$*" == *"-q"* ]]; then
  if [[ "${SCENARIO}" == "missing-support" && "$*" == *"-q egress-lb" ]]; then
    exit 0
  elif [[ "${SCENARIO}" == "oneoff-support-only" && "$*" == *"-q egress-lb" ]]; then
    printf 'one-off\\n'
  elif [[ "${SCENARIO}" == "oneoff-leftovers" ]]; then
    printf 'one-off\\nfake-container\\n'
  elif [[ "${SCENARIO}" == "multiple-api" && "$*" == *"-q api" ]]; then
    printf 'fake-container\\nsecond-container\\n'
  else
    printf 'fake-container\\n'
  fi
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
        "RELEASE_ARCH": release_arch or "linux/amd64",
        "RUNNING_IMAGE": running_image or "sha256:" + "a" * 64,
        "POST_START_IMAGE": post_start_image or "sha256:" + "a" * 64,
        "API_STARTED": str(tmp_path / "api-started"),
        "SCENARIO": scenario or "",
    }
    image = "sha256:" + "a" * 64
    args = ["--image", image] if release_arch else []
    result = subprocess.run(
        ["bash", str(script), *args],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )

    calls = command_log.read_text() if command_log.exists() else ""
    if scenario in {"missing-support", "oneoff-support-only", "multiple-api"}:
        assert result.returncode != 0
        if scenario == "multiple-api":
            assert "single regular container for service api" in result.stderr
        else:
            assert "Supporting service egress-lb is not provisioned" in result.stderr
        assert " up " not in calls
        assert " upgrade head" not in calls
        return
    if scenario == "migration-failure":
        assert result.returncode == 42
        assert " upgrade head" in calls
        assert "up --no-start" not in calls
        assert "docker start " not in calls
        assert "docker stop " not in calls
        return
    if release_arch == "linux/arm64":
        assert result.returncode != 0
        assert "Expected linux/amd64" in result.stderr
        assert " up " not in calls
        assert " upgrade head" not in calls
        return
    if running_image in {"wrong", "inspect-error"} or post_start_image == "wrong":
        assert result.returncode != 0
        assert "docker stop fake-container" in calls
        assert "curl " not in calls
        if running_image in {"wrong", "inspect-error"}:
            assert "docker start fake-container" not in calls
        else:
            assert calls.index("docker start fake-container") < calls.index(
                "docker stop fake-container"
            )
        return
    assert result.returncode == 0, result.stderr
    if release_arch:
        assert "docker-compose.release.yml" in calls
        assert " build api" not in calls
        assert "up -d --no-recreate --no-build --pull never postgres redis" in calls
        assert "run --rm --no-deps --pull never api alembic upgrade head" in calls
        assert "up -d --no-recreate --no-build --pull never egress-lb egress-alert" in calls
        assert "up --no-start --no-deps --no-build --pull never api" in calls
        assert "docker start fake-container" in calls
        assert "docker start one-off" not in calls
        assert "docker stop one-off" not in calls
        assert (
            calls.index(" upgrade head")
            < calls.index("up --no-start --no-deps")
            < calls.index("inspect --format {{.Image}}")
            < calls.index("docker start fake-container")
        )
        if start_caddy == "true":
            assert "up -d --no-deps --no-recreate --no-build --pull never caddy" in calls
        else:
            assert "--pull never caddy" not in calls
    else:
        assert " build api" in calls
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


@pytest.mark.parametrize("image", ["backend:latest", "sha256:abc", "repo@sha256:" + "a" * 64])
def test_production_release_rejects_non_local_content_ids(tmp_path: Path, image):
    script = _copy_deploy_script(tmp_path)
    result = subprocess.run(
        ["bash", str(script), "--image", image], capture_output=True, text=True, check=False
    )
    assert result.returncode != 0
    assert "--image requires a local sha256 image ID (64 lowercase hex characters)" in result.stderr
