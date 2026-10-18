/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
    MAX_HYPOTHESIS_COUNT,
    MAX_STRATEGY_PROXIMITY_LOOPS,
    MAX_HYPOTHESIS_PROXIMITY_LOOPS,
    MAX_DEEPTHINK_DEPTH,
    MAX_DEEPTHINK_STRATEGIES,
} from './ModelConfig.ts';
import { calculateLoopSchedule } from '../Deepthink/core/loopController.ts';
import {
    calculateDeepthinkApiCallsFromParams,
    type DeepthinkApiCallBreakdown,
} from './ApiCallEstimator.ts';

export interface DeepthinkTokenEstimateInput {
    strategiesCount: number;
    strategyProximityLoops?: number;
    hypothesisCount: number;
    hypothesisProximityLoops?: number;
    deepthinkDepth?: number;
    i?: number;
    j?: number;
    k?: number;
    isolateBranches?: boolean;
    codeExecutionEnabled?: boolean;
}

interface TokenRange {
    average: number;
    worst: number;
}

export interface ApiCallRange {
    min: number;
    max: number;
    baseMin?: number;
    baseMax?: number;
    breakdown?: DeepthinkApiCallBreakdown;
    sandboxMultiplier?: { min: number; max: number };
}

export interface DeepthinkTokenEstimate {
    depth: number;
    strategiesCount: number;
    hypothesisCount: number;
    input: TokenRange;
    output: TokenRange;
    total: TokenRange;
    apiCalls: ApiCallRange;
}

interface TokenProfile {
    branchPairContext: number;
    solutionContext: number;
    hypothesisPacketContext: number;
    initialExecutionInput: number;
    hypothesisTestInput: number;
    memoryBankContext: number;
    promptBase: number;
    solutionOutput: number;
    critiqueOutput: number;
    hypothesisTestOutput: number;
    hypothesisGenerationOutputPerHypothesis: number;
    strategyGenerationOutputPerStrategy: number;
    memoryOutput: number;
    bsrOutput: number;
    strategyUpdateOutput: number;
    finalJudgeOutput: number;
    updateBranchShare: number;
    branchPacketShare: number;
}
const CORRECTOR_CONTEXT_CEILING = 195_000;

export const SANDBOX_PER_CALL = {
    input: {
        average: 50_000,
        worst: 350_000,
    },
    output: {
        average: 30_000,
        worst: 250_000,
    },
};

export const SANDBOX_ITERATION_NOISE = {
    min: 256_000,
    max: 512_000,
};

export function getRandomSandboxIterationNoise(): number {
    return Math.floor(Math.random() * (SANDBOX_ITERATION_NOISE.max - SANDBOX_ITERATION_NOISE.min + 1)) + SANDBOX_ITERATION_NOISE.min;
}

const WORST_PROFILE: TokenProfile = {
    branchPairContext: 20_000,
    solutionContext: 12_000,
    hypothesisPacketContext: 8_000,
    initialExecutionInput: 30_000,
    hypothesisTestInput: 5_000,
    memoryBankContext: 4_000,
    promptBase: 5_000,
    solutionOutput: 12_000,
    critiqueOutput: 6_000,
    hypothesisTestOutput: 8_000,
    hypothesisGenerationOutputPerHypothesis: 500,
    strategyGenerationOutputPerStrategy: 500,
    memoryOutput: 4_000,
    bsrOutput: 1_500,
    strategyUpdateOutput: 3_000,
    finalJudgeOutput: 5_000,
    updateBranchShare: 1,
    branchPacketShare: 1,
};

const AVERAGE_PROFILE: TokenProfile = {
    branchPairContext: 4_000,
    solutionContext: 3_500,
    hypothesisPacketContext: 1_750,
    initialExecutionInput: 9_000,
    hypothesisTestInput: 1_800,
    memoryBankContext: 2_000,
    promptBase: 4_000,
    solutionOutput: 3_500,
    critiqueOutput: 1_200,
    hypothesisTestOutput: 1_800,
    hypothesisGenerationOutputPerHypothesis: 300,
    strategyGenerationOutputPerStrategy: 250,
    memoryOutput: 1_400,
    bsrOutput: 600,
    strategyUpdateOutput: 800,
    finalJudgeOutput: 1_500,
    updateBranchShare: 0.2,
    branchPacketShare: 0.5,
};

