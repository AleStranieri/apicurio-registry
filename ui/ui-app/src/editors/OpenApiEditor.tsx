import React, { lazy, useCallback, useEffect, useMemo, useId, useRef, useState } from "react";
import { Alert, Button, ToggleGroup, ToggleGroupItem } from "@patternfly/react-core";
import type { DocumentChangeEvent } from "@apitomy/openapi-editor";
import { EditorProps } from "./editor-types";
import { IframeEditor } from "./IframeEditor";
import { EditorLoadBoundary } from "@app/components/codeEditor/EditorLoadBoundary";
import { openApiDocument, sameOpenApiDocument, serializeOpenApiDocument } from "./OpenApiEditorContent";
import "./OpenApiEditor.css";
import { OpenApiAiPanel } from "./OpenApiAiPanel";
import { AssistantDraft, DraftBufferError, RegistryContext } from "./OpenApiProposalClient";

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
    documentId?: string;
    registryContext?: RegistryContext;
    assistantEndpoint?: string;
} & EditorProps;

/** Keeps undo/redo across ordinary edits and saves. AI replacement starts a new history. */
export const OpenApiEditor: React.FunctionComponent<OpenApiEditorProps> = (props: OpenApiEditorProps) => {
    const [implementation, setImplementation] = useState("apitomy");
    const [initialDraft, setInitialDraft] = useState(props.content);
    const latestDraft = useRef(props.content);
    const baseline = useRef(props.content);
    const surface = useRef<HTMLDivElement>(null);
    const revision = useRef(0);
    const pendingField = useRef(false);
    const generatedId = useId();
    const identity = useRef(props.documentId || generatedId);
    identity.current = props.documentId || identity.current;
    const [invalidation, setInvalidation] = useState(0);
    const [assistantOpen, setAssistantOpen] = useState(false);
    const [mount, setMount] = useState(0);
    const [restoreDraft, setRestoreDraft] = useState<typeof props.content>();
    const invalidate = (): void => {
        revision.current++;
        setInvalidation(value => value + 1);
    };
    const read = useCallback((): AssistantDraft => {
        if (surface.current?.querySelector(".source-form") || pendingField.current) {
            throw new DraftBufferError("Apply Source and finish visual fields first");
        }
        return { documentId: identity.current, revision: revision.current,
            content: latestDraft.current.content,
            contentType: latestDraft.current.contentType === "application/x-yaml" ? "application/yaml" : latestDraft.current.contentType };
    }, []);
    const onChange = useRef(props.onChange);
    onChange.current = props.onChange;

    useEffect(() => {
        baseline.current = props.content;
        if (props.content.content !== latestDraft.current.content ||
            props.content.contentType !== latestDraft.current.contentType) {
            invalidate();
            pendingField.current = false;
            setRestoreDraft(undefined);
            latestDraft.current = props.content;
            setInitialDraft(props.content);
        }
    }, [props.content]);

    const emitChange = (content: string): void => {
        invalidate();
        latestDraft.current = { ...latestDraft.current, content };
        onChange.current(content);
    };

    const onDocumentChange = (event: DocumentChangeEvent): void => {
        // A clean loading notification must not make whitespace differences look like edits.
        if (!event.isDirty) {
            return;
        }
        pendingField.current = false;
        const document = event.getContent();
        if (document) {
            emitChange(sameOpenApiDocument(document, baseline.current)
                ? baseline.current.content
                : serializeOpenApiDocument(document, latestDraft.current.contentType));
        }
    };

    const switchEditor = (value: string): void => {
        if (value !== implementation) {
            invalidate();
            setAssistantOpen(false);
            setInitialDraft(latestDraft.current);
            setImplementation(value);
        }
    };

    const replaceDraft = (content: string): void => {
        read();
        // Public initialContent reloads the model and resets commands in 0.2.0.
        openApiDocument({ ...latestDraft.current, content });
        setRestoreDraft({ ...latestDraft.current });
        emitChange(content);
        setInitialDraft(latestDraft.current);
        setMount(value => value + 1);
    };
    const restore = (): void => {
        read();
        if (restoreDraft) {
            emitChange(restoreDraft.content);
            setInitialDraft(latestDraft.current);
            setMount(value => value + 1);
            setRestoreDraft(undefined);
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
                {props.assistantEndpoint && implementation === "apitomy" &&
                    <Button variant="link" onClick={() => setAssistantOpen(value => !value)}>
                        {assistantOpen ? "Close AI assistant" : "Open AI assistant"}
                    </Button>}
            </div>
            {assistantOpen && props.assistantEndpoint && <OpenApiAiPanel endpoint={props.assistantEndpoint}
                read={read} context={props.registryContext} apply={replaceDraft} restore={restore}
                canRestore={!!restoreDraft} invalidation={invalidation} />}
            <div ref={surface} className="registry-openapi-editor__surface" onClickCapture={event => {
                const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".source-form button");
                if (button?.textContent?.trim() === "Revert" && !button.disabled) {
                    pendingField.current = false;
                    invalidate();
                }
            }} onInputCapture={event => {
                if ((event.target as HTMLElement).matches("input, textarea, [contenteditable=true]")) {
                    pendingField.current = true;
                    revision.current++;
                }
            }}>
                {implementation === "previous" ? (
                    <IframeEditor content={initialDraft} onChange={emitChange}
                        editorType="OPENAPI" editorName="OpenApiEditor" frameId="openapi-editor-frame"
                        className="editor-flex-editor" extraEditingInfo={{ openapi: { vendorExtensions: [] } }} />
                ) : document ? (
                    <EditorLoadBoundary diagnosticFallbackText={latestDraft.current.content}>
                        <ApitomyEditor key={mount} initialContent={document} onChange={onDocumentChange} />
                    </EditorLoadBoundary>
                ) : (
                    <Alert variant="warning" isInline title="Unable to load this OpenAPI document">
                    Use the previous editor to open this document.
                    </Alert>
                )}
            </div>
        </div>
    );
};
