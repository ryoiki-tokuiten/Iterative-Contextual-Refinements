import * as Diff from 'diff';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContentEntry {
    title: string;
    content: string;
}

export interface LineEntry {
    text: string;
    type: 'added' | 'removed' | 'unchanged';
    side: 'left' | 'right' | 'both';
    isSpacer?: boolean;
}

export interface SplitDiffResult {
    leftLines: LineEntry[];
    rightLines: LineEntry[];
}

// ─── Diff Computation ─────────────────────────────────────────────────────────

export function computeUnifiedDiffLines(prevContent: string, currentContent: string): LineEntry[] {
    const diffs = Diff.diffLines(prevContent, currentContent);
    const lines: LineEntry[] = [];

    for (const part of diffs) {
        const partLines = part.value.split('\n');
        partLines.forEach((line, idx) => {
            if (line === '' && idx === partLines.length - 1) return;
            lines.push({
                text: line || ' ',
                type: part.added ? 'added' : part.removed ? 'removed' : 'unchanged',
                side: 'both'
            });
        });
    }

    return lines;
}

export function computeSplitDiffLines(prevContent: string, currentContent: string): SplitDiffResult {
    const diffs = Diff.diffLines(prevContent, currentContent);
    const leftLines: LineEntry[] = [];
    const rightLines: LineEntry[] = [];

    for (const part of diffs) {
        const partLines = part.value.split('\n');
        partLines.forEach((line, idx) => {
            if (line === '' && idx === partLines.length - 1) return;

            if (part.removed) {
                leftLines.push({ text: line || ' ', type: 'removed', side: 'left' });
                rightLines.push({ text: '\u00a0', type: 'unchanged', side: 'right', isSpacer: true });
            } else if (part.added) {
                leftLines.push({ text: '\u00a0', type: 'unchanged', side: 'left', isSpacer: true });
                rightLines.push({ text: line || ' ', type: 'added', side: 'right' });
            } else {
                leftLines.push({ text: line || ' ', type: 'unchanged', side: 'left' });
                rightLines.push({ text: line || ' ', type: 'unchanged', side: 'right' });
            }
        });
    }

    return { leftLines, rightLines };
}

export function computeInitialLines(content: string): LineEntry[] {
    return content.split('\n').map(line => ({
        text: line || ' ',
        type: 'unchanged' as const,
        side: 'both' as const
    }));
}

// ─── Smooth Scroll Math ───────────────────────────────────────────────────────

export function computeAdaptiveLerp(deltaTime: number, smoothing = 0.5, baseFrameTime = 16.67): number {
    return 1 - Math.pow(smoothing, deltaTime / baseFrameTime);
}

export function computeTargetScrollTop(lineOffsetTop: number, lineHeight: number, containerHeight: number): number {
    return Math.max(0, lineOffsetTop - containerHeight / 2 + lineHeight / 2);
}

// ─── Progress Tracking ────────────────────────────────────────────────────────

export function computeProgressPercent(currentIndex: number, totalLines: number): number {
    if (totalLines === 0) return 0;
    return (currentIndex / totalLines) * 100;
}

export function computeRestoredLineIndex(progressPercent: number, totalLines: number): number {
    return Math.floor(totalLines * (progressPercent / 100));
}

// ─── Speed Config ─────────────────────────────────────────────────────────────

export const SPEED_OPTIONS = [
    { label: '0.5x', ms: 400 },
    { label: '1x',   ms: 200 },
    { label: '2x',   ms: 100 },
    { label: '4x',   ms: 50  },
    { label: '8x',   ms: 25  }
] as const;

export const DEFAULT_SPEED_MS = 200;

// Re-export imperative portal API from the React component file
export { openSequentialViewer } from './SequentialViewer.tsx';
