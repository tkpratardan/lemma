// Shared MCP tool response helpers.
export function text(s) {
    return { content: [{ type: 'text', text: s }] };
}
export function jsonText(obj) {
    return text(JSON.stringify(obj));
}
// A single image content block (base64, no data: prefix) for composing
// mixed text+image tool results.
export function imageBlock(data, mimeType) {
    return { type: 'image', data, mimeType };
}
//# sourceMappingURL=response.js.map