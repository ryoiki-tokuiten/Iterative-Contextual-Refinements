/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MAX_HYPOTHESIS_COUNT, ModelConfigManager, type ModelParameters } from './ModelConfig';

/**
 * Pure function: calculates the estimated API call range for Deepthink mode.
 * Returns { min, max } to account for variable retry loops.
 */
function calculateDeepthinkApiCallsFromParams(params: ModelParameters): { min: number; max: number } {
    const evolvingDfsEnabled = params.refinementEnabled && params.evolvingDfsEnabled;
    const strategiesCount = evolvingDfsEnabled ? Math.min(params.strategiesCount, 5) : params.strategiesCount;
    const strategyGenerationCalls = 1 + (2 * Math.max(1, Math.min(5, params.strategyProximityLoops || 2)));
    const subStrategiesCount = params.subStrategiesCount;
    const hypothesisCount = Math.max(0, Math.min(MAX_HYPOTHESIS_COUNT, params.hypothesisCount));
    const hypothesisGenerationCalls = 1 + (2 * Math.max(1, Math.min(5, params.hypothesisProximityLoops || 2)));
    const skipSubStrategies = evolvingDfsEnabled ? true : params.skipSubStrategies;
    const refinementEnabled = params.refinementEnabled;
    const dissectedObservationsEnabled = params.dissectedObservationsEnabled;

    let minCalls = 0;
    let maxCalls = 0;

    // 1. Initial strategy seed plus N proximity/revision pairs.
    minCalls += strategyGenerationCalls;
    maxCalls += strategyGenerationCalls;

    // 2. Sub-Strategy Generation (N calls - one per strategy, if not skipped)
    if (!skipSubStrategies && !evolvingDfsEnabled) {
        minCalls += strategiesCount;
        maxCalls += strategiesCount;
    }

    const solutionCount = skipSubStrategies ? strategiesCount : (strategiesCount * subStrategiesCount);

    if (evolvingDfsEnabled) {
        const evolvingDfsDepth = Math.max(1, Math.min(params.evolvingDfsDepth, 10));

        // Initial hypothesis round, plus a heartbeat at every even completed global iteration.
        if (hypothesisCount > 0) {
            const hypothesisRounds = 1 + Math.floor(evolvingDfsDepth / 2);
            minCalls += hypothesisRounds * (hypothesisGenerationCalls + hypothesisCount);
            maxCalls += hypothesisRounds * (hypothesisGenerationCalls + hypothesisCount);
        }

        // For each active strategy branch:
        // Each depth runs execution/correction + critique. Pool calls are optional.
        const branchCallsPerDepth = params.disableSolutionPool ? 2 : 3;
        minCalls += strategiesCount * evolvingDfsDepth * branchCallsPerDepth;
        maxCalls += strategiesCount * evolvingDfsDepth * branchCallsPerDepth;

        // Every five completed branch iterations: memory per branch + ceil(N/2) PQF agents.
        // If PQF requests updates, one strategy-update call plus execution+critique for each updated branch.
        const maintenancePasses = Math.floor(evolvingDfsDepth / 5);
        const pqfAgentCount = Math.ceil(strategiesCount / 2);
        minCalls += maintenancePasses * (strategiesCount + pqfAgentCount);
        maxCalls += maintenancePasses * (strategiesCount + pqfAgentCount + strategyGenerationCalls + (strategiesCount * 2));
    } else {
        // 3. Solution Attempts
        minCalls += solutionCount;
        maxCalls += solutionCount;

        // 4-5. Hypothesis Track (only if hypothesis count > 0)
        if (hypothesisCount > 0) {
            minCalls += hypothesisGenerationCalls + hypothesisCount;
            maxCalls += hypothesisGenerationCalls + hypothesisCount;
        }

        if (refinementEnabled) {
            // Standard Refinement Mode
            minCalls += solutionCount;
            maxCalls += solutionCount;

            if (dissectedObservationsEnabled) {
                minCalls += 1;
                maxCalls += 1;
            }

            minCalls += solutionCount;
            maxCalls += solutionCount;
        }
    }

    // Final Judging (1 call to select best solution)
    minCalls += 1;
    maxCalls += 1;

    return { min: minCalls, max: maxCalls };
}

export class ApiCallEstimator {
    private modelConfig: ModelConfigManager;
    private countElement: HTMLElement | null;

    constructor(modelConfig: ModelConfigManager) {
        this.modelConfig = modelConfig;
        this.countElement = document.getElementById('api-call-count');
    }

    private calculateDeepthinkApiCalls(): { min: number; max: number } {
        return calculateDeepthinkApiCallsFromParams(this.modelConfig.getParameters());
    }

    /**
     * Update the UI with the estimated API call count
     */
    public updateApiCallDisplay(): void {
        const { min, max } = this.calculateDeepthinkApiCalls();
        const currentEstimatedApiCalls = min === max ? `${min}` : `${min} to ${max}`;

        // Update the count display
        if (this.countElement) {
            if (min === max) {
                this.countElement.textContent = `~${min}`;
            } else {
                this.countElement.textContent = `~${min} to ${max}`;
            }
        }

        const sandboxInfoElement = document.getElementById('api-call-sandbox-info');
        if (sandboxInfoElement) {
            const sandboxMessage = `Since virtual env is enabled, each API call now means an agent invocation in a harness. Worst case scenario can be horrible. Think of it like running your cc or codex instance for ${currentEstimatedApiCalls} times on average.`;
            sandboxInfoElement.title = sandboxMessage;
            sandboxInfoElement.setAttribute('aria-label', sandboxMessage);
        }
    }

}
