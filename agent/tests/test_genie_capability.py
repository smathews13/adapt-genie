import base64
import copy
import json
import time
from contextvars import Context
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

import agent
from genie_capability import (
    Config,
    activate,
    canonical_json,
    capability_pending,
    clear,
    consume,
    key_id,
    verify,
)

NOW = 1_789_016_400
AUDIENCE = "adapt-orchestrator"
USER = "admin@example.test"
REQUEST_ID = "req-123"
FIXTURE = Path(__file__).with_name("fixtures") / "genie-mcp-capability.json"


def encoded(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def signed(now=NOW):
    private = Ed25519PrivateKey.generate()
    public = private.public_key()
    public_der = public.public_bytes(
        encoding=serialization.Encoding.DER,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    claims = {
        "v": 1,
        "aud": AUDIENCE,
        "purpose": "genie:mcp",
        "sub": USER,
        "request_id": REQUEST_ID,
        "iat": now,
        "exp": now + 30,
        "transport": "mcp",
        "kid": key_id(public),
    }
    return (
        {"claims": claims, "signature": encoded(private.sign(canonical_json(claims)))},
        Config(public_key=encoded(public_der), audience=AUDIENCE),
    )


def decision(envelope, config, **overrides):
    return verify(
        {"genie_mcp_capability": envelope, "genie_transport": "mcp"},
        config=config,
        request_id=overrides.get("request_id", REQUEST_ID),
        observed_user=overrides.get("observed_user", USER),
        now=overrides.get("now", NOW),
    )


def test_valid_app_signature_authorizes_mcp():
    envelope, config = signed()

    verdict = decision(envelope, config)
    assert verdict.authorized is True
    assert envelope["signature"] not in json.dumps(vars(verdict))


@pytest.mark.parametrize(
    ("mutation", "overrides", "reason"),
    [
        (lambda value: value["claims"].update({"aud": "other-endpoint"}), {}, "claims"),
        (lambda value: value["claims"].update({"exp": NOW - 1}), {}, "expired"),
        (lambda value: value["claims"].update({"request_id": "req-other"}), {}, "request"),
        (lambda value: value["claims"].update({"sub": "other@example.test"}), {}, "user"),
        (lambda value: value.update({"signature": "AAAA"}), {}, "signature"),
        (lambda value: None, {"request_id": "req-other"}, "request"),
        (lambda value: None, {"observed_user": "other@example.test"}, "user"),
    ],
)
def test_tamper_expiry_request_and_user_mismatches_fail_closed(mutation, overrides, reason):
    envelope, config = signed()
    changed = copy.deepcopy(envelope)
    mutation(changed)

    assert decision(changed, config, **overrides).reason == reason


def test_unsigned_transport_and_unconfigured_public_key_fail_closed():
    assert (
        verify(
            {"genie_transport": "mcp"},
            config=Config(public_key="", audience=AUDIENCE),
            request_id=REQUEST_ID,
            observed_user=USER,
            now=NOW,
        ).authorized
        is False
    )


def test_node_signature_fixture_verifies_in_python():
    fixture = json.loads(FIXTURE.read_text())

    verdict = decision(
        {"claims": fixture["claims"], "signature": fixture["signature"]},
        Config(public_key=fixture["public_key"], audience=fixture["claims"]["aud"]),
        now=fixture["claims"]["iat"],
    )

    assert verdict.authorized is True
    assert "private" not in json.dumps(fixture).lower()


def test_agent_exposes_mcp_only_after_verification(monkeypatch):
    envelope, config = signed(int(time.time()))
    monkeypatch.setattr(agent, "GENIE_MCP_CAPABILITY", config)
    custom_inputs = {"genie_transport": "mcp", "genie_mcp_capability": envelope}
    agent.genie_capability.consume(custom_inputs)

    assert (
        agent._genie_transport(
            custom_inputs,
            request_id=REQUEST_ID,
            observed_user=USER,
        )
        == "mcp"
    )
    assert (
        agent._genie_transport(
            {"genie_transport": "mcp"},
            request_id=REQUEST_ID,
            observed_user=USER,
        )
        == "direct"
    )


def test_consumed_capability_is_request_local_and_always_cleared():
    envelope, config = signed()
    custom_inputs = {"genie_transport": "mcp", "genie_mcp_capability": envelope}

    consume(custom_inputs)
    assert "genie_mcp_capability" not in custom_inputs
    assert capability_pending() is True

    verdict = activate(
        custom_inputs,
        config=config,
        request_id=REQUEST_ID,
        observed_user=USER,
        now=NOW,
    )

    assert verdict.authorized is True
    assert capability_pending() is False
    clear()


def test_capability_context_does_not_cross_concurrent_request_contexts():
    envelope, _ = signed()
    first = Context()
    second = Context()
    custom_inputs = {"genie_transport": "mcp", "genie_mcp_capability": envelope}

    first.run(consume, custom_inputs)

    assert first.run(capability_pending) is True
    assert second.run(capability_pending) is False
    first.run(clear)
