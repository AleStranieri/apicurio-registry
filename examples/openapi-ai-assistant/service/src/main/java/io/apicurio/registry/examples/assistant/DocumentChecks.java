package io.apicurio.registry.examples.assistant;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import io.apicurio.registry.examples.assistant.ProposalResponse.Diagnostic;
import io.apitomy.datamodels.Library;
import io.apitomy.datamodels.models.Document;
import io.apitomy.datamodels.validation.DefaultSeverityRegistry;
import io.apitomy.datamodels.validation.ValidationProblemSeverity;
import jakarta.enterprise.context.ApplicationScoped;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

@ApplicationScoped
public class DocumentChecks {
    private static final Set<String> EXAMPLE_FIELDS = Set.of("example", "default", "enum");
    private final ObjectMapper json = new ObjectMapper()
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    private final ObjectMapper yaml = new ObjectMapper(new YAMLFactory())
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    public Checked check(String content, String contentType) {
        List<Diagnostic> diagnostics = new ArrayList<>();
        try {
            JsonNode tree = ("application/yaml".equals(contentType) ? yaml : json).readTree(content);
            if (tree == null || !tree.isObject() || !"3.0.3".equals(tree.path("openapi").asText())) {
                return new Checked(null, List.of(new Diagnostic("OPENAPI_VERSION", "/openapi",
                        "A complete OpenAPI 3.0.3 document is required.", false)));
            }
            // Check references before validation, without registering any external resolver.
            references(tree, tree, "", diagnostics);
            Document document = Library.readDocumentFromJSONString(json.writeValueAsString(tree));
            if (!diagnostics.isEmpty()) {
                return new Checked(Library.writeDocument(document), List.copyOf(diagnostics));
            }
            Library.validate(document, new DefaultSeverityRegistry()).stream()
                    .filter(problem -> problem.severity == ValidationProblemSeverity.high
                            || problem.severity == ValidationProblemSeverity.medium)
                    .forEach(problem -> diagnostics.add(new Diagnostic(problem.errorCode,
                            problem.nodePath.toString() + "/" + problem.property, problem.message, false)));
            return new Checked(Library.writeDocument(document), List.copyOf(diagnostics));
        } catch (JsonProcessingException | IllegalArgumentException failure) {
            return new Checked(null, List.of(new Diagnostic("DOCUMENT_PARSE", "",
                    "The document could not be parsed as OpenAPI 3.0.3.", false)));
        }
    }

    private void references(JsonNode root, JsonNode node, String path, List<Diagnostic> errors) {
        if (node.isObject()) {
            var fields = node.fields();
            while (fields.hasNext()) {
                var field = fields.next();
                String name = field.getKey();
                String childPath = path + "/" + escape(name);
                if ("$ref".equals(name)) {
                    String ref = field.getValue().asText();
                    if (!ref.startsWith("#")) {
                        errors.add(new Diagnostic("EXTERNAL_REF_UNSUPPORTED", childPath,
                                "Only local references are supported.", false));
                    } else {
                        try {
                            String pointer = URI.create(ref).getFragment();
                            if (root.at(pointer).isMissingNode()) {
                                errors.add(new Diagnostic("BROKEN_REF", childPath,
                                        "The local reference target does not exist.", false));
                            }
                        } catch (IllegalArgumentException failure) {
                            errors.add(new Diagnostic("BROKEN_REF", childPath,
                                    "The local reference is not a valid JSON Pointer.", false));
                        }
                    }
                } else if (!name.startsWith("x-") && !EXAMPLE_FIELDS.contains(name)) {
                    references(root, field.getValue(), childPath, errors);
                }
            }
        } else if (node.isArray()) {
            for (int index = 0; index < node.size(); index++) {
                references(root, node.get(index), path + "/" + index, errors);
            }
        }
    }

    static String escape(String value) {
        return value.replace("~", "~0").replace("/", "~1");
    }

    public record Checked(JsonNode ast, List<Diagnostic> diagnostics) {
        boolean valid() {
            return ast != null && diagnostics.isEmpty();
        }
    }

}
