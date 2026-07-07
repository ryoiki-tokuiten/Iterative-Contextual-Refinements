/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CustomizablePromptsDeepthink } from '../Deepthink/DeepthinkPrompts';
import { CustomizablePromptsAdaptiveDeepthink } from '../AdaptiveDeepthink/AdaptiveDeepthinkPrompt';
import { AdaptiveDeepthinkPromptsManager } from '../AdaptiveDeepthink/AdaptiveDeepthinkPromptsManager';
import { CustomizablePromptsContextual } from '../Contextual/ContextualPrompts';
import { ContextualPromptsManager } from '../Contextual/ContextualPromptsManager';
import { DeepthinkPromptsManager } from '../Deepthink/DeepthinkPromptsManager';

export class PromptsManager {
    private deepthinkPromptsManager: DeepthinkPromptsManager;
    private adaptiveDeepthinkPromptsManager?: AdaptiveDeepthinkPromptsManager;
    private contextualPromptsManager?: ContextualPromptsManager;

    constructor(
        deepthinkPromptsRef: { current: CustomizablePromptsDeepthink },
        adaptiveDeepthinkPromptsRef?: { current: CustomizablePromptsAdaptiveDeepthink },
        contextualPromptsRef?: { current: CustomizablePromptsContextual }
    ) {
        this.deepthinkPromptsManager = new DeepthinkPromptsManager(deepthinkPromptsRef);

        if (adaptiveDeepthinkPromptsRef) {
            this.adaptiveDeepthinkPromptsManager = new AdaptiveDeepthinkPromptsManager(adaptiveDeepthinkPromptsRef);
        }
        if (contextualPromptsRef) {
            this.contextualPromptsManager = new ContextualPromptsManager(contextualPromptsRef);
        }
    }

    // Deepthink prompts
    public getDeepthinkPromptsManager(): DeepthinkPromptsManager {
        return this.deepthinkPromptsManager;
    }

    public getDeepthinkPrompts(): CustomizablePromptsDeepthink {
        return this.deepthinkPromptsManager.getPrompts();
    }

    public setDeepthinkPrompts(prompts: CustomizablePromptsDeepthink): void {
        this.deepthinkPromptsManager.setPrompts(prompts);
    }

    // Adaptive Deepthink prompts
    public getAdaptiveDeepthinkPromptsManager(): AdaptiveDeepthinkPromptsManager | undefined {
        return this.adaptiveDeepthinkPromptsManager;
    }

    public getAdaptiveDeepthinkPrompts(): CustomizablePromptsAdaptiveDeepthink | undefined {
        return this.adaptiveDeepthinkPromptsManager?.getPrompts();
    }

    public setAdaptiveDeepthinkPrompts(prompts: CustomizablePromptsAdaptiveDeepthink): void {
        this.adaptiveDeepthinkPromptsManager?.setPrompts(prompts);
    }

    // Contextual prompts
    public getContextualPromptsManager(): ContextualPromptsManager | undefined {
        return this.contextualPromptsManager;
    }

    public getContextualPrompts(): CustomizablePromptsContextual | undefined {
        return this.contextualPromptsManager?.getPrompts();
    }

    public setContextualPrompts(prompts: CustomizablePromptsContextual): void {
        this.contextualPromptsManager?.setPrompts(prompts);
    }
}