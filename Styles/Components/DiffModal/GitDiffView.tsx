import React, { useMemo } from 'react';
import { Icon } from '../../../UI/Icons';
import './GitDiffView.css';

export interface SplitDiffRow {
    left?: {
        lineNumber?: number;
        content: string;
        type: 'delete' | 'normal';
    };
    right?: {
        lineNumber?: number;
        content: string;
        type: 'add' | 'normal';
    };
}

export interface GitDiffHunk {
    header: string;
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    splitRows: SplitDiffRow[];
}

export interface GitDiffFile {
    id: string;
    displayPath: string;
    hunks: GitDiffHunk[];
}

export function isHiddenPath(filePath: string): boolean {
    if (!filePath) return false;
    const segments = filePath.split('/');
    return segments.some(segment => segment.startsWith('.') || segment === '__pycache__' || segment === 'node_modules');
}

export function parseGitDiff(raw: string): GitDiffFile[] {
    if (!raw || !raw.trim()) return [];

    const files: GitDiffFile[] = [];
    const lines = raw.split(/\r?\n/);
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith('diff --git ')) {
            const parts = line.slice(11).split(' ');
            let oldPath = parts[0]?.replace(/^[ab]\//, '') || '';
            let newPath = parts[1]?.replace(/^[ab]\//, '') || oldPath;
            let displayPath = newPath || oldPath;

            i++;
            while (i < lines.length && !lines[i].startsWith('diff --git ') && !lines[i].startsWith('@@ ')) {
                const headerLine = lines[i];
                if (headerLine.startsWith('deleted file mode')) {
                    displayPath = oldPath;
                } else if (headerLine.startsWith('rename to ')) {
                    displayPath = headerLine.slice(10).trim();
                } else if (headerLine.startsWith('--- ')) {
                    const p = headerLine.slice(4).trim();
                    if (p !== '/dev/null') oldPath = p.replace(/^[ab]\//, '');
                } else if (headerLine.startsWith('+++ ')) {
                    const p = headerLine.slice(4).trim();
                    if (p === '/dev/null') displayPath = oldPath;
                    else newPath = p.replace(/^[ab]\//, '');
                }
                i++;
            }

            if (isHiddenPath(displayPath) || isHiddenPath(oldPath)) {
                while (i < lines.length && !lines[i].startsWith('diff --git ')) {
                    i++;
                }
                continue;
            }

            const hunks: GitDiffHunk[] = [];

            while (i < lines.length && !lines[i].startsWith('diff --git ')) {
                if (lines[i].startsWith('@@ ')) {
                    const hunkHeaderMatch = lines[i].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
                    if (!hunkHeaderMatch) {
                        i++;
                        continue;
                    }

                    const oldStart = parseInt(hunkHeaderMatch[1], 10);
                    const oldLines = hunkHeaderMatch[2] !== undefined ? parseInt(hunkHeaderMatch[2], 10) : 1;
                    const newStart = parseInt(hunkHeaderMatch[3], 10);
                    const newLines = hunkHeaderMatch[4] !== undefined ? parseInt(hunkHeaderMatch[4], 10) : 1;
                    const header = lines[i];

                    let curOld = oldStart;
                    let curNew = newStart;
                    const hunkRawLines: Array<{ prefix: string; text: string; oldNo?: number; newNo?: number }> = [];

                    i++;
                    while (i < lines.length && !lines[i].startsWith('@@ ') && !lines[i].startsWith('diff --git ')) {
                        const hl = lines[i];
                        if (hl.startsWith('\\')) {
                            i++;
                            continue;
                        }

                        const prefix = hl.charAt(0);
                        const text = hl.slice(1);

                        if (prefix === '+') {
                            hunkRawLines.push({ prefix: '+', text, newNo: curNew++ });
                        } else if (prefix === '-') {
                            hunkRawLines.push({ prefix: '-', text, oldNo: curOld++ });
                        } else {
                            hunkRawLines.push({ prefix: ' ', text, oldNo: curOld++, newNo: curNew++ });
                        }
                        i++;
                    }

                    const splitRows: SplitDiffRow[] = [];
                    let pendingDeletes: Array<{ no: number; text: string }> = [];
                    let pendingAdds: Array<{ no: number; text: string }> = [];

                    const flushPending = () => {
                        const count = Math.max(pendingDeletes.length, pendingAdds.length);
                        for (let k = 0; k < count; k++) {
                            splitRows.push({
                                left: pendingDeletes[k] ? {
                                    lineNumber: pendingDeletes[k].no,
                                    content: pendingDeletes[k].text,
                                    type: 'delete',
                                } : undefined,
                                right: pendingAdds[k] ? {
                                    lineNumber: pendingAdds[k].no,
                                    content: pendingAdds[k].text,
                                    type: 'add',
                                } : undefined,
                            });
                        }
                        pendingDeletes = [];
                        pendingAdds = [];
                    };

                    for (const r of hunkRawLines) {
                        if (r.prefix === '-') {
                            pendingDeletes.push({ no: r.oldNo!, text: r.text });
                        } else if (r.prefix === '+') {
                            pendingAdds.push({ no: r.newNo!, text: r.text });
                        } else {
                            flushPending();
                            splitRows.push({
                                left: {
                                    lineNumber: r.oldNo,
                                    content: r.text,
                                    type: 'normal',
                                },
                                right: {
                                    lineNumber: r.newNo,
                                    content: r.text,
                                    type: 'normal',
                                },
                            });
                        }
                    }
                    flushPending();

                    hunks.push({
                        header,
                        oldStart,
                        oldLines,
                        newStart,
                        newLines,
                        splitRows,
                    });
                } else {
                    i++;
                }
            }

            files.push({
                id: `${oldPath}:${newPath}`,
                displayPath,
                hunks,
            });
        } else {
            i++;
        }
    }

    return files;
}

interface GitDiffViewProps {
    diff: string;
}

export const GitDiffView: React.FC<GitDiffViewProps> = ({ diff }) => {
    const parsedFiles = useMemo(() => parseGitDiff(diff), [diff]);

    if (!diff || !diff.trim() || parsedFiles.length === 0) {
        return (
            <div className="git-diff-view custom-scrollbar">
                <div className="git-diff-empty-state">
                    <p>No changes between selected snapshots.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="git-diff-view custom-scrollbar">
            <div className="git-diff-container">
                {parsedFiles.map(file => (
                    <section key={file.id} className="git-diff-file-section">
                        <div className="git-diff-file-header">
                            <Icon name="file" />
                            <span className="git-diff-file-path">{file.displayPath}</span>
                        </div>

                        {file.hunks.length === 0 ? (
                            <div className="git-diff-empty-hunk">No text differences to display.</div>
                        ) : (
                            <table className="git-diff-split-table">
                                <tbody>
                                    {file.hunks.map((hunk, hIdx) => (
                                        <React.Fragment key={hIdx}>
                                            {hIdx > 0 && (
                                                <tr className="git-diff-divider-row">
                                                    <td colSpan={2} className="git-diff-divider-cell">
                                                        <span>···</span>
                                                    </td>
                                                </tr>
                                            )}
                                            {hunk.splitRows.map((row, rIdx) => (
                                                <tr key={rIdx} className="git-diff-split-row">
                                                    {/* Left / Base Side */}
                                                    <td className={`git-diff-col-side ${row.left ? `git-diff-cell-${row.left.type}` : 'git-diff-cell-empty'}`}>
                                                        <div className="git-diff-side-inner">
                                                            <span className="git-diff-line-number">
                                                                {row.left?.lineNumber ?? ''}
                                                            </span>
                                                            <span className="git-diff-line-code">
                                                                {row.left?.content ?? ''}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    {/* Right / Compare Side */}
                                                    <td className={`git-diff-col-side ${row.right ? `git-diff-cell-${row.right.type}` : 'git-diff-cell-empty'}`}>
                                                        <div className="git-diff-side-inner">
                                                            <span className="git-diff-line-number">
                                                                {row.right?.lineNumber ?? ''}
                                                            </span>
                                                            <span className="git-diff-line-code">
                                                                {row.right?.content ?? ''}
                                                            </span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </section>
                ))}
            </div>
        </div>
    );
};
