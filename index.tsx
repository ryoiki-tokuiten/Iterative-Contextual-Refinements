/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import Sidebar from './Styles/Components/Sidebar/Sidebar';
import MainContent from './Styles/Components/MainContent';
import PromptsModalManager from './Routing/PromptsModal/PromptsModalManager';
import { AppInitializer } from './Styles/Components/AppInitializer';
import { VirtualEnvironmentModal } from './UI/VirtualEnvironmentModal';

document.addEventListener('DOMContentLoaded', () => {
    // First, render React components to populate the DOM
    const appContainer = document.getElementById('app-container');
    if (appContainer) {
        const root = createRoot(appContainer);
        root.render(
            <React.StrictMode>
                <AppInitializer />
                <Sidebar />
                <MainContent />
                <VirtualEnvironmentModal />
            </React.StrictMode>
        );
    }

    // Render the prompts modal separately in the body
    const modalContainer = document.createElement('div');
    document.body.appendChild(modalContainer);
    const modalRoot = createRoot(modalContainer);
    modalRoot.render(
        <React.StrictMode>
            <PromptsModalManager />
        </React.StrictMode>
    );
});
