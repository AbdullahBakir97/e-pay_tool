from __future__ import annotations

import pytest

from epay_tool.core.pricing import PriceStats, suggest_price, trim_outliers


def test_stats_from_prices():
    stats = PriceStats.from_prices([10.0, 20.0, 30.0], "EUR")
    assert (stats.minimum, stats.median, stats.maximum) == (10.0, 20.0, 30.0)
    assert stats.sample_size == 3


def test_suggest_price_undercuts_median():
    stats = PriceStats.from_prices([90.0, 100.0, 110.0], "EUR")
    assert suggest_price(stats, undercut_percent=10.0) == 90.0


def test_accessory_listing_is_trimmed_out():
    # A 5-euro phone case listed under the phone's GTIN must not set the price.
    prices = [5.0, 380.0, 400.0, 420.0]
    assert trim_outliers(prices) == [380.0, 400.0, 420.0]

    stats = PriceStats.from_prices(prices, "EUR")
    assert stats.minimum == 380.0
    assert stats.outliers_removed == 1
    assert suggest_price(stats, undercut_percent=3.0) == 388.0


def test_bundle_listing_is_trimmed_out():
    prices = [380.0, 400.0, 420.0, 5000.0]  # a 10-piece wholesale lot
    stats = PriceStats.from_prices(prices, "EUR")
    assert stats.maximum == 420.0
    assert stats.outliers_removed == 1


def test_small_samples_are_not_trimmed():
    # With fewer than four data points, trimming would be guesswork.
    assert trim_outliers([5.0, 400.0]) == [5.0, 400.0]


def test_suggest_price_never_below_cheapest_comparable():
    stats = PriceStats.from_prices([380.0, 400.0, 400.0, 420.0], "EUR")
    assert suggest_price(stats, undercut_percent=90.0) == 380.0


def test_empty_sample_is_rejected():
    with pytest.raises(ValueError):
        PriceStats.from_prices([], "EUR")


def test_stats_roundtrip():
    stats = PriceStats.from_prices([5.0, 15.0], "EUR")
    assert PriceStats.from_dict(stats.to_dict()) == stats
