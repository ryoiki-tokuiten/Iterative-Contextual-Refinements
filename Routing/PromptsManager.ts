/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CustomizablePromptsDeepthink } from '../Deepthink/DeepthinkPrompts';
import { CustomizablePromptsContextual } from '../Contextual/ContextualPrompts';
import { ContextualPromptsManager } from '../Contextual/ContextualPromptsManager';
import { DeepthinkPromptsManager } from '../Deepthink/DeepthinkPromptsManager';

export class PromptsManager {
    private deepthinkPromptsManager: DeepthinkPromptsManager;
    private contextualPromptsManager?: ContextualPromptsManager;

    constructor(
        deepthinkPromptsRef: { current: CustomizablePromptsDeepthink },
        contextualPromptsRef?: { current: CustomizablePromptsContextual }
    ) {
        this.deepthinkPromptsManager = new DeepthinkPromptsManager(deepthinkPromptsRef);

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

    // Contextual prompts
    public getContextualPromptsManager(): ContextualPromptsManager | undefined {
        return this.contextualPromptsManager;
    }
}