function clampInteger(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.round(value)));
}

function calculateInputTokens(
    profile: TokenProfile,
    strategyCount: number,
    strategyProximityLoops: number,
    hypothesisCount: number,
    hypothesisProximityLoops: number,
    i: number,
    j: number,
    k: number,
    isolateBranches: boolean
): number {
    const curatedContextEnabled = hypothesisCount > 0;
    const schedule = calculateLoopSchedule(i, j, k, curatedContextEnabled);
    const { standaloneHeartbeats, globalUpdates, totalHeartbeats } = schedule;

    // 1. Seed Strategy Generation (§4.1):
    // Generator runs (1 + strategyProximityLoops) turns, Proximity runs strategyProximityLoops turns
    const seedGenTurns = 1 + strategyProximityLoops;
    let seedGenInput = 0;
    for (let t = 0; t < seedGenTurns; t++) {
        seedGenInput += profile.promptBase + (strategyCount * 500) + (t * strategyCount * 900);
    }
    const seedProxInput = strategyProximityLoops * (profile.promptBase + (strategyCount * 500));
    const seedInput = seedGenInput + seedProxInput;

    // 2. Branch Iterations (§3):
    let branchInput = 0;
    const branchPacketContext = hypothesisCount > 0
        ? hypothesisCount * profile.hypothesisPacketContext * profile.branchPacketShare
        : 0;

    for (let n = 1; n <= i; n++) {
        if (n === 1) {
            // Iteration 1: Solution Attempt + Critique
            const attemptInput = strategyCount * (profile.initialExecutionInput + branchPacketContext);
            const critiqueInput = strategyCount * (profile.solutionContext + profile.solutionOutput);
            branchInput += attemptInput + critiqueInput;
        } else {
            // Window history pairs: iterations since window start (window length j)
            const windowPairs = Math.min((n - 1) % j, j);
            const windowContext = windowPairs * profile.branchPairContext;
            const memBankContext = n > j ? profile.memoryBankContext : 0;
            const peerContext = isolateBranches ? 0 : (strategyCount - 1) * profile.branchPairContext;

            const correctionPerBranch = Math.min(
                profile.branchPairContext + windowContext + memBankContext + peerContext + branchPacketContext,
                CORRECTOR_CONTEXT_CEILING
            );
            branchInput += strategyCount * correctionPerBranch;

            // Critique runs only for n < i (iteration i has NO critique per §3)
            if (n < i) {
                const critiquePerBranch = profile.solutionContext + windowContext + memBankContext + profile.solutionOutput;
                branchInput += strategyCount * critiquePerBranch;
            }
        }
    }

    // 3. Heartbeats (§4.5):
    let heartbeatInput = 0;

    // Standalone heartbeats run Heartbeat DOS when hypotheses enabled (§5.1)
    if (hypothesisCount > 0 && standaloneHeartbeats > 0) {
        const hbDosInput = profile.promptBase +
            strategyCount * (profile.solutionContext + profile.critiqueOutput) +
            (hypothesisCount * profile.hypothesisPacketContext);
        heartbeatInput += standaloneHeartbeats * hbDosInput;
    }

    // Every heartbeat (standalone + GU) runs hypothesis generator + proximity + testers (when hypotheses enabled)
    if (hypothesisCount > 0 && totalHeartbeats > 0) {
        const hypGenTurns = 1 + hypothesisProximityLoops;
        let hypGenTotalInput = 0;
        const hypGenBaseInput = profile.promptBase +
            (strategyCount * profile.solutionContext) +
            1500 +
            (hypothesisCount * profile.hypothesisPacketContext);
        for (let t = 0; t < hypGenTurns; t++) {
            hypGenTotalInput += hypGenBaseInput + (t * 800);
        }
        const hypProxInput = hypothesisProximityLoops * (profile.promptBase + (hypothesisCount * 500));
        const hypTestersInput = hypothesisCount * (profile.hypothesisTestInput + 300);

        heartbeatInput += totalHeartbeats * (hypGenTotalInput + hypProxInput + hypTestersInput);
    }

    // 4. Global Updates (§4.6):
    let globalUpdateInput = 0;
    if (globalUpdates > 0) {
        // Step-i DOS: challenge + latest correction & critique of every branch
        const stepIDosInput = profile.promptBase + strategyCount * (profile.solutionContext + profile.critiqueOutput);

        // BSR: per branch judges window of j iterations
        const bsrInputPerBranch = profile.promptBase + (j * profile.branchPairContext) + profile.memoryBankContext;
        const bsrTotalInput = strategyCount * bsrInputPerBranch;

        // Step iii: Surgical strategy generator update + proximity
        const stratGuTurns = 1 + strategyProximityLoops;
        let stratUpdateInput = 0;
        const stratBaseInput = profile.promptBase + (strategyCount * profile.solutionContext) + 1200;
        for (let t = 0; t < stratGuTurns; t++) {
            stratUpdateInput += stratBaseInput + (t * 800);
        }
        const stratUpdateProxInput = strategyProximityLoops * (profile.promptBase + 1200);

        // Step v: Memory bank distillation on surviving branches
        const survivingRatio = profile === WORST_PROFILE ? 1 : Math.max(0, 1 - profile.updateBranchShare);
        const memDistillInput = strategyCount * survivingRatio * (profile.promptBase + (j * profile.branchPairContext) + profile.memoryBankContext);

        // Replaced/evolved branch first execution & critique
        const updatedBranches = strategyCount * profile.updateBranchShare;
        const reseedInput = updatedBranches * (profile.initialExecutionInput + profile.solutionContext + profile.solutionOutput);

        // Step vi: Step-ii DOS (runs only if hypotheses enabled)
        const stepIiDosInput = hypothesisCount > 0
            ? profile.promptBase + strategyCount * (profile.solutionContext + profile.critiqueOutput) + 1200 + (hypothesisCount * profile.hypothesisPacketContext)
            : 0;

        globalUpdateInput += globalUpdates * (
            stepIDosInput +
            bsrTotalInput +
            stratUpdateInput +
            stratUpdateProxInput +
            memDistillInput +
            reseedInput +
            stepIiDosInput
        );
    }

    // 5. Final Judge (§7, §9):
    const finalJudgeInput = profile.promptBase + (strategyCount * profile.solutionContext);

    return Math.round(seedInput + branchInput + heartbeatInput + globalUpdateInput + finalJudgeInput);
}

