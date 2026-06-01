/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * StateVersion - State versioning and migration system
 * Enables forward-compatible exports and automatic migrations.
 */

import type { ApplicationMode } from '../Types';

/**
 * Current state version. Increment when making breaking changes to state structure.
 */
export const CURRENT_STATE_VERSION = 1;

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

    /** Application version that created this export (for debugging) */
    _appVersion?: string;

    /** The actual configuration data */
    data: ExportedConfigV1;
}

/**
 * Version 1 of the exported configuration.
 * Simplified structure compared to legacy format.
 */
export interface ExportedConfigV1 {
    // Core application state
    currentMode: ApplicationMode;
    initialIdea: string;
    selectedModel: string;

    // Mode-specific state (type depends on currentMode)
    modeState: unknown;

    // Embedded states (e.g., Agentic state embedded in other modes)
    embeddedStates?: Record<string, unknown>;

    // Custom prompts for all modes
    customPrompts: {
        deepthink?: unknown;
        agentic?: unknown;
        contextual?: unknown;
        adaptiveDeepthink?: unknown;
        dca?: unknown;
    };
    // Model parameters
    modelParameters?: {
        temperature: number;
        topP: number;
        strategiesCount: number;
        subStrategiesCount: number;
        hypothesisCount: number;
        redTeamAggressiveness: string;
        refinementEnabled: boolean;
        skipSubStrategies: boolean;
        dissectedObservationsEnabled: boolean;
        iterativeCorrectionsEnabled: boolean;
        provideAllSolutionsToCorrectors?: boolean;
    };

    // Evolution view data (Deepthink specific)
    solutionPoolVersions?: Array<{ content: string; title: string; timestamp: number }>;

    // Legacy fields for backward compatibility
    // These are populated when importing old formats
    pipelinesState?: unknown[];
    activePipelineId?: number | null;
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

/**
 * Migration function type.
 * Takes state of version N and returns state of version N+1.
 */
type MigrationFn = (state: unknown) => unknown;

/**
 * Registry of migrations from version N to version N+1.
 * Key is the source version.
 */
const migrations: Map<number, MigrationFn> = new Map([
    // Example: Migration from version 1 to 2
    // [1, (state: any) => {
    //     // Add new field with default value
    //     return {
    //         ...state,
    //         newField: 'defaultValue',
    //     };
    // }],
]);

/**
 * Migrate a state object from its current version to the latest version.
 * Applies all necessary migrations in sequence.
 * 
 * @param state The versioned state to migrate
 * @returns The state migrated to CURRENT_STATE_VERSION
 */
export function migrateToLatest(state: VersionedState): VersionedState {
    let currentVersion = state._version;
    let data = state.data;

    // Apply migrations sequentially
    while (currentVersion < CURRENT_STATE_VERSION) {
        const migration = migrations.get(currentVersion);
        if (migration) {
            data = migration(data) as ExportedConfigV1;
        }
        currentVersion++;
    }

    return {
        ...state,
        _version: CURRENT_STATE_VERSION,
        data,
    };
}

/**
 * Convert a legacy (pre-versioned) configuration to the new versioned format.
 * This handles imports from old JSON exports that don't have version metadata.
 * 
 * @param legacyConfig The legacy configuration object
 * @returns A properly versioned state object
 */
export function convertLegacyToVersioned(legacyConfig: Record<string, unknown>): VersionedState {
    // Detect the mode from legacy config
    const currentMode = (legacyConfig.currentMode as ApplicationMode) || 'deepthink';

    // Map legacy state fields to new structure
    const modeState = extractLegacyModeState(legacyConfig, currentMode);

    // Build the new versioned structure
    const data: ExportedConfigV1 = {
        currentMode,
        initialIdea: (legacyConfig.initialIdea as string) || '',
        selectedModel: (legacyConfig.selectedModel as string) || '',
        modeState,
        embeddedStates: undefined,
        customPrompts: {
            deepthink: legacyConfig.customPromptsDeepthinkState,
            agentic: legacyConfig.customPromptsAgentic,
            contextual: legacyConfig.customPromptsContextual,
            adaptiveDeepthink: legacyConfig.customPromptsAdaptiveDeepthink,
            dca: legacyConfig.customPromptsDCA,
        },
        modelParameters: legacyConfig.modelParameters as ExportedConfigV1['modelParameters'],
        solutionPoolVersions: legacyConfig.solutionPoolVersions as ExportedConfigV1['solutionPoolVersions'],
        pipelinesState: legacyConfig.pipelinesState as unknown[],
        activePipelineId: legacyConfig.activePipelineId as number | null,
    };

    return {
        _version: CURRENT_STATE_VERSION,
        _exportedAt: new Date().toISOString(),
        _mode: currentMode,
        data,
    };
}

/**
 * Extract mode-specific state from legacy configuration.
 */
/**
 * Extract mode-specific state from legacy configuration.
 * Must match the State interface expected by each mode's handler.
 */
function extractLegacyModeState(config: Record<string, unknown>, mode: ApplicationMode): unknown {
    switch (mode) {
        case 'deepthink':
            // Deepthink handler expects { pipeline, solutionPoolVersions, activeTabId }
            return {
                pipeline: config.activeDeepthinkPipeline,
                solutionPoolVersions: config.solutionPoolVersions,
                activeTabId: (config.activeDeepthinkPipeline as any)?.activeTabId || 'strategic-solver'
            };
        case 'agentic':
            return config.activeAgenticState;
        case 'contextual':
            return config.activeContextualState;
        case 'adaptive-deepthink':
            return config.activeAdaptiveDeepthinkState;
        case 'dynamic-compute':
            return config.activeDCAState;
        default:
            return null;
    }
}


