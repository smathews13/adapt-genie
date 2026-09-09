from types import SimpleNamespace

from databricks.sdk import useragent

import correlation
import sdk_attribution


def as_dict(tags):
    return {tag.key: tag.value for tag in tags}


def test_sdk_product_registration_uses_adapt():
    useragent._reset_product()
    sdk_attribution.register_sdk_product()
    assert useragent.product() == ("ADAPT", "1.0.0")


def test_query_tags_include_safe_scoped_ids():
    request_id = "req-11111111-1111-1111-1111-111111111111"
    run_id = "req-22222222-2222-2222-2222-222222222222"
    correlation.activate_query_ids(SimpleNamespace(request_id=request_id, run_id=run_id))
    try:
        assert as_dict(sdk_attribution.query_tags("ask", "run_sql")) == {
            "application": "ADAPT",
            "surface": "ask",
            "tool": "run_sql",
            "correlation_id": request_id,
            "run_id": run_id,
        }
    finally:
        correlation.clear_query_ids()
