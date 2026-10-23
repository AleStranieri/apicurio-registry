package io.apicurio.registry.examples.assistant;

import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.chat.request.ChatRequest;
import io.quarkus.test.InjectMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@QuarkusTest
@TestProfile(ProposalTimeoutTest.ShortTimeout.class)
class ProposalTimeoutTest {
    @InjectMock
    ChatModel model;
    @InjectMock
    McpConnector connector;

    @Test
    void cdiTimeoutInterruptsBlockedModel() {
        when(model.chat(any(ChatRequest.class))).thenAnswer(invocation -> {
            // Deliberately blocked mock, bounded even if the interceptor fails to interrupt it.
            new CountDownLatch(1).await(5, TimeUnit.SECONDS);
            throw new IllegalStateException("Mock should have been interrupted");
        });
        given().contentType("application/json").body(Fixtures.request("create", ""))
                .post("/proposals").then().statusCode(200).body("status", equalTo("not_applicable"),
                        "diagnostics[0].code", equalTo("LLM_TIMEOUT"),
                        "diagnostics[0].recoverable", equalTo(true), "run.toolCallCount", equalTo(0));
        verifyNoInteractions(connector);
    }

    public static class ShortTimeout implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of("apicurio.assistant.timeout.ms", "100");
        }
    }
}
