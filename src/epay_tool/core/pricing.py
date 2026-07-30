"""Price suggestion from market data.

A GTIN search on eBay returns more than the product itself: phone cases
listed under the phone's barcode, broken units, multi-packs. Those
outliers are trimmed before any statistic is computed, otherwise a single
5-euro accessory drags the suggested price for a 400-euro phone down.
"""

from __future__ import annotations

import statistics
from dataclasses import asdict, dataclass

# Kept wide on purpose: only obvious non-comparables are removed, and the
# median is robust enough to absorb the rest.
LOW_FACTOR = 0.25
HIGH_FACTOR = 4.0
MIN_SAMPLE_FOR_TRIM = 4


def trim_outliers(
    prices: list[float],
    low_factor: float = LOW_FACTOR,
    high_factor: float = HIGH_FACTOR,
) -> list[float]:
    """Drop prices far away from the median of the raw sample."""
    if len(prices) < MIN_SAMPLE_FOR_TRIM:
        return sorted(prices)
    median = statistics.median(prices)
    if median <= 0:
        return sorted(prices)
    kept = [p for p in prices if low_factor * median <= p <= high_factor * median]
    return sorted(kept or prices)


@dataclass
class PriceStats:
    minimum: float
    median: float
    maximum: float
    sample_size: int
    currency: str
    outliers_removed: int = 0

    @classmethod
    def from_prices(cls, prices: list[float], currency: str) -> PriceStats:
        if not prices:
            raise ValueError("Cannot build price statistics from an empty sample.")
        kept = trim_outliers(prices)
        return cls(
            minimum=min(kept),
            median=statistics.median(kept),
            maximum=max(kept),
            sample_size=len(kept),
            currency=currency,
            outliers_removed=len(prices) - len(kept),
        )

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> PriceStats:
        return cls(**data)


def suggest_price(stats: PriceStats, undercut_percent: float = 3.0) -> float:
    """Slightly undercut the median asking price, never below the cheapest.

    The median (not the mean) is the anchor so that remaining outliers
    barely move the result; the floor at the cheapest comparable listing
    keeps an aggressive undercut setting from suggesting a loss-making
    price.
    """
    candidate = stats.median * (1 - undercut_percent / 100)
    candidate = max(candidate, stats.minimum)
    return round(candidate, 2)
