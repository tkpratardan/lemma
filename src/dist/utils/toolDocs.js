// Shared MCP tool-description strings. Kept in one place so the resolution
// rule reads identically everywhere an agent could otherwise guess an index.
// For tools that act on an existing cell (edit/run/delete): when the user
// names a cell by a bare number ("cell 25", "[25]"), they mean the execution
// count shown after that cell ran — not this array position. Never pass a
// user-given number straight through; call get_state/read_notebook first and
// match on executionCount (or on pasted source text) to find the real index.
export const CELL_INDEX_DESC = '0-based array position from get_state/read_notebook — NOT execution count. A bare number ' +
    '("cell 25") usually means execution count. Match on executionCount or source text via ' +
    'get_state/read_notebook first, before calling this.';
export const INSERT_INDEX_DESC = '0-based insert position; omit to append.';
//# sourceMappingURL=toolDocs.js.map