/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Repository visibility and write ownership for Deepthink tool agents.
 *
 * The prompt carries role instructions and curated coordination context.
 * These explicit mounts may intentionally expose richer work artifacts.
 */

import type { SandboxRepositoryAccess } from '../Core/SandboxToolRuntime';
import type { DeepthinkSandboxRole } from './DeepthinkAgentRegistry';

export type { DeepthinkSandboxRole } from './DeepthinkAgentRegistry';

export interface DeepthinkSandboxAccessInput {
    repositoryId: string;
    role: DeepthinkSandboxRole;
    strategySlotIndex?: number;
    hypothesisLabel?: string;
    hypothesisRoundNumber?: number;
    selectedHypothesisLabels?: string[];
    selectedHypothesisRoundNumber?: number;
    /** Used by each paired PQF call. */
    assignedStrategySlotIndexes?: number[];
    peerStrategySlotIndexes?: number[];
    repositoryRevision?: string;
}

export const DEEPTHINK_SANDBOX_DIRECTORY_POLICY = {
    strategyDirectory(slotIndex: number): string {
        return `Strategy-${slotIndex + 1}`;
    },

    critiqueDirectory(slotIndex: number): string {
        return `${this.strategyDirectory(slotIndex)}/Critique`;
    },

    solutionPoolDirectory(slotIndex: number): string {
        return `${this.strategyDirectory(slotIndex)}/SolutionPool`;
    },

    hypothesisRoundDirectory(roundNumber: number): string {
        return `Hypothesis-v${roundNumber}`;
    },

    hypothesisDirectory(roundNumber: number, label: string): string {
        return `${this.hypothesisRoundDirectory(roundNumber)}/Hypothesis-${label}`;
    },

    prunedStrategiesDirectory(): string {
        return 'Pruned_Strategies';
    },
};

function unique(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)));
}

function requireStrategySlot(input: DeepthinkSandboxAccessInput): number {
    if (input.strategySlotIndex === undefined || input.strategySlotIndex < 0) {
        throw new Error(`Deepthink sandbox role ${input.role} requires a strategy slot index.`);
    }
    return input.strategySlotIndex;
}

function fullRepositoryRead(repositoryId: string, hidePrunedStrategies = false): SandboxRepositoryAccess {
    return {
        repositoryId,
        fullRepositoryRead: true,
        ...(hidePrunedStrategies ? { hiddenDirectories: [DEEPTHINK_SANDBOX_DIRECTORY_POLICY.prunedStrategiesDirectory()] } : {}),
    };
}

/**
 * Build the least-privileged repository view that matches the Deepthink role.
 * Read-only roles intentionally omit agentDirectory: the backend then mounts
 * the repository read-only and gives only /tmp as private scratch space.
 */
export function buildDeepthinkSandboxRepositoryAccess(input: DeepthinkSandboxAccessInput): SandboxRepositoryAccess {
    const revision = input.repositoryRevision;
    switch (input.role) {
        case 'Main Strategy Generation':
            return { ...fullRepositoryRead(input.repositoryId), revision };

        case 'Hypothesis Generation':
        case 'Final Judge':
            return { ...fullRepositoryRead(input.repositoryId, true), revision };

        case 'Hypothesis Testing':
            if (!input.hypothesisLabel || !input.hypothesisRoundNumber) {
                throw new Error('Hypothesis sandbox access requires a hypothesis label.');
            }
            return {
                repositoryId: input.repositoryId,
                agentDirectory: DEEPTHINK_SANDBOX_DIRECTORY_POLICY.hypothesisDirectory(input.hypothesisRoundNumber, input.hypothesisLabel),
                readableDirectories: [],
                revision,
            };

        case 'Post Quality Filter': {
            const assignedDirectories = (input.assignedStrategySlotIndexes || [])
                .map(DEEPTHINK_SANDBOX_DIRECTORY_POLICY.strategyDirectory);
            return {
                repositoryId: input.repositoryId,
                readableDirectories: unique(assignedDirectories),
                revision,
            };
        }
    }

    const slotIndex = requireStrategySlot(input);
    const currentStrategyDirectory = DEEPTHINK_SANDBOX_DIRECTORY_POLICY.strategyDirectory(slotIndex);
    const currentCritiqueDirectory = DEEPTHINK_SANDBOX_DIRECTORY_POLICY.critiqueDirectory(slotIndex);
    const currentSolutionPoolDirectory = DEEPTHINK_SANDBOX_DIRECTORY_POLICY.solutionPoolDirectory(slotIndex);
    const selectedHypothesisDirectories = (input.selectedHypothesisLabels || [])
        .map(label => DEEPTHINK_SANDBOX_DIRECTORY_POLICY.hypothesisDirectory(input.selectedHypothesisRoundNumber || 1, label));
    const peerStrategyDirectories = (input.peerStrategySlotIndexes || [])
        .filter(index => index !== slotIndex)
        .map(DEEPTHINK_SANDBOX_DIRECTORY_POLICY.strategyDirectory);

    if (input.role === 'Memory Bank') {
        return {
            repositoryId: input.repositoryId,
            readableDirectories: [currentStrategyDirectory],
            revision,
        };
    }

    if (input.role === 'Structured Solution Pool') {
        return {
            repositoryId: input.repositoryId,
            agentDirectory: currentSolutionPoolDirectory,
            readableDirectories: unique([currentStrategyDirectory, ...peerStrategyDirectories, ...selectedHypothesisDirectories]),
            revision,
        };
    }

    if (input.role === 'Solution Critique') {
        return {
            repositoryId: input.repositoryId,
            agentDirectory: currentCritiqueDirectory,
            readableDirectories: [currentStrategyDirectory],
            liveReadableDirectories: [currentStrategyDirectory],
            hiddenDirectories: [currentSolutionPoolDirectory],
            revision,
        };
    }

    const readableDirectories = [
        ...selectedHypothesisDirectories,
        ...peerStrategyDirectories,
        ...(input.role === 'Solution Correction' ? [currentCritiqueDirectory] : []),
        ...(input.role === 'Solution Correction' ? [currentSolutionPoolDirectory] : []),
    ];

    const hiddenDirectories = input.role === 'Solution Attempt'
        ? [currentCritiqueDirectory, currentSolutionPoolDirectory]
        : [];

    return {
        repositoryId: input.repositoryId,
        agentDirectory: currentStrategyDirectory,
        readableDirectories: unique(readableDirectories),
        ...(hiddenDirectories.length ? { hiddenDirectories } : {}),
        revision,
    };
}
