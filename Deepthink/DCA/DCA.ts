/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { initializeDCACore } from './DCACore';
import { DCAView } from './DCAView';

let dcaRoot: Root | null = null;
let containerNode: HTMLElement | null = null;

/**
 * Initializes the DCA module.
 */
export function initializeDCAModule() {
    initializeDCACore(() => {
        if (dcaRoot) {
            dcaRoot.render(React.createElement(DCAView));
        }
    });
}

/**
 * Renders the DCA mode into the provided container.
 */
export function renderDCAMode(container: HTMLElement) {
    if (!container) return;

    // Clear existing layout if necessary
    const tabsNavContainer = document.getElementById('tabs-nav-container');
    if (tabsNavContainer) tabsNavContainer.innerHTML = '';

    // Handle root reuse or creation
    if (dcaRoot && containerNode && !document.contains(containerNode)) {
        const oldRoot = dcaRoot;
        setTimeout(() => oldRoot.unmount(), 0);
        dcaRoot = null;
        containerNode = null;
    }

    if (!dcaRoot) {
        container.innerHTML = '';
        containerNode = document.createElement('div');
        containerNode.className = 'dca-mode-react-root h-full w-full';
        container.appendChild(containerNode);
        dcaRoot = createRoot(containerNode);
    }

    dcaRoot.render(React.createElement(DCAView));
}

/**
 * Clean up DCA mode state.
 */
export function cleanupDCAMode() {
    if (dcaRoot) {
        dcaRoot.render(null);
    }
}

export { startDCAProcess, getActiveDCAPipeline, setDCAStateForImport } from './DCACore';