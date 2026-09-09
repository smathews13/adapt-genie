from __future__ import annotations

import importlib.util
from pathlib import Path
from types import SimpleNamespace
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "tag_resources", ROOT / "bundle" / "tag-resources.py"
)
assert SPEC and SPEC.loader
tag_resources = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tag_resources)


class Wait:
    def __init__(self) -> None:
        self.finished = False

    def result(self) -> None:
        self.finished = True

    def wait(self) -> None:
        self.finished = True


class API:
    def __init__(self) -> None:
        self.calls: list[tuple[Any, ...]] = []
        self.wait = Wait()

    def get_project(self, name: str) -> Any:
        return SimpleNamespace(
            spec=SimpleNamespace(
                custom_tags=[
                    tag_resources.ProjectCustomTag(key="owner", value="team"),
                ]
            )
        )

    def update_project(self, *args: Any) -> Wait:
        self.calls.append(args)
        return self.wait

    def get(self, warehouse_id: str) -> Any:
        return SimpleNamespace(
            tags=tag_resources.EndpointTags(
                custom_tags=[
                    tag_resources.EndpointTagPair(key="owner", value="team"),
                ]
            )
        )

    def edit(self, *args: Any, **kwargs: Any) -> Wait:
        self.calls.append((*args, kwargs))
        return self.wait

    def patch(self, *args: Any, **kwargs: Any) -> None:
        self.calls.append((*args, kwargs))

def workspace() -> Any:
    return SimpleNamespace(
        postgres=API(),
        warehouses=API(),
        serving_endpoints=API(),
    )


def pairs(tags: list[Any]) -> dict[str, str]:
    return {tag.key: tag.value for tag in tags}


def test_lakebase_tag_preserves_existing_tags() -> None:
    client = workspace()
    tag_resources.tag_lakebase(client, "project-one")
    _, project, mask = client.postgres.calls[0]
    assert mask.paths == ["spec.custom_tags"]
    assert pairs(project.spec.custom_tags) == {"owner": "team", "system_billing": "adapt"}
    assert client.postgres.wait.finished


def test_warehouse_tag_preserves_existing_tags_and_waits() -> None:
    client = workspace()
    tag_resources.tag_warehouse(client, "warehouse-one")
    _, kwargs = client.warehouses.calls[0]
    assert pairs(kwargs["tags"].custom_tags) == {
        "owner": "team",
        "system_billing": "adapt",
    }
    assert client.warehouses.wait.finished


def test_serving_endpoint_adds_adapt_tag() -> None:
    client = workspace()
    tag_resources.tag_serving_endpoint(client, "endpoint-one")
    _, kwargs = client.serving_endpoints.calls[0]
    assert pairs(kwargs["add_tags"]) == {"system_billing": "adapt"}


def test_agent_release_tags_only_the_adapt_endpoint() -> None:
    deploy = (ROOT / "agent" / "deploy_agent.py").read_text()
    release = (ROOT / "bundle" / "agent-release.sh").read_text()
    assert "tags={" not in deploy
    assert '--registered-model' not in release
    assert "--" + "vector" + "-endpoint" not in release
    assert '--serving-endpoint "$ENDPOINT"' in release
