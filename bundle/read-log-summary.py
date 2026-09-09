#!/usr/bin/env python3
"""Print the last model-version summary object from log_model.py stdout."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def last_summary(text: str) -> dict:
    found: dict | None = None
    for line in text.splitlines():
        try:
            value = json.loads(line.strip())
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and value.get("model_version") not in (None, ""):
            found = value
    if found is None:
        raise ValueError("no JSON object with model_version in log_model.py stdout")
    return found


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("stdout_path")
    parser.add_argument("--write", metavar="PATH")
    args = parser.parse_args(argv)
    try:
        summary = last_summary(Path(args.stdout_path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    if args.write:
        Path(args.write).write_text(json.dumps(summary) + "\n", encoding="utf-8")
    print(summary["model_version"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
