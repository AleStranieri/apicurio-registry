// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OpenApiAiPanel } from "./OpenApiAiPanel";
import { AssistantDraft } from "./OpenApiProposalClient";

Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const draft: AssistantDraft = { documentId: "ai-poc/inventory-api/1", revision: 3,
    content: "{}", contentType: "application/json" };
function panel() {
    const apply = vi.fn(); const restore = vi.fn();
    const props = { endpoint: "/openapi-assistant/proposals", read: () => draft, apply, restore,
        canRestore: false, invalidation: 0 };
    return { ...render(<OpenApiAiPanel {...props} />), props, apply, restore };
}
function instruct() {
    fireEvent.change(screen.getByLabelText("Assistant instruction"), { target: { value: "Change title" } });
    fireEvent.click(screen.getByText("Propose"));
}
it("keeps the instruction through HTTP failure and allows a retry", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false }); vi.stubGlobal("fetch", fetch);
    panel(); instruct();
    await screen.findByText(/Proposal unavailable/);
    expect(screen.getByLabelText("Assistant instruction")).toHaveValue("Change title");
    fireEvent.click(screen.getByText("Propose"));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
});
it("shows semantic paths, schema diagnostics and candidate; Reject never applies", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        return { ok: true, json: async () => ({ ...body.draft, requestId: body.requestId,
            status: "applicable", candidate: "candidate text", diff: [{ kind: "changed", path: "/info/title",
                before: "Old", after: "New", schemaDifferences: [{ diffType: "TYPE_CHANGED", pathOriginal: "/schema", pathUpdated: "/schema" }] }],
            diagnostics: [{ code: "EXAMPLE", path: "/info", message: "Diagnostic text", recoverable: true }] }) };
    }));
    const view = panel(); instruct();
    await screen.findByText("changed /info/title");
    expect(screen.getByText(/TYPE_CHANGED/)).toHaveTextContent("\"before\": \"Old\"");
    expect(screen.getByText(/EXAMPLE/)).toHaveTextContent("Diagnostic text");
    expect(screen.getByText("candidate text")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Reject"));
    expect(view.apply).not.toHaveBeenCalled(); expect(screen.queryByText("candidate text")).not.toBeInTheDocument();
});
it("disables duplicate sends and aborts waiting on unmount", async () => {
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((_url, init) => { signal = init.signal; return new Promise(() => {}); });
    vi.stubGlobal("fetch", fetch);
    const view = panel(); instruct();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Propose" })).toBeDisabled();
    fireEvent.click(screen.getByText("Stop waiting"));
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("Server inference may still be running");
    fireEvent.click(screen.getByText("Propose"));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    view.unmount(); expect(signal?.aborted).toBe(true);
});
it("invalidates on editor changes and displays a blocked restore", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        return { ok: true, json: async () => ({ ...body.draft, requestId: body.requestId,
            status: "not_applicable", candidate: null, diff: [], diagnostics: [] }) };
    }));
    const view = panel(); instruct(); await screen.findByText("Proposal is not applicable");
    expect(screen.getByRole("button", { name: "Apply to draft" })).toBeDisabled();
    view.rerender(<OpenApiAiPanel {...view.props} invalidation={1} canRestore />);
    expect(screen.queryByText("Apply to draft")).not.toBeInTheDocument();
    view.restore.mockImplementation(() => { throw new Error("buffer"); });
    fireEvent.click(screen.getByText("Restore pre-AI draft"));
    expect(screen.getByRole("status")).toHaveTextContent("Finish Source");
});
