import {
  Breadcrumb,
  BreadcrumbItem,
  Bullseye,
  Button,
  Flex,
  FlexItem,
  PageSection,
  Spinner,
} from "@patternfly/react-core";
import { useK8sWatchResource } from "@openshift-console/dynamic-plugin-sdk";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ApicurioRegistry3,
  ApicurioRegistry3Model,
  getReadyCondition,
} from "../utils/k8s";
import RegistryStatusBadge from "./RegistryStatusBadge";
import EmbeddedRegistryUI from "./EmbeddedRegistryUI";
import "../styles/plugin.css";

const RegistryWorkspacePage: React.FC = () => {
  const { t } = useTranslation("plugin__apicurio-registry");
  const { name, ns: namespace } = useParams<{ name?: string; ns?: string }>();

  const [registry, loaded] = useK8sWatchResource<ApicurioRegistry3>({
    groupVersionKind: {
      group: ApicurioRegistry3Model.apiGroup,
      version: ApicurioRegistry3Model.apiVersion,
      kind: ApicurioRegistry3Model.kind,
    },
    name,
    namespace,
  });

  if (!loaded || !registry) {
    return (
      <Bullseye>
        <Spinner size="xl" />
      </Bullseye>
    );
  }

  const readyCondition = getReadyCondition(registry);
  const listPath = `/k8s/ns/${namespace}/${ApicurioRegistry3Model.apiGroup}~${ApicurioRegistry3Model.apiVersion}~${ApicurioRegistry3Model.kind}`;
  const k8sDetailPath = `${listPath}/${name}`;
  const workspacePrefix = `/apicurio/ns/${namespace}/${name}`;

  return (
    <PageSection
      variant="default"
      padding={{ default: "noPadding" }}
      isFilled
      style={{ display: "flex", flexDirection: "column" }}
    >
      <div className="apicurio-registry-workspace-bar">
        <Flex
          justifyContent={{ default: "justifyContentSpaceBetween" }}
          alignItems={{ default: "alignItemsCenter" }}
        >
          <FlexItem>
            <Flex
              alignItems={{ default: "alignItemsCenter" }}
              spaceItems={{ default: "spaceItemsSm" }}
            >
              <FlexItem>
                <Breadcrumb>
                  <BreadcrumbItem>
                    <Link to={listPath}>{t("Registry Instances")}</Link>
                  </BreadcrumbItem>
                  <BreadcrumbItem isActive>
                    <strong>{registry.metadata.name}</strong>
                  </BreadcrumbItem>
                </Breadcrumb>
              </FlexItem>
              <FlexItem>
                <RegistryStatusBadge condition={readyCondition} />
              </FlexItem>
            </Flex>
          </FlexItem>
          <FlexItem>
            <Button
              variant="secondary"
              size="sm"
              component={(props: React.ComponentProps<"a">) => (
                <Link {...props} to={k8sDetailPath} />
              )}
            >
              {t("Manage K8s Resource")}
            </Button>
          </FlexItem>
        </Flex>
      </div>
      <EmbeddedRegistryUI
        registry={registry}
        navPrefixPath={workspacePrefix}
      />
    </PageSection>
  );
};

export default RegistryWorkspacePage;
