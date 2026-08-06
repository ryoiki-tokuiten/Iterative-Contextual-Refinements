/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Root } from 'react-dom/client';
import { renderContextualUI, updateContextualUI, renderEvolvingDfsUI } from './ContextualUI';
import {
    startContextualProcess,
    stopContextualProcess,
    getContextualState,
    setContextualStateForImport,
    setContextualStateUpdateCallback,
    ContextualState,
} from './ContextualCore';

let contextualUIRoot: Root | null = null;
let activeContextualContainer: HTMLElement | null = null;

// Re-export core functional parts for the rest of the app to consume
export {
    startContextualProcess,
    stopContextualProcess,
    getContextualState,
    setContextualStateForImport,
    renderEvolvingDfsUI,
};

/**
 * Initializes the React UI state binding.
 * When the core loop updates the state, it will trigger a React re-render.
 */
setContextualStateUpdateCallback((state: ContextualState) => {
    if (contextualUIRoot && activeContextualContainer) {
        updateContextualUI(contextualUIRoot, state, stopContextualProcess);
    } else {
        renderContextualMode(); // Fallback if somehow triggered before rendering
    }
});

/**
 * Main entry point for rendering the Contextual UI mode.
 * Creates the mount point and delegates strictly to React Component.
 */
export function renderContextualMode() {
    const container = document.getElementById('pipelines-content-container');
    const tabsContainer = document.getElementById('tabs-nav-container');
    const mainHeaderContent = document.querySelector('.main-header-content') as HTMLElement;

    if (!container || !tabsContainer) return;

    if (contextualUIRoot) {
        contextualUIRoot.unmount();
        contextualUIRoot = null;
    }

    // Clear previous containers
    tabsContainer.innerHTML = '';
    container.innerHTML = '';

    // Hide entire header section for Contextual mode (no tabs/header needed)
    if (mainHeaderContent) {
        mainHeaderContent.style.display = 'none';
    }

    const contextualContainer = document.createElement('div');
    contextualContainer.id = 'contextual-container';
    contextualContainer.className = 'pipeline-content active';
    contextualContainer.style.height = '100%';
    container.appendChild(contextualContainer);

    activeContextualContainer = contextualContainer;

    const state = getContextualState();

    if (!state) {
        contextualContainer.innerHTML = '';
        return;
    }

    contextualUIRoot = renderContextualUI(contextualContainer, state, stopContextualProcess);
}
