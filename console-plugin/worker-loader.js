// Bridge Vite's ?worker imports used by the shared UI to Webpack's native workers.
module.exports = function () {
  return `export default class MonacoWorker {
    constructor() {
      return new Worker(new URL(${JSON.stringify(this.resourcePath)}, import.meta.url), { type: "module" });
    }
  }`;
};
