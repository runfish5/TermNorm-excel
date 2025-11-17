/* eslint-disable no-undef */

const devCerts = require("office-addin-dev-certs");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const webpack = require("webpack");
const path = require("path");

// Development and Production URLs
// - Development: Always localhost:3000 (webpack dev server)
// - Production: Controlled by DEPLOYMENT_URL environment variable
//   * Default (no env var): GitHub Pages → https://runfish5.github.io/TermNorm-excel/
//   * Local Windows: build-local.bat → https://localhost:8443/termnorm/
//   * Custom: set DEPLOYMENT_URL=https://your-server.com/path/ && npm run build
const urlDev = "https://localhost:3000/";
const urlProd = process.env.DEPLOYMENT_URL || "https://runfish5.github.io/TermNorm-excel/";

// Deployment Configuration (used for UI path displays)
// - DEPLOYMENT_TYPE: 'development' (default), 'iis', or 'm365'
// - DEPLOYMENT_PATH: Filesystem path where files are deployed (optional)
//   * Default: Build directory path (for development)
//   * IIS: e.g., C:\inetpub\wwwroot\termnorm
//   * M365: Not used (no filesystem access)
const deploymentType = process.env.DEPLOYMENT_TYPE || "development";
const deploymentPath = process.env.DEPLOYMENT_PATH || path.resolve(__dirname).replace(/\\/g, "\\\\");

async function getHttpsOptions() {
  const httpsOptions = await devCerts.getHttpsServerOptions();
  return { ca: httpsOptions.ca, key: httpsOptions.key, cert: httpsOptions.cert };
}

module.exports = async (env, options) => {
  const dev = options.mode === "development";
  const config = {
    devtool: "source-map",
    entry: {
      polyfill: ["core-js/stable", "regenerator-runtime/runtime"],
      taskpane: ["./src/taskpane/taskpane.js", "./src/taskpane/taskpane.html"],
    },
    output: {
      clean: true,
    },
    resolve: {
      extensions: [".html", ".js"],
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /node_modules/,
          use: {
            loader: "babel-loader",
            options: {
              presets: ["@babel/preset-env"],
            },
          },
        },
        {
          test: /\.html$/,
          exclude: /node_modules/,
          use: "html-loader",
        },
        {
          test: /\.(png|jpg|jpeg|gif|ico)$/,
          type: "asset/resource",
          generator: {
            filename: "assets/[name][ext][query]",
          },
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        __PROJECT_PATH__: JSON.stringify(deploymentPath),
        __DEPLOYMENT_TYPE__: JSON.stringify(deploymentType),
      }),
      new HtmlWebpackPlugin({
        filename: "taskpane.html",
        template: "./src/taskpane/taskpane.html",
        chunks: ["polyfill", "taskpane"],
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: "assets/*",
            to: "assets/[name][ext][query]",
          },
          {
            from: "config/*",
            to: "config/[name][ext][query]",
          },
          {
            from: "manifest*.xml",
            to: "[name]" + "[ext]",
            transform(content) {
              if (dev) {
                return content;
              } else {
                return content.toString().replace(new RegExp(urlDev, "g"), urlProd);
              }
            },
          },
        ],
      }),
    ],
    devServer: {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      server: {
        type: "https",
        options: env.WEBPACK_BUILD || options.https !== undefined ? options.https : await getHttpsOptions(),
      },
      port: process.env.npm_package_config_dev_server_port || 3000,
    },
  };

  return config;
};
