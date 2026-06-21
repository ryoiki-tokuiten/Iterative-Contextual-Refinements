/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MAX_HYPOTHESIS_COUNT } from './ModelConfig';

export interface EvolvingDfsTokenEstimateInput {
    strategiesCount: number;
    hypothesisCount: number;
    evolvingDfsDepth: number;
    isolateBranches?: boolean;
    disableSolutionPool?: boolean;
}

export interface TokenRange {
    average: number;
    worst: number;
}

export interface ApiCallRange {
    min: number;
    max: number;
}

export interface EvolvingDfsTokenEstimate {
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
    poolContext: number;
    solutionContext: number;
    hypothesisPacketContext: number;
    initialExecutionInput: number;
    hypothesisTestInput: number;
    memoryBankContext: number;
    promptBase: number;
    solutionOutput: number;
    critiqueOutput: number;
    poolOutput: number;
    hypothesisTestOutput: number;
    hypothesisGenerationOutputPerHypothesis: number;
    strategyGenerationOutputPerStrategy: number;
    memoryOutput: number;
    pqfOutput: number;
    strategyUpdateOutput: number;
    finalJudgeOutput: number;
    updateBranchShare: number;
    selectivePacketShare: number;
}

const MAX_EVOLVING_DFS_STRATEGIES = 5;
const MAX_EVOLVING_DFS_DEPTH = 10;
const MEMORY_INTERVAL = 5;
const HYPOTHESIS_HEARTBEAT_INTERVAL = 2;
const PQF_GROUP_SIZE = 2;
const CORRECTOR_CONTEXT_CEILING = 195_000;
const SOLUTION_POOL_CONTEXT_CEILING = 155_000;

const WORST_PROFILE: TokenProfile = {
    branchPairContext: 20_000,
    poolContext: 15_000,
    solutionContext: 12_000,
    hypothesisPacketContext: 8_000,
    initialExecutionInput: 30_000,
    hypothesisTestInput: 5_000,
    memoryBankContext: 4_000,
    promptBase: 5_000,
    solutionOutput: 12_000,
    critiqueOutput: 6_000,
    poolOutput: 15_000,
    hypothesisTestOutput: 8_000,
    hypothesisGenerationOutputPerHypothesis: 500,
    strategyGenerationOutputPerStrategy: 500,
    memoryOutput: 4_000,
    pqfOutput: 1_500,
    strategyUpdateOutput: 3_000,
    finalJudgeOutput: 5_000,
    updateBranchShare: 1,
    selectivePacketShare: 1,
};

const AVERAGE_PROFILE: TokenProfile = {
    branchPairContext: 4_000,
    poolContext: 2_750,
    solutionContext: 3_500,
    hypothesisPacketContext: 1_750,
    initialExecutionInput: 9_000,
    hypothesisTestInput: 1_800,
    memoryBankContext: 2_000,
    promptBase: 4_000,
    solutionOutput: 3_500,
    critiqueOutput: 1_200,
    poolOutput: 3_200,
    hypothesisTestOutput: 1_800,
    hypothesisGenerationOutputPerHypothesis: 300,
    strategyGenerationOutputPerStrategy: 250,
    memoryOutput: 1_400,
    pqfOutput: 600,
    strategyUpdateOutput: 800,
    finalJudgeOutput: 1_500,
    updateBranchShare: 0.2,
    selectivePacketShare: 0.5,
};

function clampInteger(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.round(value)));
}

function getHypothesisRoundGlobals(depth: number): number[] {
    const rounds = [0];
    for (let globalIteration = HYPOTHESIS_HEARTBEAT_INTERVAL; globalIteration <= depth; globalIteration += HYPOTHESIS_HEARTBEAT_INTERVAL) {
        rounds.push(globalIteration);
    }
    return rounds;
}

function getPqfGroupSizes(strategyCount: number): number[] {
    const sizes: number[] = [];
    for (let remaining = strategyCount; remaining > 0; remaining -= PQF_GROUP_SIZE) {
        sizes.push(Math.min(PQF_GROUP_SIZE, remaining));
    }
    return sizes;
}

