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
