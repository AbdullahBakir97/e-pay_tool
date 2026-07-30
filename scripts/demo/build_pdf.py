#!/usr/bin/env python3
"""Builds the ePay Tool product documentation PDF.

Screenshots come from scripts/demo/capture.mjs, which drives the real
built application over the DevTools protocol - the images in the document
are genuine captures, not mockups.

    python3 scripts/demo/build_pdf.py [output.pdf]
"""

from __future__ import annotations

import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    Image,
    KeepTogether,
    ListFlowable,
    ListItem,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parent.parent.parent
IMAGES = ROOT / "docs" / "images"

# ---------------------------------------------------------------- palette

INK = colors.HexColor("#1C1F24")
MUTED = colors.HexColor("#5B636E")
ACCENT = colors.HexColor("#0A4FB4")
LIGHT = colors.HexColor("#F2F4F7")
BORDER = colors.HexColor("#D6D9E0")

STATE_COLORS = {
    "SCANNED": colors.HexColor("#E6E8EB"),
    "ENRICHING": colors.HexColor("#CFE3FB"),
    "NEEDS_INFO": colors.HexColor("#FDF1C2"),
    "READY": colors.HexColor("#CDECCF"),
    "POSTED": colors.HexColor("#9BD6A2"),
    "FAILED": colors.HexColor("#F9D2CE"),
}

PAGE_W, PAGE_H = A4
MARGIN = 20 * mm
CONTENT_W = PAGE_W - 2 * MARGIN

# ----------------------------------------------------------------- styles

_base = getSampleStyleSheet()

STYLES = {
    "title": ParagraphStyle(
        "title", parent=_base["Title"], fontName="Helvetica-Bold",
        fontSize=30, leading=35, textColor=colors.white, alignment=0,
    ),
    "subtitle": ParagraphStyle(
        "subtitle", parent=_base["Normal"], fontName="Helvetica",
        fontSize=13.5, leading=19, textColor=colors.HexColor("#D5E3F7"),
    ),
    "h1": ParagraphStyle(
        "h1", parent=_base["Heading1"], fontName="Helvetica-Bold",
        fontSize=17, leading=21, textColor=ACCENT, spaceBefore=2, spaceAfter=8,
    ),
    "h2": ParagraphStyle(
        "h2", parent=_base["Heading2"], fontName="Helvetica-Bold",
        fontSize=12.5, leading=16, textColor=INK, spaceBefore=12, spaceAfter=5,
    ),
    "body": ParagraphStyle(
        "body", parent=_base["Normal"], fontName="Helvetica",
        fontSize=9.8, leading=14.5, textColor=INK, alignment=TA_JUSTIFY,
        spaceAfter=7,
    ),
    "bullet": ParagraphStyle(
        "bullet", parent=_base["Normal"], fontName="Helvetica",
        fontSize=9.8, leading=14, textColor=INK, spaceAfter=3,
    ),
    "caption": ParagraphStyle(
        "caption", parent=_base["Normal"], fontName="Helvetica-Oblique",
        fontSize=8.6, leading=12, textColor=MUTED, spaceBefore=5, spaceAfter=10,
    ),
    "figure": ParagraphStyle(
        "figure", parent=_base["Normal"], fontName="Helvetica-Bold",
        fontSize=9.5, leading=13, textColor=ACCENT, spaceBefore=4, spaceAfter=4,
    ),
    "cell": ParagraphStyle(
        "cell", parent=_base["Normal"], fontName="Helvetica",
        fontSize=8.8, leading=12.2, textColor=INK,
    ),
    "cellhead": ParagraphStyle(
        "cellhead", parent=_base["Normal"], fontName="Helvetica-Bold",
        fontSize=8.8, leading=12.2, textColor=colors.white,
    ),
    "quote": ParagraphStyle(
        "quote", parent=_base["Normal"], fontName="Helvetica-Oblique",
        fontSize=9.6, leading=14, textColor=INK,
        leftIndent=10, rightIndent=10, spaceBefore=4, spaceAfter=8,
    ),
    "coverfoot": ParagraphStyle(
        "coverfoot", parent=_base["Normal"], fontName="Helvetica",
        fontSize=9.5, leading=14, textColor=colors.HexColor("#B9CDEA"),
    ),
    "toc": ParagraphStyle(
        "toc", parent=_base["Normal"], fontName="Helvetica",
        fontSize=10, leading=17, textColor=INK,
    ),
}


def p(text: str, style: str = "body") -> Paragraph:
    return Paragraph(text, STYLES[style])


def bullets(items: list[str]) -> ListFlowable:
    return ListFlowable(
        [ListItem(p(item, "bullet"), leftIndent=12) for item in items],
        bulletType="bullet", bulletFontSize=7, bulletOffsetY=1,
        leftIndent=12, spaceAfter=8,
    )


