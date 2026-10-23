package io.apicurio.registry.examples.assistant;

final class ProposalFailure extends RuntimeException {
    private final String code;

    ProposalFailure(String code, String message) {
        super(message);
        this.code = code;
    }

    String code() {
        return code;
    }
}
