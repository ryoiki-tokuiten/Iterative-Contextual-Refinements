/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * ConfigManager - Configuration export/import using the new StateSerializer infrastructure.
 * 
 * Features:
 * - MessagePack binary serialization (faster, smaller)
 * - Gzip compression (70-90% size reduction)
 * - Automatic state sanitization (resets processing states)
 * - State versioning with migrations
 * - Backward compatible with legacy JSON exports
 */

import { globalState } from './State';
import {
    getModeHandler,
    sanitizeState,
    serialize,
    deserialize,
    downloadBlob,
    getFileExtension,
    formatBytes,
    estimateSerializedSize,
    CURRENT_STATE_VERSION,
    type VersionedState,
    type ExportedConfigV1,
    isVersionedState,
    convertLegacyToVersioned,
    migrateToLatest,
    type SerializationOptions,
} from './StateSerializer';

// Ensure handlers are registered
import './StateSerializer/handlers';


import { updateUIAfterModeChange } from './AppRouter';
import { createDefaultCustomPromptsDeepthink } from '../Deepthink/DeepthinkPrompts';
import { createDefaultCustomPromptsContextual } from '../Contextual/ContextualPrompts';
import { createDefaultCustomPromptsAdaptiveDeepthink } from '../AdaptiveDeepthink/AdaptiveDeepthinkPrompt';
import { createDefaultCustomPromptsDCA } from '../Deepthink/DCA/DCAPrompts';
import { AGENTIC_SYSTEM_PROMPT } from '../Agentic/AgenticModePrompt';
import {
    routingManager,
    updateCustomPromptTextareasFromState,
    getSelectedModel,
    getSelectedTemperature,
    getSelectedTopP,
    getSelectedStrategiesCount,
    getSelectedSubStrategiesCount,
    getSelectedHypothesisCount,
    getSelectedPqfAggressiveness,
    getRefinementEnabled,
    getSkipSubStrategies,
    getDissectedObservationsEnabled,
    getEvolvingDfsEnabled,
    getEvolvingDfsDepth,
    getIsolateBranchesEnabled,
    getSolutionPoolDisabled,
    getProvideAllSolutionsToCorrectors
} from '../Routing';
import { updateControlsState } from '../UI/Controls';

// DOM Elements Helpers
const getInitialIdeaInput = () => document.getElementById('initial-idea') as HTMLTextAreaElement;

/**
 * Export format options.
 */
export type ExportFormat = 'auto' | 'json' | 'msgpack';

/**
 * Export configuration to a file.
 * 
 * @param format Export format: 'auto' (msgpack+gzip), 'json' (human-readable), 'msgpack' (binary)
 */
