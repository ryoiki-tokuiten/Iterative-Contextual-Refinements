/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalState } from '../Core/State';
import { getProviderForCurrentModel } from '../Routing';

export function getCodeExecutionToggle(): HTMLInputElement | null {
    return document.getElementById('gemini-code-execution-toggle') as HTMLInputElement | null;
}

export function getContextualModeControls(): HTMLElement | null {
    return document.getElementById('contextual-mode-controls');
}

export function getGeminiCodeExecutionEnabled(): boolean {
    return globalState.geminiCodeExecutionEnabled;
}

export function getPythonToolExecutionEnabled(): boolean {
    return globalState.geminiCodeExecutionEnabled;
}

export function setGeminiCodeExecutionEnabled(enabled: boolean): void {
    globalState.geminiCodeExecutionEnabled = enabled;
}

export function setPythonToolExecutionEnabled(enabled: boolean): void {
    globalState.geminiCodeExecutionEnabled = enabled;
}

export function getCurrentProvider(): string {
    return getProviderForCurrentModel();
}

export function isGeminiProvider(): boolean {
    return getCurrentProvider() === 'gemini';
}

export function isContextualMode(mode: string): boolean {
    return mode === 'contextual';
}

export function shouldShowCodeExecutionToggle(currentMode: string): boolean {
    return isContextualMode(currentMode);
}

export function setToggleChecked(checked: boolean): void {
    const toggle = getCodeExecutionToggle();
    if (toggle) {
        toggle.checked = checked;
    }
}

export function setContainerDisplay(display: 'block' | 'none'): void {
    const container = getContextualModeControls();
    if (container) {
        container.style.display = display;
    }
}

export function setupCodeExecutionToggle(): void {
    const toggle = getCodeExecutionToggle();
    if (!toggle) return;

    setToggleChecked(getGeminiCodeExecutionEnabled());

    toggle.addEventListener('change', () => {
        setGeminiCodeExecutionEnabled(toggle.checked);
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

export function initializeCodeExecutionToggle(): void {
    const toggle = getCodeExecutionToggle();
    if (!toggle) return;

    setToggleChecked(getGeminiCodeExecutionEnabled());
}
