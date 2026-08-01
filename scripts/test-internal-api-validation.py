#!/usr/bin/env python3
"""Exercise the centre validator embedded in the CloudFormation Lambda."""

from __future__ import annotations

import ast
import copy
import json
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
    }
    nodes = [
        node
        for node in tree.body
        if (isinstance(node, (ast.Import, ast.ImportFrom)) and any(
            alias.name in {"json", "math"} for alias in node.names
        ))
        or (isinstance(node, ast.FunctionDef) and node.name in wanted)
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
    namespace = validator_namespace()
    validate_centre = namespace["validate_centre"]
    validate_patch = namespace["validate_patch"]
    dataset = json.loads(DATASET.read_text(encoding="utf-8"))
    centres = dataset["centres"]

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

    print(f"Validated {len(centres)} complete centre records and rejection cases.")


if __name__ == "__main__":
    main()