# ------------------------------------------------------------- components

class Rule(Flowable):
    """A thin horizontal accent rule."""

    def __init__(self, width: float, color=ACCENT, thickness: float = 2.0):
        super().__init__()
        self.width, self.color, self.thickness = width, color, thickness
        self.height = thickness

    def draw(self):
        self.canv.setFillColor(self.color)
        self.canv.rect(0, 0, self.width, self.thickness, stroke=0, fill=1)


class Callout(Flowable):
    """A tinted box for a key statement."""

    def __init__(self, text: str, width: float, fill=LIGHT, accent=ACCENT):
        super().__init__()
        self.width = width
        self.fill, self.accent = fill, accent
        self.para = Paragraph(text, ParagraphStyle(
            "callout", fontName="Helvetica", fontSize=9.8, leading=14.5,
            textColor=INK, alignment=TA_JUSTIFY,
        ))
        self.pad = 9
        self._h = 0.0

    def wrap(self, avail_w, avail_h):
        _, text_h = self.para.wrap(self.width - 2 * self.pad - 4, avail_h)
        self._h = text_h + 2 * self.pad
        return self.width, self._h

    def draw(self):
        c = self.canv
        c.setFillColor(self.fill)
        c.setStrokeColor(BORDER)
        c.roundRect(0, 0, self.width, self._h, 4, stroke=1, fill=1)
        c.setFillColor(self.accent)
        c.rect(0, 0, 3.2, self._h, stroke=0, fill=1)
        self.para.drawOn(c, self.pad + 4, self.pad)


class PipelineDiagram(Flowable):
    """The enrichment pipeline, drawn rather than screenshotted."""

    STEPS = [
        ("1", "Barcode-Scan", "USB-Scanner oder Tastatur", colors.HexColor("#E6E8EB")),
        ("2", "eBay Catalog API", "Exakte Produktdaten per GTIN", colors.HexColor("#CDECCF")),
        ("2b", "KI-Fallback", "Nur wenn der Katalog nichts liefert", colors.HexColor("#FDF1C2")),
        ("3", "eBay Taxonomy API", "Kategorie + Pflichtangaben", colors.HexColor("#CFE3FB")),
        ("4", "eBay Browse API", "Vergleichspreise für den Preisvorschlag",
         colors.HexColor("#CFE3FB")),
        ("5", "Prüfregeln", "Ergebnis: „Bereit“ oder „Info benötigt“",
         colors.HexColor("#E6E8EB")),
        ("6", "eBay Inventory API", "Veröffentlichung per Klick", colors.HexColor("#9BD6A2")),
    ]

    def __init__(self, width: float):
        super().__init__()
        self.width = width
        self.row_h = 15.5 * mm
        self.gap = 3.4 * mm
        self.height = len(self.STEPS) * self.row_h + (len(self.STEPS) - 1) * self.gap

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c = self.canv
        badge_w = 13 * mm
        for index, (num, title, detail, tint) in enumerate(self.STEPS):
            y = self.height - (index + 1) * self.row_h - index * self.gap

            c.setFillColor(tint)
            c.setStrokeColor(BORDER)
            c.roundRect(0, y, self.width, self.row_h, 3, stroke=1, fill=1)

            c.setFillColor(colors.white)
            c.roundRect(4 * mm, y + 3.2 * mm, badge_w, self.row_h - 6.4 * mm, 2, stroke=1, fill=1)
            c.setFillColor(ACCENT)
            c.setFont("Helvetica-Bold", 10)
            c.drawCentredString(4 * mm + badge_w / 2, y + self.row_h / 2 - 3.4, num)

            c.setFillColor(INK)
            c.setFont("Helvetica-Bold", 10)
            c.drawString(21 * mm, y + self.row_h / 2 + 1.0, title)
            c.setFillColor(MUTED)
            c.setFont("Helvetica", 8.4)
            c.drawString(21 * mm, y + self.row_h / 2 - 7.2, detail)

            if index < len(self.STEPS) - 1:
                cx = 10.5 * mm
                c.setStrokeColor(colors.HexColor("#9AA3AF"))
                c.setLineWidth(1.1)
                c.line(cx, y, cx, y - self.gap + 1.4 * mm)
                c.setFillColor(colors.HexColor("#9AA3AF"))
                path = c.beginPath()
                path.moveTo(cx, y - self.gap)
                path.lineTo(cx - 1.5 * mm, y - self.gap + 1.8 * mm)
                path.lineTo(cx + 1.5 * mm, y - self.gap + 1.8 * mm)
                path.close()
                c.drawPath(path, stroke=0, fill=1)


