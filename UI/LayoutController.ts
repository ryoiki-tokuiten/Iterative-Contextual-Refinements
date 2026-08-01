/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalState } from '../Core/State';
import { setIconSlot } from './Icons';

type ThemeMode = 'light' | 'dark';

function getSavedTheme(): ThemeMode {
    return (localStorage.getItem('theme') as ThemeMode) || 'dark';
}

function setSavedTheme(theme: ThemeMode): void {
    localStorage.setItem('theme', theme);
}

function toggleBodyLightMode(): boolean {
    return document.body.classList.toggle('light-mode');
}

function getThemeToggleButton(): HTMLElement | null {
    return document.getElementById('theme-toggle-button');
}

function getThemeIcon(): HTMLElement | null {
    const button = getThemeToggleButton();
    return button?.querySelector('.icon-slot') || null;
}

function setThemeIcon(isLight: boolean): void {
    const icon = getThemeIcon();
    if (icon) {
        setIconSlot(icon, isLight ? 'dark_mode' : 'light_mode');
    }
}

function getSidebarElement(): HTMLElement | null {
    return document.getElementById('controls-sidebar');
}

function getMainContentElement(): HTMLElement | null {
    return document.getElementById('main-content');
}

function getExpandButton(): HTMLElement | null {
    return document.getElementById('sidebar-expand-button');
}

function getCollapseButton(): HTMLElement | null {
    return document.getElementById('sidebar-collapse-button');
}

function getMainHeaderContent(): HTMLElement | null {
    return document.querySelector('.main-header-content');
}

function resetSidebarCollapseButtonState(): void {
    const collapseButton = getCollapseButton() as HTMLButtonElement | null;
    if (!collapseButton) return;

    collapseButton.disabled = false;
    collapseButton.style.opacity = '';
    collapseButton.style.cursor = '';
    collapseButton.title = 'Collapse Sidebar';
    collapseButton.setAttribute('aria-label', 'Collapse Sidebar');
}

export function disableSidebarCollapseButton(reason = 'Sidebar collapse disabled in this view'): void {
    const collapseButton = getCollapseButton() as HTMLButtonElement | null;
    if (!collapseButton) return;

    collapseButton.disabled = true;
    collapseButton.style.opacity = '0.35';
    collapseButton.style.cursor = 'not-allowed';
    collapseButton.title = reason;
    collapseButton.setAttribute('aria-label', reason);
}

function isSidebarCollapsed(): boolean {
    const sidebar = getSidebarElement();
    return sidebar?.classList.contains('collapsed') || false;
}

function isElementVisible(element: HTMLElement | null): boolean {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

function hasInContentSidebarRestoreControl(): boolean {
    switch (globalState.currentMode) {
        case 'contextual':
            return !!document.querySelector('.contextual-text-panel');
        case 'adaptive-deepthink':
            return !!document.querySelector('.adaptive-deepthink-embedded-panel');
        default:
            return false;
    }
}

function getSidebarCollapseDisabledReason(): string | null {
    if (isElementVisible(getMainHeaderContent())) {
        return null;
    }

    if (hasInContentSidebarRestoreControl()) {
        return null;
    }

    switch (globalState.currentMode) {
        case 'deepthink':
            return 'Sidebar collapse disabled in config view';
        case 'contextual':
            return 'Sidebar collapse disabled until a Contextual run is visible';
        case 'adaptive-deepthink':
            return 'Sidebar collapse disabled until an Adaptive Deepthink run is visible';
        default:
            return 'Sidebar collapse is disabled in this view';
    }
}

function getTabsContainer(): HTMLElement | null {
    return document.getElementById('tabs-nav-container');
}

function getFullscreenButtons(): NodeListOf<Element> {
    return document.querySelectorAll('.fullscreen-toggle-button');
}

function getPreviewContainerId(buttonId: string): string {
    return buttonId.replace('fullscreen-btn-', 'preview-container-');
}

function getAssociatedPreviewContainer(buttonId: string): HTMLElement | null {
    const previewContainerId = getPreviewContainerId(buttonId);
    return document.getElementById(previewContainerId);
}

function isFullscreenActive(): boolean {
    return !!document.fullscreenElement;
}

function getFullscreenElement(): Element | null {
    return document.fullscreenElement;
}

let sidebarIsCollapsed = false;

function setSidebarCollapsed(collapsed: boolean): void {
    sidebarIsCollapsed = collapsed;
}

function ensureExpandButtonVisibility(): void {
    const expandButton = getExpandButton();
    if (expandButton) {
        expandButton.style.display = sidebarIsCollapsed ? 'flex' : 'none';
    }
}

function syncSidebarCollapseAvailability(): void {
    const reason = getSidebarCollapseDisabledReason();

    if (!reason) {
        resetSidebarCollapseButtonState();
        ensureExpandButtonVisibility();
        return;
    }

    if (isSidebarCollapsed()) {
        expandSidebar();
    }

    disableSidebarCollapseButton(reason);
    ensureExpandButtonVisibility();
}

function collapseSidebar(): void {
    if (getSidebarCollapseDisabledReason()) {
        return;
    }

    const sidebar = getSidebarElement();
    if (sidebar) {
        sidebar.style.transition = 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';
        sidebar.classList.add('collapsed');
        setSidebarCollapsed(true);
    }
}

function expandSidebar(): void {
    const sidebar = getSidebarElement();
    const expandButton = getExpandButton();
    if (sidebar) {
        sidebar.classList.remove('collapsed');
        setSidebarCollapsed(false);
    }
    if (expandButton) {
        expandButton.style.display = 'none';
    }
}

function initializeSidebarEventListeners(): void {
    const expandButton = getExpandButton();
    const collapseButton = getCollapseButton();
    const sidebar = getSidebarElement();
    const mainContent = getMainContentElement();

    if (expandButton) {
        expandButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            expandSidebar();
        });
    }

    if (collapseButton && sidebar) {
        const newCollapseButton = collapseButton.cloneNode(true) as HTMLElement;
        collapseButton.replaceWith(newCollapseButton);

        newCollapseButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            sidebar.offsetHeight;
            collapseSidebar();

            requestAnimationFrame(() => {
                const expandBtn = getExpandButton();
                if (expandBtn) {
                    expandBtn.style.display = 'flex';
                }

                if (mainContent) {
                    mainContent.style.transform = 'translateZ(0)';
                    setTimeout(() => {
                        mainContent.style.transform = '';
                    }, 300);
                }
            });
        });
    }
}

