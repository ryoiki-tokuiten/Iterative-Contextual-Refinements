/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelConfigManager, type ModelOption } from './ModelConfig';
import { DeepthinkConfigController } from './DeepthinkConfigController';
import { ApiCallEstimator } from './ApiCallEstimator';
import { globalState } from '../Core/State';
import { updateCodeExecutionToggleVisibility } from '../UI/setupCodeExecutionToggle';
import { getModelThinkingType } from './AIProvider';
import { renderIconMarkup } from '../UI/Icons';

import { ProviderManager } from './ProviderManager';

export class ModelSelectionUI {
    private modelConfig: ModelConfigManager;
    private deepthinkConfig: DeepthinkConfigController | null = null;
    private providerManager: ProviderManager | null = null;
    private apiCallEstimator: ApiCallEstimator | null = null;
    private activeProvider: string = 'google';
    private searchQuery: string = '';
    private elements: {
        modelSelect: HTMLSelectElement | null;
        temperatureSlider: HTMLInputElement | null;
        topPSlider: HTMLInputElement | null;
        temperatureValue: HTMLSpanElement | null;
        topPValue: HTMLSpanElement | null;
        thinkingLevelSelect: HTMLSelectElement | null;
        thinkingLevelContainer: HTMLDivElement | null;
    };

    constructor(modelConfig: ModelConfigManager, deepthinkConfig?: DeepthinkConfigController, providerManager?: ProviderManager) {
        this.modelConfig = modelConfig;
        this.deepthinkConfig = deepthinkConfig || null;
        this.providerManager = providerManager || null;
        this.elements = {
            modelSelect: null,
            temperatureSlider: null,
            topPSlider: null,
            temperatureValue: null,
            topPValue: null,
            thinkingLevelSelect: null,
            thinkingLevelContainer: null
        };
    }

    private initializeElements(): void {
        this.elements = {
            modelSelect: document.getElementById('model-select') as HTMLSelectElement,
            temperatureSlider: document.getElementById('temperature-slider') as HTMLInputElement,
            topPSlider: document.getElementById('top-p-slider') as HTMLInputElement,
            temperatureValue: document.getElementById('temperature-value') as HTMLSpanElement,
            topPValue: document.getElementById('top-p-value') as HTMLSpanElement,
            thinkingLevelSelect: document.getElementById('thinking-level-select') as HTMLSelectElement,
            thinkingLevelContainer: document.getElementById('thinking-level-container') as HTMLDivElement
        };

        this.createCustomModelSelect();
        this.initializeModelOptions();
        this.initializeEventListeners();
        this.updateUI();
        this.initializeApiCallEstimator();
    }

    public initialize(): void {
        if (!this.elements.modelSelect) {
            this.initializeElements();
        }
    }

    private initializeApiCallEstimator(): void {
        this.apiCallEstimator = new ApiCallEstimator(this.modelConfig);
        this.deepthinkConfig?.addEventListener('configchange', () => {
            this.apiCallEstimator?.updateApiCallDisplay();
        });
        this.apiCallEstimator.updateApiCallDisplay();
    }

    private initializeModelOptions(): void {
        if (!this.elements.modelSelect) return;

        // Clear existing options
        this.elements.modelSelect.innerHTML = '';

        // Add model options from the model config manager
        const availableModels = this.modelConfig.getAvailableModels();
        availableModels.forEach(model => {
            const option = document.createElement('option');
            option.value = model.value;
            option.textContent = model.label || model.value;
            if (model.description) {
                option.title = model.description;
            }
            this.elements.modelSelect!.appendChild(option);
        });

        // Set default selection
        this.elements.modelSelect.value = this.modelConfig.getSelectedModel();

        // Update custom select options
        this.updateCustomSelectOptions();
    }

    public updateModelOptions(): void {
        this.initializeModelOptions();
    }

