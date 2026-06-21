/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProviderManager } from './ProviderManager';

export interface ApiKeyStatus {
    isAvailable: boolean;
    source: 'environment' | 'localStorage' | 'none';
    message: string;
    className: string;
}

export class ApiKeyManager {
    private providerManager: ProviderManager;

    constructor() {
        this.providerManager = new ProviderManager();
    }

    public initializeApiKey(): ApiKeyStatus {
        const hasConfiguredProviders = this.providerManager.hasAnyConfiguredProvider();
        
        if (hasConfiguredProviders) {
            const configuredProviders = this.providerManager.getConfiguredProviders();
            const envProviders = configuredProviders.filter(p => this.isEnvironmentProvider(p.name));
            
            if (envProviders.length > 0) {
                return {
                    isAvailable: true,
                    source: 'environment',
                    message: `${configuredProviders.length} provider(s) configured`,
                    className: 'api-key-status-message status-badge status-ok'
                };
            } else {
                return {
                    isAvailable: true,
                    source: 'localStorage',
                    message: `${configuredProviders.length} provider(s) configured`,
                    className: 'api-key-status-message status-badge status-ok'
                };
            }
        }

        return {
            isAvailable: false,
            source: 'none',
            message: 'No providers configured',
            className: 'api-key-status-message status-badge status-error'
        };
    }

    private isEnvironmentProvider(providerName: string): boolean {
        switch (providerName) {
            case 'gemini':
                return !!(process.env.GEMINI_API_KEY || process.env.AI_API_KEY || process.env.API_KEY);
            case 'openai':
                return !!process.env.OPENAI_API_KEY;
            case 'anthropic':
                return !!process.env.ANTHROPIC_API_KEY;
            case 'openrouter':
                return !!process.env.OPENROUTER_API_KEY;
            case 'nvidia':
                return !!process.env.NVIDIA_API_KEY;
            default:
                return false;
        }
    }

    public saveApiKey(apiKey: string, provider: string = 'gemini'): boolean {
        // This method is kept for backward compatibility but now delegates to ProviderManager
        return this.providerManager.configureProvider(provider, apiKey);
    }

    public clearApiKey(): void {
        // Clear all non-environment providers
        const providers = this.providerManager.getAllProviders();
        providers.forEach(provider => {
            if (!this.isEnvironmentProvider(provider.name)) {
                this.providerManager.removeProvider(provider.name);
            }
        });
    }

    public getAIProvider(): any {
        // Return the provider manager for backward compatibility
        return this.providerManager;
    }

    public getProviderForModel(modelId: string): any {
        return this.providerManager.getProviderForModel(modelId);
    }

    public hasValidApiKey(): boolean {
        return this.providerManager.hasAnyConfiguredProvider();
    }

    public getCurrentApiKey(): string | null {
        // Return null as we now manage multiple API keys
        return null;
    }

    public getCurrentProvider(): string {
        // Return the first configured provider for backward compatibility
        const configured = this.providerManager.getConfiguredProviders();
        return configured.length > 0 ? configured[0].name : 'gemini';
    }

    public getProviderManager(): ProviderManager {
        return this.providerManager;
    }
}