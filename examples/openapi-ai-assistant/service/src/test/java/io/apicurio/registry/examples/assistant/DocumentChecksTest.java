package io.apicurio.registry.examples.assistant;

import io.apitomy.datamodels.jsonschema.compat.DiffType;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DocumentChecksTest {
    private final DocumentChecks checks = new DocumentChecks();
    private final SemanticDiff diff = new SemanticDiff();

    @Test
    void validatesOpenApiWithoutModel() {
        var result = checks.check(Fixtures.read("valid.json"), "application/json");
        assertTrue(result.valid());
        assertEquals("Inventory", result.ast().path("info").path("title").asText());
        assertEquals(0, result.diagnostics().size());
    }

    @Test
    void detectsBrokenLocalReference() {
        var result = checks.check(Fixtures.read("broken-ref.json"), "application/json");
        assertFalse(result.valid());
        assertEquals("BROKEN_REF", result.diagnostics().get(0).code());
        assertEquals("/paths/~1items/get/responses/200/content/application~1json/schema/$ref",
                result.diagnostics().get(0).path());
    }

    @Test
    void apitomyDetectsMissingRequiredInfoVersion() {
        var result = checks.check(Fixtures.read("missing-required.json"), "application/json");
        assertFalse(result.valid());
        assertTrue(result.diagnostics().stream().anyMatch(error -> error.path().contains("version")));
    }

    @Test
    void rejectsExternalRefsWithoutFetching() {
        String document = Fixtures.read("broken-ref.json")
                .replace("#/components/schemas/Missing", "http://127.0.0.1:1/private");
        var result = checks.check(document, "application/json");
        assertFalse(result.valid());
        assertEquals("EXTERNAL_REF_UNSUPPORTED", result.diagnostics().get(0).code());
    }

    @Test
    void validatesYamlAndRejectsMultipleDocuments() {
        String yaml = "openapi: 3.0.3\ninfo:\n  title: Inventory\n  version: '1'\npaths: {}\n";
        assertTrue(checks.check(yaml, "application/yaml").valid());
        assertEquals("DOCUMENT_PARSE", checks.check(yaml + "---\nfoo: bar", "application/yaml")
                .diagnostics().get(0).code());
    }

    @Test
    void rejectsSyntaxAndUnsupportedVersion() {
        assertEquals("DOCUMENT_PARSE", checks.check("{broken", "application/json").diagnostics().get(0).code());
        assertEquals("OPENAPI_VERSION", checks.check(Fixtures.read("valid.json").replace("3.0.3", "3.1.0"),
                "application/json").diagnostics().get(0).code());
    }

    @Test
    void diffIgnoresFormattingAndObjectKeyOrder() {
        var original = checks.check(Fixtures.read("valid.json"), "application/json").ast();
        var reordered = checks.check("{\"paths\":{},\"info\":{\"version\":\"1\",\"title\":\"Inventory\"},"
                + "\"openapi\":\"3.0.3\"}", "application/json").ast();
        var equivalent = checks.check("{ \"openapi\": \"3.0.3\", \"info\": {\"title\": \"Inventory\","
                + "\"version\":\"1\"}, \"paths\":{} }", "application/json").ast();
        assertEquals(0, diff.compare(reordered, equivalent).size());
        assertEquals(0, diff.compare(original, original).size());
    }

    @Test
    void diffIncludesPathsAndRealApitomySchemaDifference() {
        String original = Fixtures.read("valid.json");
        var changes = diff.compare(checks.check(original, "application/json").ast(), checks.check(original
                .replace("\"integer\"", "\"string\"").replace("\"Inventory\"", "\"Changed\""),
                "application/json").ast());
        assertEquals(2, changes.size());
        assertEquals("/components/schemas/Item", changes.get(0).path());
        assertEquals(DiffType.SUBSCHEMA_TYPE_CHANGED, changes.get(0).schemaDifferences().get(0).diffType());
        assertEquals("/info/title", changes.get(1).path());
        assertEquals("Changed", changes.get(1).after().asText());
    }
}
