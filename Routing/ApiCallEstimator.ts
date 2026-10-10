/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
    MAX_HYPOTHESIS_COUNT,
    MAX_STRATEGY_PROXIMITY_LOOPS,
    MAX_HYPOTHESIS_PROXIMITY_LOOPS,
    MAX_DEEPTHINK_DEPTH,
    ModelConfigManager,
    type ModelParameters,
} from './ModelConfig.ts';
import { calculateLoopSchedule } from '../Deepthink/core/loopController.ts';

export const SANDBOX_API_CALL_MULTIPLIER = {
    min: 12,
    max: 36,
} as const;

export interface DeepthinkApiCallBreakdown {
    initialStrategy: number;
    strategyProximity: { min: number; max: number };
    solutionAttempt: { min: number; max: number };
    solutionCritique: { min: number; max: number };
    solutionCorrection: number;
    dos: number;
    hypothesisGeneration: number;
    hypothesisProximity: number;
    hypothesisTester: number;
    structuredSolutionPool: number;
    bsr: number;
    strategyGeneratorGlobalUpdate: { min: number; max: number };
    memoryBank: { min: number; max: number };
    finalJudge: number;
    standaloneHeartbeats: number;
    globalUpdates: number;
    totalHeartbeats: number;
}

export interface DeepthinkApiCallEstimate {
    min: number;
    max: number;
    baseMin: number;
    baseMax: number;
    breakdown: DeepthinkApiCallBreakdown;
    sandboxMultiplier: { min: number; max: number };
}

export function formatApiCallCount(value: number): string {
    const safeValue = Math.max(0, Number.isFinite(value) ? value : 0);
    if (safeValue >= 1_000_000) {
        const millions = safeValue / 1_000_000;
        return (millions >= 10 ? millions.toFixed(0) : millions.toFixed(1)).replace(/\.0$/, '') + 'M';
    }
    if (safeValue >= 1_000) {
        const thousands = safeValue / 1_000;
        return (thousands >= 100 ? thousands.toFixed(0) : (thousands >= 10 ? thousands.toFixed(0) : thousands.toFixed(1))).replace(/\.0$/, '') + 'k';
    }
    return String(Math.round(safeValue));
}

