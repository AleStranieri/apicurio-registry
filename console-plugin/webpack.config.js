const path = require("path");
const { ConsoleRemotePlugin } = require("@openshift-console/dynamic-plugin-sdk-webpack");

module.exports = {
  mode: "production",
  context: path.resolve(__dirname, "src"),
  entry: {},
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name]-bundle.js",
    chunkFilename: "[name]-chunk.js",
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx"],
    alias: {
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
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  plugins: [new ConsoleRemotePlugin()],
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
      directory: path.resolve(__dirname, "dist"),
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
