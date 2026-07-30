"""Local database models.

The queue of products being prepared for listing lives entirely in a local
SQLite database, so a batch of 100+ scans survives app restarts and the
user can work through the review grid at their own pace.
"""

from __future__ import annotations

import enum
import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_sku() -> str:
    return "EP-" + uuid.uuid4().hex[:12].upper()


class ProductState(enum.StrEnum):
    SCANNED = "SCANNED"          # just captured (barcode and/or photos)
    ENRICHING = "ENRICHING"      # pipeline is running (catalog / AI / pricing)
    NEEDS_INFO = "NEEDS_INFO"    # open questions or missing required fields
    READY = "READY"              # complete draft, one click away from posting
    POSTING = "POSTING"          # being published to eBay
    POSTED = "POSTED"            # live on eBay
    FAILED = "FAILED"            # last operation failed; can be retried


class DataSource(enum.StrEnum):
    CATALOG = "CATALOG"  # matched in the eBay product catalog by GTIN
    AI = "AI"            # identified by the AI fallback from photos/notes
    MANUAL = "MANUAL"    # entered by the user


class Base(DeclarativeBase):
    pass


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    sku: Mapped[str] = mapped_column(String(32), unique=True, default=new_sku)
    state: Mapped[ProductState] = mapped_column(
        Enum(ProductState), default=ProductState.SCANNED, index=True
    )
    source: Mapped[DataSource | None] = mapped_column(Enum(DataSource), nullable=True)

    # Identification
    gtin: Mapped[str | None] = mapped_column(String(14), index=True)
    epid: Mapped[str | None] = mapped_column(String(20))  # eBay product id from Catalog API
    title: Mapped[str | None] = mapped_column(String(80))
    brand: Mapped[str | None] = mapped_column(String(120))
    mpn: Mapped[str | None] = mapped_column(String(120))
    condition: Mapped[str | None] = mapped_column(String(40))  # NEW, USED_EXCELLENT, ...
    category_id: Mapped[str | None] = mapped_column(String(20))
    aspects: Mapped[dict | None] = mapped_column(JSON)  # {"Farbe": ["Schwarz"], ...}
    description: Mapped[str | None] = mapped_column(Text)
    user_notes: Mapped[str | None] = mapped_column(Text)  # free text the user adds for the AI

    # Offer
    price: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    price_stats: Mapped[dict | None] = mapped_column(JSON)  # market research snapshot

    # AI assistance
    ai_questions: Mapped[list | None] = mapped_column(JSON)      # open questions to the user
    ai_suggestions: Mapped[list | None] = mapped_column(JSON)    # photo/quality suggestions
    ai_confidence: Mapped[dict | None] = mapped_column(JSON)     # per-field confidence 0..1

    # eBay publishing state
    offer_id: Mapped[str | None] = mapped_column(String(40))
    listing_id: Mapped[str | None] = mapped_column(String(40))
    last_error: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    photos: Mapped[list[Photo]] = relationship(
        back_populates="product", cascade="all, delete-orphan", order_by="Photo.position"
    )


class Photo(Base):
    __tablename__ = "photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), index=True)
    path: Mapped[str] = mapped_column(String(500))       # local file path
    ebay_url: Mapped[str | None] = mapped_column(String(500))  # after upload to eBay
    position: Mapped[int] = mapped_column(Integer, default=0)

    product: Mapped[Product] = relationship(back_populates="photos")