export async function exportConfiguration(format: ExportFormat = 'auto'): Promise<void> {
    if (globalState.isGenerating) {
        alert("Cannot export configuration while generation is in progress.");
        return;
    }

    const initialIdeaInput = getInitialIdeaInput();
    const handler = getModeHandler(globalState.currentMode);

    // Get mode-specific state via handler
    const modeState = handler?.getFullState() ?? null;

    // Get embedded state if handler supports it
    let embeddedStates: Record<string, unknown> | undefined;
    if (handler && 'getEmbeddedState' in handler && typeof handler.getEmbeddedState === 'function') {
        const embedded = await handler.getEmbeddedState();
        if (embedded) {
            embeddedStates = { [`${globalState.currentMode}Embedded`]: embedded };
        }
    }

    // Build the versioned config
    const config: VersionedState = {
        _version: CURRENT_STATE_VERSION,
        _exportedAt: new Date().toISOString(),
        _mode: globalState.currentMode,
        data: {
            currentMode: globalState.currentMode,
            initialIdea: initialIdeaInput?.value ?? '',
            selectedModel: getSelectedModel(),
            modeState,
            embeddedStates,
            customPrompts: {
                deepthink: globalState.customPromptsDeepthinkState,
                agentic: globalState.customPromptsAgenticState,
                contextual: globalState.customPromptsContextualState,
                adaptiveDeepthink: globalState.customPromptsAdaptiveDeepthinkState,
                dca: globalState.customPromptsDCAState,
            },
            modelParameters: {
                temperature: getSelectedTemperature(),
                topP: getSelectedTopP(),
                strategiesCount: getSelectedStrategiesCount(),
                subStrategiesCount: getSelectedSubStrategiesCount(),
                hypothesisCount: getSelectedHypothesisCount(),
                pqfAggressiveness: getSelectedPqfAggressiveness(),
                refinementEnabled: getRefinementEnabled(),
                skipSubStrategies: getSkipSubStrategies(),
                dissectedObservationsEnabled: getDissectedObservationsEnabled(),
                evolvingDfsEnabled: getEvolvingDfsEnabled(),
                evolvingDfsDepth: getEvolvingDfsDepth(),
                isolateBranches: getIsolateBranchesEnabled(),
                disableSolutionPool: getSolutionPoolDisabled(),
                provideAllSolutionsToCorrectors: getProvideAllSolutionsToCorrectors(),
            },
        },
    };

    // Determine serialization options based on format
    const options: SerializationOptions = {
        format: format === 'json' ? 'json' : 'msgpack',
        compress: format !== 'json', // Compress unless explicitly JSON
        prettyPrint: format === 'json',
    };

    // Show estimated size for large exports
    const estimatedSize = estimateSerializedSize(config);
    if (estimatedSize > 10 * 1024 * 1024) { // >10MB
        console.log(`Exporting large configuration (~${formatBytes(estimatedSize)}), this may take a moment...`);
    }

    // Serialize and download
    const blob = await serialize(config, options);
    const timestamp = new Date().toISOString().replace(/[:]/g, '-').split('.')[0];
    const extension = getFileExtension(options);
    const filename = `iterative-studio-config-${timestamp}.${extension}`;

    downloadBlob(blob, filename);

    console.log(`Configuration exported: ${filename} (${formatBytes(blob.size)})`);
}

/**
 * Handle importing a configuration file.
 */
