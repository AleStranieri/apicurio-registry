// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";
import { useState } from "react";
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OpenApiEditor } from "./OpenApiEditor";
import { ContentTypes } from "@models/ContentTypes";
import { openApiDocument, sameOpenApiDocument, serializeOpenApiDocument } from "./OpenApiEditorContent";
import type { OpenAPIEditorProps } from "@apitomy/openapi-editor";
import type { IframeEditorProps } from "./IframeEditor";

const { documents } = vi.hoisted(() => ({ documents: [] as unknown[] }));
vi.mock("@app/components/codeEditor/loadMonacoRuntime", () => ({ loadMonacoRuntime: async () => ({ monaco: {} }) }));
vi.mock("./ApitomyEditor", () => ({
    default: function MockApitomyEditor(props: OpenAPIEditorProps) {
        const [source, setSource] = useState(false);
        documents.push(props.initialContent);
        return <div>
            <button onClick={() => setSource(value => !value)}>Source toggle</button>
            {source && <div className="source-form"><textarea aria-label="Unapplied Source" /><button>Revert</button></div>}
            <input aria-label="Uncommitted visual field" />
            <pre data-testid="initial-document">{JSON.stringify(props.initialContent)}</pre>
            <button onClick={() => props.onChange?.({ isDirty: false, version: 1, getContent: () => ({}) })}>Load</button>
            <button onClick={() => props.onChange?.({ isDirty: true, version: 2,
                getContent: () => ({ openapi: "3.0.2", info: { title: "Changed", version: "1" }, paths: {} }) })}>Edit</button>
            <button onClick={() => props.onChange?.({ isDirty: true, version: 3,
                getContent: () => ({ paths: {}, info: { version: "1", title: "Original" }, openapi: "3.0.2" }) })}>Undo</button>
        </div>;
    }
}));
vi.mock("./IframeEditor", () => ({
    IframeEditor: (props: IframeEditorProps) => <div>
        <pre data-testid="previous-document">{props.content.content}</pre>
        <button onClick={() => props.onChange(props.content.content.replace("Changed", "Legacy edit"))}>Legacy edit</button>
    </div>
}));

const original = "{\"openapi\":\"3.0.2\",\"info\":{\"title\":\"Original\",\"version\":\"1\"},\"paths\":{}}";
const jsonDraft = { content: original, contentType: ContentTypes.APPLICATION_JSON };

afterEach(() => { cleanup(); documents.length = 0; vi.unstubAllGlobals(); });

async function ready() { await screen.findByTestId("initial-document"); }

