package io.apicurio.registry.examples.assistant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.MissingNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.apicurio.registry.examples.assistant.ProposalResponse.Change;
import io.apicurio.registry.examples.assistant.ProposalResponse.SchemaDifference;
import io.apitomy.datamodels.jsonschema.compat.Difference;
import io.apitomy.datamodels.jsonschema.compat.JsonSchemaCompatibilityChecker;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;

/** Compares OpenAPI AST fields, with Apitomy semantic differences for Schema Objects. */
@ApplicationScoped
public class SemanticDiff {
    private final JsonSchemaCompatibilityChecker checker = JsonSchemaCompatibilityChecker.builder().build();

    public List<Change> compare(JsonNode original, JsonNode updated) {
        List<Change> changes = new ArrayList<>();
        compare(original == null ? MissingNode.getInstance() : original, updated, "", changes);
        return List.copyOf(changes);
    }

    private void compare(JsonNode before, JsonNode after, String path, List<Change> changes) {
        if (before.equals(after)) {
            return;
        }
        if (before.isObject() && after.isObject() && !schemaPath(path)) {
            var names = new TreeSet<String>();
            before.fieldNames().forEachRemaining(names::add);
            after.fieldNames().forEachRemaining(names::add);
            for (String name : names) {
                compare(before.path(name), after.path(name), path + "/" + DocumentChecks.escape(name), changes);
            }
        } else {
            List<SchemaDifference> differences = new ArrayList<>();
            if (schemaPath(path) && before.isObject() && after.isObject()) {
                // OpenAPI 3.0 Schema Objects overlap draft-4. This is a schema keyword comparison,
                // not an assertion of full OpenAPI request/response compatibility.
                for (Difference difference : checker.checkBackward(schema(before), schema(after)).getDifferences()) {
                    differences.add(new SchemaDifference(difference.getDiffType(),
                            path + difference.getPathOriginal().raw(), path + difference.getPathUpdated().raw()));
                }
            }
            changes.add(new Change(before.isMissingNode() ? "added" : after.isMissingNode() ? "removed" : "changed",
                    path, before.isMissingNode() ? null : before, after.isMissingNode() ? null : after,
                    List.copyOf(differences)));
        }
    }

    private boolean schemaPath(String path) {
        return path.endsWith("/schema") || path.matches("/components/schemas/[^/]+");
    }

    private String schema(JsonNode node) {
        ObjectNode schema = node.deepCopy();
        schema.put("$schema", "http://json-schema.org/draft-04/schema#");
        return schema.toString();
    }
}
