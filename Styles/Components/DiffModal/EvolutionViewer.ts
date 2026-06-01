import * as Diff from 'diff';
import { ContentState, EvolutionViewerState } from './types';

// ─── Active Viewer Registry ───────────────────────────────────────────────────

const activeEvolutionViewers = new Map<string, EvolutionViewerState>();

export function getActiveEvolutionViewer(sessionId: string): EvolutionViewerState | undefined {
    return activeEvolutionViewers.get(sessionId);
}

export function registerEvolutionViewer(sessionId: string, state: EvolutionViewerState): void {
    activeEvolutionViewers.set(sessionId, state);
}

export function unregisterEvolutionViewer(sessionId: string): void {
    activeEvolutionViewers.delete(sessionId);
}

export function hasEvolutionViewerOpen(sessionId: string): boolean {
    return activeEvolutionViewers.has(sessionId);
}

// ─── Content State Builders ───────────────────────────────────────────────────

export interface HistoryEntry {
    content: string;
    title: string;
    timestamp: number;
}

export function buildContentStatesFromHistory(history: HistoryEntry[]): ContentState[] {
    return history.map((entry, index) => ({
        content: entry.content,
        title: entry.title,
        iterationNumber: index + 1,
        isBugFix: false
    }));
}

// ─── Diff Line Computation ────────────────────────────────────────────────────

export interface DiffLine {
    text: string;
    type: 'added' | 'removed' | 'unchanged';
}

export function computeEvolutionDiff(prevContent: string, currContent: string): DiffLine[] {
    const diffs = Diff.diffLines(prevContent, currContent);
    const lines: DiffLine[] = [];

    for (const part of diffs) {
        const partLines = part.value.split('\n');
        partLines.forEach((line, idx) => {
            // Skip trailing empty line from split
            if (line === '' && idx === partLines.length - 1) return;
            lines.push({
                text: line || ' ',
                type: part.added ? 'added' : part.removed ? 'removed' : 'unchanged'
            });
        });
    }

    return lines;
}

export function splitIntoLines(content: string): string[] {
    return content.split('\n');
}

// Re-export imperative portal API from the React component file
export { openEvolutionViewerFromHistory, updateEvolutionViewerIfOpen, closeEvolutionViewer } from './EvolutionViewer.tsx';
