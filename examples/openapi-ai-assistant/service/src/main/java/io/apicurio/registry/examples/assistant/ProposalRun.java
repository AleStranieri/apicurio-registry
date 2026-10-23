package io.apicurio.registry.examples.assistant;

import io.apicurio.registry.examples.assistant.ProposalResponse.Diagnostic;
import java.util.List;

/** Per-request state, also available to the HTTP boundary when a CDI timeout interrupts execution. */
final class ProposalRun {
    final long started = System.nanoTime();
    final AllowedTools tools;
    volatile int attempts;
    volatile String candidate = "";
    volatile List<Diagnostic> diagnostics = List.of();

    ProposalRun(AllowedTools tools) {
        this.tools = tools;
    }

    long elapsedMs() {
        return (System.nanoTime() - started) / 1_000_000;
    }
}
