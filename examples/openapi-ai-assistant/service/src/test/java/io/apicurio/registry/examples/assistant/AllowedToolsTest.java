package io.apicurio.registry.examples.assistant;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import java.util.List;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class AllowedToolsTest {
    private final AssistantConfig config = mock(AssistantConfig.class);
    private final McpConnector connector = mock(McpConnector.class);
    private final McpConnector.Session session = mock(McpConnector.Session.class);

    @Test
    void denyEveryWriteNameBeforeOpeningConnection() {
        try (var tools = new AllowedTools(connector, config, new ObjectMapper())) {
            for (String name : List.of("create_version", "create_new_artifact", "delete_artifact", "unknown")) {
                var failure = assertThrows(ProposalFailure.class, () -> tools.execute(call(name, "{}"), false));
                assertEquals("TOOL_NOT_ALLOWED", failure.code());
            }
            assertEquals(0, tools.totalCalls());
        }
        verifyNoInteractions(connector);
    }

    @Test
    void rejectMalformedArgumentsWithoutOpeningConnection() {
        when(config.maxToolCalls()).thenReturn(4);
        try (var tools = new AllowedTools(connector, config, new ObjectMapper())) {
            var failure = assertThrows(ProposalFailure.class,
                    () -> tools.execute(call("get_version_content", "not-json"), false));
            assertEquals("TOOL_ARGUMENTS", failure.code());
            assertEquals(0, tools.totalCalls());
        }
        verifyNoInteractions(connector);
    }

    @Test
    void rejectsOversizedUtf8ResultAndClosesSession() {
        when(config.maxToolCalls()).thenReturn(4);
        when(config.maxResultBytes()).thenReturn(3);
        when(connector.open()).thenReturn(session);
        when(session.execute(any())).thenReturn("èè");
        try (var tools = new AllowedTools(connector, config, new ObjectMapper())) {
            var failure = assertThrows(ProposalFailure.class,
                    () -> tools.execute(call("get_version_content", "{}"), false));
            assertEquals("TOOL_RESULT_LIMIT", failure.code());
            assertEquals(1, tools.totalCalls());
        }
        verify(session).close();
    }

    @Test
    void zeroBudgetRejectsEvenDeterministicValidation() {
        when(config.maxToolCalls()).thenReturn(0);
        try (var tools = new AllowedTools(connector, config, new ObjectMapper())) {
            var failure = assertThrows(ProposalFailure.class,
                    () -> tools.execute(call("test_schema_rules", "{}"), true));
            assertEquals("TOOL_LIMIT", failure.code());
            assertEquals(0, tools.totalCalls());
        }
        verifyNoInteractions(connector);
    }

    private ToolExecutionRequest call(String name, String arguments) {
        return ToolExecutionRequest.builder().name(name).arguments(arguments).build();
    }
}