function calculateOutputTokens(
    profile: TokenProfile,
    strategyCount: number,
    strategyProximityLoops: number,
    hypothesisCount: number,
    hypothesisProximityLoops: number,
    i: number,
    j: number,
    k: number
): number {
    const curatedContextEnabled = hypothesisCount > 0;
    const schedule = calculateLoopSchedule(i, j, k, curatedContextEnabled);
    const { standaloneHeartbeats, globalUpdates, totalHeartbeats } = schedule;

    // 1. Seed Strategy Generation:
    const seedGenTurns = 1 + strategyProximityLoops;
    const seedGenOutput = seedGenTurns * strategyCount * profile.strategyGenerationOutputPerStrategy;
    const seedProxOutput = strategyProximityLoops * (profile === WORST_PROFILE ? 1500 : 600);
    const seedOutput = seedGenOutput + seedProxOutput;

    // 2. Branch Iterations:
    // Iteration 1: S attempts + S critiques
    // Iterations 2..i-1: S corrections + S critiques
    // Iteration i: S corrections ONLY (no critique per §3)
    const totalCorrections = i * strategyCount; // 1 attempt + (i-1) corrections
    const totalCritiques = Math.max(0, i - 1) * strategyCount; // critique omitted at i
    const branchOutput = (totalCorrections * profile.solutionOutput) + (totalCritiques * profile.critiqueOutput);

    // 3. Heartbeats:
    let heartbeatOutput = 0;

    // Standalone Heartbeat DOS (when hypotheses enabled)
    if (hypothesisCount > 0 && standaloneHeartbeats > 0) {
        heartbeatOutput += standaloneHeartbeats * (profile === WORST_PROFILE ? 3000 : 1500);
    }

    // Every heartbeat runs hypothesis generator + proximity + testers (when hypotheses enabled)
    if (hypothesisCount > 0 && totalHeartbeats > 0) {
        const hypGenTurns = 1 + hypothesisProximityLoops;
        const hypGenOutput = hypGenTurns * hypothesisCount * profile.hypothesisGenerationOutputPerHypothesis;
        const hypProxOutput = hypothesisProximityLoops * (profile === WORST_PROFILE ? 2000 : 800);
        const hypTestersOutput = hypothesisCount * profile.hypothesisTestOutput;
        heartbeatOutput += totalHeartbeats * (hypGenOutput + hypProxOutput + hypTestersOutput);
    }

    // 4. Global Updates:
    let globalUpdateOutput = 0;
    if (globalUpdates > 0) {
        // Step-i DOS
        const stepIDosOutput = profile === WORST_PROFILE ? 2500 : 1200;

        // BSR
        const bsrOutput = strategyCount * profile.bsrOutput;

        // Step iii: Surgical strategy generator update + proximity
        const stratGuTurns = 1 + strategyProximityLoops;
        const stratUpdateOutput = (stratGuTurns * profile.strategyUpdateOutput) +
            (strategyProximityLoops * (profile === WORST_PROFILE ? 1500 : 600));

        // Step v: Memory bank distillation on surviving branches
        const survivingRatio = profile === WORST_PROFILE ? 1 : Math.max(0, 1 - profile.updateBranchShare);
        const memDistillOutput = strategyCount * survivingRatio * profile.memoryOutput;

        // Replaced/evolved branch first execution & critique
        const updatedBranches = strategyCount * profile.updateBranchShare;
        const reseedOutput = updatedBranches * (profile.solutionOutput + profile.critiqueOutput);

        // Step vi: Step-ii DOS (when hypotheses enabled)
        const stepIiDosOutput = hypothesisCount > 0 ? (profile === WORST_PROFILE ? 3500 : 1600) : 0;

        globalUpdateOutput += globalUpdates * (
            stepIDosOutput +
            bsrOutput +
            stratUpdateOutput +
            memDistillOutput +
            reseedOutput +
            stepIiDosOutput
        );
    }

    // 5. Final Judge:
    const finalJudgeOutput = profile.finalJudgeOutput;

    return Math.round(seedOutput + branchOutput + heartbeatOutput + globalUpdateOutput + finalJudgeOutput);
}

