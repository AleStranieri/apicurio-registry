package io.apicurio.registry.examples.assistant;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.agent.tool.ToolSpecification;
import dev.langchain4j.model.chat.request.json.JsonObjectSchema;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;

/** The only boundary through which proposal code can execute MCP tools. */
final class AllowedTools implements AutoCloseable {
    private static final Set<String> NAMES = Set.of("get_version_content", "test_schema_rules");
    private final McpConnector connector;
    private final AssistantConfig config;
    private final ObjectMapper mapper;
    private McpConnector.Session session;
    private int modelCalls;
    private int validationCalls;

    AllowedTools(McpConnector connector, AssistantConfig config, ObjectMapper mapper) {
        this.connector = connector;
        this.config = config;
        this.mapper = mapper;
    }

    static List<ToolSpecification> specifications() {
        return List.of(ToolSpecification.builder().name("get_version_content")
                .description("Read additional Registry context. The working document is the supplied draft.")
                .parameters(JsonObjectSchema.builder().addStringProperty("groupId")
                        .addStringProperty("artifactId").addStringProperty("versionExpression")
                        .required("groupId", "artifactId", "versionExpression").build()).build(),
                ToolSpecification.builder().name("test_schema_rules")
                        .description("Dry-run Registry rules; never saves a version.")
                        .parameters(JsonObjectSchema.builder().addStringProperty("groupId")
                                .addStringProperty("artifactId").addStringProperty("versionContent")
                                .addStringProperty("versionContentType")
                                .required("groupId", "artifactId", "versionContent").build()).build());
    }

    String execute(ToolExecutionRequest call, boolean validation) {
        if (!NAMES.contains(call.name())) {
            throw new ProposalFailure("TOOL_NOT_ALLOWED", "The requested tool is not allowed.");
        }
        if (totalCalls() >= config.maxToolCalls()) {
            throw new ProposalFailure("TOOL_LIMIT", "The tool call limit was reached.");
        }
        ToolExecutionRequest normalized = normalize(call);
        if (validation) {
            validationCalls++;
        } else {
            modelCalls++;
        }
        if (session == null) {
            session = connector.open();
        }
        String result = session.execute(normalized);
        if (result == null || result.getBytes(StandardCharsets.UTF_8).length > config.maxResultBytes()) {
            throw new ProposalFailure("TOOL_RESULT_LIMIT", "The tool result is absent or exceeds the limit.");
        }
        return result;
    }

    private ToolExecutionRequest normalize(ToolExecutionRequest call) {
        try {
            ObjectNode args = mapper.readValue(call.arguments(), ObjectNode.class);
            if (args.path("versionContent").isObject()) {
                args.put("versionContent", mapper.writeValueAsString(args.get("versionContent")));
            }
            return ToolExecutionRequest.builder().id(call.id()).name(call.name())
                    .arguments(mapper.writeValueAsString(args)).build();
        } catch (JsonProcessingException | IllegalArgumentException failure) {
            throw new ProposalFailure("TOOL_ARGUMENTS", "Tool arguments must be a JSON object.");
        }
    }

    int totalCalls() {
        return modelCalls + validationCalls;
    }

    int modelCalls() {
        return modelCalls;
    }

    int validationCalls() {
        return validationCalls;
    }

    @Override
    public void close() {
        if (session != null) {
            session.close();
        }
    }
}
