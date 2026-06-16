#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
EXTENSION_DIR = REPO_ROOT / "extension"
MIN_PYTHON = (3, 12)
DEFAULT_DATABASE_URL = "postgresql+asyncpg://prompttune:prompttune@localhost:5432/prompttune_test"
DEFAULT_REDIS_URL = "redis://localhost:6379/0"


@dataclass(frozen=True)
class CheckStep:
    name: str
    command: list[str]
    cwd: Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run PromptTune baseline checks from a single Python entrypoint. "
            "This command is intended to behave the same in local shells and CI."
        )
    )
    parser.add_argument(
        "--frontend",
        action="store_true",
        help="Also run optional extension checks (npm lint + npm test).",
    )
    parser.add_argument(
        "--no-db-migrate",
        action="store_true",
        help="Skip the Alembic migration preflight step.",
    )
    return parser.parse_args()


def ensure_supported_python() -> None:
    if sys.version_info < MIN_PYTHON:
        version = ".".join(str(part) for part in MIN_PYTHON)
        raise SystemExit(
            f"quick_check.py requires Python {version}+; current interpreter is "
            f"{sys.version.split()[0]}."
        )


def ensure_repo_layout() -> None:
    missing = [path for path in (BACKEND_DIR, BACKEND_DIR / "tests") if not path.exists()]
    if missing:
        joined = ", ".join(str(path.relative_to(REPO_ROOT)) for path in missing)
        raise SystemExit(f"Repository layout is incomplete, missing: {joined}")


def ensure_command_available(command: str) -> None:
    if shutil.which(command):
        return
    raise SystemExit(
        f"Required command '{command}' was not found in PATH. "
        f"Install it before rerunning quick_check.py."
    )


def build_step_env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("DATABASE_URL", DEFAULT_DATABASE_URL)
    env.setdefault("REDIS_URL", DEFAULT_REDIS_URL)
    env.setdefault("PYTHONUNBUFFERED", "1")
    return env


def describe_env_value(name: str, value: str) -> str:
    default_value = {
        "DATABASE_URL": DEFAULT_DATABASE_URL,
        "REDIS_URL": DEFAULT_REDIS_URL,
    }.get(name)
    if value == default_value:
        return "set (default)"
    return "set (custom)"


def run_step(step: CheckStep, env: dict[str, str]) -> None:
    printable_cwd = step.cwd.relative_to(REPO_ROOT)
    printable_cmd = " ".join(step.command)
    print(f"\n==> {step.name}")
    print(f"cwd: {printable_cwd}")
    print(f"cmd: {printable_cmd}")
    print(f"DATABASE_URL: {describe_env_value('DATABASE_URL', env['DATABASE_URL'])}")
    print(f"REDIS_URL: {describe_env_value('REDIS_URL', env['REDIS_URL'])}")
    sys.stdout.flush()

    subprocess.run(
        step.command,
        cwd=step.cwd,
        check=True,
        env=env,
    )


def build_backend_steps(skip_db_migrate: bool) -> list[CheckStep]:
    steps: list[CheckStep] = []
    if not skip_db_migrate:
        steps.append(
            CheckStep(
                name="database migration preflight",
                command=[
                    sys.executable,
                    "-c",
                    "from alembic.config import main; main()",
                    "upgrade",
                    "head",
                ],
                cwd=BACKEND_DIR,
            )
        )

    steps.extend(
        [
            CheckStep(
                name="config validation",
                command=[sys.executable, "-m", "pytest", "-q", "tests/test_config.py"],
                cwd=BACKEND_DIR,
            ),
            CheckStep(
                name="architecture validation",
                command=[sys.executable, "-m", "pytest", "-q", "tests/test_infra_coverage.py"],
                cwd=BACKEND_DIR,
            ),
            CheckStep(
                name="backend pytest baseline",
                command=[
                    sys.executable,
                    "-m",
                    "pytest",
                    "-q",
                    "tests",
                    "--ignore=tests/test_config.py",
                    "--ignore=tests/test_infra_coverage.py",
                ],
                cwd=BACKEND_DIR,
            ),
        ]
    )
    return steps


def build_frontend_steps() -> list[CheckStep]:
    ensure_command_available("npm")
    return [
        CheckStep(
            name="frontend lint",
            command=["npm", "run", "lint"],
            cwd=EXTENSION_DIR,
        ),
        CheckStep(
            name="frontend tests",
            command=["npm", "run", "test"],
            cwd=EXTENSION_DIR,
        ),
    ]


def main() -> int:
    args = parse_args()
    ensure_supported_python()
    ensure_repo_layout()
    env = build_step_env()

    steps = build_backend_steps(skip_db_migrate=args.no_db_migrate)
    if args.frontend:
        steps.extend(build_frontend_steps())

    try:
        for step in steps:
            run_step(step, env)
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"\nStep failed with exit code {exc.returncode}: {' '.join(exc.cmd)}") from None

    print("\nquick_check.py completed successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
