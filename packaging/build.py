#!/usr/bin/env python3
"""Build the desktop application for the current platform.

    python packaging/build.py

Produces ``dist/ePayTool/ePayTool.exe`` on Windows and
``dist/ePayTool.app`` on macOS. Run it on the target platform - PyInstaller
does not cross-compile.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "packaging" / "epay_tool.spec"


def main() -> int:
    try:
        import PyInstaller  # noqa: F401
    except ImportError:
        print("PyInstaller is missing. Install it with:  pip install pyinstaller")
        return 1

    print(f"Building ePay Tool for {sys.platform} ...")
    result = subprocess.run(
        [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", str(SPEC)],
        cwd=ROOT,
    )
    if result.returncode == 0:
        print(f"\nDone. Artifacts are in {ROOT / 'dist'}")
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
