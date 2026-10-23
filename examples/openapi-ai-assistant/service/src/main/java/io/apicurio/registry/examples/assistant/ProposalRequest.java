package io.apicurio.registry.examples.assistant;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

public record ProposalRequest(
        @NotBlank @Pattern(regexp = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
        String requestId,
        @NotBlank @Pattern(regexp = "create|modify") String mode,
        @NotBlank String instruction,
        @NotNull @Valid Draft draft,
        @Valid RegistryContext registryContext) {

    public record Draft(@NotBlank String documentId, @NotNull @Min(0) Long revision,
            @NotBlank @Pattern(regexp = "application/(yaml|json)") String contentType,
            @NotNull String content,
            @NotBlank @Pattern(regexp = "[0-9a-f]{64}") String baseHash) {
    }

    public record RegistryContext(
            @NotBlank @Pattern(regexp = "[a-zA-Z0-9_-]+") String groupId,
            @NotBlank @Pattern(regexp = "[a-zA-Z0-9_-]+") String artifactId,
            @NotBlank @Pattern(regexp = "[a-zA-Z0-9._-]+") String version) {
    }
}