def screenshot(name: str, width: float = CONTENT_W) -> Image:
    """Places a screenshot scaled to the content width, with its aspect kept."""
    from PIL import Image as PilImage

    path = IMAGES / name
    with PilImage.open(path) as image:
        w, h = image.size
    return Image(str(path), width=width, height=width * h / w)


def framed(image: Image) -> Table:
    """Wraps a screenshot in a thin border so it reads as a figure."""
    table = Table([[image]], colWidths=[image.drawWidth + 4])
    table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))
    return table


def data_table(rows: list[list[str]], widths: list[float], head_bg=ACCENT) -> Table:
    body = [[Paragraph(cell, STYLES["cellhead"]) for cell in rows[0]]]
    body += [[Paragraph(cell, STYLES["cell"]) for cell in row] for row in rows[1:]]

    table = Table(body, colWidths=widths, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), head_bg),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8F9FB")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def state_table() -> Table:
    rows = [
        ["Status", "Bedeutung", "Nächster Schritt"],
        ["SCANNED", "Erfasst, noch nicht verarbeitet", "Automatisch: Anreicherung startet"],
        ["ENRICHING", "Katalog, Preis und KI laufen im Hintergrund", "Warten (wenige Sekunden)"],
        ["NEEDS_INFO", "Offene Fragen oder fehlende Pflichtangaben", "Fragen im Detailbereich beantworten"],
        ["READY", "Vollständiger Entwurf", "Ein Klick auf „Jetzt einstellen“"],
        ["POSTED", "Live bei eBay", "Fertig"],
        ["FAILED", "Letzter Vorgang fehlgeschlagen", "Fehler lesen, korrigieren, erneut prüfen"],
    ]
    widths = [CONTENT_W * 0.19, CONTENT_W * 0.44, CONTENT_W * 0.37]

    body = [[Paragraph(c, STYLES["cellhead"]) for c in rows[0]]]
    body += [[Paragraph(c, STYLES["cell"]) for c in row] for row in rows[1:]]

    table = Table(body, colWidths=widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for index, key in enumerate(
        ["SCANNED", "ENRICHING", "NEEDS_INFO", "READY", "POSTED", "FAILED"], start=1
    ):
        style.append(("BACKGROUND", (0, index), (0, index), STATE_COLORS[key]))
    table.setStyle(TableStyle(style))
    return table


# ------------------------------------------------------------- page frames

class DocTemplate(BaseDocTemplate):
    def __init__(self, path: str):
        super().__init__(
            path, pagesize=A4,
            leftMargin=MARGIN, rightMargin=MARGIN,
            topMargin=MARGIN, bottomMargin=18 * mm,
            title="ePay Tool - Produktdokumentation",
            author="ePay Tool",
            subject="Automatisierte eBay.de-Angebotserstellung",
        )
        cover_frame = Frame(0, 0, PAGE_W, PAGE_H, id="cover",
                            leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        body_frame = Frame(MARGIN, 18 * mm, CONTENT_W, PAGE_H - MARGIN - 18 * mm - 6 * mm,
                           id="body", leftPadding=0, rightPadding=0,
                           topPadding=0, bottomPadding=0)
        self.addPageTemplates([
            PageTemplate(id="cover", frames=[cover_frame], onPage=self._cover_bg),
            PageTemplate(id="body", frames=[body_frame], onPage=self._chrome),
        ])

    @staticmethod
    def _cover_bg(canvas: Canvas, _doc):
        canvas.saveState()
        canvas.setFillColor(colors.HexColor("#0B2E5E"))
        canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
        # Accent rule sitting directly under the title block.
        canvas.setFillColor(ACCENT)
        canvas.rect(MARGIN, PAGE_H - 122 * mm, CONTENT_W, 2.5, stroke=0, fill=1)
        # Understated corner motif.
        canvas.setStrokeColor(colors.HexColor("#1D4E8F"))
        canvas.setLineWidth(1)
        for offset in range(0, 60, 8):
            canvas.line(PAGE_W - 55 * mm + offset, 0, PAGE_W, 55 * mm - offset)
        canvas.restoreState()

    @staticmethod
    def _chrome(canvas: Canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.6)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN, PAGE_H - MARGIN + 6 * mm,
                          "ePay Tool - Automatisierte eBay.de-Angebotserstellung")
        canvas.setStrokeColor(BORDER)
        canvas.setLineWidth(0.5)
        canvas.line(MARGIN, PAGE_H - MARGIN + 4.4 * mm, PAGE_W - MARGIN, PAGE_H - MARGIN + 4.4 * mm)
        canvas.line(MARGIN, 14.5 * mm, PAGE_W - MARGIN, 14.5 * mm)
        canvas.drawString(MARGIN, 11 * mm, "Version 0.1.0")
        canvas.drawRightString(PAGE_W - MARGIN, 11 * mm, f"Seite {doc.page - 1}")
        canvas.restoreState()


# ----------------------------------------------------------------- content

def build(output: Path) -> None:
    doc = DocTemplate(str(output))
    story: list = []

    # ---------------- cover
    story.append(Spacer(1, 62 * mm))
    cover_body = [
        Paragraph("ePay Tool", STYLES["title"]),
        Spacer(1, 6 * mm),
        Paragraph(
            "Desktop-Anwendung für die automatisierte<br/>Angebotserstellung auf eBay.de",
            STYLES["subtitle"],
        ),
        Spacer(1, 10 * mm),
        Paragraph(
            "Vom Barcode zum fertigen Angebot – ohne manuelle Recherche.<br/>"
            "Für die Massenerfassung von 100+ Artikeln pro Tag.",
            STYLES["subtitle"],
        ),
    ]
    cover_table = Table([[flow] for flow in cover_body], colWidths=[CONTENT_W])
    cover_table.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    wrapper = Table([[cover_table]], colWidths=[PAGE_W])
    wrapper.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), MARGIN),
        ("RIGHTPADDING", (0, 0), (-1, -1), MARGIN),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    story.append(wrapper)
    story.append(Spacer(1, 128 * mm))

    meta = Table(
        [[Paragraph("Produktdokumentation &nbsp;·&nbsp; Version 0.1.0 &nbsp;·&nbsp; "
                    "Plattformen: Windows und macOS", STYLES["coverfoot"])]],
        colWidths=[PAGE_W - 2 * MARGIN],
    )
    meta.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("LINEABOVE", (0, 0), (-1, 0), 0.7, colors.HexColor("#1D4E8F")),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
    ]))
    meta_wrap = Table([[meta]], colWidths=[PAGE_W])
    meta_wrap.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), MARGIN),
        ("RIGHTPADDING", (0, 0), (-1, -1), MARGIN),
    ]))
    story.append(meta_wrap)

    # The template switch must be queued BEFORE the break, otherwise the next
    # page still renders with the cover's dark background.
    story.append(NextPageTemplate("body"))
    story.append(PageBreak())

    # ---------------- 1 overview
    story.append(p("1 &nbsp; Das Problem und die Lösung", "h1"))
    story.append(Rule(CONTENT_W))
    story.append(Spacer(1, 7))
    story.append(p(
        "Bisher lief jeder Artikel von Hand: Barcode ablesen, im Internet suchen, eine "
        "Shop-Seite lesen, Daten in das eBay-Formular übertragen, den Preis schätzen. Pro "
        "Artikel kostet das mehrere Minuten – bei 100 Artikeln am Tag ist das der ganze "
        "Arbeitstag."
    ))
    story.append(p(
        "ePay Tool ersetzt diesen Ablauf. Der Nutzer scannt einen Barcode, die Anwendung "
        "ermittelt die Produktdaten, recherchiert den Marktpreis, füllt das Angebot aus und "
        "legt es zur Prüfung vor. Ein Klick veröffentlicht es. Was die Anwendung nicht sicher "
        "erkennt, fragt sie nach – statt zu raten."
    ))
    story.append(Spacer(1, 3))
    story.append(Callout(
        "<b>Die zentrale Entscheidung:</b> Nicht die KI identifiziert die Produkte, sondern "
        "eBays eigene Schnittstellen. Für einen Artikel mit Barcode im eBay-Katalog liefert "
        "ein einziger Aufruf Titel, Marke, Artikelmerkmale und Katalogbilder – exakt, sofort "
        "und kostenlos. Die KI ist die Rückfallebene für alles, was der Katalog nicht "
        "beantworten kann: gebrauchte, ausgepackte oder nicht gelistete Ware.",
        CONTENT_W,
    ))
    story.append(Spacer(1, 6))

    story.append(p("Was das praktisch bedeutet", "h2"))
    story.append(bullets([
        "<b>Tempo:</b> Ein Katalogtreffer ist in unter einer Sekunde vollständig ausgefüllt.",
        "<b>Genauigkeit:</b> Katalogdaten stammen aus eBays eigenem Vokabular – keine "
        "Übersetzungsschicht, kein Risiko erfundener Angaben.",
        "<b>Kosten:</b> Die KI wird nur für die Minderheit der Artikel ohne Katalogtreffer "
        "aufgerufen. Das hält die laufenden Kosten bei wenigen Euro im Monat.",
        "<b>Kontrolle:</b> Nichts geht ohne ausdrücklichen Klick online.",
    ]))

    story.append(PageBreak())

    story.append(p("Der Ablauf pro Artikel", "h2"))
    story.append(p(
        "Jeder Schritt liefert nur das, was er sicher weiß, und reicht den Rest weiter. "
        "Schritt 2b wird ausschließlich dann ausgeführt, wenn der Katalog keinen Treffer "
        "hat – bei Markenware mit Barcode bleibt die KI vollständig außen vor."
    ))
    story.append(Spacer(1, 2))
    story.append(PipelineDiagram(CONTENT_W))
    story.append(Spacer(1, 8))
    story.append(p(
        "Zwischen Schritt 5 und 6 liegt bewusst eine Pause: Die Anwendung legt das Angebot "
        "bei eBay zunächst <b>unveröffentlicht</b> an. Erst der ausdrückliche Klick des "
        "Nutzers schaltet es live. Ein in der Prüfung entdeckter Fehler kostet deshalb "
        "nichts – es ist noch nichts online."
    ))

    story.append(PageBreak())

    # ---------------- 2 the queue
    story.append(p("2 &nbsp; Die Arbeitsliste", "h1"))
    story.append(Rule(CONTENT_W))
    story.append(Spacer(1, 7))
    story.append(p(
        "Für einen Tag mit 100 Artikeln ist die Arbeitsliste das eigentliche Programm. Jeder "
        "gescannte Artikel bekommt einen eigenen Status und wird lokal gespeichert. Ein "
        "Neustart, ein Absturz oder ein auf zwei Tage verteilter Stapel gehen deshalb nicht "
        "verloren. Der Nutzer scannt eine ganze Kiste hintereinander ein, die Anreicherung "
        "läuft im Hintergrund weiter, und er arbeitet die Liste anschließend in Ruhe ab."
    ))
    story.append(Spacer(1, 4))
    story.append(state_table())
    story.append(Spacer(1, 10))

    story.append(p("Abbildung 1: Die Arbeitsliste", "figure"))
    story.append(framed(screenshot("01-queue.png")))
    story.append(p(
        "Farbcodierte Übersicht aller Artikel. Grün ist bereit zum Einstellen, Gelb braucht "
        "noch Angaben, Rot ist fehlgeschlagen. Die Fußzeile zählt die Artikel je Status, "
        "sodass auf einen Blick klar ist, was noch zu tun ist. Der obere Hinweisbalken "
        "erscheint, solange keine eBay-Anmeldung vorliegt – in dieser Demo-Umgebung ist das "
        "der Fall.",
        "caption",
    ))

    story.append(PageBreak())

    # ---------------- 3 the AI asks
    story.append(p("3 &nbsp; Die KI fragt, statt zu raten", "h1"))
    story.append(Rule(CONTENT_W))
    story.append(Spacer(1, 7))
    story.append(p(
        "Das ist der Kern der Anwendung und der Punkt, an dem sie sich von einer einfachen "
        "Automatisierung unterscheidet. Ein Bildmodell, das gefragt wird „was ist das?“, "
        "liefert <i>immer</i> eine Antwort. Ein Frontfoto eines Smartphones enthält aber "
        "schlicht nicht die Information, um welches Modell es sich handelt."
    ))
    story.append(p(
        "Deshalb liefert die KI zu jedem Feld einen eigenen Sicherheitswert mit. Alles "
        "unterhalb der Schwelle erreicht das Angebot gar nicht erst, sondern wird zu einer "
        "konkreten Frage an den Nutzer – inklusive Hinweis, wo die Information zu finden ist:"
    ))
    story.append(Callout(
        "„Bitte die Rückseite fotografieren, um das genaue Modell zu bestimmen. Die "
        "Modellnummer (z.&nbsp;B. A2633) steht auf der Rückseite oder unter Einstellungen "
        "&gt; Allgemein &gt; Info.“",
        CONTENT_W, fill=colors.HexColor("#FDF1C2"), accent=colors.HexColor("#C9A227"),
    ))
    story.append(p(
        "Ohne diese Sperre würde die Anwendung gelegentlich ein überzeugend formuliertes, aber "
        "falsches Angebot veröffentlichen. Für einen Verkäufer ist das der schlimmste "
        "Fehlerfall, weil er erst spät als Retoure oder Verstoß auffällt. Mit der Sperre wird "
        "aus der Unsicherheit eine Frage, die in Sekunden beantwortet ist.",
    ))
    story.append(Spacer(1, 6))

    story.append(p("Abbildung 2: Offene Fragen zu einem Smartphone", "figure"))
    story.append(framed(screenshot("02-ai-questions.png")))
    story.append(p(
        "Die KI hat die Marke sicher erkannt (Apple) und den Zustand vorgeschlagen, das genaue "
        "Modell und die Speichergröße aber ausdrücklich offengelassen. Zusätzlich schlägt sie "
        "vor, welche Fotos noch fehlen. Der Artikel bleibt so lange auf „Info benötigt“.",
        "caption",
    ))

    story.append(PageBreak())

    story.append(p("Abbildung 3: Dieselbe Logik bei Kleidung und Schuhen", "figure"))
    story.append(framed(screenshot("05-size-question.png")))
    story.append(p(
        "Modell und Marke sind erkannt, die Größe ist auf den Fotos nicht lesbar – also fragt "
        "die Anwendung gezielt nach dem Etikett an der Zungeninnenseite. Der Preisvorschlag "
        "steht bereits, basierend auf 44 vergleichbaren Angeboten.",
        "caption",
    ))
    story.append(Spacer(1, 4))

    story.append(p("Harte Regeln im Code, weiche Hinweise von der KI", "h2"))
    story.append(p(
        "Ob ein Entwurf veröffentlicht werden darf, entscheidet nicht das Modell, sondern "
        "fest programmierte Regeln: Titel vorhanden und höchstens 80 Zeichen, Preis gesetzt, "
        "Kategorie gesetzt, Zustand gesetzt, mindestens ein Foto, und jede von eBay für die "
        "Kategorie geforderte Pflichtangabe gefüllt. Das sind eBays Regeln – sie müssen "
        "reproduzierbar und testbar sein. Die KI steuert ausschließlich unverbindliche "
        "Verbesserungsvorschläge bei und kann ein Angebot weder blockieren noch freigeben."
    ))

    story.append(PageBreak())

    # ---------------- 4 pricing + errors
    story.append(p("4 &nbsp; Preisfindung und Fehlerbehandlung", "h1"))
    story.append(Rule(CONTENT_W))
    story.append(Spacer(1, 7))
    story.append(p(
        "Der Preisvorschlag entsteht aus den aktuell laufenden Angeboten zum selben Barcode. "
        "Eine Suche nach GTIN liefert allerdings mehr als das Produkt selbst: Handyhüllen "
        "unter dem Barcode des Telefons, defekte Geräte, Zehnerpacks. Solche Ausreißer werden "
        "vor jeder Berechnung entfernt – sonst zieht eine 5-Euro-Hülle den Vorschlag für ein "
        "400-Euro-Telefon nach unten. Als Anker dient der Median, nicht der Mittelwert, und "
        "der Vorschlag unterschreitet nie das günstigste vergleichbare Angebot."
    ))
    story.append(Spacer(1, 5))
    story.append(p("Abbildung 4: Fertiger Entwurf mit Marktrecherche", "figure"))
    story.append(framed(screenshot("03-ready-listing.png")))
    story.append(p(
        "Der Katalogtreffer hat Titel, Marke, Zustand und Katalogbilder geliefert. Unter dem "
        "Preisfeld steht die Marktrecherche im Klartext: Spanne, Median, Anzahl der "
        "ausgewerteten Angebote und wie viele Ausreißer entfernt wurden.",
        "caption",
    ))
    story.append(Spacer(1, 4))
    story.append(p(
        "<b>Hinweis:</b> Ausgewertet werden <i>Angebotspreise</i>, nicht tatsächlich erzielte "
        "Verkaufspreise. Echte Verkaufsdaten erfordern eine gesonderte eBay-Freigabe "
        "(Marketplace Insights API); die Anwendung ist so gebaut, dass diese Quelle später "
        "ohne weitere Änderungen ergänzt werden kann."
    ))

    story.append(PageBreak())

    story.append(p("Ein Fehler stoppt nie den ganzen Stapel", "h2"))
    story.append(p(
        "Jeder Artikel trägt seinen eigenen Status und seinen eigenen Fehlertext. Läuft ein "
        "Artikel auf einen eBay-Fehler, wird dieser im Klartext am Artikel vermerkt, und die "
        "übrigen 99 laufen weiter. Nach der Korrektur genügt „Speichern &amp; neu prüfen“; "
        "eine erfolgreiche Wiederholung löscht den alten Fehler."
    ))
    story.append(Spacer(1, 5))
    story.append(p("Abbildung 5: Fehlgeschlagener Artikel mit eBay-Meldung", "figure"))
    story.append(framed(screenshot("04-failed-item.png")))
    story.append(p(
        "Die Meldung von eBay wird unverändert angezeigt, statt sie hinter einer allgemeinen "
        "Fehlermeldung zu verstecken. So ist sofort klar, was zu korrigieren ist.",
        "caption",
    ))

    story.append(PageBreak())

    # ---------------- 5 architecture
    story.append(p("5 &nbsp; Technischer Aufbau", "h1"))
    story.append(Rule(CONTENT_W))
    story.append(Spacer(1, 7))
    story.append(p(
        "Die Anwendung ist eine Electron-Desktop-Anwendung in TypeScript. Sämtliche "
        "sicherheitsrelevante Arbeit – Datenbank, Netzwerk, Dateisystem, Zugangsdaten – "
        "läuft im Hauptprozess. Die Oberfläche läuft abgeschottet, ohne Node-Zugriff, und "
        "erreicht den Hauptprozess ausschließlich über fest definierte, typisierte Kanäle."
    ))
    story.append(Spacer(1, 4))
    story.append(data_table(
        [
            ["Bereich", "Technik", "Begründung"],
            ["Oberfläche", "React + TypeScript",
             "Schnelle, wartbare Prüfansicht; abgeschottet vom System"],
            ["Laufzeit", "Electron 37",
             "Eine Codebasis für Windows und macOS"],
            ["Datenhaltung", "SQLite (in Node enthalten)",
             "Kein nativer Baustein: kein Neubau je Plattform, keine "
             "zusätzliche Signatur"],
            ["eBay-Anbindung", "Catalog, Taxonomy, Browse, Inventory, Media",
             "Offizielle Schnittstellen statt Web-Scraping"],
            ["KI", "Google Gemini oder lokal via Ollama",
             "Hinter einer Schnittstelle austauschbar"],
            ["Verpackung", "electron-builder",
             "Installer (.exe) für Windows, .dmg für macOS (Intel und Apple Silicon)"],
        ],
        [CONTENT_W * 0.19, CONTENT_W * 0.29, CONTENT_W * 0.52],
    ))
    story.append(Spacer(1, 10))

    story.append(p("Sicherheit und Zugangsdaten", "h2"))
    story.append(bullets([
        "Die eBay-Anmeldung erfolgt einmalig im Browser über das offizielle "
        "OAuth-Verfahren. Das Passwort des Nutzers sieht die Anwendung nie.",
        "Das langlebige Zugriffstoken wird verschlüsselt im Anmeldeinformationsspeicher "
        "des Betriebssystems abgelegt (Windows Credential Manager bzw. macOS-Schlüsselbund) "
        "– niemals im Klartext auf der Festplatte.",
        "Die Oberfläche läuft mit aktivierter Kontextisolierung und ohne Node-Integration.",
        "Angebote werden zunächst unveröffentlicht angelegt und gehen erst auf "
        "ausdrücklichen Klick online.",
    ]))

    story.append(p("Robustheit im Alltag", "h2"))
    story.append(bullets([
        "Die Anreicherung läuft mit begrenzter Parallelität, weil eBay pro Anwendung "
        "Aufrufgrenzen setzt. Mehr gleichzeitige Anfragen brächten keinen Zeitgewinn, "
        "sondern nur Fehler.",
        "Fehlt der KI-Schlüssel, startet die Anwendung trotzdem und weist darauf hin. "
        "Der Barcode-Weg funktioniert vollständig ohne KI.",
        "Die Datenbank arbeitet im WAL-Modus, damit die Oberfläche lesen kann, während "
        "im Hintergrund geschrieben wird.",
    ]))

    story.append(PageBreak())

    # ---------------- 6 quality
    story.append(p("6 &nbsp; Qualitätssicherung", "h1"))
    story.append(Rule(CONTENT_W))
    story.append(Spacer(1, 7))
    story.append(p(
        "Die Anwendung wird bei jeder Änderung automatisch geprüft. Die Tests laufen gegen "
        "nachgebildete eBay- und KI-Gegenstellen und benötigen daher weder Netzwerk noch "
        "Zugangsdaten."
    ))
    story.append(Spacer(1, 4))
    story.append(data_table(
        [
            ["Prüfung", "Umfang", "Status"],
            ["Automatisierte Tests", "69 Tests in 9 Dateien", "bestanden"],
            ["Typprüfung", "Gesamtes Projekt, strikte Einstellungen", "ohne Befund"],
            ["Code-Analyse (Lint)", "Quellcode und Tests", "ohne Befund"],
            ["Start-Test der fertigen App",
             "Startet die gebaute Anwendung und prüft Oberfläche und interne "
             "Schnittstelle", "bestanden"],
        ],
        [CONTENT_W * 0.26, CONTENT_W * 0.53, CONTENT_W * 0.21],
    ))
    story.append(Spacer(1, 9))
    story.append(p("Wofür die Tests konkret einstehen", "h2"))
    story.append(bullets([
        "Ein Stapel von 60 Artikeln wird vollständig und parallel abgearbeitet.",
        "Ein einzelner fehlerhafter Artikel bringt den Stapel nicht zum Stillstand.",
        "Eine erfolgreiche Wiederholung löscht den alten Fehlertext.",
        "Unsichere KI-Angaben erreichen das Angebot nicht, werden aber als Sicherheitswert "
        "gespeichert.",
        "Ein 5-Euro-Zubehörartikel unter dem Barcode eines 400-Euro-Geräts verändert den "
        "Preisvorschlag nicht.",
        "Ein exakter Katalogtitel wird nicht von der KI umgeschrieben.",
    ]))
    story.append(Spacer(1, 4))
    story.append(Callout(
        "Der Start-Test der fertigen Anwendung entstand aus einem echten Fehler: Die "
        "Brücke zwischen Oberfläche und Hauptprozess wurde unter einem anderen Dateinamen "
        "erzeugt als erwartet. Die Anwendung startete – und tat danach nichts. Kein "
        "gewöhnlicher Test kann das sehen; der Start-Test sieht es sofort.",
        CONTENT_W,
    ))

    story.append(PageBreak())

    # ---------------- 7 setup + limits
    story.append(p("7 &nbsp; Inbetriebnahme", "h1"))
    story.append(Rule(CONTENT_W))
    story.append(Spacer(1, 7))
    story.append(data_table(
        [
            ["Schritt", "Was zu tun ist"],
            ["1. eBay-Entwicklerkonto",
             "Anwendung unter developer.ebay.com anlegen und App-ID, Cert-ID und RuName "
             "übernehmen. Die Weiterleitungsadresse der Anwendung auf "
             "http://localhost:8123/callback setzen."],
            ["2. Testumgebung",
             "Zunächst gegen die eBay-Sandbox arbeiten. Erst nach erfolgreichem Test auf "
             "die Produktivumgebung umstellen."],
            ["3. KI-Schlüssel",
             "Kostenlosen Google-AI-Studio-Schlüssel eintragen. Für den Dauerbetrieb wird "
             "ein kostenpflichtiger Zugang empfohlen; bei 100+ Artikeln pro Tag liegen die "
             "Kosten im Bereich weniger Euro pro Monat."],
            ["4. Anmeldung",
             "Beim ersten Start einmalig im Browser bei eBay anmelden."],
            ["5. Richtlinien",
             "In den Einstellungen Versand-, Zahlungs- und Rücknahmerichtlinie auswählen. "
             "eBay verlangt alle drei für jedes Angebot."],
        ],
        [CONTENT_W * 0.24, CONTENT_W * 0.76],
    ))
    story.append(Spacer(1, 10))

    story.append(p("8 &nbsp; Grenzen und offene Punkte", "h1"))
    story.append(Rule(CONTENT_W))
    story.append(Spacer(1, 7))
    story.append(p(
        "Diese Punkte sind bewusst offen benannt, damit sie früh geprüft und nicht spät "
        "entdeckt werden."
    ))
    story.append(data_table(
        [
            ["Punkt", "Bedeutung und Empfehlung"],
            ["Katalogabdeckung",
             "Sehr gut bei Elektronik und Medien, schwächer bei Kleidung und "
             "No-Name-Ware. <b>Empfehlung:</b> in der ersten Woche mit 20 echten Artikeln "
             "des Kunden testen – das zeigt, wie viel Arbeit tatsächlich auf den KI-Weg "
             "entfällt."],
            ["Gebrauchtware ohne Barcode",
             "Das sind die schwierigen Fälle. Hier sind Rückfragen und gute Fotos "
             "unvermeidbar. <b>Empfehlung:</b> diese Erwartung von Anfang an mit dem "
             "Kunden klären."],
            ["Angebots- statt Verkaufspreise",
             "Echte Verkaufspreise erfordern eine gesonderte eBay-Freigabe. Die "
             "Anwendung ist auf diese Erweiterung vorbereitet."],
            ["Produktivzugang",
             "Die Freigabe der Produktivschlüssel ist die einzige externe Abhängigkeit, "
             "die den Zeitplan gefährden kann. <b>Empfehlung:</b> sofort beantragen."],
            ["Katalogbilder bei Gebrauchtware",
             "Katalogbilder werden nur verwendet, wenn keine eigenen Fotos vorliegen. Bei "
             "gebrauchten Artikeln weist die Anwendung ausdrücklich darauf hin, dass "
             "eigene Fotos nötig sind."],
        ],
        [CONTENT_W * 0.26, CONTENT_W * 0.74],
    ))

    story.append(Spacer(1, 12))
    story.append(Rule(CONTENT_W, color=BORDER, thickness=0.8))
    story.append(Spacer(1, 5))
    story.append(p(
        "<i>Alle Bildschirmfotos in diesem Dokument stammen aus der laufenden Anwendung und "
        "zeigen Demonstrationsdaten. Es wurden keine echten Angebote veröffentlicht.</i>",
        "caption",
    ))

    doc.build(story)


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "ePay-Tool-Dokumentation.pdf"
    target.parent.mkdir(parents=True, exist_ok=True)
    build(target)
    print(f"PDF written to {target}")
