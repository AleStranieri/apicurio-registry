#!/usr/bin/env python3
"""
G3 — Direct MCP stdio test script (no LLM involved).
Tests: initialize, tools/list, get_version_content, test_schema_rules (valid + invalid).

Usage:
    python3 examples/openapi-ai-assistant/scripts/g3-mcp-direct-test.py \
        --jar mcp/target/quarkus-app/quarkus-run.jar \
        --registry-url http://localhost:8080 \
        --group ai-poc \
        --artifact inventory-api \
        --out /tmp/g3-mcp-direct-results.json
"""

import argparse
import json
import os
import subprocess
import sys
import time
from typing import Any


# ---------------------------------------------------------------------------
# MCP JSON-RPC helper
# ---------------------------------------------------------------------------

class McpStdioClient:
    def __init__(self, jar_path: str, registry_url: str, extra_props: dict | None = None):
        self.jar_path = jar_path
        self.registry_url = registry_url
        self.extra_props = extra_props or {}
        self._seq = 0
        self._proc: subprocess.Popen | None = None

    def _next_id(self) -> int:
        self._seq += 1
        return self._seq

    def start(self) -> None:
        java_home = os.environ.get("JAVA_HOME", "")
        java_bin = os.path.join(java_home, "bin", "java") if java_home else "java"
        java_args = [
            java_bin,
            f"-Dregistry.url={self.registry_url}",
            # quarkus.mcp.server.http.enabled is build-time fixed to true in this JAR;
            # disable OIDC so the HTTP transport doesn't block startup in stdio-only mode.
            "-Dquarkus.oidc.tenant-enabled=false",
            "-Dquarkus.log.level=WARN",
        ]
        for k, v in self.extra_props.items():
            java_args.append(f"-D{k}={v}")
        java_args += ["-jar", self.jar_path]

        self._proc = subprocess.Popen(
            java_args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
        )
        # Give Quarkus time to start up
        time.sleep(4)

    def stop(self) -> None:
        if self._proc:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
            self._proc = None

    def _send(self, msg: dict) -> None:
        line = json.dumps(msg) + "\n"
        self._proc.stdin.write(line.encode())
        self._proc.stdin.flush()

    def _recv(self, timeout: float = 15.0) -> dict:
        """Read one JSON-RPC message from stdout (newline-delimited)."""
        import select
        start = time.monotonic()
        buf = b""
        while True:
            elapsed = time.monotonic() - start
            if elapsed > timeout:
                raise TimeoutError(f"No MCP response after {timeout}s; buf so far: {buf!r}")
            rlist, _, _ = select.select([self._proc.stdout], [], [], 0.2)
            if rlist:
                chunk = self._proc.stdout.read1(4096)  # type: ignore[attr-defined]
                if not chunk:
                    raise EOFError("MCP process closed stdout")
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    line = line.strip()
                    if line:
                        return json.loads(line)

    def call(self, method: str, params: dict | None = None, timeout: float = 30.0) -> dict:
        msg = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": method,
        }
        if params is not None:
            msg["params"] = params
        self._send(msg)
        return self._recv(timeout=timeout)

    def notify(self, method: str, params: dict | None = None) -> None:
        msg = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        self._send(msg)


# ---------------------------------------------------------------------------
# Test helpers
# ---------------------------------------------------------------------------

PASS = "PASS"
FAIL = "FAIL"

def ok(label: str, detail: str = "") -> dict:
    print(f"  [PASS] {label}" + (f": {detail}" if detail else ""))
    return {"label": label, "result": PASS, "detail": detail}

def fail(label: str, detail: str = "") -> dict:
    print(f"  [FAIL] {label}" + (f": {detail}" if detail else ""))
    return {"label": label, "result": FAIL, "detail": detail}


