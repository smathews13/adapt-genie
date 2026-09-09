#!/usr/bin/env python3
"""Does the live Genie space differ from the one in this repository?

WHY A CONTENT CHECK AND NOT A VERSION TAG. `serialized_space` carries a
`version` field, and every instruction and sample question carries an `id`. It
is tempting to treat those as the thing that decides whether a deploy is needed,
because they are cheap to read and cheap to compare. They decide nothing. A
`version` that nobody bumped and an `id` that nobody changed sit happily above a
rewritten paragraph, so a change can be committed, deployed, reported as
successful, and never land -- and the tag agrees with the deploy rather than with
the workspace. That has already happened here once and cost a day.

So this compares the TEXT. It reads the body the bundle would push, out of
`databricks bundle validate -o json` with every `${var.*}` already resolved, and
the body the workspace is actually serving, out of the Genie API, and reports
what differs. A tag that was never bumped changes nothing about the answer.

WHAT COUNTS AS DRIFT, AND WHAT DELIBERATELY DOES NOT. Only the fields the bundle
DECLARES are compared. `space_id`, `etag`, `create_time` and `update_time` are
the server's and appear in no YAML, so they are not drift and are never reported
as such -- a check that flagged them would cry drift on every single run and
would be switched off within a week.

Within a declared field the comparison is EXACT, in both directions, because a
`bundle deploy` overwrites these bodies wholesale. A table that is live and not
committed is drift just as much as one that is committed and not live: the next
deploy deletes it, and somebody's analysts lose a table nobody meant to remove.
That direction is the one a "did my change land?" check forgets, and it is the
more dangerous of the two.

WHAT THIS CANNOT TELL YOU. That an instruction which landed is being FOLLOWED.
The two look identical from here, and the only way to tell them apart is to ask
the space a question that depends on the change. It also says nothing about
permissions or about whether the curated tables are inside the model's declared
scopes; that is `bundle/genie-live-check.py`, which is a different question and
is kept separate rather than folded in.

READS ONLY. It makes no change to any workspace object and takes no lock, so it
is safe to run against a live deployment, including one somebody is mid-deploy
on or demonstrating.

Exit status is the point of the whole file:
  0  every space checked is in sync; a deploy would change nothing
  1  at least one space has drifted; the committed content is not what is live
  2  at least one space could not be read, so nothing is established either way
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

#: Fields of the space object itself that the bundle can declare. Anything not
#: in here is either the server's own bookkeeping or something no target sets,
#: and comparing it would produce a finding nobody can act on.
DECLARED_TOP_LEVEL = ("title", "description", "warehouse_id", "parent_path")

#: Fields holding a workspace path, compared with the `/Workspace` mount prefix
#: folded away. `genie_parent_path` defaults to `/Workspace/Shared` and the Genie
#: API returns `/Shared` for that same folder: `/Workspace` is the prefix the
#: filesystem view uses and the object API does not. Comparing the two literally
#: reports both spaces as drifted on every run forever, and a deploy cannot close
#: it, because the server stores the folded form again. A permanent finding no
#: deploy can clear is how a check stops being read, which would cost far more
#: than this field is worth.
#:
#: This folds ONE prefix and nothing else. A genuine folder move -- `/Shared` to
#: `/Shared/Genie`, or to another user's home -- still differs and is still
#: reported, which is the only thing anyone would act on here anyway.
PATH_FIELDS = ("parent_path",)


def same_workspace_path(committed: str, live: str) -> bool:
    def fold(value: str) -> str:
        value = value.rstrip("/") or "/"
        for prefix in ("/Workspace/", "/Workspace"):
            if value.startswith(prefix):
                return "/" + value[len(prefix):].lstrip("/")
        return value

    return fold(committed) == fold(live)

#: Lists inside `serialized_space` whose entries carry a stable key, so a diff
#: can say "this one changed" rather than "the list changed". The key is the
#: field to match entries on. Note that matching on `id` here is a REPORTING
#: convenience only: the content of a matched pair is still compared in full, so
#: an unchanged id cannot make a changed body look unchanged.
KEYED_LISTS = {
    "text_instructions": "id",
    "sample_questions": "id",
    "tables": "identifier",
}


class Unreachable(RuntimeError):
    """The workspace could not be asked, as opposed to having answered.

    Its own type for the reason genie-live-check.py gives at more length: a
    check that reports "I could not look" as "it is not there" sends somebody to
    fix a thing that was never wrong. Here it would be worse than that -- it
    would report drift on a space that is in sync, and the fix for drift is a
    deploy.
    """


def api_get(profile: str, path: str) -> dict:
    result = subprocess.run(
        ["databricks", "api", "get", path, "--profile", profile],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise Unreachable((result.stderr or result.stdout).strip() or "no error text")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise Unreachable(f"response was not JSON ({error})") from error


def body_of(space: dict, where: str) -> dict:
    """`serialized_space` as a dict, whichever way it arrived.

    The API returns it as a JSON STRING and `bundle validate` also renders it as
    one, but both are documented as an object. Accepting either costs three
    lines and means a CLI release that starts returning the object does not read
    as every space having drifted on the same morning.
    """
    raw = space.get("serialized_space")
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError) as error:
        raise Unreachable(f"{where} serialized_space was not parseable JSON ({error})")


def canonical(value):
    """A comparable form: whitespace-folded strings, everything else as it is.

    Genie instruction text is written as folded YAML, so the committed side
    arrives with the line breaks the author typed and the live side with
    whatever the server stored. Comparing those literally reports drift for a
    re-wrapped paragraph that says exactly the same thing, which is a false
    positive, and the cost of a false positive here is a deploy nobody needed
    during somebody else's release.

    Only whitespace is folded. Punctuation, case and wording are compared as
    they are, because those are the changes this exists to catch.
    """
    if isinstance(value, str):
        return " ".join(value.split())
    if isinstance(value, list):
        return [canonical(item) for item in value]
    if isinstance(value, dict):
        return {key: canonical(item) for key, item in value.items()}
    return value


def describe(value) -> str:
    """One line for a reader, truncated, with the truncation visible."""
    text = json.dumps(canonical(value), ensure_ascii=False) if not isinstance(value, str) else canonical(value)
    return text if len(text) <= 300 else text[:300] + " ...[truncated]"


def compare(committed, live, path: str, findings: list[str]) -> None:
    """Walk the committed side and record every place the live side differs.

    Committed-side-driven for the top level and EXACT inside it. Walking only
    the committed side is what keeps the server's own fields out of the report;
    once inside a declared field, both directions count, because a deploy
    rewrites that field whole.
    """
    if isinstance(committed, dict) and isinstance(live, dict):
        for key in sorted(set(committed) | set(live)):
            where = f"{path}.{key}" if path else key
            if key not in committed:
                findings.append(f"{where}: live has it, the repository does not.\n"
                                f"        live: {describe(live[key])}")
                continue
            if key not in live:
                findings.append(f"{where}: the repository has it, live does not.\n"
                                f"        committed: {describe(committed[key])}")
                continue
            compare(committed[key], live[key], where, findings)
        return

    if isinstance(committed, list) and isinstance(live, list):
        leaf = path.rsplit(".", 1)[-1]
        key = KEYED_LISTS.get(leaf)
        if key and all(isinstance(item, dict) and key in item for item in committed + live):
            by_committed = {item[key]: item for item in committed}
            by_live = {item[key]: item for item in live}
            for ident in sorted(set(by_committed) | set(by_live)):
                where = f"{path}[{key}={ident}]"
                if ident not in by_committed:
                    findings.append(f"{where}: live has this entry, the repository does not.\n"
                                    f"        live: {describe(by_live[ident])}")
                elif ident not in by_live:
                    findings.append(f"{where}: the repository has this entry, live does not.\n"
                                    f"        committed: {describe(by_committed[ident])}")
                else:
                    compare(by_committed[ident], by_live[ident], where, findings)
            return
        if canonical(committed) != canonical(live):
            findings.append(f"{path}: differs.\n"
                            f"        committed: {describe(committed)}\n"
                            f"        live:      {describe(live)}")
        return

    if canonical(committed) != canonical(live):
        findings.append(f"{path}: differs.\n"
                        f"        committed: {describe(committed)}\n"
                        f"        live:      {describe(live)}")


def check_space(profile: str, label: str, key: str, space_id: str, committed: dict) -> str:
    """`in-sync`, `drifted` or `unreadable` for one space, printing as it goes."""
    print(f"\n  {label}  {space_id}")

    if not space_id:
        print("    SKIP  no id resolved for this space, so there is nothing live to")
        print("          compare against. Either the bundle has not deployed it yet or")
        print("          no id was adopted. bundle/preflight.sh --live tells those apart.")
        return "unreadable"

    try:
        live = api_get(profile, f"/api/2.0/genie/spaces/{space_id}?include_serialized_space=true")
        live_body = body_of(live, "live")
        committed_body = body_of(committed, "committed")
    except Unreachable as error:
        print(f"    UNREADABLE  {str(error).splitlines()[0]}")
        print("          This is NOT a statement that the space is in sync, and it is")
        print("          not a statement that it has drifted. It was not established.")
        return "unreadable"

    findings: list[str] = []
    for field in DECLARED_TOP_LEVEL:
        if field not in committed:
            continue
        if field not in live:
            findings.append(f"{field}: the repository declares it, the live space has no such field.")
            continue
        if (
            field in PATH_FIELDS
            and isinstance(committed[field], str)
            and isinstance(live[field], str)
            and same_workspace_path(committed[field], live[field])
        ):
            continue
        compare(committed[field], live[field], field, findings)
    compare(committed_body, live_body, "serialized_space", findings)

    if not findings:
        print("    IN SYNC   every field this bundle declares matches the live space.")
        print(f"              (live etag {live.get('etag', '(none)')}, last updated "
              f"{live.get('update_time', '(unknown)')})")
        return "in-sync"

    print(f"    DRIFTED   {len(findings)} difference(s) between the declared body "
          f"and the live space:")
    for finding in findings:
        print(f"      - {finding}")
    # Deliberately NOT "deploy this space to close it". The bundle attaches to
    # spaces it does not own, so this branch is only reachable if something
    # declared one again -- and deploying that would overwrite a live space's
    # instructions and curated tables, which is the failure, not the fix.
    print( "          Close it in the Genie UI, on whichever side is wrong.")
    print(f"          If the bundle is declaring genie_spaces.{key} again, that is the")
    print( "          real finding: this bundle attaches to existing spaces by id and")
    print( "          must not create or overwrite them. Reference bodies live in")
    print( "          genie/, which is not part of `include:`.")
    return "drifted"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", required=True)
    parser.add_argument(
        "--space",
        nargs=3,
        action="append",
        metavar=("LABEL", "KEY", "ID"),
        default=[],
        help="KEY is the resources.genie_spaces.<key> this id corresponds to.",
    )
    args = parser.parse_args()

    try:
        bundle = json.load(sys.stdin)
    except json.JSONDecodeError as error:
        print("")
        print(f"  FAIL  the resolved bundle configuration could not be read ({error}).")
        print("        This is fed `databricks bundle validate -t <target> -o json`.")
        return 2
    declared: dict = (bundle.get("resources") or {}).get("genie_spaces") or {}

    print("  note  comparing the CONTENT the bundle would push against the content the")
    print("        workspace is serving. `serialized_space.version` and the instruction")
    print("        ids are compared like any other field and decide nothing on their own:")
    print("        an unbumped version above rewritten text is exactly the failure this")
    print("        replaces.")

    verdicts: list[str] = []
    for label, key, space_id in args.space:
        committed = declared.get(key)
        if committed is None:
            print(f"\n  {label}  {space_id or '(no id)'}")
            print(f"    SKIP  the bundle declares no genie_spaces.{key} for this target, so")
            print( "          there is no committed body to compare. A space that is live")
            print( "          and no longer declared is not drift; it is unmanaged.")
            verdicts.append("unreadable")
            continue
        verdicts.append(check_space(args.profile, label, key, space_id, committed))

    if not verdicts:
        print("")
        print("  FAIL  nothing was compared: no --space was supplied.")
        print("        A run that checks nothing must not exit 0.")
        return 2

    drifted = verdicts.count("drifted")
    unreadable = verdicts.count("unreadable")
    print("")
    if drifted:
        print(f"  {drifted} of {len(verdicts)} thing(s) checked have drifted. The committed content is NOT what is live.")
        print( "  Until a deploy closes it, this repository is not a description of the")
        print( "  running demo, and a reader reasoning from the YAML will be wrong.")
    if unreadable:
        print(f"  {unreadable} space(s) could not be established either way. Not a pass.")
    if not drifted and not unreadable:
        print("  Every space checked is in sync. A deploy would change nothing.")
    print("")
    print("  What this does NOT establish: that an instruction which landed is being")
    print("  FOLLOWED. Ask the space a question that depends on the change.")

    if drifted:
        return 1
    return 2 if unreadable else 0


if __name__ == "__main__":
    sys.exit(main())
