"""Settings dialog: pick the eBay business policies used for every listing.

eBay requires a payment, shipping and return policy on each offer. The
seller configures these once on eBay; here the user just picks which ones
this app should use, and the choice is remembered.
"""

from __future__ import annotations

from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QLabel,
    QVBoxLayout,
)

from epay_tool.ebay.client import EbayClient
from epay_tool.ebay.inventory import list_policies
from epay_tool.prefs import get_policy_ids, set_policy_ids

_POLICY_FIELDS = [
    ("fulfillment", "Versandrichtlinie", "fulfillmentPolicyId"),
    ("payment", "Zahlungsrichtlinie", "paymentPolicyId"),
    ("return", "Rücknahmerichtlinie", "returnPolicyId"),
]


class SettingsDialog(QDialog):
    def __init__(self, client: EbayClient, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Einstellungen – eBay-Richtlinien")
        self.resize(520, 220)
        self.client = client
        self.combos: dict[str, QComboBox] = {}

        layout = QVBoxLayout(self)
        self.info = QLabel(
            "Diese Richtlinien werden für alle neuen Angebote verwendet.\n"
            "Sie stammen aus Ihrem eBay-Verkäuferkonto."
        )
        self.info.setWordWrap(True)
        layout.addWidget(self.info)

        form = QFormLayout()
        for key, label, _ in _POLICY_FIELDS:
            combo = QComboBox()
            self.combos[key] = combo
            form.addRow(label, combo)
        layout.addLayout(form)

        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self._load_policies()

    def _load_policies(self) -> None:
        try:
            policies = list_policies(self.client)
        except Exception as exc:
            self.info.setText(f"Richtlinien konnten nicht geladen werden: {exc}")
            return

        current = get_policy_ids()
        for key, _label, id_field in _POLICY_FIELDS:
            combo = self.combos[key]
            combo.clear()
            for policy in policies.get(key, []):
                combo.addItem(policy.get("name", "(ohne Namen)"), policy.get(id_field))
            saved = current.get(key)
            if saved:
                index = combo.findData(saved)
                if index >= 0:
                    combo.setCurrentIndex(index)

    def selected_policy_ids(self) -> dict[str, str]:
        return {
            key: combo.currentData()
            for key, combo in self.combos.items()
            if combo.currentData()
        }

    def accept(self) -> None:
        set_policy_ids(self.selected_policy_ids())
        super().accept()
