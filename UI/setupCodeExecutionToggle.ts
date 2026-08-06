/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalState } from '../Core/State';
import { getProviderForCurrentModel } from '../Routing';

export function setSandboxToolExecutionEnabled(enabled: boolean): void {
    globalState.virtualEnvironmentEnabled = enabled;
    window.dispatchEvent(new CustomEvent('sandboxToggled', { detail: { enabled } }));
}

function shouldShowCodeExecutionToggle(currentMode: string): boolean {
    return currentMode === 'contextual' || currentMode === 'adaptive-deepthink';
}

export function setupCodeExecutionToggle(): void {
    const toggle = document.getElementById('sandbox-code-execution-toggle') as HTMLInputElement | null;
    if (!toggle) return;

    toggle.checked = globalState.virtualEnvironmentEnabled;

    toggle.addEventListener('change', () => {
        setSandboxToolExecutionEnabled(toggle.checked);
        console.log('[Code Execution] Toggle changed:', toggle.checked);
    });
}

export function updateCodeExecutionToggleVisibility(currentMode: string): void {
    const container = document.getElementById('contextual-mode-controls');
    if (!container) {
        console.log('[Code Execution] Container not found: #contextual-mode-controls');
        return;
    }

    const shouldShow = shouldShowCodeExecutionToggle(currentMode);
    container.style.display = shouldShow ? 'block' : 'none';

    console.log('[Code Execution] Visibility updated:', {
        currentMode,
        provider: getProviderForCurrentModel(),
        shouldShow
    });
}