describe("OpenAPI editor adapter", () => {
    it("ignores clean load events, preserves model on rerender, and calls the latest callback", async () => {
        const onChange = vi.fn();
        const view = render(<OpenApiEditor content={jsonDraft} onChange={onChange} />);
        await ready();
        fireEvent.click(screen.getByText("Load"));
        expect(onChange).not.toHaveBeenCalled();
        const initial = documents[0];
        fireEvent.click(screen.getByText("Edit"));
        expect(JSON.parse(onChange.mock.calls[0][0]).info.title).toBe("Changed");
        const latestCallback = vi.fn();
        view.rerender(<OpenApiEditor content={jsonDraft} onChange={latestCallback} />);
        expect(documents[documents.length - 1]).toBe(initial);
        fireEvent.click(screen.getByText("Undo"));
        expect(latestCallback).toHaveBeenLastCalledWith(original);
    });

    it("preserves undo after saving its emitted content", async () => {
        const onChange = vi.fn();
        const view = render(<OpenApiEditor content={jsonDraft} onChange={onChange} />);
        await ready();
        const initial = documents[0];
        fireEvent.click(screen.getByText("Edit"));
        const saved = onChange.mock.calls[0][0];
        view.rerender(<OpenApiEditor content={{ ...jsonDraft, content: saved }} onChange={onChange} />);
        expect(documents[documents.length - 1]).toBe(initial);
        fireEvent.click(screen.getByText("Undo"));
        expect(JSON.parse(onChange.mock.calls[onChange.mock.calls.length - 1][0]).info.title).toBe("Original");
    });

    it("loads externally supplied recovery or formatted content", async () => {
        const onChange = vi.fn();
        const view = render(<OpenApiEditor content={jsonDraft} onChange={onChange} />);
        await ready();
        view.rerender(<OpenApiEditor content={{ ...jsonDraft, content: original.replace("Original", "Recovered") }} onChange={onChange} />);
        await waitFor(() => expect(screen.getByTestId("initial-document")).toHaveTextContent("Recovered"));
        expect(onChange).not.toHaveBeenCalled();
    });

    it("preserves unsaved content when switching editors in both directions", async () => {
        const onChange = vi.fn();
        render(<OpenApiEditor content={jsonDraft} onChange={onChange} />);
        await ready();
        fireEvent.click(screen.getByText("Edit"));
        fireEvent.click(screen.getByText("Previous editor"));
        expect(screen.getByTestId("previous-document")).toHaveTextContent("\"title\": \"Changed\"");
        fireEvent.click(screen.getByText("Legacy edit"));
        fireEvent.click(screen.getByText("Apitomy (preview)"));
        await ready();
        expect(screen.getByTestId("initial-document")).toHaveTextContent("Legacy edit");
        expect(onChange).toHaveBeenCalledTimes(2);
    });

    it("loads YAML, emits YAML, and restores exact original text after undo", async () => {
        const content = "# Keep formatting\nopenapi: 3.0.2\ninfo: {title: Original, version: '1'}\npaths: {}\n";
        const onChange = vi.fn();
        render(<OpenApiEditor content={{ content, contentType: ContentTypes.APPLICATION_YAML }} onChange={onChange} />);
        await ready();
        expect(screen.getByTestId("initial-document")).toHaveTextContent("\"title\":\"Original\"");
        fireEvent.click(screen.getByText("Edit"));
        expect(onChange.mock.calls[0][0]).toContain("title: Changed");
        fireEvent.click(screen.getByText("Undo"));
        expect(onChange).toHaveBeenLastCalledWith(content);
    });

    it("keeps fallback available for malformed content", () => {
        const onChange = vi.fn();
        render(<OpenApiEditor content={{ ...jsonDraft, content: "broken" }} onChange={onChange} />);
        expect(screen.getByText("Unable to load this OpenAPI document")).toBeVisible();
        fireEvent.click(screen.getByText("Previous editor"));
        expect(screen.getByTestId("previous-document")).toHaveTextContent("broken");
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe("OpenAPI content conversion", () => {
    it("ignores object key order while preserving array order", () => {
        expect(sameOpenApiDocument({ paths: {}, info: { version: "1", title: "Original" }, openapi: "3.0.2" }, jsonDraft)).toBe(true);
        expect(sameOpenApiDocument({ values: [2, 1] }, { ...jsonDraft, content: "{\"values\":[1,2]}" })).toBe(false);
        expect(sameOpenApiDocument({ openapi: "3.0.2" }, { ...jsonDraft, content: "invalid" })).toBe(false);
    });

    it.each(["null", "[]", "\"text\"", "invalid"])("rejects non-document input %s", content => {
        expect(() => openApiDocument({ ...jsonDraft, content })).toThrow();
    });

    it("serializes using Registry JSON indentation", () => {
        expect(serializeOpenApiDocument({ openapi: "3.0.2" }, ContentTypes.APPLICATION_JSON)).toBe("{\n    \"openapi\": \"3.0.2\"\n}");
    });
});


describe("AI editor integration", () => {
    function configure() {
        const fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(init.body);
            return { ok: true, json: async () => ({ ...body.draft, requestId: body.requestId,
                status: "applicable", candidate: original.replace("Original", "AI title"),
                diff: [], diagnostics: [] }) };
        });
        vi.stubGlobal("fetch", fetch);
        const onChange = vi.fn();
        const view = render(<OpenApiEditor content={jsonDraft} onChange={onChange}
            documentId="ai-poc/inventory-api/1" assistantEndpoint="/openapi-assistant/proposals"
            registryContext={{ groupId: "ai-poc", artifactId: "inventory-api", version: "1" }} />);
        return { ...view, onChange, fetch };
    }
    async function propose() {
        fireEvent.change(screen.getByLabelText("Assistant instruction"), { target: { value: "Change title" } });
        fireEvent.click(screen.getByText("Propose"));
        await screen.findByText("Apply to draft");
    }
    it("applies only on explicit acceptance and restores exact pre-AI text", async () => {
        const view = configure(); await ready();
        fireEvent.click(screen.getByText("Open AI assistant"));
        await propose(); expect(view.onChange).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText("Apply to draft"));
        await waitFor(() => expect(screen.getByTestId("initial-document")).toHaveTextContent("AI title"));
        expect(view.onChange).toHaveBeenCalledExactlyOnceWith(original.replace("Original", "AI title"));
        fireEvent.click(screen.getByText("Restore pre-AI draft"));
        await waitFor(() => expect(screen.getByTestId("initial-document")).toHaveTextContent("Original"));
        expect(view.onChange).toHaveBeenLastCalledWith(original);
        expect(view.fetch).toHaveBeenCalledTimes(1);
    });
    it("blocks Source before its debounce and blocks unapplied visual fields", async () => {
        const view = configure(); await ready();
        fireEvent.click(screen.getByText("Open AI assistant"));
        fireEvent.click(screen.getByText("Source toggle"));
        fireEvent.input(screen.getByLabelText("Unapplied Source"), { target: { value: "unapplied" } });
        fireEvent.change(screen.getByLabelText("Assistant instruction"), { target: { value: "Change" } });
        fireEvent.click(screen.getByText("Propose"));
        await screen.findByText(/Source or a visual field/); expect(view.fetch).not.toHaveBeenCalled();
        fireEvent.click(screen.getByText("Source toggle"));
        const rendered = documents.length;
        fireEvent.input(screen.getByLabelText("Uncommitted visual field"), { target: { value: "pending" } });
        expect(documents.length).toBe(rendered);
        fireEvent.click(screen.getByText("Propose"));
        await screen.findByText(/Source or a visual field/); expect(view.fetch).not.toHaveBeenCalled();
        expect(view.onChange).not.toHaveBeenCalled();
    });
    it("allows a request after explicitly reverting Source and returning to Design", async () => {
        const view = configure(); await ready(); fireEvent.click(screen.getByText("Open AI assistant"));
        fireEvent.click(screen.getByText("Source toggle"));
        fireEvent.input(screen.getByLabelText("Unapplied Source"), { target: { value: "pending" } });
        fireEvent.click(screen.getByText("Revert")); fireEvent.click(screen.getByText("Source toggle"));
        await propose();
        expect(view.fetch).toHaveBeenCalledTimes(1); expect(view.onChange).not.toHaveBeenCalled();
    });
    it("maps Registry YAML MIME to the G4 contract while retaining YAML on Apply", async () => {
        const yaml = "openapi: 3.0.3\ninfo: {title: Original, version: '1'}\npaths: {}\n";
        const fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(init.body);
            return { ok: true, json: async () => ({ ...body.draft, requestId: body.requestId,
                status: "applicable", candidate: yaml.replace("Original", "AI YAML"), diff: [], diagnostics: [] }) };
        });
        vi.stubGlobal("fetch", fetch); const onChange = vi.fn();
        render(<OpenApiEditor content={{ content: yaml, contentType: ContentTypes.APPLICATION_YAML }}
            onChange={onChange} assistantEndpoint="/openapi-assistant/proposals" />);
        await ready(); fireEvent.click(screen.getByText("Open AI assistant")); await propose();
        expect(JSON.parse(fetch.mock.calls[0][1].body).draft).toMatchObject({ content: yaml, contentType: "application/yaml" });
        fireEvent.click(screen.getByText("Apply to draft"));
        await waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith(yaml.replace("Original", "AI YAML")));
    });
    it("rejects Apply if Source was opened after receiving a candidate", async () => {
        const view = configure(); await ready(); fireEvent.click(screen.getByText("Open AI assistant"));
        await propose(); fireEvent.click(screen.getByText("Source toggle"));
        fireEvent.click(screen.getByText("Apply to draft"));
        await screen.findByText(/Cannot apply/); expect(view.onChange).not.toHaveBeenCalled();
    });
});


it("uses the selected frontend React version for the AI tests", async () => {
    const { version } = await import("react");
    expect(version).toBe(process.env.G5_CONSOLE_TEST === "1" ? "18.3.1" : "19.3.0");
});
