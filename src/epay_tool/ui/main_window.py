"""Main window: scan bar on top, review grid, detail panel on the right.

Daily flow: the barcode field keeps focus, the user scans a whole box of
products (each scan creates a queue row and starts background enrichment),
then works through the grid - green rows post with one click, yellow rows
show the open questions in the detail panel.
"""

from __future__ import annotations

from functools import partial

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QFileDialog,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSplitter,
    QStatusBar,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)
from sqlalchemy.orm import selectinload

from epay_tool.core.pipeline import Pipeline
from epay_tool.core.worker import JobRunner
from epay_tool.db.models import Photo, Product, ProductState
from epay_tool.db.session import get_session
from epay_tool.prefs import get_policy_ids
from epay_tool.ui.detail_panel import DetailPanel
from epay_tool.ui.settings_dialog import SettingsDialog

STATE_COLORS = {
    ProductState.SCANNED: QColor("#e0e0e0"),
    ProductState.ENRICHING: QColor("#bbdefb"),
    ProductState.NEEDS_INFO: QColor("#fff59d"),
    ProductState.READY: QColor("#c8e6c9"),
    ProductState.POSTING: QColor("#bbdefb"),
    ProductState.POSTED: QColor("#81c784"),
    ProductState.FAILED: QColor("#ffcdd2"),
}

STATE_LABELS = {
    ProductState.SCANNED: "Gescannt",
    ProductState.ENRICHING: "Wird ermittelt…",
    ProductState.NEEDS_INFO: "Info benötigt",
    ProductState.READY: "Bereit",
    ProductState.POSTING: "Wird eingestellt…",
    ProductState.POSTED: "Eingestellt",
    ProductState.FAILED: "Fehler",
}

COLUMNS = ["SKU", "Barcode", "Titel", "Preis", "Fotos", "Status"]


