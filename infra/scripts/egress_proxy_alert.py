import json
import os
import socket
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path


METRICS_URL = os.getenv("EGRESS_ALERT_METRICS_URL", "http://egress-lb:8404/metrics")
BACKEND_NAME = os.getenv("EGRESS_ALERT_BACKEND", "squid_proxies")
EXPECTED_ACTIVE = int(os.getenv("EGRESS_ALERT_EXPECTED_ACTIVE", "2"))
EXPECTED_AVAILABLE = int(os.getenv("EGRESS_ALERT_EXPECTED_AVAILABLE", str(EXPECTED_ACTIVE)))
INTERVAL_SECONDS = int(os.getenv("EGRESS_ALERT_INTERVAL_SECONDS", "60"))
STATE_FILE = Path(os.getenv("EGRESS_ALERT_STATE_FILE", "/state/egress_alert_state.json"))
NODE = os.getenv("EGRESS_ALERT_NODE") or socket.gethostname()
NTFY_BASE_URL = os.getenv("NTFY_BASE_URL", "https://ntfy.sh").rstrip("/")
NTFY_TOPIC = os.getenv("NTFY_TOPIC", "").strip()
NTFY_ACCESS_TOKEN = os.getenv("NTFY_ACCESS_TOKEN", "").strip()


def _disable_proxy_env() -> None:
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        os.environ.pop(key, None)


def _request(url: str, *, data: bytes | None = None, headers: dict[str, str] | None = None) -> str:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with opener.open(req, timeout=15) as response:
        return response.read().decode("utf-8", errors="replace")


def _parse_labels(raw: str) -> dict[str, str]:
    labels: dict[str, str] = {}
    for part in raw.split(","):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        labels[key.strip()] = value.strip().strip('"')
    return labels


def _collect_status(metrics: str) -> tuple[int, int, dict[str, str]]:
    active_count: int | None = None
    server_states: dict[str, str] = {}

    for line in metrics.splitlines():
        if not line or line.startswith("#"):
            continue

        metric, _, value = line.partition(" ")
        if not value:
            continue

        if metric.startswith("haproxy_backend_active_servers{"):
            labels_raw = metric.removeprefix("haproxy_backend_active_servers{").removesuffix("}")
            labels = _parse_labels(labels_raw)
            if labels.get("proxy") == BACKEND_NAME:
                try:
                    active_count = int(float(value.strip()))
                except ValueError:
                    pass

        if metric.startswith("haproxy_server_status{"):
            labels_raw = metric.removeprefix("haproxy_server_status{").removesuffix("}")
            labels = _parse_labels(labels_raw)
            if labels.get("proxy") != BACKEND_NAME:
                continue
            try:
                enabled = float(value.strip()) == 1.0
            except ValueError:
                enabled = False
            if enabled:
                server = labels.get("server")
                state = labels.get("state")
                if server and state:
                    server_states[server] = state

    if active_count is None:
        raise RuntimeError(f"Missing haproxy_backend_active_servers for {BACKEND_NAME}")

    available_count = sum(1 for state in server_states.values() if state == "UP")
    return active_count, available_count, server_states


def _state_for(active_count: int, available_count: int) -> str:
    if available_count <= 0:
        return "down"
    if active_count < EXPECTED_ACTIVE or available_count < EXPECTED_AVAILABLE:
        return "degraded"
    return "healthy"


def _load_last_state() -> str | None:
    try:
        raw = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (json.JSONDecodeError, OSError):
        return None
    state = raw.get("state")
    return state if isinstance(state, str) else None


def _save_state(state: str) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"state": state, "updated_at": int(time.time())}), encoding="utf-8")


def _format_message(
    state: str,
    active_count: int,
    available_count: int,
    server_states: dict[str, str],
) -> tuple[str, str, str]:
    if state == "down":
        title = "PromptTune egress DOWN"
        priority = "high"
    elif state == "degraded":
        title = "PromptTune egress degraded"
        priority = "default"
    else:
        title = "PromptTune egress recovered"
        priority = "default"

    status_lines = ", ".join(f"{server}={state}" for server, state in sorted(server_states.items()))
    message = (
        f"{title}\n"
        f"node={NODE}\n"
        f"backend={BACKEND_NAME}\n"
        f"active={active_count}/{EXPECTED_ACTIVE}\n"
        f"available={available_count}/{EXPECTED_AVAILABLE}\n"
        f"servers={status_lines}"
    )
    return title, priority, message


def _send_ntfy(title: str, priority: str, message: str) -> None:
    if not NTFY_TOPIC:
        print("NTFY_TOPIC is missing; alert not sent", file=sys.stderr, flush=True)
        return

    url = f"{NTFY_BASE_URL}/{urllib.parse.quote(NTFY_TOPIC)}"
    headers = {
        "Title": title,
        "Priority": priority,
        "Tags": "warning" if "DOWN" in title or "degraded" in title else "white_check_mark",
    }
    if NTFY_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {NTFY_ACCESS_TOKEN}"

    _request(url, data=message.encode("utf-8"), headers=headers)


def check_once() -> None:
    metrics = _request(METRICS_URL)
    active_count, available_count, server_states = _collect_status(metrics)
    state = _state_for(active_count, available_count)
    last_state = _load_last_state()

    should_notify = state in {"degraded", "down"} and state != last_state
    should_notify = should_notify or (state == "healthy" and last_state in {"degraded", "down"})

    if should_notify:
        title, priority, message = _format_message(state, active_count, available_count, server_states)
        _send_ntfy(title, priority, message)
        print(f"sent alert state={state} active={active_count} available={available_count}", flush=True)
    else:
        print(f"state={state} active={active_count} available={available_count}", flush=True)

    _save_state(state)


def main() -> None:
    _disable_proxy_env()
    while True:
        try:
            check_once()
        except Exception as exc:
            print(f"egress alert check failed: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
