/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
    MAX_HYPOTHESIS_COUNT,
    MAX_STRATEGY_PROXIMITY_LOOPS,
    MAX_HYPOTHESIS_PROXIMITY_LOOPS,
    ModelConfigManager,
    type ModelParameters,
} from './ModelConfig';

function calculateDeepthinkApiCallsFromParams(params: ModelParameters): { min: number; max: number } {
    const strategiesCount = Math.max(1, Math.min(params.strategiesCount, 5));
    const depth = Math.max(1, Math.min(params.deepthinkDepth, 10));
    const strategyGenerationCalls = 1 + (2 * Math.max(1, Math.min(MAX_STRATEGY_PROXIMITY_LOOPS, params.strategyProximityLoops || 1)));
    const hypothesisCount = Math.max(0, Math.min(MAX_HYPOTHESIS_COUNT, params.hypothesisCount));
    const hypothesisGenerationCalls = 1 + (2 * Math.max(1, Math.min(MAX_HYPOTHESIS_PROXIMITY_LOOPS, params.hypothesisProximityLoops || 1)));

    let minCalls = strategyGenerationCalls;
    let maxCalls = strategyGenerationCalls;

    if (hypothesisCount > 0) {
        const hypothesisRounds = 1 + Math.floor(depth / 2);
        minCalls += hypothesisRounds * (hypothesisGenerationCalls + hypothesisCount);
        maxCalls += hypothesisRounds * (hypothesisGenerationCalls + hypothesisCount);
    }

    const branchCallsPerDepth = params.disableSolutionPool ? 2 : 3;
    minCalls += strategiesCount * depth * branchCallsPerDepth;
    maxCalls += strategiesCount * depth * branchCallsPerDepth;

    const maintenancePasses = Math.floor(depth / 5);
    const bsrAgentCount = strategiesCount;
    minCalls += maintenancePasses * (strategiesCount + bsrAgentCount);
    maxCalls += maintenancePasses * (strategiesCount + bsrAgentCount + strategyGenerationCalls + (strategiesCount * 2));

    minCalls += 1;
    maxCalls += 1;
    return { min: minCalls, max: maxCalls };
}

export class ApiCallEstimator {
    private readonly countElement: HTMLElement | null;

    constructor(private readonly modelConfig: ModelConfigManager) {
        this.countElement = document.getElementById('api-call-count');
    }

    private calculateDeepthinkApiCalls(): { min: number; max: number } {
        return calculateDeepthinkApiCallsFromParams(this.modelConfig.getParameters());
    }

    public updateApiCallDisplay(): void {
        const { min, max } = this.calculateDeepthinkApiCalls();
        if (this.countElement) {
            this.countElement.textContent = min === max ? `~${min}` : `~${min} to ${max}`;
        }
    }
}
