#!/usr/bin/env python3
"""
G2 Model Validation Script — OpenAPI 3.0.3 Generation & Tool Calling Benchmark
PoC: AleStranieri/apicurio-registry, branch poc/openapi-ai-assistant
Gate: G2 — Local LLM inference validation with Apple Metal acceleration

Usage:
  python3 scripts/g2-validate-model.py \
    --base-url http://localhost:11434/v1 \
    --model granite4:latest \
    --runs 10 \
    --out /tmp/g2-results.json

Requirements: python3 stdlib only (urllib, json, time, subprocess)
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

FIXTURE_DIR = Path(__file__).parent.parent / "fixtures"
SCRIPTS_DIR = Path(__file__).parent

# ─── Prompts ──────────────────────────────────────────────────────────────────

SYSTEM_OPENAPI = (
    "You are an expert API designer. "
    "When asked to produce an OpenAPI document, respond ONLY with valid JSON "
    "conforming to OpenAPI Specification 3.0.3. "
    "Do NOT include any markdown code fences, explanation, or prose — only the raw JSON object."
)

# C1 v1: compact inline prompt (baseline — used in first 5 runs)
PROMPT_C1_V1 = (
    "Create a minimal OpenAPI 3.0.3 document for a Pet Store API. "
    "Include: GET /pets (list all pets), POST /pets (create pet), "
    "GET /pets/{id} (get by ID, id is required path parameter). "
    "Define a Pet schema with required fields: id (string), name (string), status (string, enum: available,sold). "
    "Use response codes: 200 for list/get, 201 for create, 400 for invalid input, 404 for not found. "
    "info.title must be exactly 'Pet Store API', info.version must be '1.0.0'. "
    "Return ONLY the JSON, no markdown, no prose."
)

# C1 v2: explicit bulleted requirements (used in runs 6-10 to test prompt sensitivity)
PROMPT_C1_V2 = (
    'Create a minimal OpenAPI 3.0.3 document for a Pet Store API.\n'
    'Requirements:\n'
    '- info.title: exactly "Pet Store API"\n'
    '- info.version: exactly "1.0.0"\n'
    '- Paths:\n'
    '  - GET /pets: list all pets, response 200 (array of Pet schema)\n'
    '  - POST /pets: create pet, responses 201 (created Pet) AND 400 (invalid input)\n'
    '  - GET /pets/{id}: get by ID, responses 200 (Pet) AND 404 (not found)\n'
    '- Path parameter: {id} in GET /pets/{id} must have name=id, in=path, required=true\n'
    '- Pet schema (in components.schemas.Pet): required fields id (string), name (string), '
    'status (string, enum: [available, sold])\n'
    'Return ONLY the raw JSON object. No markdown, no explanation.'
)

PROMPT_C1 = PROMPT_C1_V2  # default (best performing variant)

PROMPT_M1 = """Here is an existing OpenAPI 3.0.3 document:

{existing_doc}

