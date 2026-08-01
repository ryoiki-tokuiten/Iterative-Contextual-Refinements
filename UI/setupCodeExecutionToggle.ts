/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalState } from '../Core/State';
import { getProviderForCurrentModel } from '../Routing';

function getCodeExecutionToggle(): HTMLInputElement | null {
    return document.getElementById('sandbox-code-execution-toggle') as HTMLInputElement | null;
}

function getContextualModeControls(): HTMLElement | null {
    return document.getElementById('contextual-mode-controls');
}

function getSandboxToolExecutionEnabled(): boolean {
    return globalState.virtualEnvironmentEnabled;
}

export function setSandboxToolExecutionEnabled(enabled: boolean): void {
    globalState.virtualEnvironmentEnabled = enabled;
    window.dispatchEvent(new CustomEvent('sandboxToggled', { detail: { enabled } }));
}

function getCurrentProvider(): string {
    return getProviderForCurrentModel();
}

function shouldShowCodeExecutionToggle(currentMode: string): boolean {
    return currentMode === 'contextual' || currentMode === 'adaptive-deepthink';
}

function setToggleChecked(checked: boolean): void {
    const toggle = getCodeExecutionToggle();
    if (toggle) {
        toggle.checked = checked;
    }
}

function setContainerDisplay(display: 'block' | 'none'): void {
    const container = getContextualModeControls();
    if (container) {
        container.style.display = display;
    }
}

export function setupCodeExecutionToggle(): void {
    const toggle = getCodeExecutionToggle();
    if (!toggle) return;

    setToggleChecked(getSandboxToolExecutionEnabled());

    toggle.addEventListener('change', () => {
        setSandboxToolExecutionEnabled(toggle.checked);
        console.log('[Code Execution] Toggle changed:', toggle.checked);
    });
}

export function updateCodeExecutionToggleVisibility(currentMode: string): void {
    const container = getContextualModeControls();
    if (!container) {
        console.log('[Code Execution] Container not found: #contextual-mode-controls');
        return;
    }

    const shouldShow = shouldShowCodeExecutionToggle(currentMode);
    setContainerDisplay(shouldShow ? 'block' : 'none');

    console.log('[Code Execution] Visibility updated:', {
        currentMode,
        provider: getCurrentProvider(),
        shouldShow
    });
}