export function calculateDeepthinkApiCallsFromParams(params: ModelParameters): DeepthinkApiCallEstimate {
    const strategiesCount = Math.max(1, Math.min(params.strategiesCount ?? 3, 5));
    const i = Math.max(1, Math.min(params.i ?? params.deepthinkDepth ?? 10, MAX_DEEPTHINK_DEPTH));
    const j = Math.max(3, Math.min(params.j ?? 5, 8));
    const k = Math.max(2, Math.min(params.k ?? 3, j));
    const strategyProximityLoops = Math.max(0, Math.min(MAX_STRATEGY_PROXIMITY_LOOPS, params.strategyProximityLoops ?? 1));
    const hypothesisCount = Math.max(0, Math.min(MAX_HYPOTHESIS_COUNT, params.hypothesisCount ?? 0));
    const hypothesisProximityLoops = Math.max(0, Math.min(MAX_HYPOTHESIS_PROXIMITY_LOOPS, params.hypothesisProximityLoops ?? 1));
    const disableSolutionPool = params.disableSolutionPool === true;

    const curatedContextEnabled = hypothesisCount > 0 || !disableSolutionPool;
    const schedule = calculateLoopSchedule(i, j, k, curatedContextEnabled);
    const { standaloneHeartbeats, globalUpdates, totalHeartbeats } = schedule;

    // 1. Seed Strategy Generation (§4.1):
    // 1 generator + 2 * strategyProximityLoops turns (gen + prox)
    const seedStrategyCalls = 1 + (2 * strategyProximityLoops);

    // 2. Baseline Branch Iterations (§3):
    // Iteration 1: S attempts + S critiques = 2S
    // Iterations 2..i-1: S corrections + S critiques = 2S * (i - 2)
    // Iteration i: S final corrections ONLY (critique omitted per §3) = S
    // Total for i >= 2 is (2i - 1) * S; for i = 1 is 2S
    const branchIterationCalls = i === 1
        ? 2 * strategiesCount
        : (2 * i - 1) * strategiesCount;

    // 3. Heartbeats (§4.5):
    // Per heartbeat with hypotheses: (1 + 2 * hypothesisProximityLoops) + hypothesisCount testers
    const hypCallsPerHeartbeat = hypothesisCount > 0
        ? (1 + (2 * hypothesisProximityLoops)) + hypothesisCount
        : 0;
    const poolCallsPerHeartbeat = disableSolutionPool ? 0 : strategiesCount;

    // Standalone heartbeats run their own Heartbeat DOS call when hypotheses enabled (§5.1)
    const standaloneHeartbeatCalls = standaloneHeartbeats * (
        (hypothesisCount > 0 ? 1 : 0) +
        hypCallsPerHeartbeat +
        poolCallsPerHeartbeat
    );

    // Heartbeat ending Global Update reuses Step-ii DOS (0 extra DOS calls per §4.5, §4.6 vii)
    const guHeartbeatCalls = curatedContextEnabled
        ? globalUpdates * (hypCallsPerHeartbeat + poolCallsPerHeartbeat)
        : 0;

    // 4. Global Updates (§4.6):
    // Step i: 1 Step-i DOS + S BSR agents
    const guStepICalls = globalUpdates * (1 + strategiesCount);

    // Step vi: 1 Step-ii DOS (only when hypotheses enabled)
    const guStepViCalls = globalUpdates * (hypothesisCount > 0 ? 1 : 0);

    // Step iii & Step v maintenance:
    // Min case: 0 strategy updates (all CONTINUE), S memory bank distillations
    const guMaintenanceMin = globalUpdates * strategiesCount;

    // Max case: changed slots run strategy generator + proximity (1 + 2 * strategyProximityLoops),
    // and pruned slots run first execution + critique (2 * S)
    const guMaintenanceMax = globalUpdates * (
        seedStrategyCalls +
        (2 * strategiesCount)
    );

    // 5. Final Judge (§7, §9): 1 call
    const finalJudgeCalls = 1;

    const baseMin = seedStrategyCalls +
        branchIterationCalls +
        standaloneHeartbeatCalls +
        guHeartbeatCalls +
        guStepICalls +
        guStepViCalls +
        guMaintenanceMin +
        finalJudgeCalls;

    const baseMax = seedStrategyCalls +
        branchIterationCalls +
        standaloneHeartbeatCalls +
        guHeartbeatCalls +
        guStepICalls +
        guStepViCalls +
        guMaintenanceMax +
        finalJudgeCalls;

    const isSandboxEnabled = params.deepthinkCodeExecutionEnabled === true || (params as any).codeExecutionEnabled === true;
    const minMultiplier = isSandboxEnabled ? SANDBOX_API_CALL_MULTIPLIER.min : 1;
    const maxMultiplier = isSandboxEnabled ? SANDBOX_API_CALL_MULTIPLIER.max : 1;

    const min = baseMin * minMultiplier;
    const max = baseMax * maxMultiplier;

    const totalHeartbeatsWithHyp = hypothesisCount > 0 ? totalHeartbeats : 0;
    const totalHeartbeatsWithPools = !disableSolutionPool ? totalHeartbeats : 0;

    const breakdown: DeepthinkApiCallBreakdown = {
        initialStrategy: 1 + strategyProximityLoops,
        strategyProximity: {
            min: strategyProximityLoops,
            max: strategyProximityLoops + (globalUpdates * strategyProximityLoops),
        },
        solutionAttempt: {
            min: strategiesCount,
            max: strategiesCount + (globalUpdates * strategiesCount),
        },
        solutionCritique: {
            min: Math.max(0, i - 1) * strategiesCount,
            max: (Math.max(0, i - 1) * strategiesCount) + (globalUpdates * strategiesCount),
        },
        solutionCorrection: Math.max(0, i - 1) * strategiesCount,
        dos: (standaloneHeartbeats * (hypothesisCount > 0 ? 1 : 0)) +
            (globalUpdates * 1) +
            (globalUpdates * (hypothesisCount > 0 ? 1 : 0)),
        hypothesisGeneration: totalHeartbeatsWithHyp * (1 + hypothesisProximityLoops),
        hypothesisProximity: totalHeartbeatsWithHyp * hypothesisProximityLoops,
        hypothesisTester: totalHeartbeatsWithHyp * hypothesisCount,
        structuredSolutionPool: totalHeartbeatsWithPools * strategiesCount,
        bsr: globalUpdates * strategiesCount,
        strategyGeneratorGlobalUpdate: {
            min: 0,
            max: globalUpdates * (1 + strategyProximityLoops),
        },
        memoryBank: {
            min: globalUpdates * strategiesCount,
            max: 0,
        },
        finalJudge: finalJudgeCalls,
        standaloneHeartbeats,
        globalUpdates,
        totalHeartbeats,
    };

    return {
        min,
        max,
        baseMin,
        baseMax,
        breakdown,
        sandboxMultiplier: { min: minMultiplier, max: maxMultiplier },
    };
}

export class ApiCallEstimator {
    private readonly countElement: HTMLElement | null;
    private readonly modelConfig: ModelConfigManager;

    constructor(modelConfig: ModelConfigManager) {
        this.modelConfig = modelConfig;
        this.countElement = document.getElementById('api-call-count');
    }

    private calculateDeepthinkApiCalls(): { min: number; max: number } {
        return calculateDeepthinkApiCallsFromParams(this.modelConfig.getParameters());
    }

    public updateApiCallDisplay(): void {
        const { min, max } = this.calculateDeepthinkApiCalls();
        if (this.countElement) {
            const formattedMin = formatApiCallCount(min);
            const formattedMax = formatApiCallCount(max);
            this.countElement.textContent = min === max ? `~${formattedMin}` : `~${formattedMin} to ${formattedMax}`;
        }
    }
}
