#!/usr/bin/env python3
"""Refresh completed UTC daily BTCUSDT and ETHUSDT candles from Binance Vision."""

import argparse
import json
import math
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path


START = date(2021, 12, 1)  # 20 earlier closes are needed for 2022 signals.
DAY_MS = 86_400_000
FILES = {"BTCUSDT": "candles.json", "ETHUSDT": "eth-candles.json"}
API = "https://data-api.binance.vision/api/v3/klines"


def timestamp_ms(day):
    return int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp() * 1000)


def fetch(symbol, start, today):
    result = []
    cursor = timestamp_ms(start)
    end = timestamp_ms(today)
    while cursor < end:
        query = urllib.parse.urlencode({
            "symbol": symbol, "interval": "1d", "startTime": cursor,
            "endTime": end - 1, "limit": 1000,
        })
        request = urllib.request.Request(f"{API}?{query}", headers={"User-Agent": "sma20-backtest/1.0"})
        with urllib.request.urlopen(request, timeout=30) as response:
            rows = json.load(response)
        if not isinstance(rows, list):
            raise ValueError(f"Unexpected response for {symbol}")
        if not rows:
            break
        for row in rows:
            opened = int(row[0])
            if opened < cursor or opened >= end:
                continue
            values = [float(row[index]) for index in (1, 2, 3, 4)]
            if not all(math.isfinite(value) and value > 0 for value in values):
                raise ValueError(f"Invalid OHLC values for {symbol}")
            result.append([datetime.fromtimestamp(opened / 1000, timezone.utc).date().isoformat(), *values])
        next_cursor = int(rows[-1][0]) + DAY_MS
        if next_cursor <= cursor:
            raise ValueError(f"Pagination did not advance for {symbol}")
        cursor = next_cursor
    return result


def update(directory, today):
    for symbol, filename in FILES.items():
        path = directory / filename
        existing = json.loads(path.read_text()) if path.exists() else []
        start = max(START, date.fromisoformat(existing[-1][0]) - timedelta(days=2)) if existing else START
        fresh = fetch(symbol, start, today)
        merged = {row[0]: row for row in existing if date.fromisoformat(row[0]) < start}
        merged.update((row[0], row) for row in fresh)
        candles = [merged[key] for key in sorted(merged) if key < today.isoformat()]
        if not candles or date.fromisoformat(candles[0][0]) > START:
            raise ValueError(f"Missing historical candles for {symbol}")
        if existing != candles:
            path.write_text(json.dumps(candles, ensure_ascii=False, separators=(",", ":")) + "\n")
        print(f"{symbol}: {len(candles)} candles, through {candles[-1][0]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, default=Path("."))
    args = parser.parse_args()
    update(args.directory, datetime.now(timezone.utc).date())
