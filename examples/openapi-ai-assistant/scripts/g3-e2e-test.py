#!/usr/bin/env python3
"""
G3 — End-to-end test: LLM + MCP stdio against Registry 3.3.1.

Flow:
  1. Start MCP stdio process (Apicurio Registry MCP 3.4.0-SNAPSHOT).
  2. Initialize MCP session.
  3. Send to Granite 4.0 MoE (via Ollama /v1) the task:
       a. Read inventory-api from the registry (get_version_content).
       b. Identify the common pagination schema pattern in the spec.
       c. Propose a new version with limit/offset pagination on GET /items.
  4. Execute the tool calls the model requests against the live MCP stdio.
  5. Call test_schema_rules on the proposed candidate (without writing it).
  6. Verify gate:
       - At least one effective read tool call (get_version_content executed).
       - At least one validation (test_schema_rules executed).
       - Version count in registry unchanged (still 1).
  7. Save full trace to --out (JSON).

No automatic write to Registry. The proposal is reported only.

Usage:
    python3 examples/openapi-ai-assistant/scripts/g3-e2e-test.py \
        --jar mcp/target/quarkus-app/quarkus-run.jar \
        --registry-url http://localhost:8080 \
        --llm-url http://127.0.0.1:11434/v1 \
        --model granite4:latest \
        --group ai-poc \
        --artifact inventory-api \
        --out /tmp/g3-e2e-results.json
"""

import argparse
import json
import os
import select
import subprocess
import sys
import time
import urllib.request
import urllib.error
from typing import Any


# ---------------------------------------------------------------------------
# MCP stdio client (same core as g3-mcp-direct-test.py)
# ---------------------------------------------------------------------------

class McpStdioClient:
    MAX_TOOL_CALLS = 4  # per plan section 8

    def __init__(self, jar_path: str, registry_url: str):
        self.jar_path = jar_path
        self.registry_url = registry_url
        self._seq = 0
        self._proc: subprocess.Popen | None = None

    def _next_id(self) -> int:
        self._seq += 1
        return self._seq

    def start(self) -> None:
        java_home = os.environ.get("JAVA_HOME", "")
        java_bin = os.path.join(java_home, "bin", "java") if java_home else "java"
        cmd = [
            java_bin,
            f"-Dregistry.url={self.registry_url}",
            "-Dquarkus.oidc.tenant-enabled=false",
            "-Dquarkus.log.level=WARN",
            "-jar", self.jar_path,
        ]
        self._proc = subprocess.Popen(
            cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=False,
        )
        time.sleep(5)
        if self._proc.poll() is not None:
            err = self._proc.stderr.read().decode(errors="replace")
            raise RuntimeError(f"MCP process exited early:\n{err}")

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

    def _recv(self, timeout: float = 20.0) -> dict:
        start = time.monotonic()
        buf = b""
        while True:
            if time.monotonic() - start > timeout:
                raise TimeoutError(f"No MCP response after {timeout}s")
            rlist, _, _ = select.select([self._proc.stdout], [], [], 0.2)
            if rlist:
                chunk = self._proc.stdout.read1(4096)  # type: ignore[attr-defined]
                if not chunk:
                    raise EOFError("MCP stdout closed")
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    line = line.strip()
                    if line:
                        return json.loads(line)

    def call(self, method: str, params: dict | None = None, timeout: float = 30.0) -> dict:
        msg = {"jsonrpc": "2.0", "id": self._next_id(), "method": method}
        if params is not None:
            msg["params"] = params
        self._send(msg)
        return self._recv(timeout=timeout)

    def notify(self, method: str, params: dict | None = None) -> None:
        msg = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        self._send(msg)

    def execute_tool(self, name: str, arguments: dict, timeout: float = 30.0) -> str:
        resp = self.call("tools/call", {"name": name, "arguments": arguments}, timeout=timeout)
        if "result" in resp:
            items = resp["result"].get("content", [])
            return "\n".join(c.get("text", "") for c in items if c.get("type") == "text")
        elif "error" in resp:
            return f"ERROR: {resp['error']}"
        return f"UNEXPECTED: {resp}"


# ---------------------------------------------------------------------------
# OpenAI-compatible LLM client (Ollama /v1)
# ---------------------------------------------------------------------------

