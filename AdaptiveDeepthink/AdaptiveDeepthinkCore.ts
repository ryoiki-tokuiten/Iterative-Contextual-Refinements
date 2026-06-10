/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Adaptive Deepthink Core
 */

import {
    generateStrategiesAgent,
    generateHypothesesAgent,
    testHypothesesAgent,
    executeStrategiesAgent,
    solutionCritiqueAgent,
    correctedSolutionsAgent,
    selectBestSolutionAgent,
    AgentExecutionContext
} from '../Deepthink/DeepthinkAgents';

// Tool call types for Adaptive Deepthink
export type AdaptiveDeepthinkToolCall =
    | { type: 'GenerateStrategies'; numStrategies: number; specialContext?: string }
    | { type: 'GenerateHypotheses'; numHypotheses: number; specialContext?: string }
    | { type: 'TestHypotheses'; hypothesisIds: string[]; specialContext?: string }
    | { type: 'ExecuteStrategies'; executions: Array<{ strategyId: string; hypothesisIds: string[] }>; specialContext?: string }
    | { type: 'SolutionCritique'; executionIds: string[]; specialContext?: string }
    | { type: 'CorrectedSolutions'; executionIds: string[] }
    | { type: 'SelectBestSolution'; solutionIds: string[] }
    | { type: 'Exit' };

export interface AdaptiveDeepthinkToolPrompts {
    sys_deepthink_initialStrategy: string;
    sys_deepthink_hypothesisGeneration: string;
    sys_deepthink_hypothesisTester: string;
    sys_deepthink_solutionAttempt: string;
    sys_deepthink_solutionCritique: string;
    sys_deepthink_selfImprovement: string;
    sys_deepthink_finalJudge: string;
}

export type AdaptiveDeepthinkToolExecutionContext = AgentExecutionContext;

// State management
export interface AdaptiveDeepthinkState {
    id: string;
    question: string;
    status: 'idle' | 'processing' | 'completed' | 'error';
    error?: string;

    // Data stores with unique IDs
    strategies: Map<string, { text: string }>;
    hypotheses: Map<string, { text: string }>;
    hypothesisTestings: Map<string, { hypothesis: string; testing: string }>;
    executions: Map<string, { strategy: string; execution: string }>;
    critiques: Map<string, { critique: string }>;
    correctedSolutions: Map<string, { strategy: string; correctedSolution: string }>;

    // Final result
    selectedSolution?: string;
}

/**
 * Execute a tool call
 */
