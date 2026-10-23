import "./App.css";
import { FunctionComponent, useEffect, useState } from "react";
import { Bullseye, Spinner } from "@patternfly/react-core";
import { ConfigService, useConfigService } from "@services/useConfigService.ts";
import { MainPageWithAuth } from "@app/MainPageWithAuth.tsx";
import { ErrorBoundaryWithRouter } from "@app/components";
import { ThemeProvider } from "@services/useThemeService.tsx";
import type { Middleware } from "@microsoft/kiota-http-fetchlibrary";
import { configureEmbeddedRequestMiddleware } from "@utils/rest.utils";

export interface EmbeddedAppProps {
    apiUrl: string;
    navPrefixPath: string;
    editorsUrl?: string;
    assistantUrl?: string;
    requestMiddleware?: Middleware[];
}

export const EmbeddedApp: FunctionComponent<EmbeddedAppProps> = ({ apiUrl, navPrefixPath, editorsUrl, assistantUrl, requestMiddleware }) => {
    const config: ConfigService = useConfigService();
    const [ready, setReady] = useState(false);

    useEffect(() => {
        setReady(false);
        configureEmbeddedRequestMiddleware(requestMiddleware);
        config.updateConfig({
            artifacts: {
                url: apiUrl
            },
            ui: {
                openApiAssistantUrl: assistantUrl,
                contextPath: "/",
                navPrefixPath,
                editorsUrl: editorsUrl || "http://localhost:8888/editors/"
            },
            features: {
                showMasthead: false,
                readOnly: false,
                breadcrumbs: true,
                draftMutability: true,
                deleteGroup: true,
                deleteArtifact: true,
                deleteVersion: true,
                settings: true
            },
            auth: {
                type: "none",
                rbacEnabled: false,
                obacEnabled: false
            }
        });
        config.fetchAndMergeConfigs().finally(() => {
            setReady(true);
        });
        return () => configureEmbeddedRequestMiddleware();
    }, [apiUrl, navPrefixPath, editorsUrl, assistantUrl, requestMiddleware]);

    if (!ready) {
        return (
            <Bullseye>
                <Spinner size="xl" />
            </Bullseye>
        );
    }

    return (
        <ThemeProvider>
            <ErrorBoundaryWithRouter>
                <MainPageWithAuth />
            </ErrorBoundaryWithRouter>
        </ThemeProvider>
    );
};
