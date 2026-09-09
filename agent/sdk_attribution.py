"""Databricks SDK and SQL attribution for ADAPT agent-side calls."""

from __future__ import annotations

from typing import TYPE_CHECKING

import correlation

if TYPE_CHECKING:
    from databricks.sdk.service.sql import QueryTag

PRODUCT_NAME = "ADAPT"
PRODUCT_VERSION = "1.0.0"
QUERY_TAG_LIMIT = 128


def register_sdk_product() -> None:
    """Identify ADAPT before constructing any Databricks SDK client."""

    from databricks.sdk import useragent

    useragent.with_product(PRODUCT_NAME, PRODUCT_VERSION)


def query_tags(surface: str, tool: str) -> list[QueryTag]:
    """Bounded statement tags used to attribute Ask SQL spend."""

    from databricks.sdk.service.sql import QueryTag

    values = {
        "application": PRODUCT_NAME,
        "surface": surface,
        "tool": tool,
        **correlation.current_query_ids(),
    }
    return [
        QueryTag(key=key, value=value[:QUERY_TAG_LIMIT]) for key, value in values.items() if value
    ]
