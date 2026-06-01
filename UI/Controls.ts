import { globalState } from '../Core/State';
import { hasValidApiKey, routingManager } from '../Routing';

export interface ControlsDisabledState {
    generateButton: boolean;
    exportConfigButton: boolean;
    importConfigInput: boolean;
    initialIdeaInput: boolean;
    redTeamButtons: boolean;
    sliders: boolean;
    toggles: boolean;
    sidebarContent: boolean;
    providersButton: boolean;
    promptsButton: boolean;
}

export function computeIsGenerating(): boolean {
    const { activeDeepthinkPipeline, isAgenticRunning, isContextualRunning, isAdaptiveDeepthinkRunning, isDCARunning } = globalState;

    const deepthinkPipelineRunningOrStopping = activeDeepthinkPipeline?.status === 'processing' || activeDeepthinkPipeline?.status === 'stopping';

    return deepthinkPipelineRunningOrStopping || isAgenticRunning || isContextualRunning || isAdaptiveDeepthinkRunning || isDCARunning;
}

export function computeIsApiKeyReady(): boolean {
    return hasValidApiKey();
}

export function computeControlsDisabledState(): ControlsDisabledState {
    const isGenerating = computeIsGenerating();
    const isApiKeyReady = computeIsApiKeyReady();

    return {
        generateButton: isGenerating || !isApiKeyReady,
        exportConfigButton: isGenerating,
        importConfigInput: isGenerating,
        initialIdeaInput: isGenerating,
        redTeamButtons: isGenerating,
        sliders: isGenerating,
        toggles: isGenerating,
        sidebarContent: isGenerating,
        providersButton: isGenerating,
        promptsButton: isGenerating
    };
}

export function updateControlsState(): void {
    const disabledState = computeControlsDisabledState();

    const generateButton = document.getElementById('generate-button') as HTMLButtonElement;
    if (generateButton) {
        generateButton.disabled = disabledState.generateButton;
    }

    const exportConfigButton = document.getElementById('export-config-button') as HTMLButtonElement;
    const importConfigInput = document.getElementById('import-config-input') as HTMLInputElement;
    const importConfigButton = document.getElementById('import-config-button') as HTMLButtonElement;
    const initialIdeaInput = document.getElementById('initial-idea') as HTMLTextAreaElement;

    if (exportConfigButton) exportConfigButton.disabled = disabledState.exportConfigButton;
    if (importConfigInput) importConfigInput.disabled = disabledState.importConfigInput;
    if (importConfigButton) {
        importConfigButton.disabled = disabledState.importConfigInput;
        importConfigButton.classList.toggle('disabled', disabledState.importConfigInput);
    }
    if (initialIdeaInput) initialIdeaInput.disabled = disabledState.initialIdeaInput;

    const redTeamButtons = document.querySelectorAll('.red-team-button');
    redTeamButtons.forEach(button => {
        (button as HTMLButtonElement).disabled = disabledState.redTeamButtons;
    });

    const sliders = document.querySelectorAll('.slider');
    sliders.forEach(slider => {
        (slider as HTMLInputElement).disabled = disabledState.sliders;
    });

    const toggles = document.querySelectorAll('input[type="checkbox"]:not([id*="pipeline"])');
    toggles.forEach(toggle => {
        (toggle as HTMLInputElement).disabled = disabledState.toggles;
    });

    routingManager.updatePromptsModalState(disabledState.generateButton);

    const sidebarContent = document.querySelector('#controls-sidebar .sidebar-content');
    if (sidebarContent) {
        (sidebarContent as HTMLElement).style.pointerEvents = disabledState.sidebarContent ? 'none' : 'auto';
        (sidebarContent as HTMLElement).style.opacity = disabledState.sidebarContent ? '0.6' : '1';
    }

    const providersButton = document.getElementById('add-providers-trigger');
    if (providersButton) {
        (providersButton as HTMLButtonElement).disabled = disabledState.providersButton;
    }
    const promptsButton = document.getElementById('prompts-trigger');
    if (promptsButton) {
        (promptsButton as HTMLButtonElement).disabled = disabledState.promptsButton;
    }

    globalState.isGenerating = computeIsGenerating();
}
