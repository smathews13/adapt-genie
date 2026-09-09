#!/usr/bin/env python3
"""Compare ADAPT's declared app configuration with captured workspace evidence."""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BUNDLE_FILE = REPO / "databricks.yml"
APP_RESOURCE = REPO / "resources" / "adapt_app.app.yml"
EXIT_OK, EXIT_FINDING, EXIT_COULD_NOT_RUN = 0, 1, 2
SCRATCH_MARKERS = ("deleteme", "delete_me", "scratch", "tmp_", "_tmp", "probe")


class Unreadable(Exception):
    """A source or evidence document could not be read."""


class Leg:
    def __init__(self, key: str, title: str) -> None:
        self.key, self.title = key, title
        self.findings: list[str] = []
        self.could_not_run: str | None = None
        self.compared: list[str] = []

    def fail(self, message: str) -> None:
        self.findings.append(message)

    def blocked(self, message: str) -> None:
        if self.could_not_run is None:
            self.could_not_run = message

    @property
    def status(self) -> int:
        if self.could_not_run:
            return EXIT_COULD_NOT_RUN
        return EXIT_FINDING if self.findings else EXIT_OK


def read(path: Path) -> str:
    if not path.is_file():
        raise Unreadable(f"{path.relative_to(REPO)} does not exist")
    return path.read_text(encoding="utf-8")


def section_of(text: str, header: str, indent: int) -> str:
    at = text.find(header)
    if at < 0:
        raise Unreadable(f"no {header.strip()} section")
    tail = text[at + len(header) :]
    match = re.search(rf"\n{' ' * indent}[A-Za-z0-9_-]+:", tail)
    return text[at : at + len(header) + (match.start() if match else len(tail))]


def target_variables(target: str, text: str | None = None) -> dict[str, str]:
    text = read(BUNDLE_FILE) if text is None else text
    at = text.find(f"\n  {target}:\n")
    if at < 0:
        raise Unreadable(f"databricks.yml declares no target named {target}")
    match = re.search(r"\n {2}[A-Za-z0-9_-]+:\n", text[at + 1 :])
    block = text[at : at + 1 + match.start()] if match else text[at:]
    key = block.find("\n    variables:\n")
    if key < 0:
        return {}
    values: dict[str, str] = {}
    for line in block[key + len("\n    variables:\n") :].splitlines():
        match = re.match(r"^ {6}([A-Za-z0-9_-]+):\s*(.*)$", line)
        if match and match.group(2).strip():
            values[match.group(1)] = match.group(2).strip().strip("\"'")
        elif line.strip() and not line.startswith(" " * 6):
            break
    return values


def variable_default(name: str, text: str | None = None) -> str:
    text = read(BUNDLE_FILE) if text is None else text
    variables = section_of(text, "\nvariables:\n", 0)
    at = variables.find(f"\n  {name}:\n")
    if at < 0:
        raise Unreadable(f"databricks.yml declares no variable {name}")
    match = re.search(r"\n {2}[A-Za-z0-9_-]+:\n", variables[at + 1 :])
    block = variables[at : at + 1 + match.start()] if match else variables[at:]
    default = re.search(r"^\s+default:\s*(.*)$", block, re.M)
    return default.group(1).strip().strip("\"'") if default else ""


def resolve(name: str, target: str, text: str | None = None) -> str:
    return target_variables(target, text).get(name, variable_default(name, text))


def expand(value: str, target: str, text: str | None = None, depth: int = 0) -> str:
    if depth > 6:
        raise Unreadable(f"variable interpolation in {value!r} does not settle")
    out = value
    for name in set(re.findall(r"\$\{var\.([A-Za-z0-9_]+)\}", value)):
        out = out.replace(
            f"${{var.{name}}}", expand(resolve(name, target, text), target, text, depth + 1)
        )
    return out


def declared_app_resources() -> list[tuple[str, str]]:
    source = read(APP_RESOURCE)
    resources = [
        (match.group(1), match.group(2))
        for match in re.finditer(
            r"^ {8}- name: (\S+)\s*\n {10}([a-z_]+):\s*$", source, re.M
        )
    ]
    if not resources:
        raise Unreadable(
            "adapt_app.app.yml parsed to no resources; its shape has changed"
        )
    return resources


def declared_app_scopes(target: str) -> list[str]:
    text = read(BUNDLE_FILE)
    default_block = section_of(text, "\n  app_user_api_scopes:\n", 2)
    scopes = re.findall(r"^\s+- (\S+)\s*$", default_block, re.M)
    at = text.find(f"\n  {target}:\n")
    if at < 0:
        raise Unreadable(f"databricks.yml declares no target named {target}")
    match = re.search(r"\n {2}[A-Za-z0-9_-]+:\n", text[at + 1 :])
    block = text[at : at + 1 + match.start()] if match else text[at:]
    key = block.find("app_user_api_scopes:")
    if key >= 0:
        scopes = []
        for line in block[key:].splitlines()[1:]:
            if re.match(r"^\s+- \S+\s*$", line):
                scopes.append(line.strip()[2:].strip())
            elif not re.match(r"^\s*#", line):
                break
    return scopes


def evidence(directory: Path | None, name: str, leg: Leg):
    if directory is None:
        leg.blocked(f"no --evidence directory was given, so {name} was never read")
        return None
    path = directory / name
    if not path.is_file():
        leg.blocked(
            f"{name} is not in the evidence directory; an absent document is not an absence of drift"
        )
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        leg.blocked(f"{name} is not readable JSON: {error}")
        return None


