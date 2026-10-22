import { OpenAPIEditor, OpenAPIEditorProps } from "@apitomy/openapi-editor";
import "@apitomy/openapi-editor-styles";

export default function ApitomyEditor(props: OpenAPIEditorProps) {
    return <OpenAPIEditor {...props} features={{ allowImports: false, allowCustomValidations: false }} />;
}
