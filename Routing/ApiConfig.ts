/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProviderManager } from './ProviderManager';

export class ApiKeyManager {
    private providerManager: ProviderManager;

    constructor() {
        this.providerManager = new ProviderManager();
    }

    public hasValidApiKey(): boolean {
        return this.providerManager.hasAnyConfiguredProvider();
    }

    public getProviderManager(): ProviderManager {
        return this.providerManager;
    }
}
