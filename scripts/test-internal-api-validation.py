#!/usr/bin/env python3
"""Exercise the centre validator embedded in the CloudFormation Lambda."""

from __future__ import annotations

import ast
import copy
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "infra" / "aws-static-site.yml"
DATASET = ROOT / "packages" / "core" / "data" / "centres.all.json"


def lambda_source() -> str:
    lines = TEMPLATE.read_text(encoding="utf-8").splitlines()
    start = lines.index("        ZipFile: |") + 1
    code: list[str] = []
    for line in lines[start:]:
        if line and not line.startswith("          "):
            break
        code.append(line[10:] if line else "")
    return "\n".join(code)


def validator_namespace() -> dict[str, object]:
    tree = ast.parse(lambda_source())
    wanted = {
        "require_object",
        "require_string",
        "require_bool",
        "require_number",
        "require_enum",
        "require_string_array",
        "validate_centre",
        "validate_patch",
        "validate_created_centre",
        "store_record",
        "response",
        "assert_public_feed_fits",
    }
    nodes = [
        node
        for node in tree.body
        if (isinstance(node, (ast.Import, ast.ImportFrom)) and any(
            alias.name in {"json", "math", "re", "urlsplit"} for alias in node.names
        ))
        or (isinstance(node, ast.FunctionDef) and node.name in wanted)
        or (
            isinstance(node, ast.Assign)
            and any(
                isinstance(target, ast.Name)
                and target.id in {
                    "KNOWN_COUNTRY_OR_REGION_CODES",
                    "MAX_PUBLIC_FEED_RESPONSE_BYTES",
                }
                for target in node.targets
            )
        )
    ]
    namespace: dict[str, object] = {}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(TEMPLATE), "exec"), namespace)
    return namespace


def expect_invalid(call, message: str) -> None:
    try:
        call()
    except ValueError:
        return
    raise AssertionError(message)


def main() -> None:
    source = lambda_source()
    assert 'ConditionalCheckFailedException' in source
    assert 'return response(409' in source
    namespace = validator_namespace()
    validate_centre = namespace["validate_centre"]
    validate_patch = namespace["validate_patch"]
    validate_created_centre = namespace["validate_created_centre"]
    store_record = namespace["store_record"]
    make_response = namespace["response"]
    assert_public_feed_fits = namespace["assert_public_feed_fits"]
    writes: list[dict[str, object]] = []

    class FakeDynamoDb:
        def put_item(self, **request):
            writes.append(request)

    namespace["dynamodb"] = FakeDynamoDb()
    namespace["table"] = "centre-overrides"
    namespace["datetime"] = datetime
    namespace["timezone"] = timezone
    store_record("manual-ca-new", {}, "admin@example.test", True)
    assert writes[-1]["ConditionExpression"] == "attribute_not_exists(centreId)"
    store_record(
        "manual-ca-new",
        {},
        "admin@example.test",
        True,
        "2026-08-12T01:02:03+00:00",
    )
    assert writes[-1]["ConditionExpression"] == "#updatedAt = :expected"
    assert writes[-1]["ExpressionAttributeValues"] == {
        ":expected": {"S": "2026-08-12T01:02:03+00:00"}
    }
    dataset = json.loads(DATASET.read_text(encoding="utf-8"))
    centres = dataset["centres"]

    current_response_bytes = len(json.dumps(
        make_response(200, dataset, "public,max-age=60,s-maxage=60"),
        separators=(",", ":"),
    ).encode("utf-8"))
    assert current_response_bytes <= namespace["MAX_PUBLIC_FEED_RESPONSE_BYTES"]

    namespace["stored_overrides"] = lambda: []
    namespace["MAX_PUBLIC_FEED_RESPONSE_BYTES"] = 100
    namespace["merged_feed"] = lambda stored=None: {"centres": [{"padding": "x" * 100}]}
    expect_invalid(
        lambda: assert_public_feed_fits("manual-ca-too-large", {}, True),
        "an oversized aggregate public feed was accepted",
    )
    namespace["MAX_PUBLIC_FEED_RESPONSE_BYTES"] = 5_500_000
    namespace["merged_feed"] = lambda stored=None: {"centres": []}
    assert_public_feed_fits("manual-ca-small", {}, True)

    for centre in centres:
        validate_centre(centre)

    malformed = copy.deepcopy(centres[0])
    malformed["offerings"] = [None]
    expect_invalid(
        lambda: validate_centre(malformed),
        "a null offering was accepted",
    )

    oversized = copy.deepcopy(centres[0])
    oversized["parsedPriceFrom"] = 10**400
    expect_invalid(
        lambda: validate_centre(oversized),
        "an oversized integer was accepted",
    )

    base = next(centre for centre in centres if "localizations" not in centre)
    namespace["centre_by_id"] = lambda centre_id: base if centre_id == base["id"] else None
    expect_invalid(
        lambda: validate_patch(base["id"], {"ieltsOrgSlug": "different-route"}),
        "a changed route slug was accepted",
    )
    validate_patch(base["id"], {"ieltsOrgSlug": base["ieltsOrgSlug"]})
    validate_patch(
        base["id"],
        {
            "localizations": [
                {
                    "locale": "zh-CN",
                    "name": "reviewed search evidence",
                    "address": None,
                    "nameSource": "admin",
                    "addressSource": None,
                }
            ]
        },
    )
    validate_patch(
        base["id"],
        {
            "futureOpening": {
                "source": "ielts_usa_network",
                "sourceUrl": "https://example.com/future-centre",
                "sourceLabel": "Future centre",
            }
        },
    )
    expect_invalid(
        lambda: validate_patch(base["id"], {"notACentreField": True}),
        "an unknown top-level field was accepted",
    )

    created = copy.deepcopy(base)
    created["id"] = "manual-ca-example-centre"
    created["ieltsOrgSlug"] = "added"
    created["geo"] = None
    created["googlePlaceId"] = None
    created["sources"] = [{
        "source": "Administrator",
        "externalSlug": created["id"],
        "url": "https://example.org/official-centre",
        "seenAt": "2026-08-12T00:00:00.000Z",
        "stillPresent": True,
    }]
    validate_created_centre(created)
    wrong_route = copy.deepcopy(created)
    wrong_route["ieltsOrgSlug"] = "unbuilt-static-route"
    expect_invalid(
        lambda: validate_created_centre(wrong_route),
        "a manually added centre was allowed to use an unbuilt route",
    )
    no_price = copy.deepcopy(created)
    for offering in no_price["offerings"]:
        offering["priceText"] = None
    expect_invalid(
        lambda: validate_created_centre(no_price),
        "an ordinary manually added centre without a source price was accepted",
    )
    unknown_operator = copy.deepcopy(created)
    unknown_operator["operator"] = "unknown"
    expect_invalid(
        lambda: validate_created_centre(unknown_operator),
        "a manually added centre without a known operator was accepted",
    )
    no_city = copy.deepcopy(created)
    no_city["address"]["city"] = ""
    expect_invalid(
        lambda: validate_created_centre(no_city),
        "a manually added centre without a city was accepted",
    )
    unknown_country = copy.deepcopy(created)
    unknown_country["address"]["country"] = "ZZ"
    expect_invalid(
        lambda: validate_created_centre(unknown_country),
        "an unknown country or region code was accepted",
    )

    print(f"Validated {len(centres)} complete centre records and rejection cases.")


if __name__ == "__main__":
    main()
