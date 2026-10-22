import {
  EmptyState,
  EmptyStateBody,
} from "@patternfly/react-core";
import { ExclamationTriangleIcon } from "@patternfly/react-icons";
import { useTranslation } from "react-i18next";
import { ApicurioRegistry3, getAppUrl, getUiUrl } from "../utils/k8s";
import { EmbeddedApp } from "@app/EmbeddedApp";
import { ConsoleProxyMiddleware } from "../utils/console-proxy-middleware";
import "../styles/plugin.css";

const requestMiddleware = [new ConsoleProxyMiddleware()];

interface EmbeddedRegistryUIProps {
  registry: ApicurioRegistry3;
  navPrefixPath?: string;
}

const EmbeddedRegistryUI: React.FC<EmbeddedRegistryUIProps> = ({
  registry,
  navPrefixPath: customNavPrefixPath,
}) => {
  const { t } = useTranslation("plugin__apicurio-registry");

  const appBaseUrl = getAppUrl(registry);
  const uiBaseUrl = getUiUrl(registry);

  if (!appBaseUrl) {
    return (
      <EmptyState
        titleText={t("Registry API Unavailable")}
        headingLevel="h4"
        icon={ExclamationTriangleIcon}
      >
        <EmptyStateBody>
          {t("Unable to determine the Registry API URL for this instance.")}
        </EmptyStateBody>
      </EmptyState>
    );
  }

  const rawApiUrl = `${appBaseUrl.replace(/\/$/, "")}/apis/registry/v3`;
  const apiUrl = appBaseUrl.includes("localhost:8080")
    ? `${window.location.origin}/api/proxy/plugin/apicurio-registry/registry-api/apis/registry/v3`
    : rawApiUrl;
  const editorsUrl = uiBaseUrl
    ? `${uiBaseUrl.replace(/\/$/, "")}/editors/`
    : "http://localhost:8888/editors/";
  const navPrefixPath =
    customNavPrefixPath ??
    `/apicurio/ns/${registry.metadata.namespace}/${registry.metadata.name}`;

  return (
    <div className="apicurio-registry-embedded-ui">
      <EmbeddedApp
        apiUrl={apiUrl}
        navPrefixPath={navPrefixPath}
        editorsUrl={editorsUrl}
        requestMiddleware={requestMiddleware}
      />
    </div>
  );
};

export default EmbeddedRegistryUI;