def chat_completion(base_url: str, model: str, messages: list[dict],
                    tools: list[dict] | None = None,
                    temperature: float = 0.1,
                    max_tokens: int = 2048,
                    timeout: float = 120.0) -> dict:
    url = base_url.rstrip("/") + "/chat/completions"
    body = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"

    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    start = time.monotonic()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode()
        elapsed = time.monotonic() - start
    result = json.loads(raw)
    result["_elapsed_s"] = round(elapsed, 2)
    return result


# ---------------------------------------------------------------------------
# Build MCP tools list for the LLM (allowlist: read + validate only)
# ---------------------------------------------------------------------------

ALLOWED_TOOLS = {"get_version_content", "test_schema_rules"}


def build_openai_tools(mcp_tools: list[dict]) -> list[dict]:
    """Convert MCP tools/list response to OpenAI tool format, allowlist only."""
    result = []
    for t in mcp_tools:
        if t["name"] not in ALLOWED_TOOLS:
            continue
        props = {}
        required = []
        for param in t.get("inputSchema", {}).get("properties", {}).items():
            pname, pdef = param
            props[pname] = {"type": pdef.get("type", "string"), "description": pdef.get("description", "")}
        for r in t.get("inputSchema", {}).get("required", []):
            required.append(r)
        result.append({
            "type": "function",
            "function": {
                "name": t["name"],
                "description": t["description"],
                "parameters": {
                    "type": "object",
                    "properties": props,
                    "required": required,
                }
            }
        })
    return result


# ---------------------------------------------------------------------------
# Agentic loop: LLM + MCP tool execution
# ---------------------------------------------------------------------------

