#!/usr/bin/env python3
"""Generate and verify ADAPT's app/model OAuth scope contract.

The app and served model receive different user tokens. This file records both
from their source declarations and fails when the committed JSON is stale.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

REPO = Path(os.environ.get("ADAPT_SCOPE_REPO", Path(__file__).resolve().parent.parent)).resolve()
CONTRACT = Path(
    os.environ.get("ADAPT_SCOPE_CONTRACT", REPO / "bundle" / "scope-contract.json")
).resolve()
BUNDLE = REPO / "databricks.yml"
PROBES = REPO / "app" / "server" / "lib" / "dependency-probes.ts"
USER_AUTH = REPO / "agent" / "user_authorization.py"

EXIT_OK, EXIT_FINDING, EXIT_COULD_NOT_RUN = 0, 1, 2
PLATFORM_ADDED = ("iam.access-control:read", "iam.current-user:read")
CLASSIFICATION = {
    "sql": ("sql-warehouse", "governed-rows"),
    "dashboards.genie": ("genie", "governed-rows"),
    "genie": ("genie", "governed-rows"),
    "catalog": ("unity-catalog", "metadata-only"),
    "workspace": ("workspace-objects", "metadata-only"),
    "serving": ("model-serving", "no-data"),
    "model-serving": ("model-serving", "no-data"),
    "iam": ("identity", "no-data"),
    "postgres": ("lakebase", "metadata-only"),
}


class Unreadable(Exception):
    """A source could not be parsed."""


def read(path: Path) -> str:
    if not path.is_file():
        raise Unreadable(f"{path.relative_to(REPO)} does not exist")
    return path.read_text(encoding="utf-8")


def classify(scope: str) -> dict[str, str]:
    family = scope.split(":", 1)[0]
    for prefix in sorted(CLASSIFICATION, key=len, reverse=True):
        if family == prefix or family.startswith(prefix + "."):
            surface, reach = CLASSIFICATION[prefix]
            return {"surface": surface, "reads": reach}
    return {
        "surface": "unclassified",
        "reads": "UNKNOWN -- classify this family in bundle/scope-contract.py",
    }


def target_names() -> list[str]:
    text = read(BUNDLE)
    try:
        tail = text[text.index("\ntargets:") + 1 :]
    except ValueError as error:
        raise Unreadable("databricks.yml declares no targets") from error
    names = re.findall(r"^  ([A-Za-z0-9_-]+):", tail, re.M)
    if not names:
        raise Unreadable("databricks.yml target list parsed to nothing")
    return names


def _scope_lines(text: str) -> tuple[list[str], list[str]]:
    live: list[str] = []
    staged: list[str] = []
    for line in text.splitlines():
        if m := re.match(r"^\s+- (\S+)\s*$", line):
            live.append(m.group(1))
        elif m := re.match(r"^\s*#\s*- (\S+)\s*$", line):
            staged.append(m.group(1))
    return live, staged


def default_scopes_and_staged() -> tuple[list[str], list[str]]:
    text = read(BUNDLE)
    at = text.find("\n  app_user_api_scopes:")
    if at < 0:
        raise Unreadable("databricks.yml declares no app_user_api_scopes variable")
    nxt = re.search(r"\n {2}[A-Za-z0-9_-]+:\n", text[at + 1 :])
    block = text[at : at + 1 + nxt.start()] if nxt else text[at:]
    default = block.find("\n    default:")
    if default < 0:
        raise Unreadable("app_user_api_scopes has no default")
    return _scope_lines(block[default:])


def declared_for(target: str) -> tuple[list[str], list[str]]:
    text = read(BUNDLE)
    at = text.find(f"\n  {target}:\n")
    if at < 0:
        raise Unreadable(f"databricks.yml declares no target named {target}")
    nxt = re.search(r"\n {2}[A-Za-z0-9_-]+:\n", text[at + 1 :])
    block = text[at : at + 1 + nxt.start()] if nxt else text[at:]
    key = block.find("app_user_api_scopes:")
    if key < 0:
        return default_scopes_and_staged()
    return _scope_lines(block[key:])


def probe_consumers() -> dict[str, list[str]]:
    text = read(PROBES)
    at = text.find("SCOPE_BY_API_PREFIX")
    if at < 0:
        raise Unreadable("dependency-probes.ts no longer exports SCOPE_BY_API_PREFIX")
    try:
        body = text[at : text.index("};", at)]
    except ValueError as error:
        raise Unreadable("SCOPE_BY_API_PREFIX has no closing object") from error
    pairs = re.findall(r"'([^']+)':\s*'([^']+)'", body)
    if not pairs:
        raise Unreadable("SCOPE_BY_API_PREFIX parsed to nothing")
    out: dict[str, list[str]] = {}
    for prefix, scope in pairs:
        out.setdefault(scope, []).append(prefix)
    return {scope: sorted(prefixes) for scope, prefixes in out.items()}


def model_scopes() -> dict[str, list[str]]:
    """Only APIs ADAPT's simple orchestrator calls with the user's token."""
    source = read(USER_AUTH)
    out: dict[str, list[str]] = {}
    for constant, condition in (
        ("GENIE_SCOPE", "the data Genie space is configured"),
        ("GENIE_MCP_SCOPE", "the data Genie MCP endpoint is configured"),
        ("SQL_SCOPE", "a SQL warehouse is configured"),
    ):
        match = re.search(rf'^{constant}\s*=\s*"([^"]+)"', source, re.M)
        if not match:
            raise Unreadable(f"user_authorization.py no longer defines {constant}")
        out[match.group(1)] = [condition]
    return out


def stem(scope: str) -> str:
    return scope.split(":", 1)[0]


def generate() -> dict:
    consumers = probe_consumers()
    model = model_scopes()
    model_by_stem = {stem(scope): scope for scope in model}
    targets: dict[str, dict] = {}
    for name in target_names():
        live, staged = declared_for(name)
        targets[name] = {"declares": live, "staged": staged}
    every = sorted({scope for body in targets.values() for scope in body["declares"]})
    return {
        "generated_by": "bundle/scope-contract.py --generate",
        "do_not_edit": (
            "Generated from databricks.yml, app/server/lib/"
            "dependency-probes.ts, and agent/user_authorization.py."
        ),
        "app_resource": {
            "file": "resources/adapt_app.app.yml",
            "bundle_key": "apps.adapt_app",
        },
        "app_scopes": {
            scope: {
                "token": "app: forwarded to the app server as x-forwarded-access-token",
                "classification": classify(scope),
                "probe_api_prefixes": consumers.get(scope, []),
                "declared_by": sorted(
                    name for name, body in targets.items() if scope in body["declares"]
                ),
                "model_equivalent": model_by_stem.get(stem(scope)),
                "same_capability_different_spelling": bool(
                    model_by_stem.get(stem(scope))
                    and model_by_stem[stem(scope)] != scope
                ),
            }
            for scope in every
        },
        "model_scopes": {
            scope: {
                "token": "model: downscoped inside the serving container by Model Serving",
                "classification": classify(scope),
                "asked_when": conditions,
                "app_equivalent": next(
                    (app_scope for app_scope in every if stem(app_scope) == stem(scope)),
                    None,
                ),
            }
            for scope, conditions in sorted(model.items())
        },
        "platform_added_to_effective": list(PLATFORM_ADDED),
        "targets": targets,
    }


def compare_live(contract: dict, app: dict) -> list[str]:
    findings: list[str] = []
    declared = set(app.get("user_api_scopes") or [])
    effective = set(app.get("effective_user_api_scopes") or [])
    if not declared:
        return ["the live app declares NO user_api_scopes"]
    for scope in sorted(declared - effective):
        findings.append(
            f"{scope} is DECLARED but NOT IN EFFECT; stop and start the app"
        )
    known = set(contract.get("platform_added_to_effective") or [])
    documented = set(contract.get("app_scopes") or {})
    for scope in sorted(effective - declared - known):
        findings.append(
            f"{scope} is IN EFFECT but neither declared nor a recorded platform addition"
        )
    for scope in sorted(declared - documented):
        findings.append(
            f"{scope} is declared on the live app but the repository does not account for it"
        )
    return findings


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--generate", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--live", metavar="APP_JSON")
    args = parser.parse_args(argv)
    if not (args.generate or args.check):
        parser.error("one of --generate or --check is required")
    try:
        fresh = generate()
    except (Unreadable, ValueError) as error:
        print(f"  COULD NOT RUN. {error}")
        return EXIT_COULD_NOT_RUN
    if args.generate:
        CONTRACT.write_text(json.dumps(fresh, indent=2) + "\n", encoding="utf-8")
        print(f"  wrote {CONTRACT.relative_to(REPO)}")
        return EXIT_OK
    if not CONTRACT.is_file():
        print(f"  COULD NOT RUN. {CONTRACT.relative_to(REPO)} does not exist.")
        return EXIT_COULD_NOT_RUN
    try:
        committed = json.loads(CONTRACT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        print(f"  COULD NOT RUN. {CONTRACT.name} is not readable JSON: {error}")
        return EXIT_COULD_NOT_RUN
    findings: list[str] = []
    for group in ("app_scopes", "model_scopes"):
        for name, body in fresh[group].items():
            if body["classification"]["surface"] == "unclassified":
                findings.append(f"{name} is declared and UNCLASSIFIED")
    if committed != fresh:
        findings.append("scope-contract.json no longer matches the code it is generated from")
    if args.live:
        try:
            app = json.loads(Path(args.live).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            print(f"  COULD NOT RUN the live leg: {error}")
            return EXIT_COULD_NOT_RUN
        findings.extend(compare_live(fresh, app))
    if findings:
        print("  scope contract DISAGREES:")
        for finding in findings:
            print(f"  FAIL  {finding}")
        return EXIT_FINDING
    print("  ok    scope contract agrees")
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
