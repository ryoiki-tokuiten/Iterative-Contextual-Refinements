/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProviderManager, ProviderConfig } from './ProviderManager';
import { renderIconMarkup } from '../UI/Icons';

export class ProviderManagementUI {
    private providerManager: ProviderManager;
    private elements: {
        trigger: HTMLElement | null;
        promptsButton: HTMLElement | null;
        overlay: HTMLElement | null;
        closeButton: HTMLElement | null;
        content: HTMLElement | null;
    };
    private onModelsChangedCallback?: () => void;
    private promptsModal?: any;

    constructor(providerManager: ProviderManager, promptsModal?: any) {
        this.providerManager = providerManager;
        this.promptsModal = promptsModal;
        this.elements = {
            trigger: null,
            promptsButton: null,
            overlay: null,
            closeButton: null,
            content: null
        };
        this.initializeElements();
    }

    private initializeElements(): void {
        this.createModal();

        // Try to mount buttons if container exists (for initial load)
        const container = document.getElementById('provider-buttons-mount-point');
        if (container) {
            this.mountButtons(container);
        }
    }

    public mountButtons(container: HTMLElement): void {
        // Clear container first to prevent duplicates
        container.innerHTML = '';

        // Create container for both buttons
        const buttonsContainer = document.createElement('div');
        buttonsContainer.className = 'provider-buttons-container';

        // Create Add Providers button
        const triggerButton = document.createElement('button');
        triggerButton.id = 'add-providers-trigger';
        triggerButton.className = 'add-providers-button';
        triggerButton.innerHTML = `
            ${renderIconMarkup('key_round')}
            <span>Providers</span>
        `;

        // Create Prompts button
        const promptsButton = document.createElement('button');
        promptsButton.id = 'prompts-trigger';
        promptsButton.className = 'prompts-button';
        promptsButton.innerHTML = `
            ${renderIconMarkup('edit')}
            <span>Prompts</span>
        `;

        buttonsContainer.appendChild(triggerButton);
        buttonsContainer.appendChild(promptsButton);

        container.appendChild(buttonsContainer);

        this.elements.trigger = triggerButton;
        this.elements.promptsButton = promptsButton;

        triggerButton.addEventListener('click', () => this.show());
        promptsButton.addEventListener('click', () => {
            this.openPromptsModal();
        });

        this.updateTriggerState();
    }

