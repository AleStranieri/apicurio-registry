package io.apicurio.registry.examples.assistant;

import dev.langchain4j.model.chat.ChatModel;
import dev.langchain4j.model.openai.OpenAiChatModel;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;

@ApplicationScoped
public class ModelProducer {
    @Produces
    @ApplicationScoped
    ChatModel model(AssistantConfig config) {
        return OpenAiChatModel.builder().baseUrl(config.modelUrl()).apiKey(config.apiKey())
                .modelName(config.model()).temperature(0.0).maxTokens(config.maxOutputTokens())
                .timeout(config.modelTimeout()).maxRetries(0).logRequests(false).logResponses(false).build();
    }
}
