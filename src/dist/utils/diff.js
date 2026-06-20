// Minimal line-level unified diff (no deps): shared by every adapter.
// Edit = +/- lines, addition = all '+', deletion = all '-'.
const MAX_DIFF_LINES = 200;
export function formatCellDiff(oldText, newText, label = 'cell') {
    const a = oldText.length ? oldText.split('\n') : [];
    const b = newText.length ? newText.split('\n') : [];
    // Longest-common-subsequence table, walked to emit context/removed/added lines.
    const n = a.length;
    const m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    // Walk the LCS table to emit context/removed/added lines.
    const lines = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            lines.push(' ' + a[i]);
            i++;
            j++;
        }
        else if (dp[i + 1][j] >= dp[i][j + 1]) {
            lines.push('-' + a[i]);
            i++;
        }
        else {
            lines.push('+' + b[j]);
            j++;
        }
    }
    while (i < n)
        lines.push('-' + a[i++]);
    while (j < m)
        lines.push('+' + b[j++]);
    // Detect no-op edits and truncate oversized diffs before returning.
    if (!lines.some((l) => l[0] === '+' || l[0] === '-')) {
        return '(no change)';
    }
    let body = lines;
    if (lines.length > MAX_DIFF_LINES) {
        body = lines.slice(0, MAX_DIFF_LINES);
        body.push(`… [diff truncated, ${lines.length - MAX_DIFF_LINES} more lines]`);
    }
    return `--- ${label} (before)\n+++ ${label} (after)\n` + body.join('\n');
}
export function mutationResult(action, diff) {
    return `${action}\n${diff}`;
}
//# sourceMappingURL=diff.js.map