export function calculateDeepthinkTokenEstimate(args: DeepthinkTokenEstimateInput): DeepthinkTokenEstimate {
    const strategiesCount = clampInteger(args.strategiesCount, 1, MAX_DEEPTHINK_STRATEGIES);
    const strategyProximityLoops = clampInteger(args.strategyProximityLoops ?? 1, 0, MAX_STRATEGY_PROXIMITY_LOOPS);
    const hypothesisCount = clampInteger(args.hypothesisCount, 0, MAX_HYPOTHESIS_COUNT);
    const hypothesisProximityLoops = clampInteger(args.hypothesisProximityLoops ?? 1, 0, MAX_HYPOTHESIS_PROXIMITY_LOOPS);
    const depth = clampInteger(args.i ?? args.deepthinkDepth ?? 10, 1, MAX_DEEPTHINK_DEPTH);
    const i = depth;
    const j = clampInteger(args.j ?? 5, 3, 8);
    const k = clampInteger(args.k ?? 3, 2, j);
    const isolateBranches = args.isolateBranches === true;

    const averageInput = calculateInputTokens(
        AVERAGE_PROFILE,
        strategiesCount,
        strategyProximityLoops,
        hypothesisCount,
        hypothesisProximityLoops,
        i,
        j,
        k,
        isolateBranches
    );
    const worstInput = calculateInputTokens(
        WORST_PROFILE,
        strategiesCount,
        strategyProximityLoops,
        hypothesisCount,
        hypothesisProximityLoops,
        i,
        j,
        k,
        isolateBranches
    );
    const averageOutput = calculateOutputTokens(
        AVERAGE_PROFILE,
        strategiesCount,
        strategyProximityLoops,
        hypothesisCount,
        hypothesisProximityLoops,
        i,
        j,
        k
    );
    const worstOutput = calculateOutputTokens(
        WORST_PROFILE,
        strategiesCount,
        strategyProximityLoops,
        hypothesisCount,
        hypothesisProximityLoops,
        i,
        j,
        k
    );

    const apiCalls = calculateDeepthinkApiCallsFromParams({
        strategiesCount,
        strategyProximityLoops,
        hypothesisCount,
        hypothesisProximityLoops,
        i,
        j,
        k,
        codeExecutionEnabled: args.codeExecutionEnabled,
        deepthinkCodeExecutionEnabled: args.codeExecutionEnabled,
    } as any);

    const sandboxInputAvg = args.codeExecutionEnabled && apiCalls.baseMin ? apiCalls.baseMin * SANDBOX_PER_CALL.input.average : 0;
    const sandboxInputWorst = args.codeExecutionEnabled && apiCalls.baseMax ? apiCalls.baseMax * SANDBOX_PER_CALL.input.worst : 0;
    const sandboxOutputAvg = args.codeExecutionEnabled && apiCalls.baseMin ? apiCalls.baseMin * SANDBOX_PER_CALL.output.average : 0;
    const sandboxOutputWorst = args.codeExecutionEnabled && apiCalls.baseMax ? apiCalls.baseMax * SANDBOX_PER_CALL.output.worst : 0;

    let sandboxIterationNoiseAvg = 0;
    let sandboxIterationNoiseWorst = 0;
    if (args.codeExecutionEnabled) {
        for (let iter = 1; iter <= i; iter++) {
            sandboxIterationNoiseAvg += getRandomSandboxIterationNoise();
            sandboxIterationNoiseWorst += getRandomSandboxIterationNoise();
        }
        if (sandboxIterationNoiseWorst < sandboxIterationNoiseAvg) {
            const temp = sandboxIterationNoiseAvg;
            sandboxIterationNoiseAvg = sandboxIterationNoiseWorst;
            sandboxIterationNoiseWorst = temp;
        }
    }

    const totalAverageInput = averageInput + sandboxInputAvg + sandboxIterationNoiseAvg;
    const totalWorstInput = worstInput + sandboxInputWorst + sandboxIterationNoiseWorst;
    const totalAverageOutput = averageOutput + sandboxOutputAvg;
    const totalWorstOutput = worstOutput + sandboxOutputWorst;

    return {
        depth: i,
        strategiesCount,
        hypothesisCount,
        input: {
            average: totalAverageInput,
            worst: totalWorstInput,
        },
        output: {
            average: totalAverageOutput,
            worst: totalWorstOutput,
        },
        total: {
            average: totalAverageInput + totalAverageOutput,
            worst: totalWorstInput + totalWorstOutput,
        },
        apiCalls,
    };
}

export function buildDeepthinkTokenTrend(args: Omit<DeepthinkTokenEstimateInput, 'deepthinkDepth' | 'i'> & { maxDepth?: number }): DeepthinkTokenEstimate[] {
    const maxDepth = clampInteger(args.maxDepth ?? MAX_DEEPTHINK_DEPTH, 1, MAX_DEEPTHINK_DEPTH);
    return Array.from({ length: maxDepth }, (_, index) => calculateDeepthinkTokenEstimate({
        ...args,
        deepthinkDepth: index + 1,
        i: index + 1,
    }));
}