def leg_scope_counts(target: str, where: Path | None) -> Leg:
    leg = Leg("scope-counts", "declared scopes vs the live app")
    try:
        declared = declared_app_scopes(target)
    except Unreadable as error:
        leg.blocked(str(error))
        return leg
    if not declared:
        leg.blocked(f"target {target} resolves to an EMPTY declared scope list")
        return leg
    app = evidence(where, "app.json", leg)
    if app is None:
        return leg
    if not isinstance(app, dict):
        leg.blocked("app.json is not an object")
        return leg
    live = list(app.get("user_api_scopes") or [])
    effective = list(app.get("effective_user_api_scopes") or [])
    if not live:
        leg.blocked("the live app reports NO user_api_scopes. Not a count of zero")
        return leg
    leg.compared.append(f"{len(declared)} bundle scopes and {len(live)} live scopes")
    if set(declared) != set(live):
        leg.fail(
            f"bundle only: {sorted(set(declared)-set(live))}; app only: "
            f"{sorted(set(live)-set(declared))}"
        )
    for scope in sorted(set(live) - set(effective)):
        leg.fail(f"{scope} is declared but NOT in effect")
    return leg


def leg_warehouse(target: str, where: Path | None) -> Leg:
    leg = Leg("warehouse", "declared SQL warehouse vs the live warehouse")
    try:
        wanted_id = expand(resolve("warehouse_id", target), target)
        wanted_name = expand(resolve("warehouse_role_name", target), target)
    except Unreadable as error:
        leg.blocked(str(error))
        return leg
    if not wanted_id or "${" in wanted_id:
        leg.blocked(f"target {target} has no resolvable warehouse_id")
        return leg
    warehouse = evidence(where, "warehouse.json", leg)
    if warehouse is None:
        return leg
    if not isinstance(warehouse, dict) or not warehouse.get("id"):
        leg.blocked("warehouse.json carries no id")
        return leg
    if warehouse["id"] != wanted_id:
        leg.fail(f"bundle warehouse {wanted_id} differs from live {warehouse['id']}")
    if wanted_name and warehouse.get("name") != wanted_name:
        leg.fail(
            f"warehouse {wanted_id} is named {warehouse.get('name')!r}; "
            f"the bundle declares role name {wanted_name!r}"
        )
    return leg


def leg_resource_observed(target: str, where: Path | None) -> Leg:
    del target
    leg = Leg("resource-observed", "declared app resources are attached")
    try:
        wanted = declared_app_resources()
    except Unreadable as error:
        leg.blocked(str(error))
        return leg
    app = evidence(where, "app.json", leg)
    if app is not None:
        if not isinstance(app, dict) or "resources" not in app:
            leg.blocked("app.json carries no resources key")
            return leg
        live = {
            row.get("name"): next((key for key in row if key != "name"), None)
            for row in app.get("resources") or []
            if isinstance(row, dict)
        }
        for name, kind in wanted:
            if name not in live:
                leg.fail(f"Declared and never observed: {name!r} ({kind})")
            elif live[name] != kind:
                leg.fail(f"{name!r} is declared as {kind} and live as {live[name]}")
        for name in sorted(set(live) - {name for name, _ in wanted}):
            leg.fail(f"live resource {name!r} has no bundle declaration")
    tables = evidence(where, "tables.json", leg)
    if tables is not None:
        if not isinstance(tables, list):
            leg.blocked("tables.json is not a list")
            return leg
        names = [row.get("name") for row in tables if isinstance(row, dict) and row.get("name")]
        if not names:
            leg.blocked("tables.json is empty; this is a failed capture, not a clean schema")
            return leg
        for name in names:
            if any(marker in name.lower() for marker in SCRATCH_MARKERS):
                leg.fail(f"table {name!r} has a name that marks it as scratch")
    return leg


LEGS = {
    "scope-counts": leg_scope_counts,
    "warehouse": leg_warehouse,
    "resource-observed": leg_resource_observed,
}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", required=True)
    parser.add_argument("--evidence")
    parser.add_argument("--leg", action="append", choices=sorted(LEGS))
    args = parser.parse_args(argv)
    where = Path(args.evidence) if args.evidence else None
    if where is not None and not where.is_dir():
        print(f"  COULD NOT RUN. {where} is not a directory.")
        return EXIT_COULD_NOT_RUN
    chosen = args.leg or sorted(LEGS)
    results: list[Leg] = []
    for key in chosen:
        try:
            results.append(LEGS[key](args.target, where))
        except Unreadable as error:
            leg = Leg(key, "")
            leg.blocked(str(error))
            results.append(leg)
    worst = EXIT_OK
    for leg in results:
        if leg.status == EXIT_FINDING:
            print(f"  DRIFT  {leg.key}: {leg.title}")
            for finding in leg.findings:
                print(f"         FAIL  {finding}")
            worst = EXIT_FINDING
        elif leg.status == EXIT_COULD_NOT_RUN:
            print(f"  ?????  {leg.key}: COULD NOT RUN. {leg.could_not_run}")
            if worst != EXIT_FINDING:
                worst = EXIT_COULD_NOT_RUN
        else:
            print(f"  ok     {leg.key}: {leg.title}")
        for note in leg.compared:
            print(f"         compared {note}")
    return worst


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
