"""Validates Lot 0 timeseries samples against CDC thresholds.

Example:
    python scripts/lot0/validate_timeseries.py \
        --input data/samples/mesures.json \
        --output docs/data_quality_report_sample.json
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

Number = float | int


@dataclass
class RuleResult:
    rule: str
    total: int
    violations: int

    @property
    def rate(self) -> float:
        return (self.violations / self.total) if self.total else 0.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate measurement samples")
    parser.add_argument("--input", type=Path, required=True, help="Path to JSON or CSV sample")
    parser.add_argument("--output", type=Path, help="Optional JSON report output")
    parser.add_argument("--timestamp-field", default="timestamp", help="Field containing ISO datetime")
    parser.add_argument("--methane-field", default="methane_pct", help="Field for CH4 (%)")
    parser.add_argument("--oxygen-field", default="oxygen_pct", help="Field for O2 (%)")
    parser.add_argument("--co2-field", default="co2_pct", help="Field for CO2 (%)")
    parser.add_argument("--depression-field", default="depression_pa", help="Field for depression (Pa)")
    parser.add_argument("--velocity-field", default="flow_velocity_ms", help="Field for velocity (m/s)")
    parser.add_argument("--gap-threshold-minutes", type=float, default=60.0, help="Gap threshold in minutes")
    return parser.parse_args()


def load_records(path: Path) -> list[dict[str, object]]:
    suffix = path.suffix.lower()
    if suffix == ".json":
        text = path.read_text(encoding="utf-8")
        data = json.loads(text)
        if isinstance(data, list):
            return [dict(row) for row in data]
        if isinstance(data, dict) and "rows" in data and isinstance(data["rows"], list):
            return [dict(row) for row in data["rows"]]
        raise ValueError("Unsupported JSON format (expect list or {rows: []})")
    if suffix == ".csv":
        with path.open("r", encoding="utf-8", newline="") as fh:
            reader = csv.DictReader(fh)
            return [dict(row) for row in reader]
    raise ValueError("Input must be .json or .csv")


def to_float(value: object) -> Number | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    value_str = str(value).strip()
    if not value_str:
        return None
    try:
        return float(value_str)
    except ValueError:
        return None


def parse_timestamp(value: object) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def evaluate_rules(records: Iterable[dict[str, object]], args: argparse.Namespace) -> dict[str, RuleResult]:
    counters: dict[str, RuleResult] = {}

    def bump(name: str, total: int, violations: int) -> None:
        counters[name] = RuleResult(name, total, violations)

    methane, oxygen, co2 = [], [], []
    depression, velocity = [], []
    timestamps: list[datetime] = []
    missing_counter = Counter()

    for row in records:
        m = to_float(row.get(args.methane_field))
        if m is None:
            missing_counter[args.methane_field] += 1
        else:
            methane.append(m)

        o = to_float(row.get(args.oxygen_field))
        if o is None:
            missing_counter[args.oxygen_field] += 1
        else:
            oxygen.append(o)

        c = to_float(row.get(args.co2_field)) if args.co2_field else None
        if args.co2_field and c is None:
            missing_counter[args.co2_field] += 1
        elif c is not None:
            co2.append(c)

        d = to_float(row.get(args.depression_field))
        if d is None:
            missing_counter[args.depression_field] += 1
        else:
            depression.append(d)

        v = to_float(row.get(args.velocity_field))
        if v is None:
            missing_counter[args.velocity_field] += 1
        else:
            velocity.append(v)

        ts = parse_timestamp(row.get(args.timestamp_field))
        if ts is None:
            missing_counter[args.timestamp_field] += 1
        else:
            timestamps.append(ts)

    bump("methane_range", len(methane), sum(not (0 <= val <= 70) for val in methane))
    bump("oxygen_range", len(oxygen), sum(not (0 <= val <= 10) for val in oxygen))
    if co2:
        bump("co2_range", len(co2), sum(not (0 <= val <= 70) for val in co2))
        total_gases = min(len(methane), len(oxygen), len(co2))
        violations = 0
        for trio in zip(methane, oxygen, co2):
            total = sum(trio)
            if not (95 <= total <= 101):
                violations += 1
        bump("gas_sum", total_gases, violations)

    bump("depression_range", len(depression), sum(not (-30000 <= val <= 0) for val in depression))
    bump("velocity_range", len(velocity), sum(not (0 <= val <= 30) for val in velocity))

    gap_minutes = args.gap_threshold_minutes
    gap_seconds = gap_minutes * 60.0
    gaps = 0
    if len(timestamps) > 1:
        timestamps.sort()
        for prev, curr in zip(timestamps, timestamps[1:]):
            delta = (curr - prev).total_seconds()
            if delta > gap_seconds:
                gaps += 1
    bump("time_gaps", max(0, len(timestamps) - 1), gaps)

    counters["missing_fields"] = RuleResult(
        "missing_fields",
        sum(missing_counter.values()),
        sum(missing_counter.values()),
    )
    return counters


def build_report(results: dict[str, RuleResult]) -> dict[str, object]:
    return {
        name: {
            "total": data.total,
            "violations": data.violations,
            "violationRate": round(data.rate, 4),
        }
        for name, data in sorted(results.items())
    }


def main() -> None:
    args = parse_args()
    records = load_records(args.input)
    results = evaluate_rules(records, args)
    report = build_report(results)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Report written to {args.output}")
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
