"""Headless UI smoke test: scanning a barcode must create a visible queue row.

Runs with the Qt "offscreen" platform, so it needs no display and is safe
in CI.
"""

from __future__ import annotations

import os

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

pytest.importorskip("PySide6")

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication

from epay_tool.db.models import ProductState
from epay_tool.ui.main_window import STATE_LABELS, MainWindow


class StubPipeline:
    """Stands in for the real pipeline; records what the UI asked for."""

    def __init__(self):
        self.client = None
        self.enriched: list[int] = []
        self.published: list[int] = []

    def enrich(self, product_id: int) -> None:
        self.enriched.append(product_id)

    def publish(self, product_id: int, **kwargs) -> None:
        self.published.append(product_id)


@pytest.fixture(scope="session")
def qapp():
    app = QApplication.instance() or QApplication([])
    yield app


@pytest.fixture
def window(qapp, db):
    pipeline = StubPipeline()
    win = MainWindow(pipeline, policy_ids={})
    win._timer.stop()  # deterministic: refresh only when the test says so
    yield win, pipeline
    win.close()


def test_scan_creates_queue_row_and_starts_enrichment(window, qapp):
    win, pipeline = window
    assert win.table.rowCount() == 0

    win.scan_input.setText("0194252707975")
    win.scan_input.returnPressed.emit()
    win.runner.pool.waitForDone(5000)
    win.refresh()

    assert win.table.rowCount() == 1
    assert win.table.item(0, 1).text() == "0194252707975"
    assert pipeline.enriched, "scanning must trigger background enrichment"
    assert win.scan_input.text() == "", "field must clear so the next scan can follow"


def test_multiple_scans_queue_up_for_bulk_work(window, qapp):
    win, pipeline = window
    for code in ("1111111111111", "2222222222222", "3333333333333"):
        win.scan_input.setText(code)
        win.scan_input.returnPressed.emit()
    win.runner.pool.waitForDone(5000)
    win.refresh()

    assert win.table.rowCount() == 3
    assert len(pipeline.enriched) == 3


def test_empty_scan_is_ignored(window, qapp):
    win, _pipeline = window
    win.scan_input.setText("   ")
    win.scan_input.returnPressed.emit()
    win.refresh()
    assert win.table.rowCount() == 0


def test_posting_without_policies_does_not_publish(window, qapp, monkeypatch):
    """A missing business policy must warn, not silently fail on eBay."""
    win, pipeline = window
    warnings: list[str] = []
    monkeypatch.setattr(
        "epay_tool.ui.main_window.QMessageBox.warning",
        lambda *args, **kwargs: warnings.append(args[2] if len(args) > 2 else ""),
    )

    win.scan_input.setText("4444444444444")
    win.scan_input.returnPressed.emit()
    win.runner.pool.waitForDone(5000)
    win.refresh()

    product_id = int(win.table.item(0, 0).data(Qt.UserRole))
    win._post_product(product_id)
    win.runner.pool.waitForDone(5000)

    assert pipeline.published == []
    assert warnings, "user must be told which settings are missing"


def test_state_labels_cover_every_state():
    # A new state without a label would render as a raw enum name in the grid.
    assert set(STATE_LABELS) == set(ProductState)
