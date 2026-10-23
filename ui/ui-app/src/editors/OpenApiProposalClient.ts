export class DraftBufferError extends Error {}

export interface AssistantDraft {
    documentId: string;
    revision: number;
    content: string;
    contentType: string;
}
export interface RegistryContext { groupId: string; artifactId: string; version: string }
export interface Proposal {
    requestId: string;
    status: "applicable" | "not_applicable";
    documentId: string;
    revision: number;
    baseHash: string;
    candidate: string | null;
    diff: { kind: string; path: string; before: unknown; after: unknown;
        schemaDifferences: { diffType: string; pathOriginal: string; pathUpdated: string }[] }[];
    diagnostics: { code: string; path: string; message: string; recoverable: boolean }[];
}
export interface ProposalState { pending: boolean; proposal?: Proposal; error?: string }
export async function draftHash(content: string): Promise<string> {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}

/** Only the configured same-origin proxy receives draft content. No Registry writes. */
export class OpenApiProposalClient {
    private sequence = 0;
    private active?: AbortController;
    private timer?: ReturnType<typeof setTimeout>;
    private base?: AssistantDraft;
    private state: ProposalState = { pending: false };
    constructor(private endpoint: string, private read: () => AssistantDraft,
        private notify: (state: ProposalState) => void, private transport: typeof fetch = (input, init) => fetch(input, init),
        private timeoutMs = 190000) {}

    private publish(state: ProposalState): void { this.state = state; this.notify(state); }
    cancel(message?: string): void {
        this.sequence++;
        this.active?.abort();
        clearTimeout(this.timer);
        this.active = undefined;
        this.base = undefined;
        this.publish({ pending: false, error: message });
    }
    private unchanged(base: AssistantDraft): boolean {
        const now = this.read(); // Also checks unapplied editor buffers, on every use.
        return now.documentId === base.documentId && now.revision === base.revision &&
            now.contentType === base.contentType && now.content === base.content;
    }
    async send(instruction: string, context?: RegistryContext): Promise<void> {
        if (this.state.pending || !instruction.trim()) { return; }
        this.cancel();
        const sequence = this.sequence;
        this.publish({ pending: true });
        this.active = new AbortController();
        this.timer = setTimeout(() => this.cancel("Timed out. Server inference may still be running."), this.timeoutMs);
        try {
            const url = new URL(this.endpoint, window.location.origin);
            if (url.origin !== window.location.origin || url.search || url.hash || url.username || url.password) {
                throw new Error("Invalid assistant proxy");
            }
            const base = { ...this.read() };
            const baseHash = await draftHash(base.content);
            if (sequence !== this.sequence) { return; }
            if (!this.unchanged(base)) { throw new Error("Draft changed"); }
            const requestId = crypto.randomUUID();
            const body = JSON.stringify({ requestId, mode: base.content.trim() ? "modify" : "create",
                instruction, draft: { ...base, baseHash }, registryContext: context });
            if (new TextEncoder().encode(body).length > 65536) { throw new Error("Request too large"); }
            const response = await this.transport(url.href, { method: "POST", redirect: "error",
                credentials: "same-origin", headers: { "Content-Type": "application/json", ...this.csrf(url) },
                body, signal: this.active?.signal });
            if (sequence !== this.sequence) { return; }
            if (!response.ok) { throw new Error("Assistant HTTP error"); }
            const proposal: Proposal = await response.json();
            if (sequence !== this.sequence) { return; }
            if (proposal.requestId !== requestId || proposal.documentId !== base.documentId ||
                proposal.revision !== base.revision || proposal.baseHash !== baseHash ||
                !this.unchanged(base) || await draftHash(this.read().content) !== baseHash) {
                throw new Error("Stale or mismatched proposal");
            }
            if (sequence !== this.sequence) { return; }
            if (!["applicable", "not_applicable"].includes(proposal.status) ||
                !Array.isArray(proposal.diff) || !Array.isArray(proposal.diagnostics) ||
                !proposal.diff.every(change => change && typeof change.kind === "string" &&
                    typeof change.path === "string" && Array.isArray(change.schemaDifferences) &&
                    change.schemaDifferences.every(d => d && typeof d.diffType === "string" &&
                        typeof d.pathOriginal === "string" && typeof d.pathUpdated === "string")) ||
                !proposal.diagnostics.every(d => d && typeof d.code === "string" && typeof d.path === "string" &&
                    typeof d.message === "string" && typeof d.recoverable === "boolean") ||
                (proposal.status === "applicable" && typeof proposal.candidate !== "string")) {
                throw new Error("Invalid proposal");
            }
            // Recheck after the asynchronous digest, including pending visual fields.
            if (!this.unchanged(base)) { throw new Error("Draft changed"); }
            this.base = base;
            this.publish({ pending: false, proposal });
        } catch (error) {
            if (sequence === this.sequence) {
                this.publish({ pending: false, error: error instanceof DraftBufferError
                    ? "Source or a visual field is not applied. Finish or revert it before retrying."
                    : "Proposal unavailable or obsolete. Check the draft and retry." });
            }
        } finally {
            if (sequence === this.sequence) { clearTimeout(this.timer); this.active = undefined; }
        }
    }
    async apply(write: (content: string) => void): Promise<void> {
        const proposal = this.state.proposal;
        const base = this.base;
        const sequence = this.sequence;
        if (!proposal || !base || proposal.status !== "applicable" || typeof proposal.candidate !== "string") { return; }
        try {
            if (!this.unchanged(base) || await draftHash(this.read().content) !== proposal.baseHash ||
                sequence !== this.sequence || !this.unchanged(base)) { throw new Error("Draft changed"); }
            write(proposal.candidate);
            this.cancel();
        } catch {
            if (sequence === this.sequence) { this.cancel("Cannot apply: the draft or editor buffer changed."); }
        }
    }
    private csrf(url: URL): Record<string, string> {
        if (!url.pathname.startsWith("/api/proxy/plugin/")) { return {}; }
        const cookie = document.cookie.split(";").map(v => v.trim()).find(v => v.startsWith("csrf-token="));
        return cookie ? { "X-CSRFToken": cookie.slice("csrf-token=".length) } : {};
    }
}
