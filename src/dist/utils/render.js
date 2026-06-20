// Agent-facing output normalizer: shared by every adapter. Text is truncated,
// rich results use the text/plain repr, images become a one-line placeholder
// instead of base64.
const MAX_TEXT = 4000; // per-output character cap before truncation
const READ_OUTPUT_MAX = 2000; // tighter per-cell cap for whole-notebook reads
// Jupyter tracebacks (and some rich reprs) embed ANSI SGR colour codes:
// pure terminal noise to the agent, so strip them.
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
export function stripAnsi(text) {
    return text.replace(ANSI_RE, '');
}
// `note=true` (the default) appends a "[truncated N chars]" note, used for
// captured cell output. `note=false` appends a bare ellipsis, used for short
// cell-source previews in an outline listing.
export function truncate(text, limit, note = true) {
    if (text.length <= limit) {
        return text;
    }
    if (note) {
        return text.slice(0, limit) + `\n… [truncated ${text.length - limit} chars]`;
    }
    return text.slice(0, limit) + '…';
}
// Strip library-internal frames (stdlib, site-packages) from a Python
// traceback string, keeping user code frames ("Cell In[N]" lines) and the
// final error line. Reduces a typical CalledProcessError chain from 15+
// lines to 4-5.
export function compactTraceback(text) {
    if (!text.includes('Traceback (most recent call last)'))
        return text;
    const lines = text.split('\n');
    const kept = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (/^\s+File "(?:\/usr\/(?:local\/)?lib\/|.*[\\/](?:site|dist)-packages[\\/]|.*[\\/]lib[\\/]python\d)/.test(line)) {
            i += 2; // skip stdlib frame header + its code line
            continue;
        }
        if (/^-{20,}$/.test(line.trim())) {
            i++;
            continue;
        } // IPython separator
        kept.push(line);
        i++;
    }
    return kept.join('\n');
}
export function renderForAgent(cell, limit = MAX_TEXT) {
    const parts = [];
    let hasImage = false;
    for (const o of cell.outputs) {
        if (o.kind === 'stream') {
            parts.push(truncate(compactTraceback(stripAnsi(o.data.text ?? '')), limit));
        }
        else if (o.kind === 'execute_result' || o.kind === 'display_data') {
            const text = o.data['text/plain'];
            if (text) {
                parts.push(truncate(stripAnsi(text), limit));
            }
            if (o.data['image/png'] !== undefined) {
                hasImage = true;
            }
        }
        else if (o.kind === 'error') {
            const traceback = o.data.traceback ?? [];
            parts.push(truncate(compactTraceback(stripAnsi(traceback.join('\n'))), limit));
        }
    }
    // Assemble parts into a single trimmed body string.
    let body = parts.filter(Boolean).join('\n').trim();
    if (hasImage) {
        body = (body ? body + '\n' : '') + '[image output]';
    }
    if (!body) {
        body = '[no output]';
    }
    return body;
}
// Untruncated text + raw image bytes for notebook_read_cell_output — where
// renderForAgent's "[image output]" placeholder is meant for compact
// reasoning, this returns the actual bytes for a viewable image block.
export function fullCellOutput(cell) {
    const parts = [];
    const images = [];
    for (const o of cell.outputs) {
        if (o.kind === 'stream') {
            parts.push(stripAnsi(o.data.text ?? ''));
        }
        else if (o.kind === 'execute_result' || o.kind === 'display_data') {
            const text = o.data['text/plain'];
            if (text) {
                parts.push(stripAnsi(text));
            }
            for (const [mime, value] of Object.entries(o.data)) {
                if (mime.startsWith('image/') && mime !== 'image/svg+xml' && typeof value === 'string') {
                    images.push({ mime, base64: value });
                }
            }
        }
        else if (o.kind === 'error') {
            const traceback = o.data.traceback ?? [];
            parts.push(compactTraceback(stripAnsi(traceback.join('\n'))));
        }
    }
    return { text: parts.filter(Boolean).join('\n').trim(), images };
}
const OUTPUT_CHUNK = 4000; // chars per notebook_read_cell_output call
const MAX_IMAGE_B64 = 4_000_000; // ~3 MB decoded; larger is an unbounded-DPI accident
// Shared by pycharm/jupyterlab's notebook_read_cell_output: pages stored text
// (offset-based) and attaches images on the first page only.
export function pagedCellOutput(cell, index, offset) {
    if (!cell) {
        return { content: [{ type: 'text', text: `cell ${index} has no stored output (has it been run?)` }] };
    }
    const { text, images } = fullCellOutput(cell);
    if (!text && images.length === 0) {
        return { content: [{ type: 'text', text: `cell ${index} has no stored output (has it been run?)` }] };
    }
    const start = offset ?? 0;
    const chunk = text.slice(start, start + OUTPUT_CHUNK);
    const end = start + chunk.length;
    let header = `cell ${index} output (${text.length} chars total${start > 0 ? `, from ${start}` : ''})`;
    if (end < text.length) {
        header += ` — ${text.length - end} more; call again with offset=${end}`;
    }
    const content = [{ type: 'text', text: chunk ? `${header}\n${chunk}` : header }];
    if (start === 0) {
        for (const img of images) {
            if (img.base64.length > MAX_IMAGE_B64) {
                content.push({ type: 'text', text: `[skipped one ${img.mime} output: too large to attach — lower the figure DPI/size and re-run]` });
            }
            else {
                content.push({ type: 'image', data: img.base64, mimeType: img.mime });
            }
        }
    }
    return { content };
}
// Shared by pycharm/jupyterlab's notebook_run_all_cells result formatting.
export function formatRunAll(ran, codeCells, failedAt, outputs) {
    const stopped = failedAt !== undefined ? `; stopped at cell ${failedAt} (error)` : '';
    const body = outputs
        .filter((o) => o.output && o.output !== '[no output]')
        .map((o) => `--- cell ${o.index} ---\n${o.output}`)
        .join('\n');
    return `ran ${ran}/${codeCells} code cells${stopped}\n${body}`;
}
// Token-safe structured summary of a whole notebook.
export function notebookSummary(cells) {
    return cells.map((c, index) => {
        const entry = { index, cellType: c.cellType, source: c.source };
        if (c.cellType === 'code') {
            entry.executionCount = c.executionCount;
            entry.error = c.error;
            entry.output = renderForAgent(c, READ_OUTPUT_MAX);
        }
        return entry;
    });
}
//# sourceMappingURL=render.js.map