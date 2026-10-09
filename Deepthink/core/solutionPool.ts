/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SolutionPool — Pure solution-pool data and download logic.
 * No DOM manipulation. React components live in SolutionPool.tsx.
 */

import {
    DeepthinkPipelineState,
    getActiveDeepthinkPipeline,
    SolutionPoolParsedSolution,
    SolutionPoolParsedResponse,
} from './deepthinkCore';

// Re-export types consumed by the TSX layer
export type { SolutionPoolParsedSolution, SolutionPoolParsedResponse };

// ═══════════════════════════════════════════════════════════════════════
// Actions (side-effectful but no DOM rendering)
// ═══════════════════════════════════════════════════════════════════════



// ═══════════════════════════════════════════════════════════════════════
// Data Extraction Helpers (consumed by React components)
// ═══════════════════════════════════════════════════════════════════════

/** Computes the iteration count for the structured noise tab grid. */
export function computeIterationCount(process: DeepthinkPipelineState): number {
    const maxCritiques = process.initialStrategies.reduce((max, strategy) => {
        const count = process.solutionCritiques.filter(c => c.mainStrategyId === strategy.id).length;
        return Math.max(max, count);
    }, 0);
    return Math.max(maxCritiques, 1);
}
