module.exports = function (css) {
  return this.resourcePath.endsWith("/@apitomy/openapi-editor/dist/openapi-editor.css")
    ? `@scope (.registry-openapi-editor) {\n${css}\n}`
    : css;
};
