#!/usr/bin/env python3
"""
eSSL / ZKTeco LAN connector (Mode B — Pull SDK) for Cross_Border_Command.

Runs on a Windows/Linux PC on the SAME LAN as the biometric terminal. It polls
the device over TCP 4370, pulls new attendance punches, and forwards them to the
app's authenticated import endpoint (POST /api/attendance/import), which runs the
same normaliser as the real-time /iclock push path (map by attendance_number,
device-local -> UTC, alternate in/out, idempotent).

Why a connector? The device speaks the ZKTeco TCP/SDK protocol, not HTTP+Sanctum.
This bridge is the only thing that needs to speak both.

Setup:
    pip install -r requirements.txt
    copy config.example.ini config.ini   # then edit config.ini
    python essl_connector.py

Mint an API token (on the server, once):
    php artisan tinker
    >>> App\\Models\\User::find(<service_user_id>)->createToken('essl-connector')->plainTextToken

See docs/ESSL_ATTENDANCE_INTEGRATION.md §5.4, §16.
"""

import configparser
import os
import sys
import time
from datetime import datetime

import requests

try:
    from zk import ZK  # pyzk
except ImportError:
    print("Missing dependency: pip install pyzk requests", file=sys.stderr)
    sys.exit(1)


def log(msg: str) -> None:
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


def load_config(path: str) -> configparser.SectionProxy:
    if not os.path.exists(path):
        log(f"Config not found: {path} (copy config.example.ini -> config.ini)")
        sys.exit(1)
    cfg = configparser.ConfigParser()
    cfg.read(path)
    return cfg["connector"]


def read_cursor(path: str) -> datetime | None:
    """Last punch time we already forwarded — only newer ones are sent."""
    try:
        with open(path, "r") as fh:
            return datetime.fromisoformat(fh.read().strip())
    except (FileNotFoundError, ValueError):
        return None


def write_cursor(path: str, when: datetime) -> None:
    with open(path, "w") as fh:
        fh.write(when.isoformat())


def pull_punches(ip: str, port: int, cursor: datetime | None) -> list[dict]:
    """Connect, read attendance, return rows newer than the cursor."""
    zk = ZK(ip, port=port, timeout=10, force_udp=False, ommit_ping=True)
    conn = None
    try:
        conn = zk.connect()
        conn.disable_device()          # freeze the device while we read
        records = conn.get_attendance() or []
        conn.enable_device()
    finally:
        if conn:
            conn.disconnect()

    rows = []
    for att in records:
        ts = att.timestamp
        if cursor and ts <= cursor:
            continue
        rows.append({
            "user_id": str(att.user_id),
            "punched_at": ts.strftime("%Y-%m-%d %H:%M:%S"),
            # pyzk exposes the In/Out function-key code as `punch` (falls back to status).
            "status": str(getattr(att, "punch", "") if getattr(att, "punch", "") != "" else getattr(att, "status", "")),
        })
    return rows


def forward(api_base: str, token: str, terminal_id: str, rows: list[dict]) -> dict:
    payload = {"punches": rows}
    if terminal_id:
        payload["device_terminal_id"] = int(terminal_id)
    resp = requests.post(
        f"{api_base.rstrip('/')}/api/attendance/import",
        json=payload,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("data", {})


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    cfg = load_config(os.path.join(here, "config.ini"))

    ip = cfg.get("device_ip")
    port = cfg.getint("device_port", fallback=4370)
    api_base = cfg.get("api_base_url")
    token = cfg.get("api_token")
    terminal_id = cfg.get("device_terminal_id", fallback="")
    interval = cfg.getint("poll_interval_seconds", fallback=60)
    cursor_path = os.path.join(here, cfg.get("cursor_file", fallback="cursor.txt"))

    log(f"eSSL connector starting — device {ip}:{port}, poll {interval}s -> {api_base}")

    while True:
        try:
            cursor = read_cursor(cursor_path)
            rows = pull_punches(ip, port, cursor)
            if rows:
                summary = forward(api_base, token, terminal_id, rows)
                newest = max(r["punched_at"] for r in rows)
                write_cursor(cursor_path, datetime.strptime(newest, "%Y-%m-%d %H:%M:%S"))
                log(f"Sent {len(rows)} punch(es): imported={summary.get('imported')} "
                    f"dupes={summary.get('skipped_duplicates')} unmatched={summary.get('unmatched_user_ids')}")
            else:
                log("No new punches.")
        except requests.HTTPError as e:
            log(f"API error: {e} — {getattr(e.response, 'text', '')[:200]} (will retry)")
        except Exception as e:  # device offline, network blip, etc.
            log(f"Poll failed: {e} (will retry next cycle)")

        time.sleep(interval)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("Stopped.")
