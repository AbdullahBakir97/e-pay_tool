"""Application entry point."""

from __future__ import annotations

import logging
import sys


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )

    from PySide6.QtWidgets import QApplication, QMessageBox

    from epay_tool.ai.provider import get_provider
    from epay_tool.config import ensure_dirs, get_settings
    from epay_tool.core.pipeline import Pipeline
    from epay_tool.db.session import init_db
    from epay_tool.ebay.auth import EbayAuth
    from epay_tool.ebay.client import EbayClient
    from epay_tool.ui.main_window import MainWindow

    ensure_dirs()
    init_db()
    settings = get_settings()

    app = QApplication(sys.argv)
    app.setApplicationName("ePay Tool")

    if not settings.ebay_client_id:
        QMessageBox.critical(
            None,
            "Konfiguration fehlt",
            "Bitte .env anhand von .env.example anlegen (eBay-Zugangsdaten).",
        )
        return 1

    auth = EbayAuth(settings)
    wants_login = not auth.has_user_consent and QMessageBox.question(
        None,
        "eBay-Anmeldung",
        "Für das Einstellen von Angeboten ist eine einmalige eBay-Anmeldung "
        "im Browser nötig. Jetzt anmelden?",
    ) == QMessageBox.Yes
    if wants_login:
        try:
            auth.interactive_login()
        except Exception as exc:
            logging.warning("eBay login failed", exc_info=True)
            QMessageBox.warning(None, "Anmeldung fehlgeschlagen", str(exc))

    client = EbayClient(settings, auth)
    ai = get_provider(settings)
    pipeline = Pipeline(settings, client, ai)

    window = MainWindow(pipeline)
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