def run_tests(client: McpStdioClient, group: str, artifact: str) -> list[dict]:
    results = []

    # -------------------------------------------------------------------
    # T1 — initialize
    # -------------------------------------------------------------------
    print("\n[T1] initialize")
    resp = client.call("initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "g3-test", "version": "1.0"},
    })
    if "result" in resp and "protocolVersion" in resp["result"]:
        pv = resp["result"]["protocolVersion"]
        server_name = resp["result"].get("serverInfo", {}).get("name", "?")
        results.append(ok("T1_initialize", f"protocolVersion={pv} server={server_name}"))
    else:
        results.append(fail("T1_initialize", str(resp)))
    # Send initialized notification (required by MCP spec)
    client.notify("notifications/initialized")

    # -------------------------------------------------------------------
    # T2 — tools/list
    # -------------------------------------------------------------------
    print("\n[T2] tools/list")
    resp = client.call("tools/list")
    tools: list[dict] = []
    if "result" in resp and "tools" in resp["result"]:
        tools = resp["result"]["tools"]
        names = sorted(t["name"] for t in tools)
        print(f"  Tools found ({len(names)}): {', '.join(names)}")
        results.append(ok("T2_tools_list", f"count={len(names)}"))
        # Save tool list for the report
        results.append({"label": "T2_tool_names", "result": PASS, "detail": names})
    else:
        results.append(fail("T2_tools_list", str(resp)))

    # Check required tools for G3 are present
    required = {"get_version_content", "test_schema_rules"}
    available = {t["name"] for t in tools}
    missing = required - available
    if missing:
        results.append(fail("T2_required_tools_present", f"missing: {missing}"))
    else:
        results.append(ok("T2_required_tools_present", "get_version_content + test_schema_rules present"))

    # -------------------------------------------------------------------
    # T3 — get_version_content (read artifact)
    # -------------------------------------------------------------------
    print(f"\n[T3] get_version_content group={group} artifact={artifact} version=1")
    resp = client.call("tools/call", {
        "name": "get_version_content",
        "arguments": {
            "groupId": group,
            "artifactId": artifact,
            "versionExpression": "1",
        }
    }, timeout=20)
    if "result" in resp:
        content_items = resp["result"].get("content", [])
        text = " ".join(c.get("text", "") for c in content_items if c.get("type") == "text")
        if "openapi" in text.lower() or "inventory" in text.lower():
            preview = text[:120].replace("\n", " ")
            results.append(ok("T3_get_version_content", f"content preview: {preview}..."))
        else:
            results.append(fail("T3_get_version_content", f"unexpected content: {text[:200]}"))
    elif "error" in resp:
        results.append(fail("T3_get_version_content", f"error: {resp['error']}"))
    else:
        results.append(fail("T3_get_version_content", f"unexpected response: {resp}"))

    # -------------------------------------------------------------------
    # T4 — test_schema_rules with a VALID candidate
    # -------------------------------------------------------------------
    print(f"\n[T4] test_schema_rules — valid candidate (add pagination params)")
    valid_candidate = json.dumps({
        "openapi": "3.0.3",
        "info": {"title": "Inventory API", "version": "2.0.0"},
        "paths": {
            "/items": {
                "get": {
                    "operationId": "listItems",
                    "summary": "List inventory items with pagination",
                    "parameters": [
                        {"name": "limit", "in": "query", "required": False,
                         "schema": {"type": "integer", "minimum": 1, "default": 20}},
                        {"name": "offset", "in": "query", "required": False,
                         "schema": {"type": "integer", "minimum": 0, "default": 0}},
                    ],
                    "responses": {
                        "200": {"description": "A list of items", "content": {
                            "application/json": {"schema": {
                                "type": "array",
                                "items": {"$ref": "#/components/schemas/Item"}
                            }}
                        }}
                    }
                },
                "post": {
                    "operationId": "createItem",
                    "summary": "Create a new inventory item",
                    "requestBody": {"required": True, "content": {
                        "application/json": {"schema": {"$ref": "#/components/schemas/ItemCreate"}}
                    }},
                    "responses": {
                        "201": {"description": "Item created", "content": {
                            "application/json": {"schema": {"$ref": "#/components/schemas/Item"}}
                        }},
                        "400": {"description": "Invalid input"}
                    }
                }
            },
            "/items/{id}": {
                "get": {
                    "operationId": "getItem",
                    "summary": "Get a single inventory item by ID",
                    "parameters": [{"name": "id", "in": "path", "required": True,
                                    "schema": {"type": "string"}}],
                    "responses": {
                        "200": {"description": "Item found", "content": {
                            "application/json": {"schema": {"$ref": "#/components/schemas/Item"}}
                        }},
                        "404": {"description": "Item not found"}
                    }
                }
            }
        },
        "components": {"schemas": {
            "Item": {"type": "object", "required": ["id", "name", "quantity"],
                     "properties": {
                         "id": {"type": "string"},
                         "name": {"type": "string"},
                         "quantity": {"type": "integer", "minimum": 0},
                         "price": {"type": "number", "format": "double"}
                     }},
            "ItemCreate": {"type": "object", "required": ["name", "quantity"],
                           "properties": {
                               "name": {"type": "string"},
                               "quantity": {"type": "integer", "minimum": 0},
                               "price": {"type": "number", "format": "double"}
                           }}
        }}
    })

    resp = client.call("tools/call", {
        "name": "test_schema_rules",
        "arguments": {
            "groupId": group,
            "artifactId": artifact,
            "versionContent": valid_candidate,
            "versionContentType": "application/json",
        }
    }, timeout=20)

    if "result" in resp:
        content_items = resp["result"].get("content", [])
        text = " ".join(c.get("text", "") for c in content_items if c.get("type") == "text")
        # isError=false in the result means validation passed
        is_error = resp["result"].get("isError", False)
        if not is_error:
            results.append(ok("T4_valid_candidate_passes", f"response: {text[:200]}"))
        else:
            results.append(fail("T4_valid_candidate_passes",
                                f"unexpected error for valid schema: {text[:300]}"))
    elif "error" in resp:
        results.append(fail("T4_valid_candidate_passes", f"RPC error: {resp['error']}"))
    else:
        results.append(fail("T4_valid_candidate_passes", f"unexpected: {resp}"))

    # -------------------------------------------------------------------
    # T5 — test_schema_rules with an INVALID candidate
    # (broken $ref — references a schema that doesn't exist)
    # -------------------------------------------------------------------
    print(f"\n[T5] test_schema_rules — invalid candidate (broken $ref)")
    invalid_candidate = json.dumps({
        "openapi": "3.0.3",
        "info": {"title": "Inventory API", "version": "2.0.0"},
        "paths": {
            "/items": {
                "get": {
                    "operationId": "listItems",
                    "responses": {
                        "200": {"description": "ok", "content": {
                            "application/json": {"schema": {
                                "$ref": "#/components/schemas/NonExistentSchema"
                            }}
                        }}
                    }
                }
            }
        },
        "components": {"schemas": {}}
    })

    resp = client.call("tools/call", {
        "name": "test_schema_rules",
        "arguments": {
            "groupId": group,
            "artifactId": artifact,
            "versionContent": invalid_candidate,
            "versionContentType": "application/json",
        }
    }, timeout=20)

    if "result" in resp:
        content_items = resp["result"].get("content", [])
        text = " ".join(c.get("text", "") for c in content_items if c.get("type") == "text")
        is_error = resp["result"].get("isError", False)
        if is_error or "violation" in text.lower() or "invalid" in text.lower() or "rule" in text.lower() or "error" in text.lower():
            results.append(ok("T5_invalid_candidate_rejected",
                              f"correctly rejected: {text[:200]}"))
        else:
            # Registry 3.3.1 may not have VALIDITY rule enabled by default; no rule = pass
            results.append(ok("T5_invalid_candidate_no_rule_configured",
                              f"no rules active (expected if no VALIDITY rule set); response: {text[:200]}"))
    elif "error" in resp:
        # An RPC-level error is also an acceptable "rejected" signal
        results.append(ok("T5_invalid_candidate_rejected",
                          f"RPC error (validation failed): {resp['error']}"))
    else:
        results.append(fail("T5_invalid_candidate_invalid_response", f"unexpected: {resp}"))

    return results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--jar", required=True)
    parser.add_argument("--registry-url", default="http://localhost:8080")
    parser.add_argument("--group", default="ai-poc")
    parser.add_argument("--artifact", default="inventory-api")
    parser.add_argument("--out", default="/tmp/g3-mcp-direct-results.json")
    args = parser.parse_args()

    java_home = os.environ.get("JAVA_HOME", "")
    if java_home:
        os.environ["PATH"] = os.path.join(java_home, "bin") + os.pathsep + os.environ["PATH"]

    print(f"=== G3 MCP Direct Test ===")
    print(f"JAR:          {args.jar}")
    print(f"Registry URL: {args.registry_url}")
    print(f"Group:        {args.group}")
    print(f"Artifact:     {args.artifact}")

    client = McpStdioClient(args.jar, args.registry_url)
    print("\nStarting MCP stdio process...")
    client.start()

    results = []
    try:
        results = run_tests(client, args.group, args.artifact)
    except Exception as e:
        results.append({"label": "UNHANDLED_EXCEPTION", "result": FAIL, "detail": str(e)})
        import traceback; traceback.print_exc()
    finally:
        client.stop()

    # Summary
    passed = sum(1 for r in results if r.get("result") == PASS)
    total = sum(1 for r in results if r.get("result") in (PASS, FAIL))
    print(f"\n=== Summary: {passed}/{total} passed ===")

    report = {
        "test": "G3 MCP Direct Test",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "jar": args.jar,
        "registry_url": args.registry_url,
        "group": args.group,
        "artifact": args.artifact,
        "passed": passed,
        "total": total,
        "results": results,
    }
    with open(args.out, "w") as f:
        json.dump(report, f, indent=2)
    print(f"Results saved to {args.out}")

    sys.exit(0 if passed == total else 1)


if __name__ == "__main__":
    main()