def run_agent_loop(llm_url: str, model: str, mcp: McpStdioClient,
                   openai_tools: list[dict], system_prompt: str,
                   user_message: str, max_tool_calls: int = 4) -> dict:
    """
    Run the agentic loop:
    - Send system + user message to LLM.
    - Execute tool_calls requested by LLM against MCP stdio.
    - Continue until finish_reason == 'stop' or tool call limit reached.
    Returns a dict with the full trace.
    """
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]
    trace = []
    tool_call_count = 0
    final_answer = None

    for iteration in range(max_tool_calls + 2):
        print(f"\n  [LLM call #{iteration + 1}]")
        t0 = time.monotonic()
        resp = chat_completion(llm_url, model, messages, tools=openai_tools)
        elapsed = time.monotonic() - t0
        print(f"    finish_reason={resp['choices'][0]['finish_reason']} elapsed={elapsed:.1f}s")

        choice = resp["choices"][0]
        msg = choice["message"]
        finish = choice["finish_reason"]

        # Record in trace
        trace.append({
            "iteration": iteration + 1,
            "finish_reason": finish,
            "elapsed_s": elapsed,
            "content": msg.get("content"),
            "tool_calls": msg.get("tool_calls"),
        })

        # Add assistant message to context
        messages.append({"role": "assistant", **{k: v for k, v in msg.items()}})

        if finish == "stop":
            final_answer = msg.get("content") or ""
            # If the model stopped without calling test_schema_rules and there's still
            # room for more tool calls, nudge it to complete STEP 3.
            validate_done = any(
                tr.get("tool_name") == "test_schema_rules"
                for t in trace for tr in t.get("tool_results", [])
            )
            read_done = any(
                tr.get("tool_name") == "get_version_content"
                for t in trace for tr in t.get("tool_results", [])
            )
            if read_done and not validate_done and tool_call_count < max_tool_calls:
                print("    Model stopped early — nudging to call test_schema_rules (STEP 3)")
                messages.append({
                    "role": "user",
                    "content": (
                        "You have read the schema but have NOT yet called test_schema_rules. "
                        "STEP 3 is MANDATORY: call test_schema_rules with the full proposed OpenAPI JSON now. "
                        "After the validation result is returned, write your final answer."
                    )
                })
                continue  # re-run loop
            break

        if finish == "tool_calls" and msg.get("tool_calls"):
            for tc in msg["tool_calls"]:
                if tool_call_count >= max_tool_calls:
                    print(f"    WARN: tool call limit ({max_tool_calls}) reached, stopping")
                    final_answer = msg.get("content", "")
                    break

                fn = tc["function"]
                tool_name = fn["name"]

                # Allowlist enforcement at client level
                if tool_name not in ALLOWED_TOOLS:
                    result_text = f"ERROR: tool '{tool_name}' is not in the allowed list: {sorted(ALLOWED_TOOLS)}"
                    print(f"    BLOCKED tool call: {tool_name}")
                else:
                    try:
                        args = json.loads(fn["arguments"])
                    except json.JSONDecodeError:
                        args = {}
                    # Fix: model sometimes passes versionContent as a JSON object
                    # instead of a string. Serialize it so MCP can accept it.
                    if tool_name == "test_schema_rules" and isinstance(args.get("versionContent"), dict):
                        print(f"    AUTO-SERIALIZE: versionContent was object, converting to JSON string")
                        args["versionContent"] = json.dumps(args["versionContent"])
                    print(f"    EXECUTING: {tool_name}({json.dumps(args)[:120]})")
                    t1 = time.monotonic()
                    result_text = mcp.execute_tool(tool_name, args)
                    tool_elapsed = time.monotonic() - t1
                    print(f"    RESULT ({tool_elapsed:.1f}s): {result_text[:200]}")
                    tool_call_count += 1

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": result_text,
                })
                trace[-1].setdefault("tool_results", []).append({
                    "tool_name": tool_name,
                    "args": fn.get("arguments"),
                    "result_preview": result_text[:300],
                })

            if tool_call_count >= max_tool_calls and finish != "stop":
                # Force a final response with no more tools
                print("    Requesting final answer (tool limit reached)")
                messages.append({
                    "role": "user",
                    "content": "Tool call limit reached. Please provide your final answer now, including the proposed OpenAPI content and the validation result."
                })
        else:
            # Unexpected finish_reason
            final_answer = msg.get("content", "")
            break

    return {
        "trace": trace,
        "final_answer": final_answer,
        "tool_call_count": tool_call_count,
        "messages_count": len(messages),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are an API design assistant for Apicurio Registry.
You have access to exactly two tools:
- get_version_content: reads the raw content of an artifact version from the Registry.
- test_schema_rules: validates a candidate schema against Registry rules (does NOT create a new version).

You MUST follow this exact sequence — no shortcuts:

STEP 1: Call get_version_content to read the current API schema.
STEP 2: Build a complete new OpenAPI 3.0.3 JSON document adding limit and offset pagination to GET /items.
STEP 3: Call test_schema_rules with the FULL proposed JSON document to validate it. This step is MANDATORY.
STEP 4: Write your final answer including the full proposed JSON and the validation result.

You MUST call BOTH tools. Do not stop after STEP 1. You MUST call test_schema_rules (STEP 3) before writing your final answer.

Rules:
- Do NOT call create_version or any write tool.
- In your final reply state: "Validation result: PASS" or "Validation result: FAIL: <reason>".
- Include the complete proposed OpenAPI JSON in a ```json block.
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--jar", required=True)
    parser.add_argument("--registry-url", default="http://localhost:8080")
    parser.add_argument("--llm-url", default="http://127.0.0.1:11434/v1")
    parser.add_argument("--model", default="granite4:latest")
    parser.add_argument("--group", default="ai-poc")
    parser.add_argument("--artifact", default="inventory-api")
    parser.add_argument("--out", default="/tmp/g3-e2e-results.json")
    args = parser.parse_args()

    print(f"=== G3 End-to-End Test ===")
    print(f"JAR:          {args.jar}")
    print(f"Registry:     {args.registry_url}")
    print(f"LLM:          {args.llm_url} model={args.model}")
    print(f"Target:       {args.group}/{args.artifact}")

    # Verify Ollama is reachable
    try:
        req = urllib.request.Request(args.llm_url.rstrip("/") + "/models")
        with urllib.request.urlopen(req, timeout=5) as r:
            models_resp = json.loads(r.read())
        available_models = [m["id"] for m in models_resp.get("data", [])]
        print(f"LLM models available: {available_models}")
        if args.model not in available_models:
            print(f"WARNING: model {args.model} not found in {available_models}")
    except Exception as e:
        print(f"ERROR: cannot reach LLM at {args.llm_url}: {e}")
        sys.exit(1)

    # Get version count baseline
    req = urllib.request.Request(
        f"{args.registry_url}/apis/registry/v3/groups/{args.group}/artifacts/{args.artifact}/versions"
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        versions_before = json.loads(r.read())
    version_count_before = versions_before.get("count", 0)
    print(f"Version count before: {version_count_before}")

    # Start MCP
    mcp = McpStdioClient(args.jar, args.registry_url)
    print("\nStarting MCP stdio process...")
    mcp.start()

    result = {}
    try:
        # Initialize MCP
        init_resp = mcp.call("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "g3-e2e", "version": "1.0"},
        })
        mcp.notify("notifications/initialized")
        print(f"MCP initialized: {init_resp['result']['serverInfo']['name']}")

        # Get tool list and build OpenAI tool defs (allowlist only)
        tools_resp = mcp.call("tools/list")
        mcp_tools = tools_resp["result"]["tools"]
        openai_tools = build_openai_tools(mcp_tools)
        print(f"Allowed tools exposed to LLM: {[t['function']['name'] for t in openai_tools]}")

        user_message = (
            f"Read the artifact '{args.artifact}' in group '{args.group}', version '1'. "
            "Identify the pagination pattern (if any). "
            f"Propose a new version of the OpenAPI document that adds `limit` (integer, min=1, default=20) "
            f"and `offset` (integer, min=0, default=0) query parameters to GET /items. "
            f"After building the proposal, validate it using test_schema_rules for group='{args.group}' "
            f"artifact='{args.artifact}'. Report the validation result and the full proposed JSON."
        )

        print("\n--- Starting agentic loop ---")
        t_start = time.monotonic()
        agent_result = run_agent_loop(
            llm_url=args.llm_url,
            model=args.model,
            mcp=mcp,
            openai_tools=openai_tools,
            system_prompt=SYSTEM_PROMPT,
            user_message=user_message,
            max_tool_calls=McpStdioClient.MAX_TOOL_CALLS,
        )
        total_elapsed = time.monotonic() - t_start
        print(f"\n--- Agentic loop complete in {total_elapsed:.1f}s ---")
        print(f"Tool calls executed: {agent_result['tool_call_count']}")

    except Exception as e:
        import traceback
        agent_result = {"error": str(e), "traceback": traceback.format_exc()}
        print(f"ERROR in agent loop: {e}")
    finally:
        mcp.stop()

    # Verify version count unchanged
    req = urllib.request.Request(
        f"{args.registry_url}/apis/registry/v3/groups/{args.group}/artifacts/{args.artifact}/versions"
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        versions_after = json.loads(r.read())
    version_count_after = versions_after.get("count", 0)
    print(f"\nVersion count after: {version_count_after}")

    # Gate G3 evaluation
    trace = agent_result.get("trace", [])
    read_calls = []
    validate_calls = []
    for t in trace:
        for tr in t.get("tool_results", []):
            if tr["tool_name"] == "get_version_content":
                read_calls.append(tr)
            if tr["tool_name"] == "test_schema_rules":
                validate_calls.append(tr)

    gate_read = len(read_calls) >= 1
    gate_validate = len(validate_calls) >= 1
    gate_no_new_versions = version_count_after == version_count_before
    gate_pass = gate_read and gate_validate and gate_no_new_versions

    print("\n=== Gate G3 Evaluation ===")
    print(f"  Read tool call executed:       {'PASS' if gate_read else 'FAIL'} ({len(read_calls)} calls)")
    print(f"  Validation executed:           {'PASS' if gate_validate else 'FAIL'} ({len(validate_calls)} calls)")
    print(f"  Version count unchanged:       {'PASS' if gate_no_new_versions else 'FAIL'} ({version_count_before} → {version_count_after})")
    print(f"\n  GATE G3: {'PASS ✅' if gate_pass else 'FAIL ❌'}")

    if agent_result.get("final_answer"):
        print("\n--- Final answer preview (first 600 chars) ---")
        print(agent_result["final_answer"][:600])

    report = {
        "test": "G3 End-to-End Test",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "registry_url": args.registry_url,
        "llm_url": args.llm_url,
        "model": args.model,
        "group": args.group,
        "artifact": args.artifact,
        "version_count_before": version_count_before,
        "version_count_after": version_count_after,
        "gate_g3": {
            "read_tool_calls": len(read_calls),
            "validate_tool_calls": len(validate_calls),
            "version_count_unchanged": gate_no_new_versions,
            "pass": gate_pass,
        },
        "agent": agent_result,
    }

    with open(args.out, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nFull trace saved to {args.out}")

    sys.exit(0 if gate_pass else 1)


if __name__ == "__main__":
    main()