function initializeThemeEventListeners(): void {
    document.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const themeToggleButton = target.closest('#theme-toggle-button');

        if (themeToggleButton) {
            e.preventDefault();
            e.stopPropagation();

            const isLight = toggleBodyLightMode();
            setThemeIcon(isLight);
            setSavedTheme(isLight ? 'light' : 'dark');
        }
    }, true);
}

function initializeFullscreenEventListeners(): void {
    document.addEventListener('fullscreenchange', () => {
        const isFullscreen = isFullscreenActive();
        const fullscreenElement = getFullscreenElement();

        getFullscreenButtons().forEach(button => {
            const btn = button as HTMLButtonElement;
            const iconFullscreen = btn.querySelector('.icon-fullscreen') as HTMLElement;
            const iconExitFullscreen = btn.querySelector('.icon-exit-fullscreen') as HTMLElement;
            const associatedPreview = getAssociatedPreviewContainer(btn.id);

            if (isFullscreen && fullscreenElement === associatedPreview) {
                if (iconFullscreen) iconFullscreen.style.display = 'none';
                if (iconExitFullscreen) iconExitFullscreen.style.display = 'inline-block';
                btn.title = "Exit Fullscreen Preview";
                btn.setAttribute('aria-label', "Exit Fullscreen Preview");
            } else {
                if (iconFullscreen) iconFullscreen.style.display = 'inline-block';
                if (iconExitFullscreen) iconExitFullscreen.style.display = 'none';
                btn.title = "Toggle Fullscreen Preview";
                btn.setAttribute('aria-label', "Toggle Fullscreen Preview");
            }
        });
    });
}

function initializeThemeFromStorage(): void {
    const savedTheme = getSavedTheme();
    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
        setThemeIcon(true);
    }
}

function initializeTabsObserver(): void {
    const tabsContainer = getTabsContainer();
    if (tabsContainer) {
        const observer = new MutationObserver(() => {
            syncSidebarCollapseAvailability();
        });
        observer.observe(tabsContainer, { childList: true, subtree: true });
    }
}

function initializeSidebarAvailabilityObserver(): void {
    const mainContent = getMainContentElement();
    if (!mainContent) return;

    const observer = new MutationObserver(() => {
        syncSidebarCollapseAvailability();
    });

    observer.observe(mainContent, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class']
    });
}

function initializeLayoutController(): void {
    initializeSidebarEventListeners();
    initializeThemeEventListeners();
    initializeFullscreenEventListeners();
    initializeThemeFromStorage();
    initializeTabsObserver();
    initializeSidebarAvailabilityObserver();

    (window as any).reinitializeSidebarControls = syncSidebarCollapseAvailability;
    window.addEventListener('appModeChanged', syncSidebarCollapseAvailability);

    syncSidebarCollapseAvailability();
}

export class LayoutController {
    public static initialize() {
        initializeLayoutController();
    }

}