class MainWindow(QMainWindow):
    def __init__(self, pipeline: Pipeline, policy_ids: dict[str, str] | None = None):
        super().__init__()
        self.pipeline = pipeline
        self.policy_ids = policy_ids or get_policy_ids()
        self.runner = JobRunner(max_threads=4)

        self.setWindowTitle("ePay Tool – eBay.de Angebots-Automatik")
        self.resize(1280, 760)
        self._build_ui()
        self.refresh()

        # periodic refresh keeps the grid in sync with background jobs
        self._timer = QTimer(self)
        self._timer.timeout.connect(self.refresh)
        self._timer.start(1500)

    # ---------------- UI construction ----------------

    def _build_ui(self) -> None:
        root = QWidget()
        layout = QVBoxLayout(root)

        # Scan bar
        scan_row = QHBoxLayout()
        scan_row.addWidget(QLabel("Barcode scannen:"))
        self.scan_input = QLineEdit()
        self.scan_input.setPlaceholderText(
            "Barcode scannen oder eintippen und Enter drücken…"
        )
        self.scan_input.returnPressed.connect(self._on_scan)
        scan_row.addWidget(self.scan_input, stretch=1)

        self.btn_photos = QPushButton("Artikel nur mit Fotos anlegen")
        self.btn_photos.clicked.connect(self._on_new_with_photos)
        scan_row.addWidget(self.btn_photos)

        self.btn_post_ready = QPushButton("Alle 'Bereit' einstellen")
        self.btn_post_ready.clicked.connect(self._on_post_all_ready)
        scan_row.addWidget(self.btn_post_ready)

        self.btn_settings = QPushButton("Einstellungen")
        self.btn_settings.clicked.connect(self._on_settings)
        scan_row.addWidget(self.btn_settings)
        layout.addLayout(scan_row)

        # Grid + detail
        splitter = QSplitter(Qt.Horizontal)
        self.table = QTableWidget(0, len(COLUMNS))
        self.table.setHorizontalHeaderLabels(COLUMNS)
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.Stretch)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.itemSelectionChanged.connect(self._on_select)
        splitter.addWidget(self.table)

        self.detail = DetailPanel(
            on_save=self._on_detail_saved,
            on_post=self._post_product,
            on_retry=self._enrich_product,
        )
        splitter.addWidget(self.detail)
        splitter.setSizes([780, 500])
        layout.addWidget(splitter, stretch=1)

        self.setCentralWidget(root)
        self.setStatusBar(QStatusBar())
        self.scan_input.setFocus()

    # ---------------- actions ----------------

    def _on_scan(self) -> None:
        code = self.scan_input.text().strip()
        self.scan_input.clear()
        if not code:
            return
        with get_session() as session:
            product = Product(gtin=code)
            session.add(product)
            session.commit()
            product_id = product.id
        self.statusBar().showMessage(f"Barcode {code} aufgenommen – Daten werden ermittelt…", 5000)
        self._enrich_product(product_id)
        self.refresh()

    def _on_new_with_photos(self) -> None:
        paths, _ = QFileDialog.getOpenFileNames(
            self, "Produktfotos wählen", filter="Bilder (*.jpg *.jpeg *.png)"
        )
        if not paths:
            return
        with get_session() as session:
            product = Product()
            product.photos = [Photo(path=p, position=i) for i, p in enumerate(paths)]
            session.add(product)
            session.commit()
            product_id = product.id
        self._enrich_product(product_id)
        self.refresh()

    def _on_post_all_ready(self) -> None:
        with get_session() as session:
            ready_ids = [
                p.id
                for p in session.query(Product).filter(
                    Product.state == ProductState.READY
                )
            ]
        if not ready_ids:
            QMessageBox.information(self, "ePay Tool", "Keine Artikel im Status 'Bereit'.")
            return
        if (
            QMessageBox.question(
                self,
                "Einstellen bestätigen",
                f"{len(ready_ids)} Artikel jetzt bei eBay einstellen?",
            )
            != QMessageBox.Yes
        ):
            return
        for pid in ready_ids:
            self._post_product(pid)

    def _on_settings(self) -> None:
        dialog = SettingsDialog(self.pipeline.client, self)
        if dialog.exec():
            self.policy_ids = dialog.selected_policy_ids()
            self.statusBar().showMessage("Richtlinien gespeichert.", 4000)

    def _enrich_product(self, product_id: int) -> None:
        self.runner.submit(product_id, self.pipeline.enrich, on_done=lambda _pid: self.refresh())

    def _post_product(self, product_id: int) -> None:
        if not all(
            self.policy_ids.get(k) for k in ("fulfillment", "payment", "return")
        ):
            QMessageBox.warning(
                self,
                "Richtlinien fehlen",
                "Bitte zuerst in den Einstellungen Zahlungs-, Versand- und "
                "Rücknahme-Richtlinien wählen.",
            )
            return
        fn = partial(
            self.pipeline.publish,
            fulfillment_policy_id=self.policy_ids["fulfillment"],
            payment_policy_id=self.policy_ids["payment"],
            return_policy_id=self.policy_ids["return"],
        )
        self.runner.submit(product_id, fn, on_done=lambda _pid: self.refresh())

    def _on_detail_saved(self, product_id: int) -> None:
        self._enrich_product(product_id)  # re-run pipeline with the new info
        self.refresh()

    def _on_select(self) -> None:
        row = self.table.currentRow()
        if row < 0:
            return
        item = self.table.item(row, 0)
        if item:
            self.detail.load(int(item.data(Qt.UserRole)))

    # ---------------- grid refresh ----------------

    def refresh(self) -> None:
        selected_id = None
        if self.table.currentRow() >= 0:
            item = self.table.item(self.table.currentRow(), 0)
            if item:
                selected_id = int(item.data(Qt.UserRole))

        with get_session() as session:
            # Photos are eager-loaded: the rows are rendered after the session
            # closes, where a lazy load would raise DetachedInstanceError.
            products = (
                session.query(Product)
                .options(selectinload(Product.photos))
                .order_by(Product.created_at.desc())
                .limit(500)
                .all()
            )

        self.table.blockSignals(True)
        self.table.setRowCount(len(products))
        for row, p in enumerate(products):
            cells = [
                p.sku,
                p.gtin or "–",
                p.title or "–",
                f"{p.price:.2f} {p.currency}" if p.price else "–",
                str(len(p.photos)),
                STATE_LABELS.get(p.state, p.state.value),
            ]
            for col, text in enumerate(cells):
                item = QTableWidgetItem(text)
                item.setBackground(STATE_COLORS.get(p.state, QColor("white")))
                if col == 0:
                    item.setData(Qt.UserRole, p.id)
                self.table.setItem(row, col, item)
            if p.id == selected_id:
                self.table.selectRow(row)
        self.table.blockSignals(False)

        counts: dict[ProductState, int] = {}
        for p in products:
            counts[p.state] = counts.get(p.state, 0) + 1
        summary = " | ".join(
            f"{STATE_LABELS[s]}: {n}" for s, n in counts.items()
        )
        self.statusBar().showMessage(summary or "Bereit zum Scannen.")
