#!/usr/bin/env python3
"""The scope contract's MODEL leg, for the model release path.

Arch#3 asks for one generated scope contract consumed by BOTH release paths. Only
one consumed it. `bundle/app-release.sh` runs `scope-contract.py --check --live`
against the app object, which answers the app's three legs and says nothing at all
about the model's -- and the model's scopes are a DIFFERENT TOKEN, set by a
different policy, validated by a different validator, on a different release. The
contract has recorded that distinction since it was written; nothing tested it.

WHAT THIS ASKS, which the app path cannot:

  the scopes THIS TARGET would bake      agent/user_authorization.py derives them
                                         from ADAPT's data Genie id and warehouse
  the scopes the contract DOCUMENTS      `model_scopes`, with the condition each
                                         is asked under
  the scopes the LIVE model version HAS  `api_scopes` in the release summary the
                                         last log_model run printed, when given

The first two need no workspace, so this is the CI form. The third is `--logged`,
taking the JSON `log_model.py` prints, and is what a release can add.

ADAPT's simple orchestrator calls only Genie and SQL with the downscoped user
token. A wider contract would authorize APIs this product does not call.

    bundle/model-scope-check.py --target example
    bundle/model-scope-check.py --target example --logged release-summary.json

    0  the model legs agree
    1  a finding: they disagree
    2  the check could not run, which is NOT agreement
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
CONTRACT = HERE / "scope-contract.json"

EXIT_OK, EXIT_FINDING, EXIT_COULD_NOT_RUN = 0, 1, 2


class Unreadable(Exception):
    """A source could not be read. Never 'asks for nothing'."""


def load(name: str, path: Path):
    """One of the sibling checkers, imported despite the hyphen in its name."""
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise Unreadable(f"{path.name} could not be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def from_file(drift, name: str, target: str) -> str:
    """One bundle variable as far as THE FILE can answer it, "" for cannot-tell.

    An empty variable and one whose value is still an unexpanded interpolation are
    the same answer: this repository's tracked files do not carry the value, and
    the value arrives at release time from `variable-overrides.json`, a
    `BUNDLE_VAR_*` environment variable, or the bundle's own output. Read either
    as "not configured" and the check fails every release of a target that
    supplies the value the normal way.

    Both the Genie ids and the warehouse go through here, so the two cannot drift
    apart on what "unresolvable" means.
    """
    value = drift.expand(drift.resolve(name, target), target).strip()
    return "" if "${" in value else value


def would_bake(target: str, drift, contract_source) -> tuple[set[str], set[str], list[str]]:
    """(required, undecidable-here, why) for the model scopes a release would bake.

    Reimplemented from the CONDITIONS rather than by importing the agent: the
    agent's copy resolves a live Settings object, which needs a workspace. What is
    reused is the SCOPE NAMES -- read from the agent's own constants by
    scope-contract.py -- so a rename there cannot pass this silently.
    """
    names = contract_source.model_scopes()
    genie_scopes = {s for s in names if "genie" in s}
    sql_scope = next((s for s in names if s == "sql" or s.startswith("sql")), None)
    if len(genie_scopes) != 2 or not sql_scope or len(names) != 3:
        raise Unreadable(
            "ADAPT's model scope source must contain direct Genie, Genie MCP, and SQL. "
            f"Found: {sorted(names)}"
        )

    wanted: set[str] = set()
    undecidable: set[str] = set()
    why: list[str] = []

    # THE GENIE ID IS NOT ALWAYS RESOLVABLE HERE, and saying so is the honest
    # answer. A target may adopt an id into the bundle variable, or leave it empty
    # and let agent-release.sh take the id the bundle's own output reports. The
    # second route needs a workspace. So an empty variable means "this check cannot
    # tell", not "no Genie space" -- and the difference matters, because reading it
    # as the latter would fail every release of a target that adopts its spaces the
    # normal way.
    data_genie = (
        os.environ.get("PLAYER_INSIGHTS_DATA_GENIE_ID", "").strip()
        or from_file(drift, "genie_data_space_id", target)
    )
    if data_genie:
        wanted.update(genie_scopes)
        why.extend(f"{scope}: a Genie space is configured" for scope in sorted(genie_scopes))
    else:
        undecidable.update(genie_scopes)
        why.extend(
            f"{scope}: NOT DECIDED here. This target declares no Genie space "
            f"id, so the id comes from the bundle's output at release time and only "
            f"a release can say whether one exists."
            for scope in sorted(genie_scopes)
        )

    # THE WAREHOUSE IS THE GENIE IDS' CASE, for the same reason and by the same
    # code path. The id names one workspace's warehouse, so the tracked file does
    # not carry it: it comes from variable-overrides.json or BUNDLE_VAR_warehouse_id
    # at release time. Reading an absent value as "no warehouse" made the gate say
    # the SQL scope was baked and unasked-for, and block a release that was correct.
    # A warehouse the file DOES resolve is still decided here, both ways.
    warehouse = (
        os.environ.get("PLAYER_INSIGHTS_WAREHOUSE_ID", "").strip()
        or from_file(drift, "warehouse_id", target)
    )
    if warehouse:
        wanted.add(sql_scope)
        why.append(f"{sql_scope}: a warehouse is configured")
    else:
        undecidable.add(sql_scope)
        why.append(
            f"{sql_scope}: NOT DECIDED here. This target's tracked files carry no "
            f"warehouse id, so it is supplied at release time and only a release "
            f"can say whether one exists."
        )

    return wanted, undecidable, why


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--target", required=True)
    ap.add_argument("--logged", metavar="SUMMARY_JSON", default=None)
    args = ap.parse_args(argv)

    try:
        drift = load("pia_drift_check", HERE / "drift-check.py")
        contract_source = load("pia_scope_contract", HERE / "scope-contract.py")
    except Unreadable as exc:
        print(f"  COULD NOT RUN. {exc}")
        print("  Nothing was compared. This is not agreement.")
        return EXIT_COULD_NOT_RUN

    if not CONTRACT.is_file():
        print(f"  COULD NOT RUN. {CONTRACT.name} does not exist.")
        print("  Generate it: bundle/scope-contract.py --generate")
        return EXIT_COULD_NOT_RUN
    try:
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"  COULD NOT RUN. {CONTRACT.name} is not readable JSON: {exc}")
        return EXIT_COULD_NOT_RUN

    documented = contract.get("model_scopes")
    if not documented:
        print(f"  COULD NOT RUN. {CONTRACT.name} documents no model scopes at all.")
        print("  An empty model leg is not a model that asks for nothing.")
        return EXIT_COULD_NOT_RUN

    try:
        wanted, undecidable, why = would_bake(args.target, drift, contract_source)
    except (Unreadable, drift.Unreadable) as exc:
        print(f"  COULD NOT RUN. {exc}")
        print("  Nothing was compared. This is not agreement.")
        return EXIT_COULD_NOT_RUN

    findings: list[str] = []

    if not wanted and not undecidable:
        findings.append(
            f"target {args.target} configures no Genie space and no warehouse, so "
            f"a release would bake an EMPTY scope list. "
            f"log_model.py refuses that, and it refuses it late -- after the "
            f"artifact is built. This is the same refusal, before the build."
        )

    for scope in sorted(wanted - set(documented)):
        findings.append(
            f"{scope} would be baked into the model for target {args.target} and the "
            f"contract documents no model scope by that name. Regenerate the "
            f"contract (bundle/scope-contract.py --generate) and read the diff."
        )

    # The contract's model list is the union across conditions, so a scope it
    # documents that this target does not want is normal. What is NOT normal is a
    # documented scope whose condition no target could ever satisfy, and the
    # readable half of that is checked here: every documented scope must at least
    # carry a condition saying when it is asked for.
    for scope, body in documented.items():
        if not (body.get("asked_when") or []):
            findings.append(
                f"the contract documents model scope {scope} with no condition, so "
                f"nothing says when it is asked for or how to tell whether it "
                f"should be."
            )
        if (body.get("classification") or {}).get("surface") == "unclassified":
            findings.append(
                f"model scope {scope} is unclassified, so nothing says whether the "
                f"downscoped token carrying it can read governed rows."
            )

    logged_checked = False
    if args.logged:
        try:
            summary = json.loads(Path(args.logged).read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"  COULD NOT RUN the logged leg: {exc}")
            print("  The static legs were not reported either. Re-run to get them.")
            return EXIT_COULD_NOT_RUN
        if "api_scopes" not in summary:
            print("  COULD NOT RUN the logged leg: the summary carries no api_scopes key,")
            print("  so it is not the JSON log_model.py prints. A summary that happens to")
            print("  list no scopes and one that was never produced look the same.")
            return EXIT_COULD_NOT_RUN
        baked = set(summary.get("api_scopes") or [])
        logged_checked = True
        if not baked:
            findings.append(
                "the logged model version baked an EMPTY api_scopes list, so Model "
                "Serving downscopes the invoker's token to nothing and every Genie "
                "and SQL call fails inside the container rather than here."
            )
        for scope in sorted(wanted - baked):
            findings.append(
                f"{scope} is asked for by this target's configuration and is NOT in "
                f"the logged model's api_scopes. The agent will call the API and the "
                f"downscoped token will not carry the scope, which fails at the "
                f"endpoint with an authorization error that names no scope."
            )
        for scope in sorted(baked - wanted - undecidable):
            findings.append(
                f"{scope} is baked into the logged model and this target's "
                f"configuration does not ask for it. The token is the USER'S, so an "
                f"extra scope is one more API the agent could be made to call with "
                f"somebody else's credential."
            )
        # A scope the static side could not decide is decided HERE, by the release
        # that actually resolved it, and recorded as such rather than waved past.
        for scope in sorted(undecidable & baked):
            why.append(f"{scope}: undecidable statically, and the logged model carries it")
        for scope in sorted(undecidable - baked):
            why.append(f"{scope}: undecidable statically, and the logged model does not carry it")

    legs = "configured, documented and logged" if logged_checked else "configured and documented"
    if findings:
        print(f"  the model's {legs} scopes DISAGREE:")
        print()
        for finding in findings:
            print(f"  FAIL  {finding}")
        return EXIT_FINDING

    print(f"  ok    the model's {legs} scopes agree")
    for line in why:
        print(f"        {line}")
    if not logged_checked:
        print("        the logged leg was NOT checked: pass --logged to add it.")
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