Add pagination to GET /items only. Add query parameters:
- limit: integer, minimum 1, maximum 100, default 20
- offset: integer, minimum 0, default 0
Do NOT change any other paths, methods, or schemas.
Return ONLY the complete updated JSON document, no markdown, no prose."""

# ─── Tool Definitions (function calling) ──────────────────────────────────────

TOOLS_VALIDATE = [
    {
        "type": "function",
        "function": {
            "name": "validate_openapi_schema",
            "description": (
                "Validates an OpenAPI 3.0.x document and returns a list of errors. "
                "Returns an empty list if the document is valid."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "document": {
                        "type": "string",
                        "description": "The OpenAPI document as a JSON string."
                    },
                    "version": {
                        "type": "string",
                        "enum": ["3.0.3", "3.1.0"],
                        "description": "The OpenAPI specification version to validate against."
                    }
                },
                "required": ["document", "version"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_schema_rules",
            "description": "Returns the registry validation rules for a given artifact group and ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "group_id": {
                        "type": "string",
                        "description": "The artifact group ID in the registry."
                    },
                    "artifact_id": {
                        "type": "string",
                        "description": "The artifact ID in the registry."
                    }
                },
                "required": ["group_id", "artifact_id"]
            }
        }
    }
]

PROMPT_TOOL_CALL = (
    "I need to validate the inventory API schema for the artifact group 'poc-g2' "
    "and artifact ID 'inventory-api'. "
    "First call get_schema_rules to retrieve the rules, then call validate_openapi_schema "
    "with the following document as JSON string and version '3.0.3':\n"
    '{"openapi":"3.0.3","info":{"title":"Test","version":"1.0.0"},"paths":{}}'
)

# ─── OpenAPI Assertions ────────────────────────────────────────────────────────

def assert_openapi_c1(doc: dict) -> list[str]:
    """Return list of assertion failures for C1 (Pet Store)."""
    errors = []
    if doc.get("openapi") != "3.0.3":
        errors.append(f"openapi version: expected '3.0.3', got '{doc.get('openapi')}'")
    info = doc.get("info", {})
    if info.get("title") != "Pet Store API":
        errors.append(f"info.title: expected 'Pet Store API', got '{info.get('title')}'")
    if info.get("version") != "1.0.0":
        errors.append(f"info.version: expected '1.0.0', got '{info.get('version')}'")

    paths = doc.get("paths", {})
    if "/pets" not in paths:
        errors.append("missing path: /pets")
    else:
        pets = paths["/pets"]
        if "get" not in pets:
            errors.append("missing operation: GET /pets")
        if "post" not in pets:
            errors.append("missing operation: POST /pets")

    if "/pets/{id}" not in paths:
        errors.append("missing path: /pets/{id}")
    else:
        pet_id = paths["/pets/{id}"]
        if "get" not in pet_id:
            errors.append("missing operation: GET /pets/{id}")
        else:
            params = pet_id["get"].get("parameters", [])
            path_params = [p for p in params if p.get("in") == "path" and p.get("name") == "id"]
            if not path_params:
                errors.append("GET /pets/{id}: missing required path parameter 'id'")
            elif not path_params[0].get("required"):
                errors.append("GET /pets/{id}: path parameter 'id' must be required:true")

    schemas = doc.get("components", {}).get("schemas", {})
    pet_schemas = [s for name, s in schemas.items() if "pet" in name.lower()]
    if not pet_schemas:
        errors.append("components.schemas: no Pet schema found")
    else:
        pet = pet_schemas[0]
        props = pet.get("properties", {})
        required = pet.get("required", [])
        for field in ["id", "name", "status"]:
            if field not in props:
                errors.append(f"Pet schema: missing property '{field}'")
            if field not in required:
                errors.append(f"Pet schema: property '{field}' not in required[]")
        if "status" in props:
            status_schema = props["status"]
            if status_schema.get("type") != "string":
                errors.append(f"Pet.status: expected type string, got '{status_schema.get('type')}'")
            enum_vals = status_schema.get("enum", [])
            if "available" not in enum_vals or "sold" not in enum_vals:
                errors.append(f"Pet.status: enum missing 'available' or 'sold', got {enum_vals}")

    return errors


def assert_response_codes_c1(doc: dict) -> list[str]:
    """Check that required response codes are present."""
    errors = []
    paths = doc.get("paths", {})

    # GET /pets → 200
    get_pets = paths.get("/pets", {}).get("get", {})
    if "200" not in get_pets.get("responses", {}):
        errors.append("GET /pets: missing response 200")

    # POST /pets → 201, 400
    post_pets = paths.get("/pets", {}).get("post", {})
    for code in ["201", "400"]:
        if code not in post_pets.get("responses", {}):
            errors.append(f"POST /pets: missing response {code}")

    # GET /pets/{id} → 200, 404
    get_pet_id = paths.get("/pets/{id}", {}).get("get", {})
    for code in ["200", "404"]:
        if code not in get_pet_id.get("responses", {}):
            errors.append(f"GET /pets/{{id}}: missing response {code}")

    return errors


# ─── HTTP Helper ──────────────────────────────────────────────────────────────

def chat_completion(base_url: str, model: str, messages: list, tools=None,
                    temperature=0.1, max_tokens=2048, timeout=120) -> dict:
    """Call /v1/chat/completions and return the raw response dict."""
    url = base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_memory_mb() -> dict:
    """Return host memory stats in MiB (macOS vm_stat + sysctl)."""
    result = {}
    try:
        vm = subprocess.check_output(["vm_stat"], text=True)
        import re
        pages = {}
        for line in vm.splitlines():
            m = re.match(r"^(.+?):\s+(\d+)", line)
            if m:
                pages[m.group(1).strip()] = int(m.group(2))
        page_bytes = 16384
        result["free_mib"] = round(pages.get("Pages free", 0) * page_bytes / (1024**2))
        result["inactive_mib"] = round(pages.get("Pages inactive", 0) * page_bytes / (1024**2))
        result["wired_mib"] = round(pages.get("Pages wired down", 0) * page_bytes / (1024**2))
        result["compressed_stored_mib"] = round(
            pages.get("Pages stored in compressor", 0) * page_bytes / (1024**2)
        )
        result["compressor_actual_mib"] = round(
            pages.get("Pages occupied by compressor", 0) * page_bytes / (1024**2)
        )
        result["available_mib"] = result["free_mib"] + result["inactive_mib"]
    except Exception as e:
        result["error"] = str(e)

    # memory_pressure tool
    try:
        mp = subprocess.check_output(["memory_pressure"], text=True, timeout=5)
        for line in mp.splitlines():
            if "System Memory Pressure" in line:
                result["pressure_level"] = line.strip()
                break
    except Exception:
        pass

    return result


# ─── Tests ────────────────────────────────────────────────────────────────────

def run_c1_test(base_url: str, model: str, run_idx: int, total_runs: int = 10) -> dict:
    """C1: Create Pet Store API — OpenAPI 3.0.3 generation.

    First half of runs uses PROMPT_C1_V1 (compact baseline),
    second half uses PROMPT_C1_V2 (explicit bulleted requirements).
    This documents prompt sensitivity in the G2 report.
    """
    # Split: v1 for first half, v2 for second half
    prompt_variant = "v1" if run_idx <= total_runs // 2 else "v2"
    prompt_text = PROMPT_C1_V1 if prompt_variant == "v1" else PROMPT_C1_V2

    mem_before = get_memory_mb()
    t_start = time.monotonic()

    result = {
        "test": "C1",
        "run": run_idx,
        "prompt_variant": prompt_variant,
        "model": model,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pass": False,
        "parse_ok": False,
        "schema_errors": [],
        "response_code_errors": [],
        "latency_s": None,
        "prompt_tokens": None,
        "completion_tokens": None,
        "tokens_per_sec": None,
        "mem_before_mib": mem_before,
        "mem_after_mib": None,
        "raw_content": None,
        "error": None,
    }

    try:
        messages = [
            {"role": "system", "content": SYSTEM_OPENAPI},
            {"role": "user", "content": prompt_text},
        ]
        resp = chat_completion(base_url, model, messages, temperature=0.1, max_tokens=2048)
        t_end = time.monotonic()
        result["latency_s"] = round(t_end - t_start, 3)

        usage = resp.get("usage", {})
        result["prompt_tokens"] = usage.get("prompt_tokens")
        result["completion_tokens"] = usage.get("completion_tokens")
        if result["completion_tokens"] and result["latency_s"]:
            result["tokens_per_sec"] = round(result["completion_tokens"] / result["latency_s"], 1)

        content = resp["choices"][0]["message"]["content"]
        result["raw_content"] = content[:500]  # truncated for log

        # Strip potential markdown fences
        content_clean = content.strip()
        if content_clean.startswith("```"):
            lines = content_clean.splitlines()
            content_clean = "\n".join(
                l for l in lines if not l.startswith("```")
            ).strip()

        # Parse JSON
        try:
            doc = json.loads(content_clean)
            result["parse_ok"] = True
        except json.JSONDecodeError as e:
            result["parse_ok"] = False
            result["error"] = f"JSON parse error: {e}"
            result["mem_after_mib"] = get_memory_mb()
            return result

        # Run assertions
        schema_errs = assert_openapi_c1(doc)
        code_errs = assert_response_codes_c1(doc)
        result["schema_errors"] = schema_errs
        result["response_code_errors"] = code_errs
        result["pass"] = (len(schema_errs) == 0 and len(code_errs) == 0)

    except urllib.error.URLError as e:
        result["error"] = f"HTTP error: {e}"
        t_end = time.monotonic()
        result["latency_s"] = round(t_end - t_start, 3)
    except Exception as e:
        result["error"] = f"Unexpected: {type(e).__name__}: {e}"
        t_end = time.monotonic()
        result["latency_s"] = round(t_end - t_start, 3)

    result["mem_after_mib"] = get_memory_mb()
    return result


def run_tool_call_test(base_url: str, model: str, run_idx: int) -> dict:
    """Tool calling test: verify model produces valid tool_calls."""
    mem_before = get_memory_mb()
    t_start = time.monotonic()

    result = {
        "test": "TOOL_CALL",
        "run": run_idx,
        "model": model,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pass": False,
        "tool_calls_present": False,
        "tool_calls": [],
        "first_tool_name": None,
        "first_tool_args_valid": False,
        "latency_s": None,
        "prompt_tokens": None,
        "completion_tokens": None,
        "tokens_per_sec": None,
        "mem_before_mib": mem_before,
        "mem_after_mib": None,
        "error": None,
    }

    try:
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a helpful assistant. "
                    "Use the provided tools to help users validate their API schemas. "
                    "Always use tools when appropriate — never refuse to call them."
                )
            },
            {"role": "user", "content": PROMPT_TOOL_CALL},
        ]
        resp = chat_completion(base_url, model, messages, tools=TOOLS_VALIDATE,
                               temperature=0.1, max_tokens=1024)
        t_end = time.monotonic()
        result["latency_s"] = round(t_end - t_start, 3)

        usage = resp.get("usage", {})
        result["prompt_tokens"] = usage.get("prompt_tokens")
        result["completion_tokens"] = usage.get("completion_tokens")
        if result["completion_tokens"] and result["latency_s"]:
            result["tokens_per_sec"] = round(result["completion_tokens"] / result["latency_s"], 1)

        choice = resp["choices"][0]
        msg = choice.get("message", {})
        finish_reason = choice.get("finish_reason", "")

        tool_calls = msg.get("tool_calls", [])
        result["tool_calls_present"] = bool(tool_calls)
        result["finish_reason"] = finish_reason

        parsed_calls = []
        for tc in tool_calls:
            fn = tc.get("function", {})
            name = fn.get("name")
            try:
                args = json.loads(fn.get("arguments", "{}"))
                args_valid = True
            except json.JSONDecodeError:
                args = {}
                args_valid = False
            parsed_calls.append({
                "id": tc.get("id"),
                "name": name,
                "arguments": args,
                "args_valid_json": args_valid,
            })

        result["tool_calls"] = parsed_calls

        if parsed_calls:
            first = parsed_calls[0]
            result["first_tool_name"] = first["name"]
            # Check expected tools are called
            called_names = {c["name"] for c in parsed_calls}
            expected_tools = {"get_schema_rules", "validate_openapi_schema"}
            if first["name"] in expected_tools and first["args_valid_json"]:
                result["first_tool_args_valid"] = True

            # Pass: at least one expected tool called with valid JSON args
            result["pass"] = bool(
                called_names & expected_tools
                and all(c["args_valid_json"] for c in parsed_calls)
            )
        else:
            result["pass"] = False
            result["error"] = f"No tool_calls in response (finish_reason={finish_reason})"
            # Check if model described the calls in text (not a real tool call)
            content = msg.get("content", "")
            if content and ("validate_openapi_schema" in content or "get_schema_rules" in content):
                result["error"] += " — model described tool call in text instead of executing it"

    except urllib.error.URLError as e:
        result["error"] = f"HTTP error: {e}"
        t_end = time.monotonic()
        result["latency_s"] = round(t_end - t_start, 3)
    except Exception as e:
        result["error"] = f"Unexpected: {type(e).__name__}: {e}"
        t_end = time.monotonic()
        result["latency_s"] = round(t_end - t_start, 3)

    result["mem_after_mib"] = get_memory_mb()
    return result


def check_model_ready(base_url: str, model: str, timeout: int = 30) -> bool:
    """Verify the inference endpoint and model are available."""
    url = base_url.rstrip("/") + "/models"
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            req = urllib.request.Request(url, method="GET")
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read())
                models = [m["id"] for m in data.get("data", [])]
                # Accept model with or without tag
                model_base = model.split(":")[0]
                if any(model_base in m for m in models):
                    return True
                # Retry — model may be loading
        except Exception:
            pass
        time.sleep(2)
    return False


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="G2 Model Validation")
    parser.add_argument("--base-url", default="http://localhost:11434/v1",
                        help="OpenAI-compatible base URL")
    parser.add_argument("--model", default="granite4:latest",
                        help="Model name/tag to test")
    parser.add_argument("--runs", type=int, default=10,
                        help="Number of C1 runs (tool call runs = runs//2)")
    parser.add_argument("--out", default="/tmp/g2-results.json",
                        help="Output file for JSON results")
    parser.add_argument("--timeout", type=int, default=120,
                        help="Per-request timeout in seconds")
    args = parser.parse_args()

    print(f"[G2] Target: {args.base_url} | Model: {args.model} | Runs: {args.runs}")
    print(f"[G2] Checking model availability...")

    if not check_model_ready(args.base_url, args.model, timeout=30):
        print(f"[G2] ERROR: Model {args.model} not available at {args.base_url}")
        sys.exit(1)

    print(f"[G2] Model ready. Starting validation runs...")

    all_results = []
    mem_baseline = get_memory_mb()
    print(f"[G2] Memory baseline: available={mem_baseline.get('available_mib')} MiB, "
          f"compressed_stored={mem_baseline.get('compressed_stored_mib')} MiB")

    # C1 runs: first half uses PROMPT_C1_V1, second half uses PROMPT_C1_V2
    c1_pass = 0
    c1_v1_pass = 0
    c1_v2_pass = 0
    for i in range(1, args.runs + 1):
        variant = "v1" if i <= args.runs // 2 else "v2"
        print(f"[G2] C1 run {i}/{args.runs} [{variant}]...", end="", flush=True)
        res = run_c1_test(args.base_url, args.model, i, total_runs=args.runs)
        status = "PASS" if res["pass"] else f"FAIL({res.get('error') or ','.join((res['schema_errors'] + res['response_code_errors'])[:2])})"
        tps = f"{res['tokens_per_sec']} tok/s" if res["tokens_per_sec"] else "n/a"
        print(f" {status} | {res['latency_s']}s | {tps}")
        if res["pass"]:
            c1_pass += 1
            if variant == "v1":
                c1_v1_pass += 1
            else:
                c1_v2_pass += 1
        all_results.append(res)

    # Tool call runs (half the count, min 3)
    tc_runs = max(3, args.runs // 2)
    tc_pass = 0
    for i in range(1, tc_runs + 1):
        print(f"[G2] TOOL_CALL run {i}/{tc_runs}...", end="", flush=True)
        res = run_tool_call_test(args.base_url, args.model, i)
        status = "PASS" if res["pass"] else f"FAIL({res.get('error', '')[:60]})"
        tps = f"{res['tokens_per_sec']} tok/s" if res["tokens_per_sec"] else "n/a"
        print(f" {status} | {res['latency_s']}s | {tps}")
        if res["pass"]:
            tc_pass += 1
        all_results.append(res)

    # Summary
    c1_results = [r for r in all_results if r["test"] == "C1"]
    tc_results = [r for r in all_results if r["test"] == "TOOL_CALL"]

    def stats(results, key):
        vals = [r[key] for r in results if r.get(key) is not None]
        if not vals:
            return {}
        return {
            "min": round(min(vals), 3),
            "max": round(max(vals), 3),
            "avg": round(sum(vals) / len(vals), 3),
            "count": len(vals),
        }

    mem_final = get_memory_mb()

    c1_v1_results = [r for r in c1_results if r.get("prompt_variant") == "v1"]
    c1_v2_results = [r for r in c1_results if r.get("prompt_variant") == "v2"]
    half = args.runs // 2

    summary = {
        "gate": "G2",
        "model": args.model,
        "base_url": args.base_url,
        "ollama_version": "0.40.9",
        "backend": "Metal (Apple M1 Pro)",
        "timestamp_start": all_results[0]["timestamp"] if all_results else None,
        "timestamp_end": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "c1": {
            "runs": args.runs,
            "pass": c1_pass,
            "fail": args.runs - c1_pass,
            "pass_rate": f"{c1_pass}/{args.runs}",
            "v1_pass_rate": f"{c1_v1_pass}/{half}",
            "v2_pass_rate": f"{c1_v2_pass}/{args.runs - half}",
            "latency_s": stats(c1_results, "latency_s"),
            "tokens_per_sec": stats(c1_results, "tokens_per_sec"),
        },
        "tool_call": {
            "runs": tc_runs,
            "pass": tc_pass,
            "fail": tc_runs - tc_pass,
            "pass_rate": f"{tc_pass}/{tc_runs}",
            "latency_s": stats(tc_results, "latency_s"),
            "tokens_per_sec": stats(tc_results, "tokens_per_sec"),
        },
        "memory": {
            "baseline_available_mib": mem_baseline.get("available_mib"),
            "final_available_mib": mem_final.get("available_mib"),
            "final_compressed_stored_mib": mem_final.get("compressed_stored_mib"),
            "final_compressor_actual_mib": mem_final.get("compressor_actual_mib"),
            "pressure_level": mem_final.get("pressure_level"),
        },
        # Gate criterion: v2 prompt (production variant) must pass ≥ 4/5;
        # tool calling must pass ≥ 4/5.
        # v1 is baseline documentation only.
        "gate_pass": (
            c1_v2_pass >= ((args.runs - half) * 4 // 5)
            and tc_pass >= (tc_runs * 4 // 5)
        ),
        "results": all_results,
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(summary, indent=2))

    print(f"\n[G2] ── Summary ──────────────────────────")
    print(f"  C1 v1 (compact prompt):  {c1_v1_pass}/{half} PASS")
    print(f"  C1 v2 (explicit prompt): {c1_v2_pass}/{args.runs - half} PASS")
    print(f"  Tool calling:            {tc_pass}/{tc_runs} PASS")
    print(f"  Memory available (final): {mem_final.get('available_mib')} MiB")
    print(f"  Compressed stored: {mem_final.get('compressed_stored_mib')} MiB")
    print(f"  Gate G2: {'PASS ✓' if summary['gate_pass'] else 'FAIL ✗'}")
    print(f"  Results: {out_path}")

    sys.exit(0 if summary["gate_pass"] else 1)


if __name__ == "__main__":
    main()
