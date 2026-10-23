// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantDraft, draftHash, OpenApiProposalClient, Proposal, ProposalState } from "./OpenApiProposalClient";

Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
afterEach(() => { vi.useRealTimers(); document.cookie = "csrf-token=; Max-Age=0; path=/"; });

const content = "{\"openapi\":\"3.0.3\",\"info\":{\"title\":\"Original\",\"version\":\"1\"},\"paths\":{}}";
const candidate = content.replace("Original", "Proposed");
function setup(endpoint = "/openapi-assistant/proposals") {
    let draft: AssistantDraft = { documentId: "ai-poc/inventory-api/1", revision: 7, content, contentType: "application/json" };
    let blocked = false;
    let state: ProposalState = { pending: false };
    const requests: { body: any; resolve: (r: Response) => void; signal: AbortSignal }[] = [];
    const transport = vi.fn((_url, init) => new Promise<Response>(resolve => {
        requests.push({ body: JSON.parse(init!.body as string), resolve, signal: init!.signal as AbortSignal });
    }));
    const client = new OpenApiProposalClient(endpoint, () => {
        if (blocked) { throw new Error("Source buffer"); }
        return draft;
    }, value => { state = value; }, transport as typeof fetch, 1000);
    const respond = (index = 0, overrides: Partial<Proposal> = {}) => {
        const r = requests[index];
        r.resolve({ ok: true, json: async () => ({ ...r.body.draft, requestId: r.body.requestId,
            status: "applicable", candidate, diff: [{ kind: "changed", path: "/info/title", before: "Original", after: "Proposed", schemaDifferences: [] }],
            diagnostics: [], ...overrides }) } as Response);
    };
    return { client, transport, requests, respond, state: () => state,
        change: (value: Partial<AssistantDraft>) => { draft = { ...draft, ...value }; },
        block: () => { blocked = true; } };
}
async function requestReady(s: ReturnType<typeof setup>, count = 1) {
    await vi.waitFor(() => expect(s.requests).toHaveLength(count));
}

