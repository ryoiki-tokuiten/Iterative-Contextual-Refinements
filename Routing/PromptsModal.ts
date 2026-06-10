/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializePromptStyling, updatePromptContent } from '../Styles/Components/PromptStyling';
import { PromptRefiner } from './PromptRefiner';
import { globalState } from '../Core/State';
import { renderIconMarkup } from '../UI/Icons';

export class PromptsModal {
    private elements: {
        overlay: HTMLElement | null;
        closeButton: HTMLButtonElement | null;
        trigger: HTMLElement | null;
        nav: HTMLElement | null;
        content: HTMLElement | null;
    };

    private currentMode: string = 'deepthink';
    private modelConfig: any = null;
    public promptsManager: any = null;
    private activeRefiners: Map<string, PromptRefiner> = new Map();

    constructor() {
        this.elements = {
            overlay: null,
            closeButton: null,
            trigger: null,
            nav: null,
            content: null
        };

        // We can't initialize elements here because the DOM might not be ready
        // Elements will be initialized lazily in show() or ensureElements()
    }

    private listenersInitialized: boolean = false;

    private ensureElements(): boolean {
        if (this.elements.overlay) return true;

        this.elements.overlay = document.getElementById('prompts-modal-overlay');
        this.elements.closeButton = document.getElementById('prompts-modal-close-button') as HTMLButtonElement;
        this.elements.nav = document.getElementById('prompts-modal-nav');
        this.elements.content = document.getElementById('prompts-modal-content');

        if (this.elements.overlay) {
            if (!this.listenersInitialized) {
                this.initializeEventListeners();
                this.listenersInitialized = true;
            }
            return true;
        }
        return false;
    }

