const path = require("path");
const { ConsoleRemotePlugin } = require("@openshift-console/dynamic-plugin-sdk-webpack");
const isProduction = process.env.NODE_ENV === "production";
const outputDirectory = path.resolve(__dirname, isProduction ? "dist" : "dist-dev");

module.exports = {
  mode: isProduction ? "production" : "development",
  context: path.resolve(__dirname, "src"),
  entry: {},
  output: {
    path: outputDirectory,
    filename: "[name]-bundle.js",
    chunkFilename: "[name]-chunk.js",
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    alias: {
      "@apitomy/openapi-editor-styles": path.resolve(
        __dirname, "../ui/ui-app/node_modules/@apitomy/openapi-editor/dist/openapi-editor.css"
      ),
      "@app": path.resolve(__dirname, "../ui/ui-app/src/app"),
      "@models": path.resolve(__dirname, "../ui/ui-app/src/models"),
      "@editors": path.resolve(__dirname, "../ui/ui-app/src/editors"),
      "@utils": path.resolve(__dirname, "../ui/ui-app/src/utils"),
      "@services": path.resolve(__dirname, "../ui/ui-app/src/services"),
      "@sdk": path.resolve(__dirname, "../typescript-sdk"),
      "@apicurio/apicurio-registry-sdk": path.resolve(
        __dirname,
        "../typescript-sdk/dist/main.js"
      ),
      react: path.resolve(__dirname, "node_modules/react"),
      "react-dom": path.resolve(__dirname, "node_modules/react-dom"),
      "@patternfly/react-core": path.resolve(
        __dirname,
        "node_modules/@patternfly/react-core"
      ),
      "@patternfly/react-icons": path.resolve(
        __dirname,
        "node_modules/@patternfly/react-icons"
      ),
      "@patternfly/react-table": path.resolve(
        __dirname,
        "node_modules/@patternfly/react-table"
      ),
    },
    modules: [
      path.resolve(__dirname, "node_modules"),
      path.resolve(__dirname, "../ui/ui-app/node_modules"),
      path.resolve(__dirname, "../ui/node_modules"),
      path.resolve(__dirname, "../typescript-sdk/node_modules"),
      "node_modules",
    ],
  },
  module: {
    rules: [
      {
        resourceQuery: /worker/,
        use: [path.resolve(__dirname, "worker-loader.js")],
      },
      {
        test: /\.(ts|tsx)$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "swc-loader",
            options: {
              jsc: {
                parser: {
                  syntax: "typescript",
                  tsx: true,
                },
                transform: {
                  react: {
                    runtime: "automatic",
                  },
                },
              },
            },
          },
        ],
      },
      {
        test: /\.m?js$/,
        resolve: {
          fullySpecified: false,
        },
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader", path.resolve(__dirname, "scope-apitomy-css-loader.js")],
      },
    ],
  },
  // SDK 4.20 declares React 17; this PoC console actually provides React 18.3.1.
  // Keep sharing the host React singleton required by the new editor.
  plugins: [new ConsoleRemotePlugin({ validateSharedModules: false })],
  devtool: "source-map",
  performance: {
    hints: false,
  },
  devServer: {
    port: 9001,
    client: {
      overlay: {
        errors: true,
        warnings: false,
      },
    },
    static: {
      directory: outputDirectory,
    },
    devMiddleware: {
      writeToDisk: true,
    },
    proxy: [
      {
        context: ["/registry-api"],
        target: "http://localhost:8080",
        pathRewrite: { "^/registry-api": "" },
        changeOrigin: true,
        headers: {
          Origin: "http://localhost:8888",
        },
      },
    ],
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
      "Access-Control-Allow-Headers":
        "X-Requested-With, Content-Type, Authorization",
    },
  },
};
