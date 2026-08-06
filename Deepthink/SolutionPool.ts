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
} from './DeepthinkCore';

// Re-export types consumed by the TSX layer
export type { SolutionPoolParsedSolution, SolutionPoolParsedResponse };

// ═══════════════════════════════════════════════════════════════════════
// Actions (side-effectful but no DOM rendering)
// ═══════════════════════════════════════════════════════════════════════

/** Downloads the latest pool snapshot for every branch as a JSON file. */
export function downloadAllLatestPoolsAsJSON(pipelineId: string): void {
    const pipeline = getActiveDeepthinkPipeline();
    if (!pipeline || pipeline.id !== pipelineId) {
        alert('Pipeline not found.');
        return;
    }
    const latestPoolsByBranch = new Map<string, {
        strategy_id: string;
        branch_version: number;
        global_iteration?: number;
        branch_iteration?: number;
        status: string;
        pool: SolutionPoolParsedResponse | string | null;
    }>();

    (pipeline.structuredSolutionPoolAgents || []).forEach(agent => {
        if (agent.status === 'skipped' || (!agent.poolResponse?.trim() && !agent.parsedPoolResponse)) return;

        const branchVersion = agent.branchVersion || 1;
        const key = `${agent.mainStrategyId}-v${branchVersion}`;
        const existing = latestPoolsByBranch.get(key);
        if (existing && (existing.global_iteration || 0) >= (agent.globalIteration || 0)) return;

        latestPoolsByBranch.set(key, {
            strategy_id: agent.mainStrategyId,
            branch_version: branchVersion,
            global_iteration: agent.globalIteration,
            branch_iteration: agent.branchIteration,
            status: agent.status,
            pool: agent.parsedPoolResponse || agent.poolResponse || null,
        });
    });

    if (latestPoolsByBranch.size === 0) {
        alert('No solution pool content available yet. The pool is still initializing.');
        return;
    }

    const payload = {
        schema: 'deepthink-latest-solution-pools-v1',
        pools: Array.from(latestPoolsByBranch.values()),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'all_latest_solution_pools.json';
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
