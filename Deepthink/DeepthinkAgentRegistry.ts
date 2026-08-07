/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CustomizablePromptsDeepthink } from './DeepthinkPrompts';

type DeepthinkSystemPromptKey = Extract<keyof CustomizablePromptsDeepthink, `sys_deepthink_${string}`>;
type DeepthinkModelKey = Extract<keyof CustomizablePromptsDeepthink, `model_${string}`>;

export const DEEPTHINK_AGENT_REGISTRY = {
    initialStrategy: {
        label: 'Initial Strategy Generation',
        sandboxRole: 'Main Strategy Generation',
        systemPromptKey: 'sys_deepthink_initialStrategy',
        modelKey: 'model_initialStrategy',
    },
    strategyProximity: {
        label: 'Strategies Proximity',
        sandboxRole: 'Main Strategy Generation',
        systemPromptKey: 'sys_deepthink_strategyProximity',
        modelKey: 'model_strategyProximity',
    },
    hypothesisGeneration: {
        label: 'Hypothesis Generation',
        sandboxRole: 'Hypothesis Generation',
        systemPromptKey: 'sys_deepthink_hypothesisGeneration',
        modelKey: 'model_hypothesisGeneration',
    },
    hypothesisProximity: {
        label: 'Hypothesis Proximity',
        sandboxRole: 'Hypothesis Generation',
        systemPromptKey: 'sys_deepthink_hypothesisProximity',
        modelKey: 'model_hypothesisProximity',
    },
    hypothesisTester: {
        label: 'Hypothesis Testing',
        sandboxRole: 'Hypothesis Testing',
        systemPromptKey: 'sys_deepthink_hypothesisTester',
        modelKey: 'model_hypothesisTester',
    },
    solutionAttempt: {
        label: 'Solution Attempt',
        sandboxRole: 'Solution Attempt',
        systemPromptKey: 'sys_deepthink_solutionAttempt',
        modelKey: 'model_solutionAttempt',
    },
    solutionCritique: {
        label: 'Solution Critique',
        sandboxRole: 'Solution Critique',
        systemPromptKey: 'sys_deepthink_solutionCritique',
        modelKey: 'model_solutionCritique',
    },
    solutionCorrection: {
        label: 'Solution Correction',
        sandboxRole: 'Solution Correction',
        systemPromptKey: 'sys_deepthink_solutionCorrection',
        modelKey: 'model_solutionCorrection',
    },
    structuredSolutionPool: {
        label: 'Structured Solution Pool',
        sandboxRole: 'Structured Solution Pool',
        systemPromptKey: 'sys_deepthink_structuredSolutionPool',
        modelKey: 'model_structuredSolutionPool',
    },
    memoryBank: {
        label: 'Memory Bank',
        sandboxRole: 'Memory Bank',
        systemPromptKey: 'sys_deepthink_memoryBank',
        modelKey: 'model_memoryBank',
    },
    postQualityFilter: {
        label: 'Post Quality Filter',
        sandboxRole: 'Post Quality Filter',
        systemPromptKey: 'sys_deepthink_postQualityFilter',
        modelKey: 'model_postQualityFilter',
    },
    finalJudge: {
        label: 'Final Judge',
        sandboxRole: 'Final Judge',
        systemPromptKey: 'sys_deepthink_finalJudge',
        modelKey: 'model_finalJudge',
    },
} as const satisfies Record<string, {
    label: string;
    sandboxRole: string;
    systemPromptKey: DeepthinkSystemPromptKey;
    modelKey: DeepthinkModelKey;
}>;

export type DeepthinkAgentKind = keyof typeof DEEPTHINK_AGENT_REGISTRY;
export type DeepthinkSandboxRole =
    typeof DEEPTHINK_AGENT_REGISTRY[DeepthinkAgentKind]['sandboxRole'];

export function deepthinkAgentModel(
    agentKind: DeepthinkAgentKind,
    prompts: CustomizablePromptsDeepthink,
    fallbackModel: string,
): string {
    const selected = prompts[DEEPTHINK_AGENT_REGISTRY[agentKind].modelKey];
    return typeof selected === 'string' && selected.trim() ? selected : fallbackModel;
}

export function deepthinkAgentSystemInstruction(
    agentKind: DeepthinkAgentKind,
    prompts: CustomizablePromptsDeepthink,
): string {
    return prompts[DEEPTHINK_AGENT_REGISTRY[agentKind].systemPromptKey];
}
