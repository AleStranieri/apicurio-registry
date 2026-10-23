package io.apicurio.registry.examples.assistant;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.data.message.AiMessage;
import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.chat.request.ChatRequest;
import dev.langchain4j.model.chat.response.ChatResponse;
import io.quarkus.test.InjectMock;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import java.net.http.HttpTimeoutException;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@QuarkusTest
class ProposalResourceTest {
    @InjectMock
    ChatModel model;
    @InjectMock
    McpConnector connector;
    @Inject
    ObjectMapper mapper;
    private McpConnector.Session session;

    @BeforeEach
    void setup() {
        reset(model, connector);
        session = mock(McpConnector.Session.class);
        when(connector.open()).thenReturn(session);
        when(session.execute(any())).thenReturn("Schema is valid and compatible.");
    }

    @Test
    void contractUsesBrowserDraftAndComputedDiff() {
        String original = Fixtures.read("valid.json");
        String changed = original.replace("Inventory", "Changed");
        answer(changed);
        given().contentType("application/json").body(Fixtures.request("modify", original))
                .post("/proposals").then().statusCode(200)
                .body("status", equalTo("applicable"), "candidate", equalTo(changed),
                        "requestId", equalTo("2b739835-9c16-47ef-a492-faa328e11126"),
                        "documentId", equalTo("unsaved-browser-draft"), "revision", equalTo(7),
                        "baseHash", equalTo(ProposalResource.hash(original)),
                        "diff[0].path", equalTo("/info/title"), "diff[0].after", equalTo("Changed"),
                        "diagnostics", hasSize(0), "run.attemptCount", equalTo(1),
                        "run.toolCallCount", equalTo(1), "run.model", equalTo("granite4:latest"),
                        "run.elapsedMs", greaterThanOrEqualTo(0));
        var prompt = ArgumentCaptor.forClass(ChatRequest.class);
        verify(model).chat(prompt.capture());
        assertTrue(prompt.getValue().messages().toString().contains("Inventory"));
        assertEquals(List.of("get_version_content", "test_schema_rules"), prompt.getValue().toolSpecifications()
                .stream().map(tool -> tool.name()).toList());
        var tool = ArgumentCaptor.forClass(ToolExecutionRequest.class);
        verify(session).execute(tool.capture());
        assertEquals("test_schema_rules", tool.getValue().name());
        verify(session).close();
    }

    @Test
    void createAcceptsEmptyDraftWithoutRegistry() {
        answer(Fixtures.read("valid.json"));
        given().contentType("application/json").body(Fixtures.request("create", ""))
                .post("/proposals").then().statusCode(200).body("status", equalTo("applicable"),
                        "run.toolCallCount", equalTo(0), "diff[0].kind", equalTo("added"));
        verifyNoInteractions(connector);
    }

    @Test
    void modifyRequiresDraft() throws Exception {
        var body = mapper.valueToTree(Fixtures.request("modify", Fixtures.read("valid.json")));
        ((ObjectNode) body).remove("draft");
        given().contentType("application/json").body(body.toString()).post("/proposals").then().statusCode(400);
        verifyNoInteractions(model, connector);
    }

    @Test
    void rejectsBlankInstruction() throws Exception {
        var request = Fixtures.request("create", "");
        given().contentType("application/json").body(new ProposalRequest(request.requestId(), request.mode(),
                "  ", request.draft(), null)).post("/proposals").then().statusCode(400);
        verifyNoInteractions(model, connector);
    }

    @Test
    void rejectsWrongHashAndTraversal() {
        var request = Fixtures.request("modify", Fixtures.read("valid.json"));
        var draft = request.draft();
        given().contentType("application/json").body(new ProposalRequest(request.requestId(), request.mode(),
                request.instruction(), new ProposalRequest.Draft(draft.documentId(), draft.revision(),
                        draft.contentType(), draft.content(), "0".repeat(64)), request.registryContext()))
                .post("/proposals").then().statusCode(400);
        given().contentType("application/json").body(new ProposalRequest(request.requestId(), request.mode(),
                request.instruction(), draft, new ProposalRequest.RegistryContext("../default", "inventory-api", "1")))
                .post("/proposals").then().statusCode(400);
        verifyNoInteractions(model, connector);
    }

