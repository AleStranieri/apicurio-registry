package io.apicurio.registry.examples.assistant;

import io.smallrye.config.ConfigMapping;
import io.smallrye.config.WithDefault;
import io.smallrye.config.WithName;
import jakarta.validation.constraints.Min;
import java.time.Duration;

@ConfigMapping(prefix = "apicurio.assistant")
public interface AssistantConfig {
    @WithDefault("granite4:latest")
    String model();

    @WithDefault("http://127.0.0.1:11434/v1")
    String modelUrl();

    @WithDefault("ollama")
    String apiKey();

    @WithDefault("120s")
    Duration modelTimeout();

    @WithDefault("4")
    @Min(0)
    int maxToolCalls();

    @WithDefault("8")
    @Min(1)
    int maxIterations();

    @WithDefault("32768")
    @Min(1)
    int maxResultBytes();

    @WithDefault("65536")
    @Min(1)
    int maxPromptBytes();

    @WithDefault("4096")
    int maxOutputTokens();

    @WithDefault("30s")
    Duration mcpTimeout();

    @WithDefault("java")
    String javaCommand();

    @WithDefault("mcp/target/quarkus-app/quarkus-run.jar")
    String mcpJar();

    @WithDefault("http://localhost:8080")
    String registryUrl();

    @WithName("body.max-size")
    @WithDefault("64K")
    String maxBodySize();

    @WithName("timeout.ms")
    @WithDefault("180000")
    @Min(1)
    long timeoutMs();
}
