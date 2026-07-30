"""Detail panel: edit a draft, answer the AI's questions, post or retry."""

from __future__ import annotations

from collections.abc import Callable

from PySide6.QtWidgets import (
    QDoubleSpinBox,
    QFileDialog,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QScrollArea,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from epay_tool.db.models import Photo, Product, ProductState
from epay_tool.db.session import get_session

CONDITIONS = [
    ("NEW", "Neu"),
    ("NEW_OTHER", "Neu: Sonstige"),
    ("USED_EXCELLENT", "Gebraucht: Sehr gut"),
    ("USED_GOOD", "Gebraucht: Gut"),
    ("USED_ACCEPTABLE", "Gebraucht: Akzeptabel"),
    ("FOR_PARTS_OR_NOT_WORKING", "Defekt / Ersatzteile"),
]


class DetailPanel(QScrollArea):
    def __init__(
        self,
        on_save: Callable[[int], None],
        on_post: Callable[[int], None],
        on_retry: Callable[[int], None],
    ):
        super().__init__()
        self.on_save = on_save
        self.on_post = on_post
        self.on_retry = on_retry
        self.product_id: int | None = None
        self.setWidgetResizable(True)
        self._build()

    def _build(self) -> None:
        body = QWidget()
        layout = QVBoxLayout(body)

        self.questions_box = QGroupBox("Offene Fragen / Hinweise")
        self.questions_label = QLabel()
        self.questions_label.setWordWrap(True)
        q_layout = QVBoxLayout(self.questions_box)
        q_layout.addWidget(self.questions_label)
        layout.addWidget(self.questions_box)

        form_box = QGroupBox("Angebotsentwurf")
        form = QFormLayout(form_box)
        self.title_edit = QLineEdit()
        self.title_edit.setMaxLength(80)
        self.brand_edit = QLineEdit()
        self.condition_edit = QLineEdit()
        self.condition_edit.setPlaceholderText(
            "z.B. " + ", ".join(code for code, _ in CONDITIONS[:3])
        )
        self.price_edit = QDoubleSpinBox()
        self.price_edit.setRange(0, 1_000_000)
        self.price_edit.setDecimals(2)
        self.price_edit.setSuffix(" €")
        self.notes_edit = QTextEdit()
        self.notes_edit.setPlaceholderText(
            "Antworten auf die Fragen oder zusätzliche Infos hier eintragen – "
            "beim Speichern wertet die KI sie erneut aus."
        )
        self.notes_edit.setFixedHeight(90)
        self.description_edit = QTextEdit()
        self.description_edit.setFixedHeight(160)

        form.addRow("Titel", self.title_edit)
        form.addRow("Marke", self.brand_edit)
        form.addRow("Zustand", self.condition_edit)
        form.addRow("Preis", self.price_edit)
        form.addRow("Notizen / Antworten", self.notes_edit)
        form.addRow("Beschreibung", self.description_edit)
        layout.addWidget(form_box)

        self.market_label = QLabel()
        self.market_label.setWordWrap(True)
        layout.addWidget(self.market_label)

        buttons = QHBoxLayout()
        self.btn_add_photos = QPushButton("Fotos hinzufügen")
        self.btn_add_photos.clicked.connect(self._add_photos)
        self.btn_save = QPushButton("Speichern && neu prüfen")
        self.btn_save.clicked.connect(self._save)
        self.btn_post = QPushButton("Jetzt einstellen")
        self.btn_post.clicked.connect(self._post)
        buttons.addWidget(self.btn_add_photos)
        buttons.addWidget(self.btn_save)
        buttons.addWidget(self.btn_post)
        layout.addLayout(buttons)

        self.error_label = QLabel()
        self.error_label.setWordWrap(True)
        self.error_label.setStyleSheet("color: #b71c1c;")
        layout.addWidget(self.error_label)
        layout.addStretch(1)

        self.setWidget(body)
        self._set_enabled(False)

    # ---------------- data binding ----------------

    def load(self, product_id: int) -> None:
        self.product_id = product_id
        with get_session() as session:
            p = session.get(Product, product_id)
            if p is None:
                return
            self.title_edit.setText(p.title or "")
            self.brand_edit.setText(p.brand or "")
            self.condition_edit.setText(p.condition or "")
            self.price_edit.setValue(p.price or 0.0)
            self.notes_edit.setPlainText(p.user_notes or "")
            self.description_edit.setPlainText(p.description or "")

            lines = list(p.ai_questions or []) + [
                f"Tipp: {s}" for s in (p.ai_suggestions or [])
            ]
            self.questions_label.setText("\n".join(f"• {ln}" for ln in lines) or "Keine.")
            self.questions_box.setVisible(True)

            if p.price_stats:
                stats = p.price_stats
                self.market_label.setText(
                    f"Marktpreise ({stats['sample_size']} Angebote): "
                    f"{stats['minimum']:.2f} – {stats['maximum']:.2f} {stats['currency']}, "
                    f"Median {stats['median']:.2f}"
                )
            else:
                self.market_label.setText("")

            self.error_label.setText(p.last_error or "")
            self._set_enabled(True)
            self.btn_post.setEnabled(p.state in (ProductState.READY, ProductState.NEEDS_INFO))

    def _save(self) -> None:
        if self.product_id is None:
            return
        with get_session() as session:
            p = session.get(Product, self.product_id)
            if p is None:
                return
            p.title = self.title_edit.text().strip() or None
            p.brand = self.brand_edit.text().strip() or None
            p.condition = self.condition_edit.text().strip() or None
            p.price = self.price_edit.value() or None
            p.user_notes = self.notes_edit.toPlainText().strip() or None
            p.description = self.description_edit.toPlainText().strip() or None
            p.ai_questions = None  # answered - the pipeline may raise new ones
            session.commit()
        self.on_save(self.product_id)

    def _post(self) -> None:
        if self.product_id is not None:
            self._save_silent()
            self.on_post(self.product_id)

    def _save_silent(self) -> None:
        """Persist edits without re-triggering enrichment."""
        if self.product_id is None:
            return
        with get_session() as session:
            p = session.get(Product, self.product_id)
            if p is None:
                return
            p.title = self.title_edit.text().strip() or None
            p.price = self.price_edit.value() or None
            p.condition = self.condition_edit.text().strip() or None
            session.commit()

    def _add_photos(self) -> None:
        if self.product_id is None:
            return
        paths, _ = QFileDialog.getOpenFileNames(
            self, "Fotos wählen", filter="Bilder (*.jpg *.jpeg *.png)"
        )
        if not paths:
            return
        with get_session() as session:
            p = session.get(Product, self.product_id)
            if p is None:
                return
            offset = len(p.photos)
            for i, path in enumerate(paths):
                p.photos.append(Photo(path=path, position=offset + i))
            session.commit()
        self.on_save(self.product_id)

    def _set_enabled(self, enabled: bool) -> None:
        for w in (
            self.title_edit,
            self.brand_edit,
            self.condition_edit,
            self.price_edit,
            self.notes_edit,
            self.description_edit,
            self.btn_add_photos,
            self.btn_save,
            self.btn_post,
        ):
            w.setEnabled(enabled)
