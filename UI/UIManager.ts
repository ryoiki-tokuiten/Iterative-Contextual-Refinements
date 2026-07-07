import { globalState } from '../Core/State';
import { ApplicationMode } from '../Core/Types';

export interface PipelineTabData {
    id: number;
    modelName: string;
    temperature: number;
    status: string;
    isActive: boolean;
}

export interface ModeConfig {
    title: string;
    bodyClass: string;
}

const MODE_CONFIGS: Partial<Record<ApplicationMode, ModeConfig>> = {
    'deepthink': { title: 'Deepthink', bodyClass: 'mode-deepthink' },
    'contextual': { title: 'Contextual Refinements', bodyClass: 'mode-contextual' },
    'adaptive-deepthink': { title: 'Adaptive Deepthink', bodyClass: 'mode-adaptive-deepthink' }
};

export function getCurrentModeConfig(): ModeConfig {
    return MODE_CONFIGS[globalState.currentMode] || MODE_CONFIGS['deepthink']!;
}

export function getModeTitle(mode: ApplicationMode): string {
    return MODE_CONFIGS[mode]?.title || 'Deepthink';
}

export function getModeBodyClass(mode: ApplicationMode): string {
    return MODE_CONFIGS[mode]?.bodyClass || 'mode-deepthink';
}

export function getCurrentMode(): ApplicationMode {
    return globalState.currentMode;
}

export function isGenerating(): boolean {
    return globalState.isGenerating;
}

export function getModeRadioValue(): ApplicationMode {
    return globalState.currentMode;
}

export function getHeaderTitleForMode(mode: ApplicationMode): string {
    switch (mode) {
        case 'deepthink': return 'Deepthink';
        case 'contextual': return 'Contextual Refinements';
        case 'adaptive-deepthink': return 'Adaptive Deepthink';
        default: return 'Deepthink';
    }
}

export function getControlVisibility(mode: ApplicationMode): {
    deepthink: boolean;
    adaptiveDeepthink: boolean;
} {
    return {
        deepthink: mode === 'deepthink',
        adaptiveDeepthink: mode === 'adaptive-deepthink'
    };
}

export function setCurrentMode(mode: ApplicationMode) {
    globalState.currentMode = mode;
}
