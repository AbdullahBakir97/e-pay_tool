# PyInstaller spec - builds a single desktop application bundle.
#
#   Windows:  pyinstaller packaging/epay_tool.spec      -> dist/ePayTool/ePayTool.exe
#   macOS:    pyinstaller packaging/epay_tool.spec      -> dist/ePayTool.app
#
# The same spec serves both platforms; the .app bundle is only produced on
# macOS, where BUNDLE is a no-op elsewhere.

import sys
from pathlib import Path

APP_NAME = "ePayTool"
ROOT = Path(SPECPATH).parent

a = Analysis(
    [str(ROOT / "src" / "epay_tool" / "main.py")],
    pathex=[str(ROOT / "src")],
    binaries=[],
    datas=[],
    hiddenimports=[
        # Backends resolved at runtime by name, so PyInstaller cannot see them.
        "keyring.backends.Windows",
        "keyring.backends.macOS",
        "keyring.backends.SecretService",
        "epay_tool.ai.gemini",
        "epay_tool.ai.ollama",
    ],
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "numpy", "pytest"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    exclude_binaries=True,
    name=APP_NAME,
    debug=False,
    strip=False,
    upx=False,
    console=False,  # windowed app - no terminal
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name=APP_NAME,
)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name=f"{APP_NAME}.app",
        bundle_identifier="de.epaytool.app",
        info_plist={
            "NSHighResolutionCapable": True,
            "LSMinimumSystemVersion": "11.0",
            "CFBundleShortVersionString": "0.1.0",
        },
    )
