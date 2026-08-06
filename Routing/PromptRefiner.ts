/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { callAI } from './AIService';
import { renderIconMarkup } from '../UI/Icons';
import { describeProviderError } from '../Core/ProviderError';

interface PromptRefinerConfig {
    agentName: string;
    currentPrompt: string;
    onPromptUpdated: (newPrompt: string) => void;
    modelConfig: any;
}

export class PromptRefiner {
    private config: PromptRefinerConfig;
    private overlay: HTMLElement | null = null;
    private isRefining: boolean = false;

    constructor(config: PromptRefinerConfig) {
        this.config = config;
    }

    public show(triggerElement: HTMLElement): void {
        if (this.overlay) {
            this.overlay.remove();
        }

        this.overlay = this.createOverlay();
        document.body.appendChild(this.overlay);

        // Position near the trigger element
        this.positionOverlay(triggerElement);

        // Show with animation
        requestAnimationFrame(() => {
            this.overlay?.classList.add('visible');
        });
    }

    private createOverlay(): HTMLElement {
        const overlay = document.createElement('div');
        overlay.className = 'prompt-refiner-overlay';
        overlay.innerHTML = `
            <div class="prompt-refiner-card">
                <div class="prompt-refiner-header">
                    <h3 class="prompt-refiner-title">Refine Prompt</h3>
                    <button class="prompt-refiner-close" aria-label="Close">
                        ${renderIconMarkup('close')}
                    </button>
                </div>
                <div class="prompt-refiner-body">
                    <div class="prompt-refiner-input-group">
                        <label class="prompt-refiner-label">Refinement Instructions</label>
                        <textarea 
                            class="prompt-refiner-textarea" 
                            placeholder="e.g., Change the prompt to focus on sales and business potential, or make it more professional..."
                            rows="4"
                        ></textarea>
                    </div>
                    <div class="prompt-refiner-model-group">
                        <label class="prompt-refiner-label">Model for Refinement</label>
                        <div class="prompt-refiner-model-selector-wrapper">
                            <select class="prompt-refiner-model-select" style="display: none;">
                                <option value="">Use Global Model</option>
                            </select>
                            <div class="custom-model-select" id="prompt-refiner-custom-select">
                                <div class="custom-model-select-trigger" id="prompt-refiner-model-trigger">
                                    <span class="custom-model-select-text" id="prompt-refiner-model-text">Use Global Model</span>
                                    ${renderIconMarkup('expand_more', 'custom-model-select-arrow')}
                                </div>
                                <div class="custom-model-select-dropdown" id="prompt-refiner-model-dropdown">
                                    <!-- Options will be populated here -->
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="prompt-refiner-footer">
                    <button class="prompt-refiner-button prompt-refiner-button-secondary" data-action="cancel">
                        Cancel
                    </button>
                    <button class="prompt-refiner-button prompt-refiner-button-primary" data-action="refine">
                        <span class="prompt-refiner-button-text">Refine Prompt</span>
                        <span class="prompt-refiner-spinner" style="display: none;">
                            ${renderIconMarkup('progress_activity')}
                        </span>
                    </button>
                </div>
            </div>
        `;

        this.initializeOverlayEvents(overlay);
        this.populateModelSelector(overlay);

        return overlay;
    }

