import React, { lazy, useEffect, useMemo, useRef, useState } from "react";
import { Alert, ToggleGroup, ToggleGroupItem } from "@patternfly/react-core";
import type { DocumentChangeEvent } from "@apitomy/openapi-editor";
import { Editor as DraftEditor, EditorProps } from "./editor-types";
import { IframeEditor } from "./IframeEditor";
import { EditorLoadBoundary } from "@app/components/codeEditor/EditorLoadBoundary";
import { openApiDocument, sameOpenApiDocument, serializeOpenApiDocument } from "./OpenApiEditorContent";
import "./OpenApiEditor.css";

const ApitomyEditor = lazy(async () => {
    const { loadMonacoRuntime } = await import("@app/components/codeEditor/loadMonacoRuntime");
    const runtime = await loadMonacoRuntime();
    // The published editor bundles its own Monaco loader, which discovers an existing
    // runtime through window.monaco. Supply ours before mounting to avoid CDN requests.
    (window as Window & { monaco?: unknown }).monaco = runtime.monaco;
    return import("./ApitomyEditor");
});

export type OpenApiEditorProps = {
    className?: string;
} & EditorProps;

/** Keeps the initial document stable across edits and saves, preserving undo/redo. */
export const OpenApiEditor: DraftEditor = (props: OpenApiEditorProps) => {
    const [implementation, setImplementation] = useState("apitomy");
    const [initialDraft, setInitialDraft] = useState(props.content);
    const latestDraft = useRef(props.content);
    const baseline = useRef(props.content);
    const onChange = useRef(props.onChange);
    onChange.current = props.onChange;

    useEffect(() => {
        baseline.current = props.content;
        if (props.content.content !== latestDraft.current.content ||
            props.content.contentType !== latestDraft.current.contentType) {
            latestDraft.current = props.content;
            setInitialDraft(props.content);
        }
    }, [props.content]);

    const emitChange = (content: string): void => {
        latestDraft.current = { ...latestDraft.current, content };
        onChange.current(content);
    };

    const onDocumentChange = (event: DocumentChangeEvent): void => {
        // A clean loading notification must not make whitespace differences look like edits.
        if (!event.isDirty) {
            return;
        }
        const document = event.getContent();
        if (document) {
            emitChange(sameOpenApiDocument(document, baseline.current)
                ? baseline.current.content
                : serializeOpenApiDocument(document, latestDraft.current.contentType));
        }
    };

    const switchEditor = (value: string): void => {
        if (value !== implementation) {
            setInitialDraft(latestDraft.current);
            setImplementation(value);
        }
    };

    const document = useMemo(() => {
        try {
            return openApiDocument(initialDraft);
        } catch {
            return undefined;
        }
    }, [initialDraft]);

    return (
        <div className={`registry-openapi-editor ${props.className || "editor-openapi-flex-container"}`}>
            <div className="registry-openapi-editor__selector">
                <ToggleGroup aria-label="OpenAPI editor">
                    <ToggleGroupItem text="Apitomy (preview)" buttonId="openapi-apitomy"
                        isSelected={implementation === "apitomy"} onChange={() => switchEditor("apitomy")} />
                    <ToggleGroupItem text="Previous editor" buttonId="openapi-previous"
                        isSelected={implementation === "previous"} onChange={() => switchEditor("previous")} />
                </ToggleGroup>
            </div>
            {implementation === "previous" ? (
                <IframeEditor content={initialDraft} onChange={emitChange}
                    editorType="OPENAPI" editorName="OpenApiEditor" frameId="openapi-editor-frame"
                    className="editor-flex-editor" extraEditingInfo={{ openapi: { vendorExtensions: [] } }} />
            ) : document ? (
                <EditorLoadBoundary diagnosticFallbackText={latestDraft.current.content}>
                    <ApitomyEditor initialContent={document} onChange={onDocumentChange} />
                </EditorLoadBoundary>
            ) : (
                <Alert variant="warning" isInline title="Unable to load this OpenAPI document">
                    Use the previous editor to open this document.
                </Alert>
            )}
        </div>
    );
};