    private createModal(): void {
        // Create modal overlay using the same structure as prompts modal
        const overlay = document.createElement('div');
        overlay.id = 'provider-management-overlay';
        overlay.className = 'modal-overlay';
        overlay.style.display = 'none';

        overlay.innerHTML = `
            <div class="modal-content" role="dialog" aria-modal="true" aria-labelledby="provider-management-title">
                <header class="modal-header">
                    <h2 id="provider-management-title" class="modal-title">
                        ${renderIconMarkup('key')}
                        Provider Management
                    </h2>
                    <button id="provider-management-close" class="modal-close-button" aria-label="Close Provider Management">
                        ${renderIconMarkup('close')}
                    </button>
                </header>
                <div class="modal-body">
                    <div id="provider-management-content" class="provider-management-content">
                        <!-- Provider cards will be rendered here -->
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        this.elements.overlay = overlay;
        this.elements.closeButton = overlay.querySelector('#provider-management-close');
        this.elements.content = overlay.querySelector('#provider-management-content');

        // Add event listeners
        if (this.elements.closeButton) {
            this.elements.closeButton.addEventListener('click', () => this.hide());
        }

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.hide();
            }
        });

        // Add escape key listener
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && overlay.style.display === 'flex') {
                this.hide();
            }
        });
    }

    public show(): void {
        if (this.elements.overlay) {
            this.renderProviderCards();
            this.elements.overlay.style.display = 'flex';
            setTimeout(() => {
                this.elements.overlay!.classList.add('is-visible');
            }, 10);
        }
    }

    public hide(): void {
        if (this.elements.overlay) {
            this.elements.overlay.classList.remove('is-visible');
            this.elements.overlay.addEventListener('transitionend', () => {
                if (!this.elements.overlay!.classList.contains('is-visible')) {
                    this.elements.overlay!.style.display = 'none';
                }
            }, { once: true });
        }
    }

    private renderProviderCards(): void {
        if (!this.elements.content) return;

        const providers = this.providerManager.getAllProviders();

        this.elements.content.innerHTML = `
            <div class="provider-cards-grid">
                ${providers.map(provider => this.renderProviderCard(provider)).join('')}
            </div>
        `;

        // Add event listeners for each provider card
        providers.forEach(provider => {
            this.attachProviderCardListeners(provider);
        });
    }

    private renderProviderCard(provider: ProviderConfig): string {
        const isConfigured = provider.isConfigured;
        const isEnvironmentKey = this.isEnvironmentKey(provider.name);

        return `
            <div class="provider-card" data-provider="${provider.name}">
                <div class="provider-card-header">
                    <div class="provider-info">
                        <h3 class="provider-name">${provider.displayName}</h3>
                        <div class="provider-status ${isConfigured ? 'configured' : 'not-configured'}">
                            ${isConfigured ? 'Configured' : 'Not Configured'}
                        </div>
                    </div>
                    <div class="provider-icon">
                        ${this.getProviderIcon(provider.name)}
                    </div>
                </div>
                
                <div class="provider-card-body">
                    ${isConfigured ? this.renderConfiguredState(provider, isEnvironmentKey) : this.renderNotConfiguredState(provider)}
                </div>
            </div>
        `;
    }

    private renderConfiguredState(provider: ProviderConfig, isEnvironmentKey: boolean): string {
        const models = provider.models;
        const defaultModels = this.getDefaultModels(provider.name);

        // For local models, all models are custom (no defaults)
        const isLocal = provider.name === 'local';

        return `
            <div class="configured-content">
                ${isLocal && provider.apiKey ? `
                    <div class="endpoint-info">
                        ${renderIconMarkup('link')}
                        <span class="endpoint-url">Endpoint: ${provider.apiKey}</span>
                    </div>
                ` : ''}
                
                <div class="models-section">
                    <h4>Available Models</h4>
                    <div class="models-list">
                        ${models.map(model => `
                            <div class="model-item ${!isLocal && defaultModels.includes(model) ? 'default-model' : 'custom-model'}">
                                <span class="model-name">${model}</span>
                                ${isLocal || !defaultModels.includes(model) ? `
                                    <button class="remove-model-btn" data-provider="${provider.name}" data-model="${model}">
                                        ${renderIconMarkup('close')}
                                    </button>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <div class="add-model-section">
                    <div class="add-model-and-actions">
                        <div class="input-group">
                            <input type="text" 
                                   class="add-model-input" 
                                   placeholder="Add custom model ID"
                                   data-provider="${provider.name}">
                            <button class="add-model-btn" data-provider="${provider.name}">Add</button>
                        </div>
                        ${!isEnvironmentKey ? `
                            <div class="provider-actions">
                                <button class="remove-provider-btn" data-provider="${provider.name}">
                                    Clear Key
                                </button>
                            </div>
                        ` : ''}
                    </div>
                    ${isEnvironmentKey ? `
                        <div class="env-key-notice">
                            ${renderIconMarkup('info')}
                            API key loaded from environment
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    private renderNotConfiguredState(provider: ProviderConfig): string {
        // Special UI for Local Models provider
        if (provider.name === 'local') {
            return `
                <div class="not-configured-content">
                    <div class="input-group">
                        <input type="text" 
                               class="api-key-input" 
                               placeholder="Enter endpoint URL (e.g., http://localhost:1234)"
                               data-provider="${provider.name}">
                        <small class="input-help">The URL of your local model server (LM Studio, Ollama, etc.)</small>
                    </div>
                    
                    <div class="input-group">
                        <input type="text" 
                               class="model-ids-input" 
                               placeholder="Model IDs (comma-separated, required)"
                               data-provider="${provider.name}">
                        <small class="input-help">Enter the model IDs available on your local server</small>
                    </div>
                    
                    <button class="configure-provider-btn" data-provider="${provider.name}">
                        Configure Local Models
                    </button>
                </div>
            `;
        }

        // Standard UI for other providers
        return `
            <div class="not-configured-content">
                <div class="input-group">
                    <input type="password" 
                           class="api-key-input" 
                           placeholder="Enter ${provider.displayName} API Key"
                           data-provider="${provider.name}">
                </div>
                
                <div class="input-group">
                    <input type="text" 
                           class="model-ids-input" 
                           placeholder="Model IDs (comma-separated, optional)"
                           data-provider="${provider.name}">
                    <small class="input-help">Leave empty to use default models only</small>
                </div>
                
                <button class="configure-provider-btn" data-provider="${provider.name}">
                    Configure Provider
                </button>
            </div>
        `;
    }

    private attachProviderCardListeners(provider: ProviderConfig): void {
        if (!this.elements.content) return;
        const card = this.elements.content.querySelector(`.provider-card[data-provider="${provider.name}"]`);
        if (!card) return;

        // Configure provider button
        const configureBtn = card.querySelector('.configure-provider-btn');
        if (configureBtn) {
            configureBtn.addEventListener('click', () => this.handleConfigureProvider(provider.name));
        }

        // Remove provider button
        const removeBtn = card.querySelector('.remove-provider-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => this.handleRemoveProvider(provider.name));
        }

        // Add model button
        const addModelBtn = card.querySelector('.add-model-btn');
        if (addModelBtn) {
            addModelBtn.addEventListener('click', () => this.handleAddModel(provider.name));
        }

        // Add model input enter key
        const addModelInput = card.querySelector('.add-model-input') as HTMLInputElement;
        if (addModelInput) {
            addModelInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.handleAddModel(provider.name);
                }
            });
        }

        // Remove model buttons
        const removeModelBtns = card.querySelectorAll('.remove-model-btn');
        removeModelBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const button = target.closest('.remove-model-btn') as HTMLElement;
                const modelId = button.dataset.model!;
                this.handleRemoveModel(provider.name, modelId);
            });
        });
    }

    private handleConfigureProvider(providerName: string): void {
        if (!this.elements.content) return;
        const card = this.elements.content.querySelector(`.provider-card[data-provider="${providerName}"]`);
        if (!card) return;

        const apiKeyInput = card.querySelector('.api-key-input') as HTMLInputElement;
        const modelIdsInput = card.querySelector('.model-ids-input') as HTMLInputElement;

        const apiKey = apiKeyInput.value.trim();

        // For local models, validate endpoint URL and require model IDs
        if (providerName === 'local') {
            if (!apiKey) {
                this.showError(card, 'Please enter an endpoint URL');
                return;
            }

            const customModels = modelIdsInput.value
                .split(',')
                .map(m => m.trim())
                .filter(m => m.length > 0);

            if (customModels.length === 0) {
                this.showError(card, 'Please enter at least one model ID');
                return;
            }

            const success = this.providerManager.configureProvider(providerName, apiKey, customModels);
            if (success) {
                this.updateTriggerState();
                this.renderProviderCards(); // Re-render to show configured state

                // Notify the routing manager to refresh models
                this.notifyModelsChanged();
            } else {
                this.showError(card, 'Failed to configure local models. Please check your endpoint URL.');
            }
        } else {
            // Standard provider configuration
            if (!apiKey) {
                this.showError(card, 'Please enter an API key');
                return;
            }

            const customModels = modelIdsInput.value
                .split(',')
                .map(m => m.trim())
                .filter(m => m.length > 0);

            const success = this.providerManager.configureProvider(providerName, apiKey, customModels);
            if (success) {
                this.updateTriggerState();
                this.renderProviderCards(); // Re-render to show configured state

                // Notify the routing manager to refresh models
                this.notifyModelsChanged();
            } else {
                this.showError(card, 'Failed to configure provider. Please check your API key.');
            }
        }
    }

    private handleRemoveProvider(providerName: string): void {
        if (confirm(`Are you sure you want to remove the ${providerName} provider?`)) {
            this.providerManager.removeProvider(providerName);
            this.updateTriggerState();
            this.renderProviderCards();

            // Notify the routing manager to refresh models
            this.notifyModelsChanged();
        }
    }

    private handleAddModel(providerName: string): void {
        if (!this.elements.content) return;
        const card = this.elements.content.querySelector(`.provider-card[data-provider="${providerName}"]`);
        if (!card) return;

        const input = card.querySelector('.add-model-input') as HTMLInputElement;
        const modelId = input.value.trim();

        if (!modelId) {
            this.showError(card, 'Please enter a model ID');
            return;
        }

        const success = this.providerManager.addCustomModel(providerName, modelId);
        if (success) {
            input.value = '';
            this.renderProviderCards();

            // Notify the routing manager to refresh models
            this.notifyModelsChanged();
        } else {
            this.showError(card, 'Failed to add model or model already exists');
        }
    }

    private handleRemoveModel(providerName: string, modelId: string): void {
        this.providerManager.removeCustomModel(providerName, modelId);
        this.renderProviderCards();

        // Notify the routing manager to refresh models
        this.notifyModelsChanged();
    }

    private showError(card: Element, message: string): void {
        // Remove existing error
        const existingError = card.querySelector('.error-message');
        if (existingError) {
            existingError.remove();
        }

        // Add new error
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        card.appendChild(errorDiv);

        // Remove error after 3 seconds
        setTimeout(() => {
            errorDiv.remove();
        }, 3000);
    }

    private getProviderIcon(providerName: string): string {
        const icons: Record<string, string> = {
            gemini: '<img src="./Logos/Google.png" alt="Google Gemini" class="provider-logo">',
            openai: '<img src="./Logos/OpenAI.png" alt="OpenAI" class="provider-logo">',
            anthropic: '<img src="./Logos/Anthropic.png" alt="Anthropic" class="provider-logo">',
            openrouter: '<img src="./Logos/Openrouter.png" alt="OpenRouter" class="provider-logo">',
            nvidia: '<img src="./Logos/NVIDIA.png" alt="NVIDIA" class="provider-logo">',
            local: '<img src="./Logos/Local.png" alt="Local Models" class="provider-logo">'
        };
        return icons[providerName] || renderIconMarkup('api');
    }

    private getDefaultModels(providerName: string): string[] {
        const defaultModels: Record<string, string[]> = {
            gemini: ['gemini-3-pro-preview', 'gemini-3-flash-preview',   'gemini-3.1-flash-lite-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'],
            openrouter: ['deepseek/deepseek-chat-v3.1:free', 'deepseek/deepseek-r1-0528:free', 'qwen/qwen3-coder:free', 'z-ai/glm-4.5-air:free'],
            anthropic: ['claude-opus-4-1-20250805', 'claude-sonnet-4-20250514'],
            openai: ['o3-2025-04-16', 'gpt-5-2025-08-07', 'gpt-4.1-2025-04-14', 'gpt-5-mini-2025-08-07'],
            nvidia: ['deepseek-ai/deepseek-v4-pro', 'minimaxai/minimax-m2.7']
        };
        return defaultModels[providerName] || [];
    }

    private isEnvironmentKey(providerName: string): boolean {
        const provider = this.providerManager.getAllProviders().find(p => p.name === providerName);
        if (!provider?.apiKey) return false;

        switch (providerName) {
            case 'gemini':
                return provider.apiKey === (process.env.GEMINI_API_KEY || process.env.AI_API_KEY || process.env.API_KEY);
            case 'openai':
                return provider.apiKey === process.env.OPENAI_API_KEY;
            case 'anthropic':
                return provider.apiKey === process.env.ANTHROPIC_API_KEY;
            case 'openrouter':
                return provider.apiKey === process.env.OPENROUTER_API_KEY;
            case 'nvidia':
                return provider.apiKey === process.env.NVIDIA_API_KEY;
            default:
                return false;
        }
    }

    public updateTriggerState(): void {
        if (!this.elements.trigger) return;

        const hasConfiguredProviders = this.providerManager.hasAnyConfiguredProvider();

        if (hasConfiguredProviders) {
            this.elements.trigger.classList.add('configured');
        } else {
            this.elements.trigger.classList.remove('configured');
        }
    }

    public getProviderManager(): ProviderManager {
        return this.providerManager;
    }

    public setOnModelsChangedCallback(callback: () => void): void {
        this.onModelsChangedCallback = callback;
    }

    private notifyModelsChanged(): void {
        if (this.onModelsChangedCallback) {
            this.onModelsChangedCallback();
        }
    }

    public openPromptsModal(): void {
        if (this.promptsModal) {
            console.log('Opening prompts modal');
            this.promptsModal.show();
        } else {
            console.error('Prompts modal not available');
        }
    }
}
