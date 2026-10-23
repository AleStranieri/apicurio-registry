package io.apicurio.registry.examples.assistant;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.apicurio.registry.examples.assistant.ProposalResponse.Change;
import io.apicurio.registry.examples.assistant.ProposalResponse.Diagnostic;
import io.apicurio.registry.examples.assistant.ProposalResponse.Run;
import jakarta.inject.Inject;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.net.SocketTimeoutException;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import org.eclipse.microprofile.faulttolerance.exceptions.TimeoutException;
import org.jboss.logging.Logger;

@Path("/proposals")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class ProposalResource {
    private static final Logger log = Logger.getLogger(ProposalResource.class);
    @Inject
    ProposalRunner runner;
    @Inject
    AssistantConfig config;
    @Inject
    McpConnector connector;
    @Inject
    ObjectMapper mapper;
    @Inject
    DocumentChecks checks;

    @POST
    public ProposalResponse propose(@NotNull @Valid ProposalRequest request) {
        validate(request);
        var tools = new AllowedTools(connector, config, mapper);
        var state = new ProposalRun(tools);
        List<Change> changes = List.of();
        try (tools) {
            changes = runner.run(request, state);
        } catch (TimeoutException timeout) {
            state.diagnostics = List.of(new Diagnostic("LLM_TIMEOUT", "", "The proposal timed out. Retry the request.", true));
        } catch (ProposalFailure failure) {
            state.diagnostics = List.of(new Diagnostic(failure.code(), "", failure.getMessage(), true));
        } catch (Exception failure) {
            state.diagnostics = List.of(new Diagnostic(isTimeout(failure) ? "LLM_TIMEOUT" : "ASSISTANT_UNAVAILABLE",
                    "", "The assistant could not complete the proposal. Retry the request.", true));
        }
        String status = state.diagnostics.isEmpty() ? "applicable" : "not_applicable";
        log.infof("requestId=%s status=%s attempts=%d toolCalls=%d elapsedMs=%d", request.requestId(),
                status, state.attempts, tools.totalCalls(), state.elapsedMs());
        return new ProposalResponse(request.requestId(), status, request.draft().documentId(),
                request.draft().revision(), request.draft().baseHash(), state.candidate,
                "applicable".equals(status) ? changes : List.of(), state.diagnostics,
                new Run(config.model(), tools.totalCalls(), state.attempts, state.elapsedMs(),
                        tools.modelCalls(), tools.validationCalls()));
    }

    private void validate(ProposalRequest request) {
        if ("modify".equals(request.mode()) && (request.draft().content().isBlank()
                || request.registryContext() == null)) {
            throw badRequest("Modify requires a nonempty draft and Registry context.");
        }
        if (!hash(request.draft().content()).equals(request.draft().baseHash())) {
            throw badRequest("The baseHash does not match the draft content.");
        }
        if (!request.draft().content().isBlank()) {
            var original = checks.check(request.draft().content(), request.draft().contentType());
            if (original.ast() == null) {
                throw badRequest("The draft must be a parseable OpenAPI 3.0.3 document.");
            }
        }
    }

    static String hash(String content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(content.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is required by the JVM", impossible);
        }
    }

    private BadRequestException badRequest(String message) {
        return new BadRequestException(Response.status(400).entity(new Diagnostic("INVALID_REQUEST", "", message, false)).build());
    }

    private boolean isTimeout(Throwable error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof HttpTimeoutException || cause instanceof SocketTimeoutException) {
                return true;
            }
        }
        return false;
    }
}