    private initializeEventListeners(): void {
        // Trigger event listener will be set externally by ProviderManagementUI

        if (this.elements.closeButton) {
            this.elements.closeButton.addEventListener('click', () => this.hide());
        }

        if (this.elements.overlay) {
            this.elements.overlay.addEventListener('click', (e) => {
                if (e.target === this.elements.overlay) {
                    this.hide();
                }
            });
        }

        // Add Escape key handler to close modal (consistent with other full-screen containers)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.elements.overlay?.classList.contains('is-visible')) {
                this.hide();
            }
        });

        // Listen for mode changes to update the modal
        window.addEventListener('appModeChanged', () => {
            this.setCurrentMode(globalState.currentMode);
            if (this.elements.overlay?.classList.contains('is-visible')) {
                this.initializeModal();
            }
        });
    }

    public show(): void {
        if (!this.ensureElements()) {
            console.error('Prompts modal elements not found in DOM');
            return;
        }

        if (this.elements.overlay) {
            this.initializeModal(); // Re-initialize on open to reflect current mode
            this.elements.overlay.style.display = 'flex';
            setTimeout(() => {
                this.elements.overlay!.classList.add('is-visible');
                // Apply syntax highlighting to all prompt textareas
                initializePromptStyling();
                // Force initial content sync after editors are enhanced
                setTimeout(() => updatePromptContent(), 60);
                // Safety: run once more after layout settles
                setTimeout(() => updatePromptContent(), 200);
                // React-controlled components auto-sync from their managers
            }, 10);
        }
    }

    public hide(): void {
        // Try to ensure elements exist, but don't fail if they don't (modal might not be open)
        this.ensureElements();

        if (this.elements.overlay) {
            this.elements.overlay.classList.remove('is-visible');
            this.elements.overlay.addEventListener('transitionend', () => {
                if (!this.elements.overlay!.classList.contains('is-visible')) {
                    this.elements.overlay!.style.display = 'none';
                }
            }, { once: true });
        }
    }

    public setCurrentMode(mode: string): void {
        this.currentMode = this.normalizeModeKey(mode);
    }

    public setModelConfig(modelConfig: any): void {
        this.modelConfig = modelConfig;
    }

    public setPromptsManager(promptsManager: any): void {
        this.promptsManager = promptsManager;
    }

    private initializeModal(): void {
        if (!this.elements.nav || !this.elements.content) return;

        // Clear previous state
        this.elements.nav.innerHTML = '';
        this.elements.content.querySelectorAll('.prompts-mode-container').forEach(el => el.classList.remove('active'));
        this.elements.content.querySelectorAll('.prompt-content-pane').forEach(el => el.classList.remove('active'));

        const activeModeContainer = document.getElementById(`${this.currentMode}-prompts-container`);
        if (!activeModeContainer) return;

        activeModeContainer.classList.add('active');

        // Display current mode at the top of nav
        const modeTitle = document.createElement('h4');
        modeTitle.className = 'prompts-nav-mode-title';
        modeTitle.textContent = `${this.getModeDisplayName(this.currentMode)} Mode Prompts`;
        this.elements.nav.appendChild(modeTitle);

        const navStructure = this.getPromptNavStructure()[this.currentMode as keyof ReturnType<typeof this.getPromptNavStructure>];
        if (!navStructure) return;

        let firstNavItem: HTMLElement | null = null;

        navStructure.forEach((group: any) => {
            const groupTitleEl = document.createElement('h5');
            groupTitleEl.className = 'prompts-nav-group-title';
            groupTitleEl.textContent = group.groupTitle;
            this.elements.nav!.appendChild(groupTitleEl);

            group.prompts.forEach((promptKey: string) => {
                const pane = activeModeContainer.querySelector<HTMLElement>(`.prompt-content-pane[data-prompt-key="${promptKey}"]`);
                if (!pane) return;

                const titleElement = pane.querySelector<HTMLHeadingElement>('.prompt-pane-title');
                const title = titleElement ? titleElement.textContent : 'Unnamed Section';

                const navItem = document.createElement('div');
                navItem.className = 'prompts-nav-item';
                navItem.textContent = title;
                navItem.dataset.targetPane = promptKey;
                this.elements.nav!.appendChild(navItem);

                if (!firstNavItem) {
                    firstNavItem = navItem;
                }

                navItem.addEventListener('click', () => {
                    // Remove active class from all nav items
                    this.elements.nav?.querySelectorAll('.prompts-nav-item').forEach(item => {
                        item.classList.remove('active');
                    });

                    // Add active class to clicked item
                    navItem.classList.add('active');

                    // Hide all content panes
                    activeModeContainer.querySelectorAll('.prompt-content-pane').forEach(pane => {
                        pane.classList.remove('active');
                        pane.classList.remove('dual-panel');
                    });

                    // Show corresponding content pane
                    const targetPane = activeModeContainer.querySelector(`.prompt-content-pane[data-prompt-key="${promptKey}"]`);
                    if (targetPane) {
                        targetPane.classList.add('active');

                        // Apply dual-panel class if there are 2 prompt cards
                        const cardCount = targetPane.querySelectorAll('.prompt-card').length;
                        if (cardCount === 2) {
                            targetPane.classList.add('dual-panel');
                        }

                        // Update prompt content when switching panes
                        setTimeout(() => updatePromptContent(), 50);
                    }
                });
            });
        });

        // Activate the first one by default
        if (firstNavItem) {
            (firstNavItem as HTMLElement).click();
        }

        // Initialize model selectors after navigation is set up
        this.initializeModelSelectors();

        // Also update model selectors from state after a short delay to ensure DOM is ready
        setTimeout(() => {
            this.updateModelSelectorsFromState();
        }, 100);
    }

    private getPromptNavStructure() {
        return {
            deepthink: [
                {
                    groupTitle: "1. STRATEGY GENERATION",
                    prompts: ["deepthink-initial-strategy", "deepthink-sub-strategy"]
                },
                {
                    groupTitle: "2. SOLUTION DEVELOPMENT",
                    prompts: ["deepthink-solution-attempt", "deepthink-solution-critique", "deepthink-dissected-synthesis", "deepthink-self-improvement", "deepthink-structured-solution-pool"]
                },
                {
                    groupTitle: "3. HYPOTHESIS EXPLORATION",
                    prompts: ["deepthink-hypothesis-generation", "deepthink-hypothesis-tester"]
                },
                {
                    groupTitle: "4. EVALUATION & JUDGMENT",
                    prompts: ["deepthink-post-quality-filter", "deepthink-memory-bank", "deepthink-final-judge"]
                }
            ],
            agentic: [
                {
                    groupTitle: "AGENTIC CONFIGURATION",
                    prompts: ["agentic-system", "agentic-verifier"]
                }
            ],
            adaptiveDeepthink: [
                {
                    groupTitle: "1. MAIN ORCHESTRATOR",
                    prompts: ["adaptive-main"]
                },
                {
                    groupTitle: "2. STRATEGY & HYPOTHESIS",
                    prompts: ["adaptive-strategy-gen", "adaptive-hypothesis-gen", "adaptive-hypothesis-test"]
                },
                {
                    groupTitle: "3. EXECUTION & REFINEMENT",
                    prompts: ["adaptive-execution", "adaptive-critique", "adaptive-corrector"]
                },
                {
                    groupTitle: "4. FINAL JUDGMENT",
                    prompts: ["adaptive-judge"]
                }
            ],
            contextual: [
                {
                    groupTitle: "CONTEXTUAL AGENTS",
                    prompts: ["contextual-main-generator", "contextual-iterative-agent", "contextual-solution-pool", "contextual-memory"]
                }
            ],
            'dynamic-compute': [
                {
                    groupTitle: "DYNAMIC COMPUTE",
                    prompts: ["dca-solution-generator", "dca-local-pool-agent"]
                }
            ]
        };
    }

    private normalizeModeKey(mode: string): string {
        const mapping: Record<string, string> = {
            'adaptive-deepthink': 'adaptiveDeepthink'
        };
        return mapping[mode] || mode;
    }

    private getModeDisplayName(normalizedMode: string): string {
        const mapping: Record<string, string> = {
            adaptiveDeepthink: 'Adaptive Deepthink'
        };
        const display = mapping[normalizedMode];
        if (display) {
            return display;
        }

        if (!normalizedMode) {
            return '';
        }

        return normalizedMode.charAt(0).toUpperCase() + normalizedMode.slice(1);
    }

    private initializeModelSelectors(): void {
        if (!this.modelConfig) return;

        // React-controlled containers manage their own select options and change handlers.
        // We still apply createCustomModelSelect() for the visual overlay (styled dropdown,
        // Refine button, Diff button), but skip wiping options and adding imperative listeners.
        const reactContainerIds = new Set([
            'deepthink-prompts-container',
            'agentic-prompts-container',
            'adaptiveDeepthink-prompts-container',
            'contextual-prompts-container',
            'dynamic-compute-prompts-container'
        ]);

        const modelSelectors = document.querySelectorAll('.prompt-model-select');
        modelSelectors.forEach((selector: Element) => {
            const selectElement = selector as HTMLSelectElement;

            const parentContainer = selectElement.closest('.prompts-mode-container');
            const isReactControlled = parentContainer && reactContainerIds.has(parentContainer.id);

            if (!isReactControlled) {
                // Non-React selects: clear and repopulate options imperatively
                while (selectElement.children.length > 1) {
                    selectElement.removeChild(selectElement.lastChild!);
                }

                const availableModels = this.modelConfig.getAvailableModels();
                availableModels.forEach((model: any) => {
                    const option = document.createElement('option');
                    option.value = model.value;
                    option.textContent = model.value;
                    if (model.description) {
                        option.title = model.description;
                    }
                    selectElement.appendChild(option);
                });

                selectElement.addEventListener('change', (e) => {
                    this.handleModelSelectionChange(e);
                });
            }

            // Custom dropdown overlay is always created for consistent styling
            this.createCustomModelSelect(selectElement);
        });

        // Update model selectors with saved state values after populating options
        this.updateModelSelectorsFromState();

        // Set up change detection for all textareas
        setTimeout(() => {
            this.setupChangeDetection();
        }, 100);
    }

    private setupChangeDetection(): void {
        // Get all prompt textareas
        const textareas = document.querySelectorAll('.prompt-textarea');

        textareas.forEach((textarea) => {
            const textareaElement = textarea as HTMLTextAreaElement;
            const textareaId = textareaElement.id;

            // Find the corresponding agent name from the textarea ID
            const agentName = this.getAgentNameFromTextareaId(textareaId);
            if (!agentName) return;

            // Store original value on first load
            if (!textareaElement.dataset.originalValue) {
                textareaElement.dataset.originalValue = textareaElement.value;
            }

            // Add input listener to check for changes
            textareaElement.addEventListener('input', () => {
                this.checkPromptChanges(agentName);
            });

            // Initial check
            this.checkPromptChanges(agentName);
        });
    }

    private getAgentNameFromTextareaId(textareaId: string): string | null {
        // Reverse mapping from textarea ID to agent name
        const allMaps = {
            ...this.getDeepthinkAgentMap(),
            ...this.getAgenticAgentMap(),
            ...this.getAdaptiveDeepthinkAgentMap(),
            ...this.getContextualAgentMap()
        };

        for (const [agentName, id] of Object.entries(allMaps)) {
            if (id === textareaId) {
                return agentName;
            }
        }

        return null;
    }



    private getDeepthinkAgentMap(): { [key: string]: string } {
        return {
            'initialStrategy': 'sys-deepthink-initial-strategy',
            'subStrategy': 'sys-deepthink-sub-strategy',
            'solutionAttempt': 'sys-deepthink-solution-attempt',
            'solutionCritique': 'sys-deepthink-solution-critique',
            'dissectedSynthesis': 'sys-deepthink-dissected-synthesis',
            'selfImprovement': 'sys-deepthink-self-improvement',
            'hypothesisGeneration': 'sys-deepthink-hypothesis-generation',
            'hypothesisTester': 'sys-deepthink-hypothesis-tester',
            'postQualityFilter': 'sys-deepthink-post-quality-filter',
            'memoryBank': 'sys-deepthink-memory-bank',
            'finalJudge': 'sys-deepthink-final-judge',
            'structuredSolutionPool': 'sys-deepthink-structured-solution-pool'
        };
    }

    private getAgenticAgentMap(): { [key: string]: string } {
        return {
            'agentic': 'sys-agentic',
            'agentic-verifier': 'sys-agentic-verifier'
        };
    }

    private getAdaptiveDeepthinkAgentMap(): { [key: string]: string } {
        return {
            'adaptive-main': 'sys-adaptive-main',
            'adaptive-strategy-gen': 'sys-adaptive-strategy-gen',
            'adaptive-hypothesis-gen': 'sys-adaptive-hypothesis-gen',
            'adaptive-hypothesis-test': 'sys-adaptive-hypothesis-test',
            'adaptive-execution': 'sys-adaptive-execution',
            'adaptive-critique': 'sys-adaptive-critique',
            'adaptive-corrector': 'sys-adaptive-corrector',
            'adaptive-judge': 'sys-adaptive-judge'
        };
    }

    private getContextualAgentMap(): { [key: string]: string } {
        return {
            'contextual-main-generator': 'sys-contextual-main-generator',
            'contextual-iterative-agent': 'sys-contextual-iterative-agent',
            'contextual-solution-pool': 'sys-contextual-solution-pool',
            'contextual-memory': 'sys-contextual-memory'
        };
    }

    private createCustomModelSelect(originalSelect: HTMLSelectElement): void {
        const container = originalSelect.parentElement;
        if (!container) return;

        // Check if custom select already exists
        if (container.querySelector('.custom-model-select')) return;

        const agentName = originalSelect.dataset.agent || 'unknown';

        // Create custom dropdown structure with refine button
        const customSelect = document.createElement('div');
        customSelect.className = 'custom-model-select';
        customSelect.innerHTML = `
            <div class="custom-model-select-trigger" id="custom-model-select-trigger-${agentName}">
                <span class="custom-model-select-text" id="custom-model-select-text-${agentName}">Use Global Model</span>
                ${renderIconMarkup('expand_more', 'custom-model-select-arrow')}
            </div>
            <div class="custom-model-select-dropdown" id="custom-model-select-dropdown-${agentName}">
                <!-- Options will be populated here -->
            </div>
        `;

        // Insert custom select after the original select
        container.insertBefore(customSelect, originalSelect.nextSibling);

        // Add refine button
        const refineButton = document.createElement('button');
        refineButton.className = 'prompt-model-refine-btn';
        refineButton.type = 'button';
        refineButton.innerHTML = `
            ${renderIconMarkup('edit')}
            <span>Refine</span>
        `;
        refineButton.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.openPromptRefiner(agentName);
        });
        container.appendChild(refineButton);

        // Add diff button (initially hidden)
        const diffButton = document.createElement('button');
        diffButton.className = 'prompt-model-diff-btn';
        diffButton.type = 'button';
        diffButton.style.display = 'none';
        diffButton.dataset.agent = agentName;
        diffButton.innerHTML = `
            ${renderIconMarkup('difference')}
            <span>Diff</span>
        `;

        // Use arrow function to preserve 'this' context
        const clickHandler = (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            this.openPromptDiff(agentName);
        };

        diffButton.addEventListener('click', clickHandler);

        container.appendChild(diffButton);

        // Hide the original select
        originalSelect.style.display = 'none';

        // Initialize the custom select using shared logic
        this.initializeCustomSelectListeners(agentName);
        this.updateCustomSelectOptions(agentName);
    }

    private initializeCustomSelectListeners(agentName: string): void {
        const trigger = document.getElementById(`custom-model-select-trigger-${agentName}`);
        const dropdown = document.getElementById(`custom-model-select-dropdown-${agentName}`);

        if (!trigger || !dropdown) return;

        // Toggle dropdown
        trigger.addEventListener('click', () => {
            const isOpen = trigger.classList.contains('open');
            // Close all other dropdowns first
            document.querySelectorAll('.custom-model-select-trigger.open').forEach(t => {
                if (t !== trigger) {
                    t.classList.remove('open');
                    const otherId = t.id.replace('custom-model-select-trigger-', '');
                    const otherDropdown = document.getElementById(`custom-model-select-dropdown-${otherId}`);
                    if (otherDropdown) otherDropdown.classList.remove('open');
                }
            });

            if (isOpen) {
                this.closeCustomSelect(agentName);
            } else {
                this.openCustomSelect(agentName);
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!trigger.contains(e.target as Node) && !dropdown.contains(e.target as Node)) {
                this.closeCustomSelect(agentName);
            }
        });
    }

    private openCustomSelect(agentName: string): void {
        const trigger = document.getElementById(`custom-model-select-trigger-${agentName}`);
        const dropdown = document.getElementById(`custom-model-select-dropdown-${agentName}`);

        if (trigger && dropdown) {
            trigger.classList.add('open');
            dropdown.classList.add('open');
        }
    }

    private closeCustomSelect(agentName: string): void {
        const trigger = document.getElementById(`custom-model-select-trigger-${agentName}`);
        const dropdown = document.getElementById(`custom-model-select-dropdown-${agentName}`);

        if (trigger && dropdown) {
            trigger.classList.remove('open');
            dropdown.classList.remove('open');
        }
    }

    private updateCustomSelectOptions(agentName: string): void {
        const dropdown = document.getElementById(`custom-model-select-dropdown-${agentName}`);
        const textElement = document.getElementById(`custom-model-select-text-${agentName}`);
        const originalSelect = document.querySelector(`select[data-agent="${agentName}"]`) as HTMLSelectElement;

        if (!dropdown || !textElement || !originalSelect) return;

        const availableModels = this.modelConfig.getAvailableModels();
        const selectedValue = originalSelect.value;

        // Clear existing options
        dropdown.innerHTML = '';

        // Add "Use Global Model" option
        const globalOption = document.createElement('div');
        globalOption.className = 'custom-model-select-option';
        globalOption.dataset.value = '';
        if (selectedValue === '') {
            globalOption.classList.add('selected');
        }

        globalOption.innerHTML = `
            <span class="custom-model-select-option-text">Use Global Model</span>
            ${renderIconMarkup('CircleCheck', 'option-check')}
        `;

        globalOption.addEventListener('click', () => {
            this.selectCustomOption(agentName, '', 'Use Global Model');
        });

        dropdown.appendChild(globalOption);

        // Reuse the same provider grouping logic from ModelSelectionUI
        this.addProviderGroups(dropdown, availableModels, selectedValue, agentName);

        // Update selected text
        if (selectedValue === '') {
            textElement.textContent = 'Use Global Model';
        } else {
            textElement.textContent = selectedValue;
        }
    }

    private addProviderGroups(dropdown: HTMLElement, availableModels: any[], selectedValue: string, agentName: string): void {
        // Group models by provider
        const modelsByProvider: Record<string, typeof availableModels> = {};
        availableModels.forEach((model: any) => {
            if (!modelsByProvider[model.provider!]) {
                modelsByProvider[model.provider!] = [];
            }
            modelsByProvider[model.provider!].push(model);
        });

        // Provider configuration with colors (same as ModelSelectionUI)
        const providerConfig: Record<string, { class: string }> = {
            'openai': { class: 'openai' },
            'anthropic': { class: 'anthropic' },
            'google': { class: 'google' },
            'gemini': { class: 'google' },
            'openrouter': { class: 'openrouter' },
            'meta': { class: 'meta' },
            'mistral': { class: 'mistral' }
        };

        // Sort providers for consistent ordering
        const sortedProviders = Object.keys(modelsByProvider).sort((a, b) => {
            const order = ['openai', 'anthropic', 'google', 'gemini', 'meta', 'mistral'];
            const aIndex = order.indexOf(a.toLowerCase());
            const bIndex = order.indexOf(b.toLowerCase());
            if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
            if (aIndex === -1) return 1;
            if (bIndex === -1) return -1;
            return aIndex - bIndex;
        });

        // Add provider groups (same structure as ModelSelectionUI)
        sortedProviders.forEach(provider => {
            const models = modelsByProvider[provider];
            const config = providerConfig[provider.toLowerCase()] || { class: 'default' };

            // Create provider section container
            const providerSection = document.createElement('div');
            providerSection.className = `custom-model-select-provider-section ${config.class}`;

            // Add provider header
            const providerHeader = document.createElement('div');
            providerHeader.className = `custom-model-select-provider-header ${config.class}`;
            providerHeader.innerHTML = `
                <span>${provider.charAt(0).toUpperCase() + provider.slice(1)}</span>
            `;
            providerSection.appendChild(providerHeader);

            // Sort models within provider
            const sortedModels = models.sort((a: any, b: any) => a.value.localeCompare(b.value));

            // Add models for this provider
            sortedModels.forEach((model: any) => {
                const option = document.createElement('div');
                option.className = 'custom-model-select-option';
                option.dataset.value = model.value;
                if (model.value === selectedValue) {
                    option.classList.add('selected');
                }

                option.innerHTML = `
                    <span class="custom-model-select-option-text">${model.value}</span>
                    ${renderIconMarkup('CircleCheck', 'option-check')}
                `;

                option.addEventListener('click', () => {
                    this.selectCustomOption(agentName, model.value, model.value);
                });

                providerSection.appendChild(option);
            });

            dropdown.appendChild(providerSection);
        });
    }

    private selectCustomOption(agentName: string, value: string, label: string): void {
        const textElement = document.getElementById(`custom-model-select-text-${agentName}`);
        const dropdown = document.getElementById(`custom-model-select-dropdown-${agentName}`);
        const originalSelect = document.querySelector(`select[data-agent="${agentName}"]`) as HTMLSelectElement;

        if (textElement) {
            textElement.textContent = label;
        }

        // Update the hidden select
        if (originalSelect) {
            // Use the native setter to bypass React's value tracker, ensuring onChange fires
            const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
            if (nativeSetter) {
                nativeSetter.call(originalSelect, value);
            } else {
                originalSelect.value = value;
            }
            // Trigger change event (React's onChange for <select> maps to native 'change')
            const changeEvent = new Event('change', { bubbles: true });
            originalSelect.dispatchEvent(changeEvent);
        }

        // Update selected state in dropdown
        if (dropdown) {
            dropdown.querySelectorAll('.custom-model-select-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            dropdown.querySelector(`[data-value="${value}"]`)?.classList.add('selected');
        }

        this.closeCustomSelect(agentName);
    }

    private updateModelSelectorsFromState(): void {
        // React-controlled components auto-sync model selectors from their managers
    }

    private handleModelSelectionChange(_event: Event): void {
        // Event handling is managed by PromptsManager
    }

    private getTextareaIdForAgent(agentName: string): string | null {
        // Deepthink mode agents
        const deepthinkMap: { [key: string]: string } = {
            'initialStrategy': 'sys-deepthink-initial-strategy',
            'subStrategy': 'sys-deepthink-sub-strategy',
            'solutionAttempt': 'sys-deepthink-solution-attempt',
            'solutionCritique': 'sys-deepthink-solution-critique',
            'dissectedSynthesis': 'sys-deepthink-dissected-synthesis',
            'selfImprovement': 'sys-deepthink-self-improvement',
            'hypothesisGeneration': 'sys-deepthink-hypothesis-generation',
            'hypothesisTester': 'sys-deepthink-hypothesis-tester',
            'postQualityFilter': 'sys-deepthink-post-quality-filter',
            'memoryBank': 'sys-deepthink-memory-bank',
            'finalJudge': 'sys-deepthink-final-judge',
            'structuredSolutionPool': 'sys-deepthink-structured-solution-pool'
        };

        // Agentic mode agents
        const agenticMap: { [key: string]: string } = {
            'agentic': 'sys-agentic',
            'agentic-verifier': 'sys-agentic-verifier'
        };

        // Adaptive Deepthink mode agents
        const adaptiveDeepthinkMap: { [key: string]: string } = {
            'adaptive-main': 'sys-adaptive-main',
            'adaptive-strategy-gen': 'sys-adaptive-strategy-gen',
            'adaptive-hypothesis-gen': 'sys-adaptive-hypothesis-gen',
            'adaptive-hypothesis-test': 'sys-adaptive-hypothesis-test',
            'adaptive-execution': 'sys-adaptive-execution',
            'adaptive-critique': 'sys-adaptive-critique',
            'adaptive-corrector': 'sys-adaptive-corrector',
            'adaptive-judge': 'sys-adaptive-judge'
        };

        // Contextual mode agents
        const contextualMap: { [key: string]: string } = {
            'contextual-main-generator': 'sys-contextual-main-generator',
            'contextual-iterative-agent': 'sys-contextual-iterative-agent',
            'contextual-solution-pool': 'sys-contextual-solution-pool',
            'contextual-memory': 'sys-contextual-memory'
        };

        return deepthinkMap[agentName] || agenticMap[agentName] || adaptiveDeepthinkMap[agentName] || contextualMap[agentName] || null;
    }

    private openPromptRefiner(agentName: string): void {
        if (!this.modelConfig) {
            console.error('modelConfig is not set');
            return;
        }

        // Use the proper mapping from agent name to textarea ID
        const textareaId = this.getTextareaIdForAgent(agentName);
        if (!textareaId) {
            console.error('No textarea mapping found for agent:', agentName);
            return;
        }

        const textarea = document.getElementById(textareaId) as HTMLTextAreaElement;
        if (!textarea) {
            console.error('Textarea not found with ID:', textareaId);
            return;
        }

        const currentPrompt = textarea.value;

        // Create or get existing refiner
        let refiner = this.activeRefiners.get(agentName);
        if (!refiner) {
            refiner = new PromptRefiner({
                agentName,
                currentPrompt,
                onPromptUpdated: (newPrompt: string) => {
                    textarea.value = newPrompt;
                    // Trigger input event to update the state
                    const inputEvent = new Event('input', { bubbles: true });
                    textarea.dispatchEvent(inputEvent);
                    // Update syntax highlighting
                    setTimeout(() => updatePromptContent(), 50);
                    // Check for changes and show/hide diff button
                    this.checkPromptChanges(agentName);
                },
                modelConfig: this.modelConfig
            });
            this.activeRefiners.set(agentName, refiner);
        } else {
            refiner.updateConfig({ currentPrompt });
        }

        // Find the refine button to position the overlay
        const refineButton = document.querySelector('.prompt-model-refine-btn') as HTMLElement;
        console.log('Showing refiner overlay');
        refiner.show(refineButton || document.body);
    }

    private checkPromptChanges(agentName: string): void {
        const textareaId = this.getTextareaIdForAgent(agentName);
        if (!textareaId) return;

        const textarea = document.getElementById(textareaId) as HTMLTextAreaElement;
        if (!textarea) return;

        const currentPrompt = textarea.value;
        const originalPrompt = textarea.dataset.originalValue || '';

        // Find the diff button for this agent
        const diffButton = document.querySelector(`.prompt-model-diff-btn[data-agent="${agentName}"]`) as HTMLElement;
        if (!diffButton) {
            // Button doesn't exist yet - might be called before button is created
            return;
        }

        // Show diff button if content has changed
        const hasChanges = currentPrompt.trim() !== originalPrompt.trim();
        if (hasChanges) {
            diffButton.style.display = 'inline-flex';
            diffButton.style.visibility = 'visible';
            diffButton.style.pointerEvents = 'auto';
        } else {
            diffButton.style.display = 'none';
        }
    }

    private openPromptDiff(agentName: string): void {
        const textareaId = this.getTextareaIdForAgent(agentName);
        if (!textareaId) return;

        const textarea = document.getElementById(textareaId) as HTMLTextAreaElement;
        if (!textarea) return;

        const currentPrompt = textarea.value;
        const originalPrompt = textarea.dataset.originalValue || '';

        if (!originalPrompt) return;

        // Use the existing diff modal from DiffModal.tsx (lazy-loaded)
        void import('../Styles/Components/DiffModal/DiffModalController').then((mod) => {
            mod.openPromptDiffModal(originalPrompt, currentPrompt, `Prompt Changes - ${agentName}`);
        });
    }

    public updateTriggerState(isGenerating: boolean): void {
        if (this.elements.trigger) {
            const parentSection = this.elements.trigger.closest('.sidebar-section');
            if (parentSection) {
                parentSection.classList.toggle('disabled', isGenerating);
            }
            this.elements.trigger.style.pointerEvents = isGenerating ? 'none' : 'auto';
            this.elements.trigger.style.opacity = isGenerating ? '0.6' : '1';
        }
    }
}
