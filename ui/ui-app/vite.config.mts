import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import react from "@vitejs/plugin-react-swc";
import { fileURLToPath } from "node:url";

const PORT: number = parseInt(process.env.SERVER_PORT || "8888");

export default defineConfig({
    base: "./",
    plugins: [react(), tsconfigPaths(), {
        name: "scope-apitomy-styles",
        enforce: "pre",
        transform(code, id) {
            if (id.endsWith("/@apitomy/openapi-editor/dist/openapi-editor.css")) {
                return `@scope (.registry-openapi-editor) {\n${code}\n}`;
            }
        }
    }],
    resolve: {
        alias: {
            ...(process.env.G5_CONSOLE_TEST === "1" ? {
                "@testing-library/react": fileURLToPath(new URL("../../console-plugin/node_modules/@testing-library/react", import.meta.url)),
                "react": fileURLToPath(new URL("../../console-plugin/node_modules/react", import.meta.url)),
                "react-dom": fileURLToPath(new URL("../../console-plugin/node_modules/react-dom", import.meta.url)),
                "@patternfly/react-core": fileURLToPath(new URL("../../console-plugin/node_modules/@patternfly/react-core", import.meta.url)),
                "@patternfly/react-icons": fileURLToPath(new URL("../../console-plugin/node_modules/@patternfly/react-icons", import.meta.url))
            } : {}),
            "@apitomy/openapi-editor-styles": fileURLToPath(new URL("./node_modules/@apitomy/openapi-editor/dist/openapi-editor.css", import.meta.url)),
            "@microsoft/kiota-abstractions": fileURLToPath(new URL("./node_modules/@microsoft/kiota-abstractions", import.meta.url)),
            "@microsoft/kiota-http-fetchlibrary": fileURLToPath(new URL("./node_modules/@microsoft/kiota-http-fetchlibrary", import.meta.url)),
            "@microsoft/kiota-serialization-form": fileURLToPath(new URL("./node_modules/@microsoft/kiota-serialization-form", import.meta.url)),
            "@microsoft/kiota-serialization-json": fileURLToPath(new URL("./node_modules/@microsoft/kiota-serialization-json", import.meta.url)),
            "@microsoft/kiota-serialization-multipart": fileURLToPath(new URL("./node_modules/@microsoft/kiota-serialization-multipart", import.meta.url)),
            "@microsoft/kiota-serialization-text": fileURLToPath(new URL("./node_modules/@microsoft/kiota-serialization-text", import.meta.url))
        }
    },
    server: {
        proxy: { "/openapi-assistant": { target: "http://127.0.0.1:8082", rewrite: path => path.replace(/^\/openapi-assistant/, "") } },
        port: PORT
    },
    test: {
        environment: "node",
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
        server: {
            deps: {
                inline: ["@patternfly/react-styles"]
            }
        }
    },
    // define: {
    //     "process.platform": {}
    // }
});