export async function handleImportConfiguration(event: Event): Promise<void> {
    if (globalState.isGenerating) {
        alert("Cannot import configuration while generation is in progress.");
        return;
    }

    const fileInputTarget = event.target as HTMLInputElement;
    if (!fileInputTarget.files || fileInputTarget.files.length === 0) {
        return;
    }

    const file = fileInputTarget.files[0];

    try {
        // Deserialize the file (auto-detects format and compression)
        let rawConfig = await deserialize<unknown>(file);

        // Handle versioning
        let versionedConfig: VersionedState;

        if (isVersionedState(rawConfig)) {
            // New format with version metadata
            versionedConfig = migrateToLatest(rawConfig);
        } else {
            // Legacy format without version metadata
            versionedConfig = convertLegacyToVersioned(rawConfig as Record<string, unknown>);
        }

        // Apply the configuration
        await applyConfiguration(versionedConfig);

        console.log(`Configuration imported successfully from ${file.name}`);
    } catch (error) {
        console.error('Failed to import configuration:', error);
        alert(`Failed to import configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
        // Reset the file input
        fileInputTarget.value = '';
    }
}

/**
 * Apply an imported configuration to the application state.
 */
async function applyConfiguration(config: VersionedState): Promise<void> {
    const { data } = config;

    // 1. Restore global mode
    globalState.currentMode = data.currentMode;
    const modeRadio = document.querySelector(`input[name="app-mode"][value="${globalState.currentMode}"]`) as HTMLInputElement;
    if (modeRadio) {
        modeRadio.checked = true;
    }



    // 3. Restore initial idea
    const initialIdeaInput = getInitialIdeaInput();
    if (initialIdeaInput) {
        initialIdeaInput.value = data.initialIdea || '';
    }

    // 4. Clear problem images for non-deepthink modes
    if (globalState.currentMode !== 'deepthink') {
        globalState.currentProblemImages = [];
    }

    // 5. Update UI for mode change
    updateUIAfterModeChange();

    // 6. Reinitialize sidebar controls
    if ((window as any).reinitializeSidebarControls) {
        (window as any).reinitializeSidebarControls();
    }

    // 7. Restore custom prompts
    restoreCustomPrompts(data.customPrompts);
    updateCustomPromptTextareasFromState();

    // 8. Restore model parameters (with delay for UI readiness)
    if (data.modelParameters) {
        setTimeout(() => {
            restoreModelParameters(data.modelParameters!);
        }, 150);
    }

    // 9. Restore mode-specific state via handler
    const handler = getModeHandler(data.currentMode);
    if (handler && data.modeState) {
        const sanitizedState = sanitizeState(data.modeState);
        handler.restoreState(sanitizedState);

        // Restore embedded state if available
        if (data.embeddedStates && 'restoreEmbeddedState' in handler && typeof handler.restoreEmbeddedState === 'function') {
            const embeddedKey = `${data.currentMode}Embedded`;
            if (data.embeddedStates[embeddedKey]) {
                await handler.restoreEmbeddedState(data.embeddedStates[embeddedKey]);
            }
        }

        // Render after state restoration
        handler.renderAfterImport();
    }

    // 10. Update controls state
    updateControlsState();
}

/**
 * Restore custom prompts from imported configuration.
 */
function restoreCustomPrompts(prompts: ExportedConfigV1['customPrompts']): void {
    // Configuration map for restoring prompts
    // Maps the prompt key from export -> global state property -> default value generator
    const promptConfigs = [

        {
            key: 'deepthink' as const,
            target: 'customPromptsDeepthinkState' as const,
            getDefault: createDefaultCustomPromptsDeepthink
        },
        {
            key: 'agentic' as const,
            target: 'customPromptsAgenticState' as const,
            getDefault: () => ({ systemPrompt: AGENTIC_SYSTEM_PROMPT })
        },
        {
            key: 'adaptiveDeepthink' as const,
            target: 'customPromptsAdaptiveDeepthinkState' as const,
            getDefault: createDefaultCustomPromptsAdaptiveDeepthink
        },
        {
            key: 'contextual' as const,
            target: 'customPromptsContextualState' as const,
            getDefault: createDefaultCustomPromptsContextual
        },
        {
            key: 'dca' as const,
            target: 'customPromptsDCAState' as const,
            getDefault: createDefaultCustomPromptsDCA
        }
    ];

    // Iterate and restore
    promptConfigs.forEach(({ key, target, getDefault }) => {
        const value = prompts[key] || getDefault();
        // Deep copy to ensure we don't hold references to export object or defaults
        globalState[target] = JSON.parse(JSON.stringify(value));
    });
}

/**
 * Restore model parameters from imported configuration.
 */
function restoreModelParameters(params: NonNullable<ExportedConfigV1['modelParameters']>): void {
    const modelConfig = routingManager.getModelConfigManager();

    // Older exports predate branch isolation, so importing one must restore the default-off behavior.
    modelConfig.updateParameter('isolateBranches', params.isolateBranches === true);
    // Older exports predate optional pool skipping, so they keep the normal pool behavior.
    modelConfig.updateParameter('disableSolutionPool', params.disableSolutionPool === true);

    // Iterate over all keys in the params object and update if strictly defined
    // This automatically handles any new parameters added to the interface
    Object.keys(params).forEach(key => {
        const paramKey = key as keyof typeof params;
        if (params[paramKey] !== undefined) {
            // Safe to cast as any because the updated internal logic handles validation if needed
            // and the keys come from the strongly typed ExportedConfigV1['modelParameters']
            modelConfig.updateParameter(paramKey as any, params[paramKey]);
        }
    });

    // Sync UI with restored parameters
    const modelSelectionUI = routingManager.getModelSelectionUI();
    if (modelSelectionUI) {
        modelSelectionUI.syncUIWithParameters();
    }
    routingManager.getDeepthinkConfigController().emitFullStateUpdate();
}

// ============================================================================
// LEGACY EXPORT FUNCTION - For backward compatibility
// ============================================================================

/**
 * @deprecated Use exportConfiguration('json') for human-readable exports
 * 
 * Legacy export function that produces the old JSON format.
 * Kept for backward compatibility with external tools.
 */
export async function exportConfigurationLegacy(): Promise<void> {
    // For backward compatibility, we'll just call the new function with JSON format
    return exportConfiguration('json');
}
