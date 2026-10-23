import { useEffect, useMemo, useState } from "react";
import { Alert, Button, TextArea } from "@patternfly/react-core";
import { AssistantDraft, OpenApiProposalClient, Proposal, ProposalState, RegistryContext } from "./OpenApiProposalClient";

export function OpenApiProposalDiff({ proposal }: { proposal: Proposal }) {
    return <>
        <h4>Semantic changes</h4>
        <ul>{proposal.diff.map((change, i) => <li key={i}>
            <strong>{change.kind} {change.path || "/"}</strong>
            <pre>{JSON.stringify({ before: change.before, after: change.after,
                schemaDifferences: change.schemaDifferences }, null, 2)}</pre>
        </li>)}</ul>
        <h4>Diagnostics</h4>
        <ul>{proposal.diagnostics.map((diagnostic, i) => <li key={i}>
            {diagnostic.code} {diagnostic.path}: {diagnostic.message}
        </li>)}</ul>
        <details><summary>Candidate document</summary><pre>{proposal.candidate}</pre></details>
    </>;
}

export function OpenApiAiPanel(props: { endpoint: string; read: () => AssistantDraft;
    context?: RegistryContext; apply: (content: string) => void; restore: () => void;
    canRestore: boolean; invalidation: number }) {
    const [instruction, setInstruction] = useState("");
    const [state, setState] = useState<ProposalState>({ pending: false });
    const client = useMemo(() => new OpenApiProposalClient(props.endpoint, props.read, setState), [props.endpoint, props.read]);
    useEffect(() => () => client.cancel(), [client]);
    useEffect(() => { client.cancel(); }, [client, props.invalidation]);
    return <aside aria-label="OpenAPI AI assistant" className="registry-openapi-ai-panel">
        <p>Local AI preview. Apply changes the draft only; use Registry Save to persist.</p>
        <p>Apply and Restore reset editor undo history. Restore returns the exact pre-AI draft and replaces subsequent edits.</p>
        <p>Save or revert Source, then return to Design before requesting or applying. Finish visual fields first.</p>
        <TextArea aria-label="Assistant instruction" value={instruction} isDisabled={state.pending}
            onChange={(_event, value) => setInstruction(value)} />
        <Button isDisabled={state.pending || !instruction.trim()} onClick={() => void client.send(instruction, props.context)}>Propose</Button>
        {state.pending && <Button variant="secondary" onClick={() => client.cancel("Stopped waiting. Server inference may still be running.")}>Stop waiting</Button>}
        <div role="status" aria-live="polite">{state.pending ? "Preparing proposal…" : state.error}</div>
        {state.proposal && <>
            {state.proposal.status === "not_applicable" && <Alert isInline variant="warning" title="Proposal is not applicable" />}
            <OpenApiProposalDiff proposal={state.proposal} />
            <Button isDisabled={state.proposal.status !== "applicable"} onClick={() => void client.apply(props.apply)}>Apply to draft</Button>
            <Button variant="link" onClick={() => client.cancel()}>Reject</Button>
        </>}
        {props.canRestore && <Button variant="secondary" onClick={() => { client.cancel(); try { props.restore(); } catch { setState({ pending: false, error: "Finish Source or visual fields before restoring." }); } }}>Restore pre-AI draft</Button>}
    </aside>;
}