    @Test
    void rejectsOversizedBodyBeforeModel() {
        var request = Fixtures.request("create", "");
        given().contentType("application/json").body(new ProposalRequest(request.requestId(), "create",
                "x".repeat(70000), request.draft(), null)).post("/proposals").then().statusCode(413);
        verifyNoInteractions(model, connector);
    }

    @Test
    void modelTimeoutHasRecoveryCode() {
        when(model.chat(any(ChatRequest.class))).thenThrow(new RuntimeException(new HttpTimeoutException("secret")));
        given().contentType("application/json").body(Fixtures.request("create", ""))
                .post("/proposals").then().statusCode(200).body("status", equalTo("not_applicable"),
                        "diagnostics[0].code", equalTo("LLM_TIMEOUT"), "diagnostics[0].recoverable", equalTo(true));
        verifyNoInteractions(connector);
    }

    @Test
    void twoInvalidCandidatesReturnDiagnosticsAndNeverReachRegistry() {
        answer(Fixtures.read("broken-ref.json"), Fixtures.read("missing-required.json"));
        given().contentType("application/json").body(Fixtures.request("modify", Fixtures.read("valid.json")))
                .post("/proposals").then().statusCode(200).body("status", equalTo("not_applicable"),
                        "run.attemptCount", equalTo(2), "run.toolCallCount", equalTo(0), "diff", hasSize(0),
                        "diagnostics.size()", greaterThanOrEqualTo(1));
        var prompt = ArgumentCaptor.forClass(ChatRequest.class);
        verify(model, times(2)).chat(prompt.capture());
        assertTrue(prompt.getAllValues().get(1).messages().toString().contains("BROKEN_REF"));
        verifyNoInteractions(connector);
    }

    @Test
    void oneRepairCanProduceApplicableCandidate() {
        answer(Fixtures.read("missing-required.json"), Fixtures.read("valid.json"));
        given().contentType("application/json").body(Fixtures.request("create", ""))
                .post("/proposals").then().statusCode(200).body("status", equalTo("applicable"),
                        "run.attemptCount", equalTo(2), "diagnostics", hasSize(0));
        verify(model, times(2)).chat(any(ChatRequest.class));
        verifyNoInteractions(connector);
    }

    @Test
    void deniesWriteToolBeforeOpeningMcp() {
        when(model.chat(any(ChatRequest.class))).thenReturn(response(AiMessage.from(tool("create_version", "{}"))));
        given().contentType("application/json").body(Fixtures.request("modify", Fixtures.read("valid.json")))
                .post("/proposals").then().statusCode(200).body("status", equalTo("not_applicable"),
                        "diagnostics[0].code", equalTo("TOOL_NOT_ALLOWED"), "run.toolCallCount", equalTo(0));
        verifyNoInteractions(connector);
    }

    @Test
    void serializesGraniteObjectArgumentsAndNudgesAfterToolCall() throws Exception {
        String document = Fixtures.read("valid.json");
        when(model.chat(any(ChatRequest.class))).thenReturn(response(AiMessage.from(tool("test_schema_rules",
                "{\"groupId\":\"ai-poc\",\"artifactId\":\"inventory-api\",\"versionContent\":" + document + "}"))),
                response(AiMessage.from("The tool completed.")), response(AiMessage.from(document)));
        given().contentType("application/json").body(Fixtures.request("modify", document))
                .post("/proposals").then().statusCode(200).body("status", equalTo("applicable"),
                        "run.toolCallCount", equalTo(2), "run.modelToolCallCount", equalTo(1),
                        "run.validationToolCallCount", equalTo(1));
        var call = ArgumentCaptor.forClass(ToolExecutionRequest.class);
        verify(session, times(2)).execute(call.capture());
        assertTrue(mapper.readTree(call.getAllValues().get(0).arguments()).path("versionContent").isTextual());
        var prompt = ArgumentCaptor.forClass(ChatRequest.class);
        verify(model, times(3)).chat(prompt.capture());
        assertTrue(prompt.getAllValues().get(2).messages().toString().contains("without commentary"));
    }

