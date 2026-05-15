/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { exportConfiguration, handleImportConfiguration } from './ConfigManager';
import { updateUIAfterModeChange, renderActiveMode } from './AppRouter';
import { initializeEvolutionConvergenceButtons } from '../Styles/Components/Sidebar/ModelParameters';
import {
    ensureAdaptiveDeepthinkInitialized,
    ensureAgenticInitialized,
    ensureContextualInitialized,
    ensureDeepthinkInitialized,
    loadWebsiteLogic,
    setAgenticPromptsManagerForLazyLoad
} from './ModeLoader';

import {
    routingManager,
    initializeRouting,
    hasValidApiKey,
    getProviderForCurrentModel
} from '../Routing';
import { globalState } from './State';
import { ApplicationMode } from './Types';
import { updateControlsState } from '../UI/Controls';
import { LayoutController } from '../UI/LayoutController';
import { GlobalModals } from '../UI/GlobalModals';

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

        // Validate file compatibility with selected provider in Deepthink modes
        if ((globalState.currentMode === 'deepthink' || globalState.currentMode === 'adaptive-deepthink') &&
            globalState.currentProblemImages.length > 0) {

            const provider = getProviderForCurrentModel();
            const uploadedFiles = globalState.currentProblemImages;

            if (provider === 'openrouter') {
                alert("OpenRouter models do not support file uploads. Please remove all files or select a different provider.");
                return;
            }

            if (provider === 'openai' || provider === 'anthropic') {
                const supportedImageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
                const unsupportedFiles = uploadedFiles.filter(f => !supportedImageTypes.includes(f.mimeType));

                if (unsupportedFiles.length > 0) {
                    const unsupportedTypes = [...new Set(unsupportedFiles.map(f => f.mimeType))].join(', ');
                    alert(`${provider.charAt(0).toUpperCase() + provider.slice(1)} only supports images (PNG, JPEG, GIF, WEBP).\n\nUnsupported file types detected: ${unsupportedTypes}\n\nPlease remove unsupported files or switch to Gemini for full file support.`);
                    return;
                }
            }
        }

        if (globalState.currentMode === 'deepthink') {
            console.log('Starting Deepthink process');
            const firstImage = globalState.currentProblemImages.length > 0 ? globalState.currentProblemImages[0] : null;
            const deepthink = await ensureDeepthinkInitialized();
            await deepthink.startDeepthinkAnalysisProcess(initialIdea, firstImage?.base64, firstImage?.mimeType);
        } else if (globalState.currentMode === 'agentic') {
            console.log('Starting Agentic process');
            try {
                const agentic = await ensureAgenticInitialized();
                await agentic.startAgenticProcess(initialIdea);
            } catch (e) {
                console.error('Error starting Agentic process:', e);
            }
        } else if (globalState.currentMode === 'contextual') {
            const contextual = await ensureContextualInitialized();
            await contextual.startContextualProcess(initialIdea, globalState.customPromptsContextualState);
        } else if (globalState.currentMode === 'adaptive-deepthink') {
            const adaptive = await ensureAdaptiveDeepthinkInitialized();
            await adaptive.startAdaptiveDeepthinkProcess(initialIdea, globalState.customPromptsAdaptiveDeepthinkState, globalState.currentProblemImages);
        } else if (globalState.currentMode === 'dynamic-compute') {
            const { ensureDCAInitialized } = await import('./ModeLoader');
            await ensureDCAInitialized();
            const { startDCAProcess } = await import('../Deepthink/DCA/DCACore');
            startDCAProcess(initialIdea);
        } else { // Website mode
            console.log('Starting Website mode');
            const websiteLogic = await loadWebsiteLogic();
            websiteLogic.initPipelines();
            renderActiveMode();
            console.log('Pipelines initialized:', globalState.pipelinesState.length);
            const runningPromises = globalState.pipelinesState.map(p => websiteLogic.runPipeline(p.id, initialIdea));

            try {
                await Promise.allSettled(runningPromises);
            } finally {
                globalState.isGenerating = false;
                updateControlsState();
            }
        }
    }

    public static handleExportConfig() {
        exportConfiguration();
    }

    public static handleImportConfig(e: Event) {
        handleImportConfiguration(e);
    }

    public static handleDiffModalClick(pipelineId: number, iterationNumber: number, contentType: 'html' | 'text') {
        void import('../Styles/Components/DiffModal/DiffModalController').then((mod) => {
            mod.openDiffModal(pipelineId, iterationNumber, contentType);
        });
    }

    private static initializeCustomPromptTextareas() {
        routingManager.initializePromptsManager(
            { current: globalState.customPromptsWebsiteState },
            { current: globalState.customPromptsDeepthinkState },
            { current: globalState.customPromptsAgenticState },
            { current: globalState.customPromptsAdaptiveDeepthinkState },
            { current: globalState.customPromptsContextualState },
            { current: globalState.customPromptsDCAState }
        );

        const agenticPromptsManager = routingManager.getAgenticPromptsManager();
        if (agenticPromptsManager) {
            setAgenticPromptsManagerForLazyLoad(agenticPromptsManager);
        }
    }
}
