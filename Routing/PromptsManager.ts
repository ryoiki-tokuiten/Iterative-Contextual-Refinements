/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CustomizablePromptsWebsite } from '../Refine/RefinePrompts';
import { CustomizablePromptsDeepthink } from '../Deepthink/DeepthinkPrompts';
import { AgenticPromptsManager, AgenticPrompts } from '../Agentic/AgenticPromptsManager';
import { CustomizablePromptsAdaptiveDeepthink } from '../AdaptiveDeepthink/AdaptiveDeepthinkPrompt';
import { AdaptiveDeepthinkPromptsManager } from '../AdaptiveDeepthink/AdaptiveDeepthinkPromptsManager';
import { CustomizablePromptsContextual } from '../Contextual/ContextualPrompts';
import { ContextualPromptsManager } from '../Contextual/ContextualPromptsManager';
import { WebsitePromptsManager } from '../Refine/WebsitePromptsManager';
import { DeepthinkPromptsManager } from '../Deepthink/DeepthinkPromptsManager';

import { DCAPromptsState } from '../Deepthink/DCA/DCAPrompts';
import { DCAPromptsManager } from '../Deepthink/DCA/DCAPromptsManager';

export class PromptsManager {
    private websitePromptsManager: WebsitePromptsManager;
    private deepthinkPromptsManager: DeepthinkPromptsManager;
    private agenticPromptsManager: AgenticPromptsManager;
    private adaptiveDeepthinkPromptsManager?: AdaptiveDeepthinkPromptsManager;
    private contextualPromptsManager?: ContextualPromptsManager;
    private dcaPromptsManager?: DCAPromptsManager;

    constructor(
        websitePromptsRef: { current: CustomizablePromptsWebsite },
        deepthinkPromptsRef: { current: CustomizablePromptsDeepthink },
        agenticPromptsRef?: { current: AgenticPrompts },
        adaptiveDeepthinkPromptsRef?: { current: CustomizablePromptsAdaptiveDeepthink },
        contextualPromptsRef?: { current: CustomizablePromptsContextual },
        dcaPromptsRef?: { current: DCAPromptsState }
    ) {
        this.websitePromptsManager = new WebsitePromptsManager(websitePromptsRef);
        this.deepthinkPromptsManager = new DeepthinkPromptsManager(deepthinkPromptsRef);

        const defaultAgenticRef = agenticPromptsRef || { current: { systemPrompt: '', verifierPrompt: '' } };
        this.agenticPromptsManager = new AgenticPromptsManager(defaultAgenticRef.current);

        if (adaptiveDeepthinkPromptsRef) {
            this.adaptiveDeepthinkPromptsManager = new AdaptiveDeepthinkPromptsManager(adaptiveDeepthinkPromptsRef);
        }
        if (contextualPromptsRef) {
            this.contextualPromptsManager = new ContextualPromptsManager(contextualPromptsRef);
        }
        if (dcaPromptsRef) {
            this.dcaPromptsManager = new DCAPromptsManager(dcaPromptsRef);
        }
    }

    // DCA Prompts
    public getDCAPromptsManager(): DCAPromptsManager | undefined {
        return this.dcaPromptsManager;
    }

    public getDCAPrompts(): DCAPromptsState | undefined {
        return this.dcaPromptsManager?.getPrompts();
    }

    public setDCAPrompts(prompts: DCAPromptsState): void {
        this.dcaPromptsManager?.setPrompts(prompts);
    }

    // Website prompts
    public getWebsitePromptsManager(): WebsitePromptsManager {
        return this.websitePromptsManager;
    }

    public getWebsitePrompts(): CustomizablePromptsWebsite {
        return this.websitePromptsManager.getPrompts();
    }

    public setWebsitePrompts(prompts: CustomizablePromptsWebsite): void {
        this.websitePromptsManager.setPrompts(prompts);
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

    // Agentic prompts
    public getAgenticPromptsManager(): AgenticPromptsManager {
        return this.agenticPromptsManager;
    }

    public getAgenticPrompts(): AgenticPrompts {
        return this.agenticPromptsManager.getAgenticPrompts();
    }

    public setAgenticPrompts(prompts: AgenticPrompts): void {
        this.agenticPromptsManager.setAgenticPrompts(prompts);
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