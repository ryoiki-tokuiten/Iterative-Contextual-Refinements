/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { exportConfiguration, handleImportConfiguration } from './ConfigManager';
import { updateUIAfterModeChange } from './AppRouter';
import { initializeEvolutionConvergenceButtons } from '../Styles/Components/Sidebar/ModelParameters';
import {
    ensureAdaptiveDeepthinkInitialized,
    ensureContextualInitialized,
    ensureDeepthinkInitialized,
} from './ModeLoader';

import {
    routingManager,
    initializeRouting,
    hasValidApiKey
} from '../Routing';
import { globalState } from './State';
import { ApplicationMode } from './Types';
import { updateControlsState } from '../UI/Controls';
import { LayoutController } from '../UI/LayoutController';
import { GlobalModals } from '../UI/GlobalModals';
import { countFileTokens, getMediaCounts, DIRECT_CONTEXT_MEDIA_LIMITS, DIRECT_CONTEXT_TOKEN_LIMIT } from '../Styles/Components/Sidebar/FileUploadLogic';

export class App {
    public static init() {
        this.initializeGlobalFunctions();
        this.initializeCoreLogic();
        LayoutController.initialize();
        GlobalModals.initialize();
    }

    private static initializeGlobalFunctions() {
    }

    private static initializeCoreLogic() {
        // Initialize routing system
        initializeRouting();

        // Refresh providers to update available models
        routingManager.refreshProviders();

        this.initializeCustomPromptTextareas();
        updateUIAfterModeChange(); // Called early to set up initial UI logic based on default mode

        initializeEvolutionConvergenceButtons();
        // Default to first mode if none specifically checked (e.g. after import or on fresh load)
        const appModeRadios = document.querySelectorAll('input[name="app-mode"]');
        let modeIsAlreadySet = false;
        appModeRadios.forEach(radio => {
            if ((radio as HTMLInputElement).checked) {
                globalState.currentMode = (radio as HTMLInputElement).value as ApplicationMode;
                modeIsAlreadySet = true;
            }
        });

        if (!modeIsAlreadySet && appModeRadios.length > 0) {
            const firstModeRadio = appModeRadios[0] as HTMLInputElement;
            if (firstModeRadio) {
                firstModeRadio.checked = true;
                globalState.currentMode = firstModeRadio.value as ApplicationMode;
            }
        }

        // The default mode must be captured at UI level and set via globalState
        updateUIAfterModeChange();
        updateControlsState();

        const preloader = document.getElementById('preloader');
        if (preloader) {
            preloader.classList.add('hidden');
        }
    }

    public static async handleGenerate(initialIdea: string) {
        console.log('Generate button clicked');
        console.log('Current mode:', globalState.currentMode);

        if (!hasValidApiKey()) {
            alert("No providers are configured. Please configure at least one AI provider using the 'Add Providers' button.");
            return;
        }

        if (!initialIdea) {
            alert("Please enter an idea, premise, or request.");
            return;
        }

        const directFiles = globalState.directContextFiles;
        const directMedia = getMediaCounts(directFiles);
        if (countFileTokens(directFiles) > DIRECT_CONTEXT_TOKEN_LIMIT
            || directMedia.images > DIRECT_CONTEXT_MEDIA_LIMITS.images) {
            alert(`Direct context exceeds its limit: ${DIRECT_CONTEXT_TOKEN_LIMIT.toLocaleString()} text tokens and ${DIRECT_CONTEXT_MEDIA_LIMITS.images} images. Move files to Context through file-system or remove some files.`);
            return;
        }

        if (globalState.currentMode === 'deepthink') {
            console.log('Starting Deepthink process');
            const deepthink = await ensureDeepthinkInitialized();
            await deepthink.startDeepthinkAnalysisProcess(initialIdea);
        } else if (globalState.currentMode === 'contextual') {
            const contextual = await ensureContextualInitialized();
            await contextual.startContextualProcess(initialIdea, globalState.customPromptsContextualState);
        } else if (globalState.currentMode === 'adaptive-deepthink') {
            const adaptive = await ensureAdaptiveDeepthinkInitialized();
            await adaptive.startAdaptiveDeepthinkProcess(initialIdea, globalState.customPromptsAdaptiveDeepthinkState, globalState.directContextFiles);
        } else {
            console.warn('Unknown or unsupported application mode:', globalState.currentMode);
        }
    }

    public static handleExportConfig() {
        exportConfiguration();
    }

    public static handleImportConfig(e: Event) {
        handleImportConfiguration(e);
    }

    private static initializeCustomPromptTextareas() {
        routingManager.initializePromptsManager(
            { current: globalState.customPromptsDeepthinkState },
            { current: globalState.customPromptsAdaptiveDeepthinkState },
            { current: globalState.customPromptsContextualState }
        );
    }
}
