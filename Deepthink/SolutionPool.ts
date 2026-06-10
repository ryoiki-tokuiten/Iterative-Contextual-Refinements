/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SolutionPool — Pure data/version management logic.
 * No DOM manipulation. React components live in SolutionPool.tsx.
 */

import { openEvolutionViewerFromHistory } from '../Styles/Components/DiffModal/EvolutionViewer';
import {
    DeepthinkPipelineState,
    getActiveDeepthinkPipeline,
    SolutionPoolParsedSolution,
    SolutionPoolParsedResponse,
} from './DeepthinkCore';

// Re-export types consumed by the TSX layer
export type { SolutionPoolParsedSolution, SolutionPoolParsedResponse };

// ═══════════════════════════════════════════════════════════════════════
// Version History Store
// ═══════════════════════════════════════════════════════════════════════

export interface SolutionPoolVersion {
    content: string;
    title: string;
    timestamp: number;
}

const solutionPoolVersions = new Map<string, SolutionPoolVersion[]>();

function sessionKey(pipelineId: string): string {
    return `solution-pool-${pipelineId}`;
}

/** Appends a new snapshot of the solution pool for a given pipeline. */
export function addSolutionPoolVersion(pipelineId: string, poolContent: string, iterationNumber: number): void {
    if (!pipelineId || !poolContent) return;

    const key = sessionKey(pipelineId);
    let versions = solutionPoolVersions.get(key);
    if (!versions) {
        versions = [];
        solutionPoolVersions.set(key, versions);
    }
    versions.push({ content: poolContent, title: `Iteration ${iterationNumber}`, timestamp: Date.now() });
}

/** Clears stored versions for a pipeline. */
export function clearSolutionPoolVersions(pipelineId: string): void {
    solutionPoolVersions.delete(sessionKey(pipelineId));
}

/** Returns a defensive copy of the version history, or null if empty. */
export function getSolutionPoolVersionsForExport(pipelineId: string): SolutionPoolVersion[] | null {
    const versions = solutionPoolVersions.get(sessionKey(pipelineId));
    return versions && versions.length > 0 ? [...versions] : null;
}

/** Restores version history from a previously exported array. */
export function restoreSolutionPoolVersions(pipelineId: string, versions: SolutionPoolVersion[]): void {
    if (!pipelineId || !versions?.length) return;
    solutionPoolVersions.set(sessionKey(pipelineId), [...versions]);
}

/** Returns the raw version array reference for read-only consumption by the UI layer. */
export function getSolutionPoolVersions(pipelineId: string): SolutionPoolVersion[] | undefined {
    return solutionPoolVersions.get(sessionKey(pipelineId));
}

// ═══════════════════════════════════════════════════════════════════════
// Actions (side-effectful but no DOM rendering)
// ═══════════════════════════════════════════════════════════════════════

/** Opens the diff evolution viewer for a pipeline's solution pool history. */
export function openSolutionPoolEvolution(pipelineId: string): void {
    const key = sessionKey(pipelineId);
    const versions = solutionPoolVersions.get(key);

    if (!versions || versions.length === 0) {
        alert('No solution pool history available yet. The pool needs at least one update to view evolution.');
        return;
    }
    openEvolutionViewerFromHistory(versions, key);
}

/** Downloads the current pool as a JSON file. */
export function downloadSolutionPoolAsJSON(pipelineId: string): void {
    const pipeline = getActiveDeepthinkPipeline();
    if (!pipeline || pipeline.id !== pipelineId) {
        alert('Pipeline not found.');
        return;
    }
    if (!pipeline.structuredSolutionPool?.trim()) {
        alert('No solution pool content available yet. The pool is still initializing.');
        return;
    }

    const blob = new Blob([pipeline.structuredSolutionPool], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'solution_pool.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════════
// Data Extraction Helpers (consumed by React components)
// ═══════════════════════════════════════════════════════════════════════

/** Computes the iteration count for the solution pool tab grid. */
export function computeIterationCount(process: DeepthinkPipelineState): number {
    const maxCritiques = process.initialStrategies.reduce((max, strategy) => {
        const count = process.solutionCritiques.filter(c => c.mainStrategyId === strategy.id).length;
        return Math.max(max, count);
    }, 0);
    return Math.max(maxCritiques, 1);
}