function calculateApiCalls(strategyCount: number, hypothesisCount: number, depth: number, disableSolutionPool: boolean): ApiCallRange {
    let min = 1; // Initial strategy generation
    let max = 1;

    if (hypothesisCount > 0) {
        const hypothesisRounds = getHypothesisRoundGlobals(depth).length;
        min += hypothesisRounds * (1 + hypothesisCount);
        max += hypothesisRounds * (1 + hypothesisCount);
    }

    const branchCallsPerDepth = disableSolutionPool ? 2 : 3;
    min += strategyCount * depth * branchCallsPerDepth;
    max += strategyCount * depth * branchCallsPerDepth;

    const maintenancePasses = Math.floor(depth / MEMORY_INTERVAL);
    const pqfAgentCount = Math.ceil(strategyCount / PQF_GROUP_SIZE);
    min += maintenancePasses * (strategyCount + pqfAgentCount);
    max += maintenancePasses * (strategyCount + pqfAgentCount + 1 + (strategyCount * 2));

    min += 1; // Final judging
    max += 1;

    return { min, max };
}

function calculateHypothesisInput(profile: TokenProfile, strategyCount: number, hypothesisCount: number, depth: number): number {
    if (hypothesisCount <= 0) return 0;

    return getHypothesisRoundGlobals(depth).reduce((total, globalIteration, roundIndex) => {
        const previousRoundCount = roundIndex;
        const previousPackets = previousRoundCount * hypothesisCount * profile.hypothesisPacketContext;
        const recentBranchHistory = globalIteration > 0
            ? strategyCount * Math.min(2, globalIteration) * profile.branchPairContext
            : strategyCount * 500;
        const generationInput = profile.promptBase + previousPackets + recentBranchHistory;
        const testingInput = hypothesisCount * profile.hypothesisTestInput;
        return total + generationInput + testingInput;
    }, 0);
}

function calculateBranchInput(
    profile: TokenProfile,
    strategyCount: number,
    hypothesisCount: number,
    depth: number,
    isolateBranches: boolean,
    disableSolutionPool: boolean
): number {
    let input = 0;
    const selectivePacketContext = hypothesisCount *
        profile.hypothesisPacketContext *
        profile.selectivePacketShare;

    for (let currentDepth = 1; currentDepth <= depth; currentDepth++) {
        if (currentDepth === 1) {
            input += strategyCount * (profile.initialExecutionInput + selectivePacketContext);
        } else {
            const currentHistoryPairs = Math.min(currentDepth - 1, MEMORY_INTERVAL);
            const correctionInput = Math.min(
                (isolateBranches ? 0 : (strategyCount - 1) * profile.branchPairContext) +
                (currentHistoryPairs * profile.branchPairContext) +
                (disableSolutionPool ? 0 : profile.poolContext) +
                selectivePacketContext,
                CORRECTOR_CONTEXT_CEILING
            );
            input += strategyCount * correctionInput;
        }

        const critiqueHistoryPairs = Math.min(currentDepth - 1, MEMORY_INTERVAL);
        input += strategyCount * (profile.solutionContext + (critiqueHistoryPairs * profile.branchPairContext));

        if (!disableSolutionPool) {
            const poolContextCount = currentDepth === 1
                ? 0
                : (isolateBranches ? 0 : strategyCount - 1) + Math.min(currentDepth - 1, MEMORY_INTERVAL);
            const poolInput = Math.min(
                profile.branchPairContext +
                (poolContextCount * profile.poolContext) +
                selectivePacketContext,
                SOLUTION_POOL_CONTEXT_CEILING
            );
            input += strategyCount * poolInput;
        }
    }

    return input;
}

function calculateMaintenanceInput(profile: TokenProfile, strategyCount: number, depth: number): number {
    const maintenancePasses = Math.floor(depth / MEMORY_INTERVAL);
    if (maintenancePasses <= 0) return 0;

    const groupSizes = getPqfGroupSizes(strategyCount);
    let input = 0;

    for (let pass = 1; pass <= maintenancePasses; pass++) {
        const memoryInputPerStrategy = profile.promptBase +
            (MEMORY_INTERVAL * profile.branchPairContext) +
            (pass > 1 ? profile.memoryBankContext : 0);
        input += strategyCount * memoryInputPerStrategy;

        input += groupSizes.reduce((total, groupSize) => {
            return total + profile.promptBase + (groupSize * MEMORY_INTERVAL * profile.branchPairContext);
        }, 0);

        const updatedBranches = strategyCount * profile.updateBranchShare;
        if (updatedBranches > 0) {
            input += profile.promptBase +
                (updatedBranches * (profile.branchPairContext + profile.memoryBankContext)) +
                (strategyCount * 500);
            input += updatedBranches * (profile.initialExecutionInput + profile.solutionContext);
        }
    }

    return input;
}

