import { DraftContent } from "@models/drafts";
import { ContentTypes } from "@models/ContentTypes";
import { parseJson, parseYaml, toJsonString, toYamlString } from "@utils/content.utils";

export function openApiDocument(draft: DraftContent): object {
    const document = typeof draft.content === "object" ? draft.content
        : draft.contentType === ContentTypes.APPLICATION_YAML ? parseYaml(draft.content) : parseJson(draft.content);
    if (!document || typeof document !== "object" || Array.isArray(document)) {
        throw new Error("Expected an OpenAPI document object");
    }
    return document;
}

function canonical(value: any): any {
    if (Array.isArray(value)) {
        return value.map(canonical);
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    }
    return value;
}

export function sameOpenApiDocument(document: object, draft: DraftContent): boolean {
    try {
        return JSON.stringify(canonical(document)) === JSON.stringify(canonical(openApiDocument(draft)));
    } catch {
        // The previous editor may have repaired an initially malformed document.
        return false;
    }
}

export function serializeOpenApiDocument(document: object, contentType: string): string {
    return contentType === ContentTypes.APPLICATION_YAML ? toYamlString(document) : toJsonString(document);
}
