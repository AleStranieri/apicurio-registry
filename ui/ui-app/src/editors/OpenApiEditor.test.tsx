// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
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
    default: (props: OpenAPIEditorProps) => {
        documents.push(props.initialContent);
        return <div>
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

afterEach(() => { cleanup(); documents.length = 0; });

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
