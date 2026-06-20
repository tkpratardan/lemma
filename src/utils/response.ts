// Shared MCP tool response helpers.
export function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] };
}

export function jsonText(obj: unknown) {
  return text(JSON.stringify(obj));
}

// A single image content block (base64, no data: prefix) for composing
// mixed text+image tool results.
export function imageBlock(data: string, mimeType: string) {
  return { type: 'image' as const, data, mimeType };
}