function calculateInputTokens(
    profile: TokenProfile,
    strategyCount: number,
    hypothesisCount: number,
    depth: number,
    isolateBranches: boolean,
    disableSolutionPool: boolean
): number {
    const strategyGenerationInput = profile.promptBase + (strategyCount * 500);
    const finalJudgeInput = profile.promptBase + (strategyCount * profile.solutionContext);

    return Math.round(
        strategyGenerationInput +
        calculateHypothesisInput(profile, strategyCount, hypothesisCount, depth) +
        calculateBranchInput(profile, strategyCount, hypothesisCount, depth, isolateBranches, disableSolutionPool) +
        calculateMaintenanceInput(profile, strategyCount, depth) +
        finalJudgeInput
    );
}

function calculateOutputTokens(
    profile: TokenProfile,
    strategyCount: number,
    hypothesisCount: number,
    depth: number,
    disableSolutionPool: boolean
): number {
    const hypothesisRounds = hypothesisCount > 0 ? getHypothesisRoundGlobals(depth).length : 0;
    const maintenancePasses = Math.floor(depth / MEMORY_INTERVAL);
    const pqfAgentCount = Math.ceil(strategyCount / PQF_GROUP_SIZE);
    const updatedBranches = strategyCount * profile.updateBranchShare * maintenancePasses;

    const branchOutput = strategyCount * depth * (
        profile.solutionOutput +
        profile.critiqueOutput +
        (disableSolutionPool ? 0 : profile.poolOutput)
    );

    const maintenanceOutput = maintenancePasses * (
        (strategyCount * profile.memoryOutput) +
        (pqfAgentCount * profile.pqfOutput) +
        profile.strategyUpdateOutput
    );

    return Math.round(
        (strategyCount * profile.strategyGenerationOutputPerStrategy) +
        branchOutput +
        (hypothesisRounds * hypothesisCount * (
            profile.hypothesisGenerationOutputPerHypothesis +
            profile.hypothesisTestOutput
        )) +
        maintenanceOutput +
        (updatedBranches * (profile.solutionOutput + profile.critiqueOutput)) +
        profile.finalJudgeOutput
    );
}

export function calculateEvolvingDfsTokenEstimate(args: EvolvingDfsTokenEstimateInput): EvolvingDfsTokenEstimate {
    const strategiesCount = clampInteger(args.strategiesCount, 1, MAX_EVOLVING_DFS_STRATEGIES);
    const hypothesisCount = clampInteger(args.hypothesisCount, 0, MAX_HYPOTHESIS_COUNT);
    const depth = clampInteger(args.evolvingDfsDepth, 1, MAX_EVOLVING_DFS_DEPTH);
    const isolateBranches = args.isolateBranches === true;
    const disableSolutionPool = args.disableSolutionPool === true;

    const averageInput = calculateInputTokens(AVERAGE_PROFILE, strategiesCount, hypothesisCount, depth, isolateBranches, disableSolutionPool);
    const worstInput = calculateInputTokens(WORST_PROFILE, strategiesCount, hypothesisCount, depth, isolateBranches, disableSolutionPool);
    const averageOutput = calculateOutputTokens(AVERAGE_PROFILE, strategiesCount, hypothesisCount, depth, disableSolutionPool);
    const worstOutput = calculateOutputTokens(WORST_PROFILE, strategiesCount, hypothesisCount, depth, disableSolutionPool);

    return {
        depth,
        strategiesCount,
        hypothesisCount,
        input: {
            average: averageInput,
            worst: worstInput,
        },
        output: {
            average: averageOutput,
            worst: worstOutput,
        },
        total: {
            average: averageInput + averageOutput,
            worst: worstInput + worstOutput,
        },
        apiCalls: calculateApiCalls(strategiesCount, hypothesisCount, depth, disableSolutionPool),
    };
}

export function buildEvolvingDfsTokenTrend(args: Omit<EvolvingDfsTokenEstimateInput, 'evolvingDfsDepth'> & { maxDepth?: number }): EvolvingDfsTokenEstimate[] {
    const maxDepth = clampInteger(args.maxDepth ?? MAX_EVOLVING_DFS_DEPTH, 1, MAX_EVOLVING_DFS_DEPTH);
    return Array.from({ length: maxDepth }, (_, index) => calculateEvolvingDfsTokenEstimate({
        ...args,
        evolvingDfsDepth: index + 1,
    }));
}
