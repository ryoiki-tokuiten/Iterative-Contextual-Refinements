/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * StateVersion - Current versioned export schema.
 */

import type { ApplicationMode } from '../Types';

/**
 * Current state version. Increment when making breaking changes to state structure.
 */
export const CURRENT_STATE_VERSION = 2;

/**
 * Wrapper for versioned state exports.
 * All exports include version metadata for future migrations.
 */
export interface VersionedState {
    /** State format version */
    _version: number;

    /** ISO timestamp of when the export was created */
    _exportedAt: string;

    /** The mode that was active when exported */
    _mode: ApplicationMode;

    /** The actual configuration data */
    data: ExportedConfig;
}

/**
 * Current exported application state.
 */
export interface ExportedConfig {
    // Core application state
    currentMode: ApplicationMode;
    initialIdea: string;
    selectedModel: string;

    // Mode-specific state (type depends on currentMode)
    modeState: unknown;

    // Embedded states (e.g., Adaptive state embedded in other modes)
    embeddedStates?: Record<string, unknown>;

    // Custom prompts for all modes
    customPrompts: {
        deepthink?: unknown;
        contextual?: unknown;
        adaptiveDeepthink?: unknown;
    };
    // Model parameters
    modelParameters: {
        temperature: number;
        topP: number;
        strategiesCount: number;
        strategyProximityLoops: number;
        subStrategiesCount: number;
        hypothesisCount: number;
        hypothesisProximityLoops: number;
        pqfAggressiveness: string;
        refinementEnabled: boolean;
        skipSubStrategies: boolean;
        dissectedObservationsEnabled: boolean;
        evolvingDfsEnabled: boolean;
        evolvingDfsDepth: number;
        isolateBranches: boolean;
        disableSolutionPool: boolean;
        provideAllSolutionsToCorrectors: boolean;
    };

}

/**
 * Type guard to check if an object is a VersionedState.
 */
export function isVersionedState(obj: unknown): obj is VersionedState {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        '_version' in obj &&
        typeof (obj as VersionedState)._version === 'number' &&
        'data' in obj
    );
}