describe("proposal lifecycle without a real model", () => {
    it("posts the exact current draft and SHA-256; applying writes only through the draft callback", async () => {
        const s = setup();
        s.change({ content: content.replace("Original", "Unsaved") });
        const sent = s.client.send("Change title", { groupId: "ai-poc", artifactId: "inventory-api", version: "1" });
        await requestReady(s);
        expect(s.requests[0].body).toMatchObject({ mode: "modify", instruction: "Change title", draft: {
            documentId: "ai-poc/inventory-api/1", revision: 7, content: content.replace("Original", "Unsaved"),
            contentType: "application/json", baseHash: await draftHash(content.replace("Original", "Unsaved")) } });
        s.respond(); await sent;
        const write = vi.fn(); await s.client.apply(write);
        expect(write).toHaveBeenCalledExactlyOnceWith(candidate);
        expect(s.transport).toHaveBeenCalledTimes(1);
        expect(s.state()).toEqual({ pending: false, error: undefined });
    });
    it("uses create for an empty draft and preserves YAML", async () => {
        const s = setup(); s.change({ content: "", contentType: "application/yaml" });
        const sent = s.client.send("Create"); await requestReady(s);
        expect(s.requests[0].body).toMatchObject({ mode: "create", draft: { content: "", contentType: "application/yaml",
            baseHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" } });
        s.respond(0, { candidate: "openapi: 3.0.3\n" }); await sent;
        const write = vi.fn(); await s.client.apply(write);
        expect(write).toHaveBeenCalledExactlyOnceWith("openapi: 3.0.3\n");
    });
    it("blocks before fetch when Source or a visual field is uncommitted", async () => {
        const s = setup(); s.block(); await s.client.send("Change");
        expect(s.transport).not.toHaveBeenCalled();
        expect(s.state().error).toContain("unavailable or obsolete");
    });
    it.each(["documentId", "revision", "baseHash", "requestId"] as const)("rejects mismatched response %s", async key => {
        const s = setup(); const sent = s.client.send("Change"); await requestReady(s);
        s.respond(0, { [key]: key === "revision" ? 9 : "wrong" }); await sent;
        expect(s.state().proposal).toBeUndefined();
        const write = vi.fn(); await s.client.apply(write); expect(write).not.toHaveBeenCalled();
    });
    it.each([{ content: content + " " }, { revision: 8 }, { documentId: "other" }, { contentType: "application/yaml" }])(
        "rejects a draft changed during inference: %j", async change => {
            const s = setup(); const sent = s.client.send("Change"); await requestReady(s);
            s.change(change); s.respond(); await sent;
            expect(s.state().error).toContain("obsolete"); expect(s.state().proposal).toBeUndefined();
        });
    it("rechecks the draft and unapplied buffers at Apply", async () => {
        const s = setup(); const sent = s.client.send("Change"); await requestReady(s); s.respond(); await sent;
        expect(s.state().proposal?.candidate).toBe(candidate);
        s.block(); const write = vi.fn(); await s.client.apply(write);
        expect(write).not.toHaveBeenCalled(); expect(s.state().error).toContain("Cannot apply");
    });
    it("rechecks revision at Apply even if content has returned to its earlier value", async () => {
        const s = setup(); const sent = s.client.send("Change"); await requestReady(s); s.respond(); await sent;
        s.change({ revision: 9 }); const write = vi.fn(); await s.client.apply(write);
        expect(write).not.toHaveBeenCalled(); expect(s.state().proposal).toBeUndefined();
    });
    it("prevents double sends and ignores stopped responses arriving after a newer request", async () => {
        const s = setup(); const first = s.client.send("First"); await requestReady(s);
        await s.client.send("Double click"); expect(s.transport).toHaveBeenCalledTimes(1);
        s.client.cancel(); expect(s.requests[0].signal.aborted).toBe(true);
        const second = s.client.send("Second"); await requestReady(s, 2);
        s.respond(1, { candidate: "new" }); await second;
        s.respond(0, { candidate: "late" }); await first;
        expect(s.state().proposal?.candidate).toBe("new");
        s.client.cancel();
    });
    it("times out and invalidates late responses even if fetch ignores abort", async () => {
        const s = setup(); const sent = s.client.send("Change"); await requestReady(s);
        vi.useFakeTimers(); // Schedule a fresh request under the virtual clock.
        s.client.cancel();
        const next = s.client.send("Retry"); await requestReady(s, 2);
        await vi.advanceTimersByTimeAsync(1000);
        expect(s.state()).toEqual({ pending: false, error: "Timed out. Server inference may still be running." });
        s.respond(1); s.respond(0); await Promise.all([sent, next]);
        expect(s.state().proposal).toBeUndefined(); expect(s.requests[1].signal.aborted).toBe(true);
    });
    it("rejects non-applicable candidates and discards proposals without writes", async () => {
        const s = setup(); const sent = s.client.send("Change"); await requestReady(s);
        s.respond(0, { status: "not_applicable", candidate: null,
            diagnostics: [{ code: "REGISTRY_RULES", path: "/", message: "Rejected", recoverable: false }] }); await sent;
        expect(s.state().proposal?.diagnostics[0].code).toBe("REGISTRY_RULES");
        const write = vi.fn(); await s.client.apply(write); s.client.cancel();
        expect(write).not.toHaveBeenCalled(); expect(s.state().proposal).toBeUndefined();
    });
    it("handles HTTP errors without exposing the response body", async () => {
        const s = setup(); const sent = s.client.send("Change"); await requestReady(s);
        s.requests[0].resolve({ ok: false, status: 500 } as Response); await sent;
        expect(s.state().error).toBe("Proposal unavailable or obsolete. Check the draft and retry.");
    });
    it("rejects cross-origin endpoints and oversized requests before sending content", async () => {
        const external = setup("https://example.invalid/proposals");
        await external.client.send("Change");
        expect(external.transport).not.toHaveBeenCalled();
        expect(external.state().error).toContain("unavailable");
        const oversized = setup();
        await oversized.client.send("x".repeat(65537));
        expect(oversized.transport).not.toHaveBeenCalled();
        expect(oversized.state().pending).toBe(false);
    });
    it("fails closed for malformed diagnostics instead of rendering an invalid panel", async () => {
        const s = setup(); const sent = s.client.send("Change"); await requestReady(s);
        s.respond(0, { diagnostics: [null] as unknown as Proposal["diagnostics"] }); await sent;
        expect(s.state().proposal).toBeUndefined(); expect(s.state().error).toContain("unavailable");
    });

    it("forwards console CSRF only through its same-origin service proxy", async () => {
        document.cookie = "csrf-token=synthetic-csrf; path=/";
        const s = setup("/api/proxy/plugin/apicurio-registry/registry-api/openapi-assistant/proposals");
        const sent = s.client.send("Change"); await requestReady(s);
        expect(s.transport.mock.calls[0][1]?.headers).toEqual({ "Content-Type": "application/json", "X-CSRFToken": "synthetic-csrf" });
        expect(s.transport.mock.calls[0][1]?.redirect).toBe("error");
        s.respond(); await sent; s.client.cancel();
    });

});
