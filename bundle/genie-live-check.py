#!/usr/bin/env python3
"""Read-only release check for ADAPT's single governed-data Genie space."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from urllib.parse import quote

GENIE_RUN_LEVELS = {"CAN_RUN", "CAN_EDIT", "CAN_MANAGE"}
WAREHOUSE_RUN_LEVELS = {"CAN_USE", "CAN_MANAGE", "IS_OWNER"}


class Unreachable(RuntimeError):
    """The workspace could not be asked."""


def api_get(profile: str, path: str) -> dict:
    result = subprocess.run(
        ["databricks", "api", "get", path, "--profile", profile],
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise Unreachable((result.stderr or result.stdout).strip() or "no error text")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise Unreachable(f"response was not JSON ({error})") from error


def principal_groups(profile: str, principal: str) -> tuple[set[str], str | None]:
    try:
        me = api_get(profile, "/api/2.0/preview/scim/v2/Me")
        if me.get("userName") == principal:
            return {
                group["display"]
                for group in me.get("groups") or []
                if group.get("display")
            }, None
    except Unreachable:
        pass
    criterion = quote(f'userName eq "{principal}"', safe="")
    try:
        body = api_get(
            profile, f"/api/2.0/preview/scim/v2/Users?filter={criterion}"
        )
    except Unreachable as error:
        return set(), str(error).splitlines()[0]
    for user in body.get("Resources") or []:
        return {
            group["display"]
            for group in user.get("groups") or []
            if group.get("display")
        }, None
    return set(), f"{principal} was not found in SCIM"


def evaluate_acl(
    acl: list[dict] | None, principal: str, groups: set[str], sufficient: set[str]
) -> tuple[str, str]:
    if acl is None:
        return "unresolved", "permissions could not be read"
    covering = {principal, "users"} | groups
    held: set[str] = set()
    matched: set[str] = set()
    for entry in acl:
        who = (
            entry.get("user_name")
            or entry.get("service_principal_name")
            or entry.get("group_name")
        )
        if who not in covering:
            continue
        matched.add(who)
        held |= {
            permission.get("permission_level")
            for permission in entry.get("all_permissions") or []
            if permission.get("permission_level")
        }
    if held & sufficient:
        return "granted", f"holds {', '.join(sorted(held & sufficient))} via {', '.join(sorted(matched))}"
    if held:
        return "denied", f"holds only {', '.join(sorted(held))}"
    return "denied", "has no direct or resolved group grant"


def _acl(profile: str, path: str) -> list[dict] | None:
    try:
        return api_get(profile, path).get("access_control_list") or []
    except Unreachable:
        return None


def _curated_tables(space: dict) -> set[str] | None:
    raw = space.get("serialized_space")
    if not raw:
        return None
    try:
        body = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError:
        return None
    tables = (body.get("data_sources") or {}).get("tables")
    if tables is None:
        return None
    return {row["identifier"] for row in tables if row.get("identifier")}


def declared_scopes(allowlist: str) -> tuple[list[str], list[str]]:
    scopes: list[str] = []
    problems: list[str] = []
    for raw in allowlist.split(","):
        name = raw.strip().strip("`")
        if not name:
            continue
        if len(name.split(".")) not in (1, 2):
            problems.append(f"data_catalogs entry {name!r} must be catalog or catalog.schema")
        elif name not in scopes:
            scopes.append(name)
    return scopes, problems


def _scope_of(table: str) -> str:
    parts = table.split(".")
    return ".".join(parts[:2]) if len(parts) >= 3 else table


def check_space(
    args, label: str, space_id: str, origin: str, scopes, contract, groups, group_reason
) -> int:
    """Check one space. ``contract`` remains for compatibility with focused tests."""
    del contract
    failures = 0
    print(f"\n  {label}  {space_id}  ({origin})")
    try:
        space = api_get(
            args.profile,
            f"/api/2.0/genie/spaces/{space_id}?include_serialized_space=true",
        )
    except Unreachable as error:
        print(f"    FAIL  could not read Genie space {space_id}: {error}")
        return 1
    print(f"    ok    exists, titled {(space.get('title') or '(untitled)')!r}")
    if args.execution_identity == "user-authorization":
        print("    note  CAN RUN is per signed-in reader and is not release-verifiable.")
    else:
        verdict, detail = evaluate_acl(
            _acl(args.profile, f"/api/2.0/permissions/genie/{space_id}"),
            args.principal,
            groups,
            GENIE_RUN_LEVELS,
        )
        if verdict != "granted":
            failures += 1
            print(f"    FAIL  {args.principal} cannot be confirmed to run it: {detail}.")
            if group_reason:
                print(f"          Group membership was unreadable: {group_reason}")
    warehouse = space.get("warehouse_id")
    if warehouse:
        if warehouse != args.warehouse_id:
            print(f"    note  runs on warehouse {warehouse}, not {args.warehouse_id}")
        if args.execution_identity == "user-authorization":
            print("    note  CAN USE is also per signed-in reader and not established here.")
        else:
            verdict, detail = evaluate_acl(
                _acl(args.profile, f"/api/2.0/permissions/warehouses/{warehouse}"),
                args.principal,
                groups,
                WAREHOUSE_RUN_LEVELS,
            )
            if verdict != "granted":
                failures += 1
                print(f"    FAIL  warehouse {warehouse} is not usable: {detail}.")
    curated = _curated_tables(space)
    if curated is None:
        print("    FAIL  the space definition carries no readable table list")
        return failures + 1
    if not curated:
        print("    FAIL  the space curates no tables")
        return failures + 1
    uncovered = sorted(
        table
        for table in curated
        if _scope_of(table) not in scopes and table.split(".", 1)[0] not in scopes
    )
    print(f"    ok    curates {len(curated)} table(s)")
    if uncovered:
        failures += 1
        print("    FAIL  curated tables outside data_catalogs:")
        for table in uncovered:
            print(f"            - {table}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", required=True)
    parser.add_argument("--principal", required=True)
    parser.add_argument("--principal-source", required=True)
    parser.add_argument(
        "--execution-identity",
        required=True,
        choices=("system-passthrough", "user-authorization"),
    )
    parser.add_argument("--warehouse-id", required=True)
    parser.add_argument("--allowlist", required=True)
    parser.add_argument("--space-id", required=True)
    parser.add_argument("--space-origin", default="bundle variable")
    args = parser.parse_args()
    scopes, problems = declared_scopes(args.allowlist)
    for problem in problems:
        print(f"  FAIL  {problem}")
    if not scopes:
        print("  FAIL  data_catalogs resolves to no scopes")
    groups, group_reason = (
        (set(), None)
        if args.execution_identity == "user-authorization"
        else principal_groups(args.profile, args.principal)
    )
    failures = len(problems) + (0 if scopes else 1)
    failures += check_space(
        args,
        "data genie space",
        args.space_id,
        args.space_origin,
        scopes,
        set(),
        groups,
        group_reason,
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
