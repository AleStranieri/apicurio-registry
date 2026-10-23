#!/usr/bin/env python3
"""Replay a proposal through G4; compare Registry versions before/after (no setup writes)."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import urllib.request
import uuid

DEFAULT_INSTRUCTION = "Change only info.title to Inventory Assistant G4. Return the complete JSON document."


def read_json(url, data=None):
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=200) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service-url", default="http://127.0.0.1:8082")
    parser.add_argument("--registry-url", default="http://127.0.0.1:8080")
    parser.add_argument("--mode", choices=["create", "modify"], default="modify")
    parser.add_argument("--instruction", default=DEFAULT_INSTRUCTION)
    parser.add_argument("--expected-title", help="Also require this exact candidate info.title")
    parser.add_argument("--draft", type=Path, default=Path(__file__).resolve().parents[1] / "fixtures/inventory-api-openapi303.json")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    # Isolated G3 fixture only. This script never invokes a Registry write or changes rules.
    versions_url = args.registry_url.rstrip("/") + "/apis/registry/v3/groups/ai-poc/artifacts/inventory-api/versions"
    before = read_json(versions_url)
    content = args.draft.read_text() if args.mode == "modify" else ""
    request = {
        "requestId": str(uuid.uuid4()), "mode": args.mode, "instruction": args.instruction,
        "draft": {"documentId": "g4-smoke", "revision": 7, "contentType": "application/json",
                  "content": content, "baseHash": hashlib.sha256(content.encode()).hexdigest()},
    }
    if args.mode == "modify":
        request["registryContext"] = {"groupId": "ai-poc", "artifactId": "inventory-api", "version": "1"}
    started = time.monotonic()
    proposal = read_json(args.service_url.rstrip("/") + "/proposals", json.dumps(request).encode())
    after = read_json(versions_url)
    expected_title = args.expected_title
    if args.mode == "modify" and args.instruction == DEFAULT_INSTRUCTION and expected_title is None:
        expected_title = "Inventory Assistant G4"
    title_matches = None
    if expected_title is not None:
        try:
            title_matches = json.loads(proposal["candidate"]).get("info", {}).get("title") == expected_title
        except (ValueError, TypeError):
            title_matches = False
    report = {"request": request, "response": proposal, "registryBefore": before, "registryAfter": after,
              "versionsUnchanged": before == after, "expectedTitleMatches": title_matches,
              "elapsedMs": round((time.monotonic() - started) * 1000)}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"status": proposal["status"], "run": proposal["run"],
                      "diagnostics": proposal["diagnostics"], "versionsUnchanged": before == after,
                      "expectedTitleMatches": title_matches}))
    return 0 if proposal["status"] == "applicable" and before == after and title_matches is not False else 1


if __name__ == "__main__":
    raise SystemExit(main())
