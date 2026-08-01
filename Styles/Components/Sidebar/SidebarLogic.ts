import { globalState } from '../../../Core/State';

export type AppMode = 'deepthink' | 'adaptive-deepthink' | 'contextual';

export function getShowFileUploadForMode(mode: AppMode): boolean {
    return mode === 'deepthink' || mode === 'adaptive-deepthink';
}

export function createModeChangeHandler(
    setCurrentMode: (mode: AppMode) => void
): (e: Event) => void {
    return (e: Event) => {
        const target = e.target as HTMLInputElement;
        if (target.name === 'app-mode') {
            const newMode = target.value as AppMode;
            setCurrentMode(newMode);
            globalState.currentMode = newMode;
        }
    };
}

export function attachModeChangeListener(
    handler: (e: Event) => void
): { cleanup: () => void } {
    const modeSelector = document.getElementById('app-mode-selector');
    if (modeSelector) {
        modeSelector.addEventListener('change', handler);
    }
    return {
        cleanup: () => {
            if (modeSelector) {
                modeSelector.removeEventListener('change', handler);
            }
        }
    };
}
