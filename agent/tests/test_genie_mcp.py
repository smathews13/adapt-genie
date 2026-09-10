from types import SimpleNamespace

import pytest

import tools as tools_module
from config import Settings
from evidence import EvidenceRefused
from genie_mcp import (
    ManagedGenieResult,
    invoke_managed_genie,
    render_result,
    result_columns,
    sql_statements,
)
from tools import PlayerInsightTools

ACTIVITY = "test_catalog.test_schema.fact_player_activity"


def settings() -> Settings:
    return Settings(
        llm_endpoint="test-model",
        warehouse_id="warehouse",
        data_genie_space_id="space-1",
        data_genie_space_title="Sales",
        catalog="test_catalog",
        schema="test_schema",
        catalog_allowlist=("test_catalog",),
        declared_manifest=(ACTIVITY,),
        max_output_tokens=2500,
    )


def tool(name, properties, required=()):
    return SimpleNamespace(
        name=name,
        inputSchema={"type": "object", "properties": properties, "required": list(required)},
    )


class FakeManagedClient:
    def __init__(self, *, server_url, workspace_client):
        self.server_url = server_url
        self.workspace_client = workspace_client
        self.calls = []
        self._tools = [
            tool("genie_ask", {"input": {"type": "array"}}, ("input",)),
            tool(
                "genie_poll_response",
                {
                    "conversation_id": {"type": "string"},
                    "response_id": {"type": "string"},
                },
                ("conversation_id", "response_id"),
            ),
        ]

    def list_tools(self):
        return self._tools

    def call_tool(self, name, arguments):
        self.calls.append((name, arguments))
        if name == "genie_ask":
            return SimpleNamespace(
                content=[
                    SimpleNamespace(
                        text='{"status":"RUNNING","conversation_id":"c-1","response_id":"r-1"}'
                    )
                ],
                structuredContent=None,
            )
        return SimpleNamespace(
            content=[SimpleNamespace(text="Revenue was 42.")],
            structuredContent={
                "status": "COMPLETED",
                "attachments": [
                    {
                        "query": {
                            "query": (
                                "SELECT title, sum(revenue) AS revenue "
                                "FROM cat.sch.sales GROUP BY title"
                            ),
                            "result": {"columns": ["title", "revenue"], "rows": [["A", 42]]},
                        }
                    }
                ],
            },
        )


def test_runtime_discovers_tools_uses_obo_client_and_polls_structured_result():
    workspace = SimpleNamespace(config=SimpleNamespace(host="https://workspace.example/"))
    held = {}

    def factory(**kwargs):
        held["client"] = FakeManagedClient(**kwargs)
        return held["client"]

    result = invoke_managed_genie(
        workspace,
        "space-1",
        "revenue by title",
        timeout_seconds=1,
        client_factory=factory,
        sleep=lambda _: None,
    )

    client = held["client"]
    assert client.server_url == "https://workspace.example/api/2.0/mcp/genie/space-1"
    assert client.workspace_client is workspace
    assert result.discovered_tools == ("genie_ask", "genie_poll_response")
    assert result.called_tools == ("genie_ask", "genie_poll_response")
    assert client.calls == [
        (
            "genie_ask",
            {
                "input": [
                    {
                        "type": "message",
                        "role": "user",
                        "content": [{"type": "input_text", "text": "revenue by title"}],
                    }
                ]
            },
        ),
        ("genie_poll_response", {"conversation_id": "c-1", "response_id": "r-1"}),
    ]
    assert sql_statements(result.payload) == [
        "SELECT title, sum(revenue) AS revenue FROM cat.sch.sales GROUP BY title"
    ]
    assert result_columns(result.payload) == ["title", "revenue"]
    assert "Revenue was 42." in render_result(result.payload)


def test_result_provenance_is_never_inferred_from_answer_prose():
    payload = {"status": "COMPLETED", "answer": "42 players from cat.sch.players."}

    assert sql_statements(payload) == []
    assert result_columns(payload) == []


def test_tool_reuses_evidence_gateway_for_mcp_sql_and_sources(monkeypatch):
    managed = ManagedGenieResult(
        payload={
            "status": "COMPLETED",
            "answer": "8,413 active players",
            "sql": f"SELECT count(*) AS active_players FROM {ACTIVITY}",
            "columns": [{"name": "active_players"}],
            "rows": [[8413]],
        },
        discovered_tools=("genie_ask", "genie_poll_response"),
        called_tools=("genie_ask", "genie_poll_response"),
    )
    monkeypatch.setattr(tools_module.genie_mcp, "invoke_managed_genie", lambda *a, **k: managed)
    player_tools = PlayerInsightTools(
        settings(),
        SimpleNamespace(config=SimpleNamespace(host="https://workspace.example")),
        user_authorized=True,
    )

    result = player_tools.genie_mcp("How many active players?")

    assert result.attributed is True
    assert result.sources == [ACTIVITY]
    assert result.sql == f"SELECT count(*) AS active_players FROM {ACTIVITY}"
    assert '"rows": [' in result.text


def test_tool_withholds_mcp_prose_that_has_no_query_provenance(monkeypatch):
    managed = ManagedGenieResult(
        payload={"status": "COMPLETED", "answer": "8,413 active players"},
        discovered_tools=("genie_ask",),
        called_tools=("genie_ask",),
    )
    monkeypatch.setattr(tools_module.genie_mcp, "invoke_managed_genie", lambda *a, **k: managed)
    player_tools = PlayerInsightTools(
        settings(),
        SimpleNamespace(config=SimpleNamespace(host="https://workspace.example")),
        user_authorized=True,
    )

    with pytest.raises(EvidenceRefused):
        player_tools.genie_mcp("How many active players?")
