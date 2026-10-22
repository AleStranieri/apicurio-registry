import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@app/App.tsx";
import { ConfigService, useConfigService } from "@services/useConfigService.ts";
import { configureEmbeddedRequestMiddleware } from "@utils/rest.utils.ts";
import { DisableCompressionMiddleware } from "@utils/disableCompressionMiddleware.ts";

configureEmbeddedRequestMiddleware([new DisableCompressionMiddleware()]);

// eslint-disable-next-line react-hooks/rules-of-hooks
const config: ConfigService = useConfigService();
config.fetchAndMergeConfigs().then(() => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
        <React.Fragment>
            <App />
        </React.Fragment>
    );
});
