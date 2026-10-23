package io.apicurio.registry.examples.assistant;

import dev.langchain4j.agent.tool.ToolExecutionRequest;
import dev.langchain4j.mcp.client.DefaultMcpClient;
import dev.langchain4j.mcp.client.transport.stdio.StdioMcpTransport;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.List;

@ApplicationScoped
public class McpConnector {
    @Inject
    AssistantConfig config;

    public Session open() {
        var transport = new StdioMcpTransport.Builder().command(List.of(config.javaCommand(),
                "-Dregistry.url=" + config.registryUrl(), "-Dquarkus.oidc.tenant-enabled=false",
                "-Dquarkus.log.level=OFF", "-Dquarkus.http.host=127.0.0.1", "-Dquarkus.http.port=0",
                "-jar", config.mcpJar())).logEvents(false).build();
        try {
            var client = new DefaultMcpClient.Builder().transport(transport)
                    .initializationTimeout(config.mcpTimeout()).toolExecutionTimeout(config.mcpTimeout())
                    .logHandler(message -> { }).build();
            return new Session() {
                @Override
                public String execute(ToolExecutionRequest request) {
                    return client.executeTool(request);
                }

                @Override
                public void close() {
                    client.close();
                }
            };
        } catch (RuntimeException failure) {
            if (transport.getProcess() != null) {
                transport.getProcess().destroy();
            }
            throw failure;
        }
    }

    public interface Session extends AutoCloseable {
        String execute(ToolExecutionRequest request);

        @Override
        void close();
    }
}
