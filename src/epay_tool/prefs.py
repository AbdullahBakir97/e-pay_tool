"""Small JSON store for non-secret user choices (selected business policies).

Kept separate from Settings: these are picked in the UI at runtime, not
configured in .env.
"""

from __future__ import annotations

import json
from pathlib import Path

from epay_tool.config import DATA_DIR, ensure_dirs

PREFS_PATH: Path = DATA_DIR / "prefs.json"


def load_prefs() -> dict:
    if not PREFS_PATH.exists():
        return {}
    try:
        return json.loads(PREFS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_prefs(prefs: dict) -> None:
    ensure_dirs()
    PREFS_PATH.write_text(json.dumps(prefs, indent=2, ensure_ascii=False), encoding="utf-8")


def get_policy_ids() -> dict[str, str]:
    return load_prefs().get("policy_ids", {})


def set_policy_ids(policy_ids: dict[str, str]) -> None:
    prefs = load_prefs()
    prefs["policy_ids"] = policy_ids
    save_prefs(prefs)
