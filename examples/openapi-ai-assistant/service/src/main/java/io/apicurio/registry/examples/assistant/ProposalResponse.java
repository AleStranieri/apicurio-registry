package io.apicurio.registry.examples.assistant;

import com.fasterxml.jackson.databind.JsonNode;
import io.apitomy.datamodels.jsonschema.compat.DiffType;
import java.util.List;

public record ProposalResponse(String requestId, String status, String documentId, long revision,
        String baseHash, String candidate, List<Change> diff, List<Diagnostic> diagnostics, Run run) {

    public record Change(String kind, String path, JsonNode before, JsonNode after,
            List<SchemaDifference> schemaDifferences) {
    }

    public record SchemaDifference(DiffType diffType, String pathOriginal, String pathUpdated) {
    }

    public record Diagnostic(String code, String path, String message, boolean recoverable) {
    }

    public record Run(String model, int toolCallCount, int attemptCount, long elapsedMs,
            int modelToolCallCount, int validationToolCallCount) {
    }
}