export async function executeAdaptiveDeepthinkTool(
    toolCall: AdaptiveDeepthinkToolCall,
    state: AdaptiveDeepthinkState,
    context: AdaptiveDeepthinkToolExecutionContext,
    deepthinkPrompts: AdaptiveDeepthinkToolPrompts,
    images: Array<{ base64: string, mimeType: string }> = []
): Promise<string> {
    try {
        switch (toolCall.type) {
            case 'GenerateStrategies': {
                const response = await generateStrategiesAgent(
                    state.question,
                    toolCall.numStrategies,
                    toolCall.specialContext || '',
                    deepthinkPrompts.sys_deepthink_initialStrategy,
                    context,
                    images
                );

                if (!response.success || !response.data) {
                    return `[ERROR: ${response.error}]`;
                }

                let result = '<Strategies Generated>\n';
                response.data.strategies.forEach((strat: string, idx: number) => {
                    const id = `strategy-${Date.now()}-${idx}`;
                    state.strategies.set(id, { text: strat });
                    result += `<Strategy ID: ${id}>\n${strat}\n</Strategy ID: ${id}>\n\n`;
                });
                result += '</Strategies Generated>';

                return result;
            }

            case 'GenerateHypotheses': {
                const response = await generateHypothesesAgent(
                    state.question,
                    toolCall.numHypotheses,
                    toolCall.specialContext || '',
                    deepthinkPrompts.sys_deepthink_hypothesisGeneration,
                    context,
                    images
                );

                if (!response.success || !response.data) {
                    return `[ERROR: ${response.error}]`;
                }

                let result = '<Hypotheses Generated>\n';
                response.data.hypotheses.forEach((hyp: string, idx: number) => {
                    const id = `hypothesis-${Date.now()}-${idx}`;
                    state.hypotheses.set(id, { text: hyp });
                    result += `<Hypothesis ID: ${id}>\n${hyp}\n</Hypothesis ID: ${id}>\n\n`;
                });
                result += '</Hypotheses Generated>';

                return result;
            }

            case 'TestHypotheses': {
                const response = await testHypothesesAgent(
                    state.question,
                    toolCall.hypothesisIds,
                    state.hypotheses,
                    toolCall.specialContext || '',
                    deepthinkPrompts.sys_deepthink_hypothesisTester,
                    context,
                    images
                );

                if (!response.success || !response.data) {
                    return `[ERROR: ${response.error}]`;
                }

                let result = '<Hypothesis Testing Results>\n';
                response.data.results.forEach((res: any) => {
                    if (res.success) {
                        state.hypothesisTestings.set(res.id, {
                            hypothesis: res.hypothesis,
                            testing: res.testing
                        });
                        result += `<${res.id}>\n`;
                        result += `<Actual Hypothesis>${res.hypothesis}</Actual Hypothesis>\n`;
                        result += `<Hypothesis Testing>${res.testing}</Hypothesis Testing>\n`;
                        result += `</${res.id}>\n\n`;
                    }
                });
                result += '</Hypothesis Testing Results>';

                return result;
            }

            case 'ExecuteStrategies': {
                const response = await executeStrategiesAgent(
                    state.question,
                    toolCall.executions,
                    state.strategies,
                    state.hypothesisTestings,
                    toolCall.specialContext || '',
                    deepthinkPrompts.sys_deepthink_solutionAttempt,
                    context,
                    images
                );

                if (!response.success || !response.data) {
                    return `[ERROR: ${response.error}]`;
                }

                let result = '<Strategy Executions>\n';
                response.data.results.forEach((res: any) => {
                    if (res.success) {
                        const execId = `execution-${res.id}`;
                        state.executions.set(execId, {
                            strategy: res.strategy,
                            execution: res.execution
                        });
                        result += `<Execution ID: ${execId}>\n${res.execution}\n</Execution ID: ${execId}>\n\n`;
                    }
                });
                result += '</Strategy Executions>';

                return result;
            }

            case 'SolutionCritique': {
                const response = await solutionCritiqueAgent(
                    state.question,
                    toolCall.executionIds,
                    state.executions,
                    toolCall.specialContext || '',
                    deepthinkPrompts.sys_deepthink_solutionCritique,
                    context,
                    images
                );

                if (!response.success || !response.data) {
                    return `[ERROR: ${response.error}]`;
                }

                let result = '<Solution Critiques>\n';
                response.data.results.forEach((res: any) => {
                    if (res.success) {
                        state.critiques.set(res.id, { critique: res.critique });
                        result += `<${res.id}: Critique>\n${res.critique}\n</${res.id}: Critique>\n\n`;
                    }
                });
                result += '</Solution Critiques>';

                return result;
            }

            case 'CorrectedSolutions': {
                const response = await correctedSolutionsAgent(
                    state.question,
                    toolCall.executionIds,
                    state.executions,
                    state.critiques,
                    deepthinkPrompts.sys_deepthink_selfImprovement,
                    context,
                    images
                );

                if (!response.success || !response.data) {
                    return `[ERROR: ${response.error}]`;
                }

                let result = '<Corrected Solutions>\n';
                response.data.results.forEach((res: any) => {
                    if (res.success) {
                        const correctedId = `${res.id}:Corrected`;
                        const originalExec = state.executions.get(res.id);
                        if (originalExec) {
                            state.correctedSolutions.set(correctedId, {
                                strategy: originalExec.strategy,
                                correctedSolution: res.correctedSolution
                            });
                            result += `<${correctedId}>\n${res.correctedSolution}\n</${correctedId}>\n\n`;
                        }
                    }
                });
                result += '</Corrected Solutions>';

                return result;
            }

            case 'SelectBestSolution': {
                const response = await selectBestSolutionAgent(
                    state.question,
                    toolCall.solutionIds,
                    state.correctedSolutions,
                    deepthinkPrompts.sys_deepthink_finalJudge,
                    context,
                    images
                );

                if (!response.success || !response.data) {
                    return `[ERROR: ${response.error}]`;
                }

                state.selectedSolution = response.data.selection;
                return `<Best Solution Selected>\n${response.data.selection}\n</Best Solution Selected>`;
            }

            case 'Exit':
                return '<Adaptive Deepthink Exit />';

            default:
                return '[ERROR: Unknown tool type]';
        }
    } catch (error) {
        return `[ERROR: ${error instanceof Error ? error.message : 'Unknown error'}]`;
    }
}

/**
 * Create initial state
 */
export function createAdaptiveDeepthinkState(question: string): AdaptiveDeepthinkState {
    return {
        id: `adaptive-deepthink-${Date.now()}`,
        question,
        status: 'idle',
        strategies: new Map(),
        hypotheses: new Map(),
        hypothesisTestings: new Map(),
        executions: new Map(),
        critiques: new Map(),
        correctedSolutions: new Map()
    };
}