    private createCustomModelSelect(): void {
        if (!this.elements.modelSelect) return;

        const container = this.elements.modelSelect.parentElement;
        if (!container) return;

        // Create the new split layout structure
        const customSelect = document.createElement('div');
        customSelect.className = 'model-selector';
        customSelect.id = 'model-selector';
        customSelect.innerHTML = `
            <div class="model-selector-providers" id="model-selector-providers">
                <!-- Provider tabs will be populated here -->
            </div>
            <div class="model-selector-models-container">
                <div class="model-search-container" id="model-search-container">
                    ${renderIconMarkup('Search', 'model-search-icon')}
                    <input type="text" class="model-search-input" id="model-search-input" placeholder="Search models...">
                </div>
                <div class="model-selector-models" id="model-selector-models">
                    <!-- Models will be populated here -->
                </div>
            </div>
        `;

        // Bind search input event
        const searchInput = customSelect.querySelector('#model-search-input') as HTMLInputElement;
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                this.searchQuery = searchInput.value.trim().toLowerCase();
                this.filterAndRenderModels();
            });
        }

        // Insert custom select after the original select
        container.insertBefore(customSelect, this.elements.modelSelect.nextSibling);
    }

    private filterAndRenderModels(): void {
        const availableModels = this.modelConfig.getAvailableModels();
        const selectedModel = this.modelConfig.getSelectedModel();
        const modelsByProvider: Record<string, typeof availableModels> = {};
        availableModels.forEach(model => {
            const prov = model.provider || 'unknown';
            if (!modelsByProvider[prov]) {
                modelsByProvider[prov] = [];
            }
            modelsByProvider[prov].push(model);
        });
        this.renderModelsForProvider(this.activeProvider, modelsByProvider, selectedModel);
    }

    private updateCustomSelectOptions(): void {
        const providersContainer = document.getElementById('model-selector-providers');
        const modelsContainer = document.getElementById('model-selector-models');

        if (!providersContainer || !modelsContainer) return;

        const availableModels = this.modelConfig.getAvailableModels();
        const selectedModel = this.modelConfig.getSelectedModel();

        // Group models by provider
        const modelsByProvider: Record<string, typeof availableModels> = {};
        availableModels.forEach(model => {
            const provider = model.provider || 'unknown';
            const providerKey = provider.toLowerCase();
            if (!modelsByProvider[providerKey]) {
                modelsByProvider[providerKey] = [];
            }
            modelsByProvider[providerKey].push(model);
        });

        // Provider configuration with SVG logos
        const providerConfig: Record<string, { logo: string; class: string; label: string }> = {
            'google': {
                logo: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`,
                class: 'google',
                label: 'Google'
            },
            'gemini': {
                logo: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>`,
                class: 'google',
                label: 'Gemini'
            },
            'openai': {
                logo: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>`,
                class: 'openai',
                label: 'OpenAI'
            },
            'nvidia': {
                logo: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M8.948 8.798v-1.43a6.7 6.7 0 0 1 .424-.018c3.922-.124 6.493 3.374 6.493 3.374s-2.774 3.851-5.75 3.851c-.398 0-.787-.062-1.158-.185v-4.346c1.528.185 1.837.857 2.747 2.385l2.04-1.714s-1.492-1.952-4-1.952a6.016 6.016 0 0 0-.796.035m0-4.735v2.138l.424-.027c5.45-.185 9.01 4.47 9.01 4.47s-4.08 4.964-8.33 4.964c-.37 0-.733-.035-1.095-.097v1.325c.3.035.61.062.91.062 3.957 0 6.82-2.023 9.593-4.408.459.371 2.34 1.263 2.73 1.652-2.633 2.208-8.772 3.984-12.253 3.984-.335 0-.653-.018-.971-.053v1.864H24V4.063zm0 10.326v1.131c-3.657-.654-4.673-4.46-4.673-4.46s1.758-1.944 4.673-2.262v1.237H8.94c-1.528-.186-2.73 1.245-2.73 1.245s.68 2.412 2.739 3.11M2.456 10.9s2.164-3.197 6.5-3.533V6.201C4.153 6.59 0 10.653 0 10.653s2.35 6.802 8.948 7.42v-1.237c-4.84-.6-6.492-5.936-6.492-5.936z"/></svg>`,
                class: 'nvidia',
                label: 'NVIDIA'
            },
            'anthropic': {
                logo: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.258 0h3.767L16.906 20.48h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.521zm4.132 10.501L8.453 7.687l-2.247 6.334h4.495z"/></svg>`,
                class: 'anthropic',
                label: 'Anthropic'
            },
            'openrouter': {
                logo: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`,
                class: 'openrouter',
                label: 'Router'
            },
            'local': {
                logo: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8h16v10zm-2-1h-6v-2h6v2zM7.5 17l-1.41-1.41L8.67 13l-2.59-2.59L7.5 9l4 4-4 4z"/></svg>`,
                class: 'local',
                label: 'Local'
            },
            'meta': {
                logo: `<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6.915 4.03c-1.968 0-3.683 1.28-4.871 3.113C.704 9.208 0 11.883 0 14.449c0 .706.07 1.369.21 1.973a4.14 4.14 0 0 0 1.756 2.494c.893.593 2.123.893 3.912.893 1.738 0 3.075-.373 3.948-1.166.878-.798 1.317-1.96 1.317-3.439 0-.543-.032-1.089-.095-1.636a44.09 44.09 0 0 0-.26-1.636l-1.353.233c.095.606.171 1.214.228 1.822.057.606.085 1.145.085 1.616 0 1.073-.26 1.86-.778 2.363-.518.504-1.405.756-2.66.756-1.43 0-2.42-.23-2.968-.69-.548-.462-.822-1.158-.822-2.088 0-2.346.6-4.48 1.8-6.404 1.2-1.92 2.53-2.881 3.99-2.881.886 0 1.594.302 2.125.907.532.606.797 1.408.797 2.408 0 .315-.012.63-.036.945-.024.315-.06.63-.107.945l1.353-.233c.054-.315.093-.63.117-.945.024-.315.036-.63.036-.945 0-1.315-.373-2.36-1.12-3.134-.747-.775-1.756-1.162-3.026-1.162zM14.69 4.03c-1.269 0-2.278.388-3.026 1.162-.746.774-1.12 1.82-1.12 3.134 0 .315.012.63.037.945.024.315.063.63.116.945l1.353-.233a12.6 12.6 0 0 1-.107-.945 12.6 12.6 0 0 1-.036-.945c0-1 .265-1.802.797-2.408.531-.605 1.24-.907 2.126-.907 1.46 0 2.79.961 3.99 2.881 1.2 1.924 1.8 4.058 1.8 6.404 0 .93-.275 1.626-.823 2.088-.548.46-1.538.69-2.967.69-1.256 0-2.143-.252-2.66-.756-.52-.503-.78-1.29-.78-2.363 0-.47.029-1.01.086-1.616a44.09 44.09 0 0 1 .228-1.822l-1.353-.233a44.09 44.09 0 0 0-.26 1.636c-.063.547-.095 1.093-.095 1.636 0 1.479.439 2.64 1.317 3.44.873.792 2.21 1.165 3.948 1.165 1.789 0 3.019-.3 3.912-.893a4.14 4.14 0 0 0 1.756-2.494c.14-.604.21-1.267.21-1.973 0-2.566-.704-5.24-2.044-7.306-1.188-1.834-2.903-3.113-4.871-3.113z"/></svg>`,
                class: 'meta',
                label: 'Meta'
            },
            'mistral': {
                logo: `<svg viewBox="0 0 24 24" width="20" height="20"><rect x="2" y="4" width="4" height="4" fill="currentColor"/><rect x="6" y="4" width="4" height="4" fill="currentColor" opacity="0.7"/><rect x="14" y="4" width="4" height="4" fill="currentColor" opacity="0.7"/><rect x="18" y="4" width="4" height="4" fill="currentColor"/><rect x="2" y="10" width="4" height="4" fill="currentColor"/><rect x="6" y="10" width="4" height="4" fill="currentColor"/><rect x="10" y="10" width="4" height="4" fill="currentColor"/><rect x="14" y="10" width="4" height="4" fill="currentColor"/><rect x="18" y="10" width="4" height="4" fill="currentColor"/><rect x="2" y="16" width="4" height="4" fill="currentColor"/><rect x="10" y="16" width="4" height="4" fill="currentColor"/><rect x="18" y="16" width="4" height="4" fill="currentColor"/></svg>`,
                class: 'mistral',
                label: 'Mistral'
            }
        };

        // Ensure all core providers are present
        const coreProviders = ['gemini', 'openai', 'nvidia', 'anthropic', 'openrouter', 'local'];
        const modelsProviders = Object.keys(modelsByProvider).map(p => p.toLowerCase());
        const allProvidersSet = new Set([
            ...coreProviders,
            ...modelsProviders
        ]);

        // Sort providers - Google/Gemini first, then others
        const sortedProviders = Array.from(allProvidersSet).sort((a, b) => {
            const order = ['google', 'gemini', 'openai', 'nvidia', 'anthropic', 'openrouter', 'meta', 'mistral', 'local'];
            const aIndex = order.indexOf(a.toLowerCase());
            const bIndex = order.indexOf(b.toLowerCase());
            if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
            if (aIndex === -1) return 1;
            if (bIndex === -1) return -1;
            return aIndex - bIndex;
        });

        // Determine active provider - prefer Google/Gemini, or first available
        const selectedModelData = availableModels.find(m => m.value === selectedModel);
        if (selectedModelData?.provider) {
            this.activeProvider = selectedModelData.provider.toLowerCase();
        } else if (sortedProviders.includes('gemini')) {
            this.activeProvider = 'gemini';
        } else if (sortedProviders.includes('google')) {
            this.activeProvider = 'google';
        } else if (sortedProviders.length > 0) {
            this.activeProvider = sortedProviders[0].toLowerCase();
        }

        // Build provider tabs
        providersContainer.innerHTML = '';
        sortedProviders.forEach(provider => {
            const config = providerConfig[provider.toLowerCase()] || {
                logo: `<span class="provider-letter">${provider.charAt(0).toUpperCase()}</span>`,
                class: 'default',
                label: provider.charAt(0).toUpperCase() + provider.slice(1)
            };

            const providerTab = document.createElement('button');
            providerTab.className = `provider-tab ${config.class}`;
            if (provider.toLowerCase() === this.activeProvider) {
                providerTab.classList.add('active');
            }
            providerTab.dataset.provider = provider;
            providerTab.innerHTML = `
                <span class="provider-logo">${config.logo}</span>
            `;
            providerTab.title = config.label;

            providerTab.addEventListener('click', () => {
                this.setActiveProvider(provider);
            });

            providersContainer.appendChild(providerTab);
        });

        // Render models for active provider
        this.renderModelsForProvider(this.activeProvider, modelsByProvider, selectedModel);

        // Sync models container height with providers column
        this.syncModelsSectionHeight();
    }

    private syncModelsSectionHeight(): void {
        const providersContainer = document.getElementById('model-selector-providers');
        const modelsContainer = document.getElementById('model-selector-models');
        const searchContainer = document.getElementById('model-search-container');

        if (providersContainer && modelsContainer) {
            // Get the natural height of providers column
            const providersHeight = providersContainer.offsetHeight;
            const searchHeight = searchContainer ? searchContainer.offsetHeight : 0;
            // Set models max-height to match (minus padding and search bar height)
            modelsContainer.style.maxHeight = `${providersHeight - 12 - searchHeight}px`;
        }
    }

    private setActiveProvider(provider: string): void {
        this.activeProvider = provider.toLowerCase();

        // Clear search input on provider tab change
        const searchInput = document.getElementById('model-search-input') as HTMLInputElement;
        if (searchInput) {
            searchInput.value = '';
        }
        this.searchQuery = '';

        // Update active state on tabs
        const tabs = document.querySelectorAll('.provider-tab');
        tabs.forEach(tab => {
            tab.classList.remove('active');
            if ((tab as HTMLElement).dataset.provider?.toLowerCase() === this.activeProvider) {
                tab.classList.add('active');
            }
        });

        // Re-render models
        const selectedModel = this.modelConfig.getSelectedModel();
        this.renderModelsForProvider(provider, this.groupAvailableModels(), selectedModel);
        this.updateThinkingLevelVisibility();
    }

    private renderModelsForProvider(
        provider: string,
        modelsByProvider: Record<string, { value: string; label: string; description?: string; provider?: string }[]>,
        selectedModel: string
    ): void {
        const modelsContainer = document.getElementById('model-selector-models');
        if (!modelsContainer) return;

        modelsContainer.innerHTML = '';

        const normalizedProvider = provider.toLowerCase();
        const lookupProviderName = normalizedProvider === 'google' ? 'gemini' : normalizedProvider;
        const providerConfig = this.providerManager?.getProviderConfig(lookupProviderName);
        const isConfigured = providerConfig ? providerConfig.isConfigured : false;

        if (!isConfigured) {
            const displayName = providerConfig?.displayName || (provider.charAt(0).toUpperCase() + provider.slice(1));
            modelsContainer.innerHTML = `
                <div class="provider-unconfigured-container">
                    <div class="provider-unconfigured-icon">
                        ${renderIconMarkup('TriangleAlert', 'unconfigured-alert-icon', {}, 28)}
                    </div>
                    <h4 class="provider-unconfigured-title">${displayName} Not Configured</h4>
                    <p class="provider-unconfigured-description">
                        API key or credentials for ${displayName} are not configured in Iterative Studio.
                    </p>
                    <button class="provider-configure-btn" id="model-selector-configure-btn">
                        ${renderIconMarkup('settings', 'configure-settings-icon', {}, 14)}
                        <span>Configure API Key</span>
                    </button>
                </div>
            `;
            
            const configureBtn = modelsContainer.querySelector('#model-selector-configure-btn');
            if (configureBtn) {
                configureBtn.addEventListener('click', () => {
                    document.getElementById('add-providers-trigger')?.click();
                });
            }
            return;
        }

        // Find models for this provider (case-insensitive match)
        const providerKey = Object.keys(modelsByProvider).find(
            k => k.toLowerCase() === provider.toLowerCase()
        );
        let models = providerKey ? modelsByProvider[providerKey] : [];

        // Apply search filter if query is not empty
        if (this.searchQuery) {
            models = models.filter(model => 
                model.value.toLowerCase().includes(this.searchQuery) ||
                (model.label && model.label.toLowerCase().includes(this.searchQuery))
            );
        }

        if (models.length === 0) {
            if (this.searchQuery) {
                modelsContainer.innerHTML = '<div class="no-models">No matching models found</div>';
            } else {
                modelsContainer.innerHTML = `
                    <div class="no-models">
                        No models found for ${providerConfig?.displayName || provider}.<br/>
                        <button class="provider-configure-btn refresh-models-btn" id="model-selector-refresh-btn" style="margin-top: 12px; font-size: 11px; padding: 6px 10px;">
                            ${renderIconMarkup('RotateCcw', 'refresh-icon', {}, 12)}
                            <span>Fetch Models</span>
                        </button>
                    </div>
                `;
                const refreshBtn = modelsContainer.querySelector('#model-selector-refresh-btn');
                if (refreshBtn) {
                    refreshBtn.addEventListener('click', async () => {
                        const icon = refreshBtn.querySelector('.refresh-icon');
                        if (icon) icon.classList.add('spinning');
                        try {
                            await this.providerManager?.fetchAndSetProviderModels(lookupProviderName);
                        } catch (err) {
                            console.error('Fetch failed:', err);
                        } finally {
                            if (icon) icon.classList.remove('spinning');
                        }
                    });
                }
            }
            return;
        }

        // Sort models alphabetically
        const sortedModels = [...models].sort((a, b) => a.value.localeCompare(b.value));

        sortedModels.forEach(model => {
            const modelBtn = document.createElement('button');
            modelBtn.className = 'model-option';
            if (model.value === selectedModel) {
                modelBtn.classList.add('selected');
            }
            modelBtn.dataset.value = model.value;

            // Add checkmark icon for selected model
            const checkIcon = model.value === selectedModel
                ? renderIconMarkup('CircleCheck', 'model-check-icon', {}, 14)
                : '';

            modelBtn.innerHTML = `<span class="model-name">${model.value}</span>${checkIcon}`;

            modelBtn.addEventListener('click', () => {
                this.selectModel(model.value);
            });

            modelsContainer.appendChild(modelBtn);
        });
    }

    private selectModel(value: string): void {
        // Update the hidden select
        if (this.elements.modelSelect) {
            this.elements.modelSelect.value = value;
        }

        // Update model config
        this.modelConfig.setSelectedModel(value);

        // Update code execution toggle visibility (depends on provider)
        updateCodeExecutionToggleVisibility(globalState.currentMode);

        // Re-render models to update checkmark
        this.renderModelsForProvider(this.activeProvider, this.groupAvailableModels(), value);
        this.updateThinkingLevelVisibility();
    }

    private groupAvailableModels(): Record<string, ModelOption[]> {
        return this.modelConfig.getAvailableModels().reduce<Record<string, ModelOption[]>>((modelsByProvider, model) => {
            const prov = model.provider || 'unknown';
            const provKey = prov.toLowerCase();
            if (!modelsByProvider[provKey]) {
                modelsByProvider[provKey] = [];
            }
            modelsByProvider[provKey].push(model);
            return modelsByProvider;
        }, {});
    }
    private initializeEventListeners(): void {
        // Model selection
        if (this.elements.modelSelect) {
            this.elements.modelSelect.addEventListener('change', () => {
                this.modelConfig.setSelectedModel(this.elements.modelSelect!.value);
                // Update code execution toggle visibility (depends on provider)
                updateCodeExecutionToggleVisibility(globalState.currentMode);
                this.updateThinkingLevelVisibility();
            });
        }

        // Thinking Level select
        if (this.elements.thinkingLevelSelect) {
            this.elements.thinkingLevelSelect.addEventListener('change', () => {
                const value = this.elements.thinkingLevelSelect!.value as any;
                globalState.thinkingLevel = value;
                this.modelConfig.updateParameter('thinkingLevel', value);
            });
        }

        // Temperature slider
        if (this.elements.temperatureSlider && this.elements.temperatureValue) {
            this.elements.temperatureSlider.addEventListener('input', () => {
                const value = parseFloat(this.elements.temperatureSlider!.value);
                this.modelConfig.updateParameter('temperature', value);
                this.elements.temperatureValue!.textContent = value.toString();
            });
        }

        // Top P slider
        if (this.elements.topPSlider && this.elements.topPValue) {
            this.elements.topPSlider.addEventListener('input', () => {
                const value = parseFloat(this.elements.topPSlider!.value);
                this.modelConfig.updateParameter('topP', value);
                this.elements.topPValue!.textContent = value.toString();
            });
        }
    }

    private updateUI(): void {
        const params = this.modelConfig.getParameters();

        if (this.elements.temperatureSlider) {
            this.elements.temperatureSlider.value = params.temperature.toString();
        }
        if (this.elements.temperatureValue) {
            this.elements.temperatureValue.textContent = params.temperature.toString();
        }

        if (this.elements.topPSlider) {
            this.elements.topPSlider.value = params.topP.toString();
        }
        if (this.elements.topPValue) {
            this.elements.topPValue.textContent = params.topP.toString();
        }

        this.updateThinkingLevelVisibility();
    }

    public getModelConfig(): ModelConfigManager {
        return this.modelConfig;
    }

    /**
     * Public method to sync UI with current model parameters
     * Useful after importing configuration
     */
    public syncUIWithParameters(): void {
        this.updateUI();
        this.apiCallEstimator?.updateApiCallDisplay();
    }

    private updateThinkingLevelVisibility(): void {
        if (!this.elements.thinkingLevelContainer) return;
        const selectedModel = this.modelConfig.getSelectedModel();
        const excludedProviders = ['openrouter', 'local'];
        const show = !excludedProviders.includes(this.activeProvider) && getModelThinkingType(selectedModel) !== 'none';
        this.elements.thinkingLevelContainer.style.display = show ? '' : 'none';
        
        // Also update the select element value to match globalState
        if (this.elements.thinkingLevelSelect) {
            this.elements.thinkingLevelSelect.value = globalState.thinkingLevel;
        }
    }
}