    private populateModelSelector(overlay: HTMLElement): void {
        const select = overlay.querySelector('.prompt-refiner-model-select') as HTMLSelectElement;
        const dropdown = overlay.querySelector('#prompt-refiner-model-dropdown') as HTMLElement;
        const trigger = overlay.querySelector('#prompt-refiner-model-trigger') as HTMLElement;
        const textElement = overlay.querySelector('#prompt-refiner-model-text') as HTMLElement;

        if (!select || !dropdown || !trigger || !textElement) return;

        const availableModels = this.config.modelConfig.getAvailableModels();

        // Populate hidden select
        availableModels.forEach((model: any) => {
            const option = document.createElement('option');
            option.value = model.value;
            option.textContent = model.value;
            select.appendChild(option);
        });

        // Populate custom dropdown
        this.populateCustomDropdown(dropdown, availableModels, select);

        // Add click handler for trigger
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = trigger.classList.contains('open');
            if (isOpen) {
                this.closeCustomDropdown(trigger, dropdown);
            } else {
                this.openCustomDropdown(trigger, dropdown);
            }
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!trigger.contains(e.target as Node) && !dropdown.contains(e.target as Node)) {
                this.closeCustomDropdown(trigger, dropdown);
            }
        });
    }

    private populateCustomDropdown(dropdown: HTMLElement, availableModels: any[], select: HTMLSelectElement): void {
        dropdown.innerHTML = '';

        // Add "Use Global Model" option
        const globalOption = document.createElement('div');
        globalOption.className = 'custom-model-select-option';
        globalOption.dataset.value = '';
        globalOption.innerHTML = `
            <span class="custom-model-select-option-text">Use Global Model</span>
            ${renderIconMarkup('check', 'option-check')}
        `;
        globalOption.addEventListener('click', () => {
            this.selectModel('', 'Use Global Model', select);
        });
        dropdown.appendChild(globalOption);

        // Group models by provider
        const modelsByProvider: Record<string, typeof availableModels> = {};
        availableModels.forEach((model: any) => {
            if (!modelsByProvider[model.provider!]) {
                modelsByProvider[model.provider!] = [];
            }
            modelsByProvider[model.provider!].push(model);
        });

        const providerConfig: Record<string, { class: string }> = {
            'openai': { class: 'openai' },
            'anthropic': { class: 'anthropic' },
            'google': { class: 'google' },
            'gemini': { class: 'google' },
            'openrouter': { class: 'openrouter' },
            'meta': { class: 'meta' },
            'mistral': { class: 'mistral' }
        };

        const sortedProviders = Object.keys(modelsByProvider).sort();

        sortedProviders.forEach(provider => {
            const models = modelsByProvider[provider];
            const config = providerConfig[provider.toLowerCase()] || { class: 'default' };

            const providerSection = document.createElement('div');
            providerSection.className = `custom-model-select-provider-section ${config.class}`;

            const providerHeader = document.createElement('div');
            providerHeader.className = `custom-model-select-provider-header ${config.class}`;
            providerHeader.innerHTML = `<span>${provider.charAt(0).toUpperCase() + provider.slice(1)}</span>`;
            providerSection.appendChild(providerHeader);

            const sortedModels = models.sort((a: any, b: any) => a.value.localeCompare(b.value));

            sortedModels.forEach((model: any) => {
                const option = document.createElement('div');
                option.className = 'custom-model-select-option';
                option.dataset.value = model.value;
                option.innerHTML = `
                    <span class="custom-model-select-option-text">${model.value}</span>
                    ${renderIconMarkup('check', 'option-check')}
                `;
                option.addEventListener('click', () => {
                    this.selectModel(model.value, model.value, select);
                });
                providerSection.appendChild(option);
            });

            dropdown.appendChild(providerSection);
        });
    }

    private selectModel(value: string, label: string, select: HTMLSelectElement): void {
        const textElement = document.querySelector('#prompt-refiner-model-text') as HTMLElement;
        const dropdown = document.querySelector('#prompt-refiner-model-dropdown') as HTMLElement;
        const trigger = document.querySelector('#prompt-refiner-model-trigger') as HTMLElement;

        if (textElement) {
            textElement.textContent = label;
        }

        select.value = value;

        // Update selected state
        if (dropdown) {
            dropdown.querySelectorAll('.custom-model-select-option').forEach(opt => {
                opt.classList.remove('selected');
            });
            dropdown.querySelector(`[data-value="${value}"]`)?.classList.add('selected');
        }

        this.closeCustomDropdown(trigger, dropdown);
    }

    private openCustomDropdown(trigger: HTMLElement, dropdown: HTMLElement): void {
        trigger.classList.add('open');
        dropdown.classList.add('open');
    }

    private closeCustomDropdown(trigger: HTMLElement, dropdown: HTMLElement): void {
        trigger.classList.remove('open');
        dropdown.classList.remove('open');
    }

    private initializeOverlayEvents(overlay: HTMLElement): void {
        const closeBtn = overlay.querySelector('.prompt-refiner-close');
        const cancelBtn = overlay.querySelector('[data-action="cancel"]');
        const refineBtn = overlay.querySelector('[data-action="refine"]');
        const textarea = overlay.querySelector('.prompt-refiner-textarea') as HTMLTextAreaElement;

        closeBtn?.addEventListener('click', () => this.hide());
        cancelBtn?.addEventListener('click', () => this.hide());
        refineBtn?.addEventListener('click', () => this.handleRefine());

        // Close on overlay click (outside card)
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.hide();
            }
        });

        // Close on Escape key (with propagation stop to prevent closing parent modals)
        const escapeHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && this.overlay?.classList.contains('visible')) {
                e.stopPropagation();
                e.preventDefault();
                this.hide();
            }
        };
        document.addEventListener('keydown', escapeHandler, true);

        // Store handler for cleanup
        (overlay as any)._escapeHandler = escapeHandler;

        // Auto-resize textarea
        textarea?.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        });
    }

    private positionOverlay(_triggerElement: HTMLElement): void {
        if (!this.overlay) return;

        const card = this.overlay.querySelector('.prompt-refiner-card') as HTMLElement;
        if (!card) return;

        // Center the card in viewport
        card.style.position = 'fixed';
        card.style.top = '50%';
        card.style.left = '50%';
        card.style.transform = 'translate(-50%, -50%)';
    }

    private async handleRefine(): Promise<void> {
        if (this.isRefining) return;

        const textarea = this.overlay?.querySelector('.prompt-refiner-textarea') as HTMLTextAreaElement;
        const modelSelect = this.overlay?.querySelector('.prompt-refiner-model-select') as HTMLSelectElement;
        const refineBtn = this.overlay?.querySelector('[data-action="refine"]') as HTMLButtonElement;
        const buttonText = refineBtn?.querySelector('.prompt-refiner-button-text') as HTMLElement;
        const spinner = refineBtn?.querySelector('.prompt-refiner-spinner') as HTMLElement;

        if (!textarea || !modelSelect || !refineBtn) return;

        const instructions = textarea.value.trim();
        if (!instructions) {
            this.showError('Please provide refinement instructions');
            return;
        }

        this.isRefining = true;
        refineBtn.disabled = true;
        if (buttonText) buttonText.style.display = 'none';
        if (spinner) {
            spinner.style.display = 'inline-flex';
            // Add spinning class to the icon
            const icon = spinner.querySelector('.icon-slot');
            if (icon) icon.classList.add('spinning');
        }

        try {
            const selectedModel = modelSelect.value || this.config.modelConfig.getSelectedModel();
            const refinedPrompt = await this.refinePrompt(instructions, selectedModel);

            this.config.onPromptUpdated(refinedPrompt);
            this.hide();
        } catch (error) {
            console.error('Error refining prompt:', error);
            this.showError(describeProviderError(error));
        } finally {
            this.isRefining = false;
            if (refineBtn) refineBtn.disabled = false;
            if (buttonText) buttonText.style.display = '';
            if (spinner) {
                spinner.style.display = 'none';
                // Remove spinning class
                const icon = spinner.querySelector('.icon-slot');
                if (icon) icon.classList.remove('spinning');
            }
        }
    }

    private async refinePrompt(instructions: string, model: string): Promise<string> {
        const systemPrompt = `You are an expert prompt engineer. Your task is to refine and improve system prompts for AI agents based on user instructions.

CRITICAL RULES:
1. Maintain the EXACT structure, format, and syntax of the original prompt
2. Preserve all XML tags, markdown formatting, and special characters
3. Keep the same tone and style unless explicitly asked to change it
4. Only modify the content according to the user's instructions
5. Output ONLY the complete refined prompt - no explanations, no markdown code blocks, no additional text
6. The output must be ready to use directly as a system prompt

Your goal is to enhance the prompt while preserving its integrity and functionality.`;

        const userPrompt = `Original Prompt:
${this.config.currentPrompt}

Refinement Instructions:
${instructions}

Please provide the complete refined prompt:`;

        const response = await callAI(
            userPrompt,
            model,
            systemPrompt,
            false
        );

        const refinedPrompt = response.text?.trim() || '';

        if (!refinedPrompt) {
            throw new Error('Empty response from AI');
        }

        return refinedPrompt;
    }

    private showError(message: string): void {
        if (!this.overlay) return;

        const existingError = this.overlay.querySelector('.prompt-refiner-error');
        if (existingError) {
            existingError.remove();
        }

        const errorDiv = document.createElement('div');
        errorDiv.className = 'prompt-refiner-error';
        errorDiv.textContent = message;

        const body = this.overlay.querySelector('.prompt-refiner-body');
        body?.appendChild(errorDiv);

        setTimeout(() => {
            errorDiv.remove();
        }, 3000);
    }

    public hide(): void {
        if (!this.overlay) return;

        // Remove escape key listener (must use same capture phase as when added)
        const escapeHandler = (this.overlay as any)._escapeHandler;
        if (escapeHandler) {
            document.removeEventListener('keydown', escapeHandler, true);
        }

        this.overlay.classList.remove('visible');
        setTimeout(() => {
            this.overlay?.remove();
            this.overlay = null;
        }, 300);
    }

    public updateConfig(config: Partial<PromptRefinerConfig>): void {
        this.config = { ...this.config, ...config };
    }
}
