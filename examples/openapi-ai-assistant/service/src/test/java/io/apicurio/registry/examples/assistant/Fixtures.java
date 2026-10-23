package io.apicurio.registry.examples.assistant;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

final class Fixtures {
    private Fixtures() {
    }

    static String read(String name) {
        try (var stream = Fixtures.class.getResourceAsStream("/" + name)) {
            if (stream == null) {
                throw new IllegalArgumentException("Missing fixture: " + name);
            }
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8).strip();
        } catch (IOException failure) {
            throw new IllegalStateException(failure);
        }
    }

    static ProposalRequest request(String mode, String content) {
        return new ProposalRequest("2b739835-9c16-47ef-a492-faa328e11126", mode, "Change the title",
                new ProposalRequest.Draft("unsaved-browser-draft", 7L, "application/json", content,
                        ProposalResource.hash(content)), "modify".equals(mode)
                        ? new ProposalRequest.RegistryContext("ai-poc", "inventory-api", "1") : null);
    }
}