    @Test
    void enforcesToolLimitEvenForBatchedCalls() {
        var calls = List.of(tool("get_version_content", "{}"), tool("get_version_content", "{}"),
                tool("get_version_content", "{}"), tool("get_version_content", "{}"), tool("get_version_content", "{}"));
        when(model.chat(any(ChatRequest.class))).thenReturn(response(AiMessage.from(calls)));
        given().contentType("application/json").body(Fixtures.request("modify", Fixtures.read("valid.json")))
                .post("/proposals").then().statusCode(200).body("status", equalTo("not_applicable"),
                        "diagnostics[0].code", equalTo("TOOL_LIMIT"), "run.toolCallCount", equalTo(4));
        verify(session, times(4)).execute(any());
        verify(session).close();
    }

    @Test
    void enforcesIterationLimit() {
        answer("I will do it.");
        given().contentType("application/json").body(Fixtures.request("create", ""))
                .post("/proposals").then().statusCode(200).body("status", equalTo("not_applicable"),
                        "diagnostics[0].code", equalTo("ITERATION_LIMIT"));
        verify(model, times(8)).chat(any(ChatRequest.class));
        verifyNoInteractions(connector);
    }

    @Test
    void removesAdvertisedToolsToReserveFinalValidationBudget() {
        when(model.chat(any(ChatRequest.class))).thenReturn(response(AiMessage.from(List.of(
                tool("get_version_content", "{}"), tool("get_version_content", "{}"),
                tool("get_version_content", "{}")))), response(AiMessage.from(Fixtures.read("valid.json"))));
        given().contentType("application/json").body(Fixtures.request("modify", Fixtures.read("valid.json")))
                .post("/proposals").then().statusCode(200).body("status", equalTo("applicable"),
                        "run.toolCallCount", equalTo(4), "run.validationToolCallCount", equalTo(1));
        var prompt = ArgumentCaptor.forClass(ChatRequest.class);
        verify(model, times(2)).chat(prompt.capture());
        assertTrue(prompt.getAllValues().get(1).toolSpecifications().isEmpty());
        assertTrue(prompt.getAllValues().get(1).messages().toString().contains("No more model tool calls"));
    }

    @Test
    void registryRejectionCannotBeOverruledByModel() {
        answer(Fixtures.read("valid.json"));
        when(session.execute(any())).thenReturn("Schema rules check failed: incompatible");
        given().contentType("application/json").body(Fixtures.request("modify", Fixtures.read("valid.json")))
                .post("/proposals").then().statusCode(200).body("status", equalTo("not_applicable"),
                        "run.attemptCount", equalTo(2), "diagnostics[0].code", equalTo("REGISTRY_RULES"));
        verify(session, times(2)).execute(any());
        verify(session, never()).execute(argThat(call -> !"test_schema_rules".equals(call.name())));
    }

    private void answer(String first, String... rest) {
        ChatResponse[] responses = List.of(rest).stream().map(text -> response(AiMessage.from(text)))
                .toArray(ChatResponse[]::new);
        when(model.chat(any(ChatRequest.class))).thenReturn(response(AiMessage.from(first)), responses);
    }

    private static ChatResponse response(AiMessage message) {
        return ChatResponse.builder().aiMessage(message).build();
    }

    private static ToolExecutionRequest tool(String name, String arguments) {
        return ToolExecutionRequest.builder().id("call-1").name(name).arguments(arguments).build();
    }
}
