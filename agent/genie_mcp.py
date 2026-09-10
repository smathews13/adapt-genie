"""Runtime discovery and invocation for Databricks' managed Genie MCP server.

This module deliberately knows no fixed managed-tool schema. The managed server
owns its tool names and input contracts, so each call discovers them through
``databricks-mcp`` and adapts the question and any polling identifiers to the
schema returned by that server.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from typing import Any

ASK_TOOL_NAMES = ("genie_ask", "query_space", "ask_genie", "ask")
POLL_TOOL_NAMES = ("genie_poll_response", "get_response", "poll_response", "get_message")
QUESTION_FIELDS = ("question", "query", "prompt", "input")
TERMINAL_SUCCESS = {"COMPLETED", "COMPLETE", "SUCCEEDED", "SUCCESS", "DONE"}
TERMINAL_FAILURE = {"FAILED", "ERROR", "CANCELLED", "CANCELED", "EXPIRED"}
SQL_KEYS = {"sql", "query", "generated_sql", "statement"}
COLUMN_KEYS = {"columns", "column_names"}
ID_FIELDS = ("conversation_id", "message_id", "response_id", "request_id", "id")
MAX_RESULT_CHARS = 40_000


@dataclass(frozen=True)
class ManagedGenieResult:
    """The actual managed-MCP response and the transport calls that produced it."""

    payload: Any
    discovered_tools: tuple[str, ...]
    called_tools: tuple[str, ...]


def _plain(value: Any, seen: set[int] | None = None) -> Any:
    """Convert MCP/Pydantic result objects to bounded JSON-compatible values."""

    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    seen = seen or set()
    if id(value) in seen:
        return "<recursive>"
    seen.add(id(value))
    if hasattr(value, "model_dump"):
        try:
            return _plain(value.model_dump(mode="json"), seen)
        except TypeError:
            return _plain(value.model_dump(), seen)
    if isinstance(value, dict):
        return {str(key): _plain(item, seen) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item, seen) for item in value]
    public = {
        key: getattr(value, key)
        for key in ("content", "structuredContent", "structured_content", "isError", "text")
        if hasattr(value, key)
    }
    return _plain(public, seen) if public else str(value)


def _json_inside(value: Any) -> Any:
    """Decode JSON carried by MCP text blocks without rewriting ordinary prose."""

    value = _plain(value)
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith(("{", "[")):
            try:
                return _json_inside(json.loads(stripped))
            except json.JSONDecodeError:
                return value
        return value
    if isinstance(value, list):
        return [_json_inside(item) for item in value]
    if isinstance(value, dict):
        return {key: _json_inside(item) for key, item in value.items()}
    return value


def normalized_payload(result: Any) -> Any:
    """The complete result, preserving structured content and text provenance."""

    return _json_inside(result)


def _walk(value: Any):
    value = normalized_payload(value)
    yield value
    if isinstance(value, dict):
        for item in value.values():
            yield from _walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk(item)


def _pairs(value: Any):
    value = normalized_payload(value)
    if isinstance(value, dict):
        for key, item in value.items():
            yield str(key), item
            yield from _pairs(item)
    elif isinstance(value, list):
        for item in value:
            yield from _pairs(item)


def status_of(value: Any) -> str:
    for key, item in _pairs(value):
        if key.lower() in {"status", "state"} and isinstance(item, str):
            return item.strip().upper()
    return ""


def sql_statements(value: Any) -> list[str]:
    """Statements the MCP response itself exposes; never infer one from prose."""

    found: list[str] = []
    for key, item in _pairs(value):
        if key.lower() not in SQL_KEYS or not isinstance(item, str):
            continue
        candidate = item.strip()
        if not candidate or not re.match(r"(?is)^\s*(?:--[^\n]*\n|\s)*(select|with)\b", candidate):
            continue
        if candidate not in found:
            found.append(candidate)
    return found


def result_columns(value: Any) -> list[str]:
    """Columns explicitly named by the managed result, for the output-schema gate."""

    found: list[str] = []
    for key, item in _pairs(value):
        if key.lower() not in COLUMN_KEYS or not isinstance(item, list):
            continue
        for column in item:
            name = (
                column
                if isinstance(column, str)
                else column.get("name")
                if isinstance(column, dict)
                else None
            )
            if isinstance(name, str) and name.strip() and name.strip() not in found:
                found.append(name.strip())
    return found


def render_result(value: Any) -> str:
    """A bounded, lossless-enough result for evidence, stages, and synthesis."""

    payload = normalized_payload(value)
    text = json.dumps(payload, ensure_ascii=False, default=str, indent=2)
    if len(text) <= MAX_RESULT_CHARS:
        return text
    return text[:MAX_RESULT_CHARS].rstrip() + "\n… MCP result truncated at evidence bound."


def _schema(tool: Any) -> dict[str, Any]:
    value = getattr(tool, "inputSchema", None)
    if value is None:
        value = getattr(tool, "input_schema", None)
    value = _plain(value)
    return value if isinstance(value, dict) else {}


def _tool_name(tool: Any) -> str:
    return str(getattr(tool, "name", "") or "")


def _select(tools: list[Any], preferred: tuple[str, ...], *, polling: bool) -> Any | None:
    by_name = {_tool_name(tool): tool for tool in tools if _tool_name(tool)}
    for name in preferred:
        if name in by_name:
            return by_name[name]
    for name, tool in by_name.items():
        lowered = name.lower()
        looks_poll = "poll" in lowered or lowered.startswith(("get_", "fetch_"))
        if polling == looks_poll and (
            "genie" in lowered or "response" in lowered or "space" in lowered
        ):
            return tool
    return None


def _question_arguments(tool: Any, question: str) -> dict[str, Any]:
    properties = _schema(tool).get("properties")
    properties = properties if isinstance(properties, dict) else {}
    field = next((name for name in QUESTION_FIELDS if name in properties), None)
    if field is None and len(properties) == 1:
        field = next(iter(properties))
    if field is None:
        raise RuntimeError(
            f"Managed Genie MCP tool {_tool_name(tool)!r} exposes no question field; "
            f"discovered fields: {sorted(properties)}."
        )
    if field == "input":
        return {
            "input": [
                {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": question}],
                }
            ]
        }
    return {field: question}


def _first_values(value: Any) -> dict[str, Any]:
    found: dict[str, Any] = {}
    for key, item in _pairs(value):
        lowered = key.lower()
        if lowered in ID_FIELDS and lowered not in found and isinstance(item, (str, int)):
            found[lowered] = item
    return found


def _poll_arguments(tool: Any, value: Any) -> dict[str, Any]:
    properties = _schema(tool).get("properties")
    properties = properties if isinstance(properties, dict) else {}
    ids = _first_values(value)
    arguments = {name: ids[name] for name in properties if name in ids}
    required = _schema(tool).get("required")
    required = required if isinstance(required, list) else []
    missing = [name for name in required if name not in arguments]
    if missing:
        raise RuntimeError(
            f"Managed Genie MCP polling tool {_tool_name(tool)!r} needs {missing}, "
            "but the preceding managed result did not return them."
        )
    return arguments


def invoke_managed_genie(
    workspace_client: Any,
    space_id: str,
    question: str,
    *,
    timeout_seconds: float,
    client_factory: Any = None,
    sleep: Any = time.sleep,
) -> ManagedGenieResult:
    """Discover, invoke, and if necessary poll one managed Genie MCP request."""

    if not space_id.strip():
        raise RuntimeError("The configured data Genie space id is empty.")
    if client_factory is None:
        from databricks_mcp import DatabricksMCPClient

        client_factory = DatabricksMCPClient
    host = str(workspace_client.config.host).rstrip("/")
    server_url = f"{host}/api/2.0/mcp/genie/{space_id.strip()}"
    client = client_factory(server_url=server_url, workspace_client=workspace_client)
    tools = list(client.list_tools())
    names = tuple(_tool_name(tool) for tool in tools if _tool_name(tool))
    ask = _select(tools, ASK_TOOL_NAMES, polling=False)
    if ask is None:
        raise RuntimeError(f"Managed Genie MCP exposed no query tool; discovered: {list(names)}.")

    called = [_tool_name(ask)]
    result = client.call_tool(_tool_name(ask), _question_arguments(ask, question))
    deadline = time.monotonic() + max(0.0, timeout_seconds)
    while True:
        status = status_of(result)
        if status in TERMINAL_FAILURE:
            raise RuntimeError(
                f"Managed Genie MCP ended in {status}: {render_result(result)[:1000]}"
            )
        if status in TERMINAL_SUCCESS or not status:
            return ManagedGenieResult(normalized_payload(result), names, tuple(called))
        poll = _select(tools, POLL_TOOL_NAMES, polling=True)
        if poll is None:
            raise RuntimeError(
                f"Managed Genie MCP returned non-terminal status {status} but exposed no "
                "polling tool; "
                f"discovered: {list(names)}."
            )
        if time.monotonic() >= deadline:
            raise TimeoutError(
                f"Managed Genie MCP was still {status} when this turn's budget expired."
            )
        sleep(min(0.5, max(0.0, deadline - time.monotonic())))
        called.append(_tool_name(poll))
        result = client.call_tool(_tool_name(poll), _poll_arguments(poll, result))
