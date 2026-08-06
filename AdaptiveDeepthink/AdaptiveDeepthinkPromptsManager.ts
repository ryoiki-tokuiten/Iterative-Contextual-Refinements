/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CustomizablePromptsAdaptiveDeepthink, createDefaultCustomPromptsAdaptiveDeepthink } from './AdaptiveDeepthinkPrompt';
import { globalState } from '../Core/State';

interface AdaptiveDeepthinkPromptsRef {
    current: CustomizablePromptsAdaptiveDeepthink;
}

// A simple subscription-based state manager for purely functional React consumption
class AdaptiveDeepthinkPromptsManager {
    private state: CustomizablePromptsAdaptiveDeepthink;
    private listeners: Set<(state: CustomizablePromptsAdaptiveDeepthink) => void>;
    private ref?: AdaptiveDeepthinkPromptsRef;

    constructor(initialRef?: AdaptiveDeepthinkPromptsRef) {
        this.ref = initialRef;
        this.state = initialRef?.current || createDefaultCustomPromptsAdaptiveDeepthink();
        this.listeners = new Set();
    }

    private currentPrompts(): CustomizablePromptsAdaptiveDeepthink {
        return this.ref?.current || this.state;
    }

    public getPrompts(): CustomizablePromptsAdaptiveDeepthink {
        return this.currentPrompts();
    }

    public setPrompts(prompts: CustomizablePromptsAdaptiveDeepthink): void {
        this.state = { ...prompts };
        if (this.ref) {
            this.ref.current = this.state;
        }
        this.notifyListeners();
    }

    public updatePrompt(key: keyof CustomizablePromptsAdaptiveDeepthink, value: string | undefined): void {
        const nextState = { ...this.currentPrompts() };
        if (value === undefined || value === '') {
            delete nextState[key];
        } else {
            nextState[key] = value;
        }
        this.state = nextState;
        if (this.ref) {
            this.ref.current = this.state;
        }
        this.notifyListeners();
    }

    public resetToDefaults(): void {
        this.setPrompts(createDefaultCustomPromptsAdaptiveDeepthink());
    }

    public subscribe(listener: (state: CustomizablePromptsAdaptiveDeepthink) => void): () => void {
        this.listeners.add(listener);
        // Immediately notify with current state
        listener(this.currentPrompts());
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notifyListeners(): void {
        this.listeners.forEach(listener => listener(this.currentPrompts()));
    }
}

const adaptiveDeepthinkPromptsRef: AdaptiveDeepthinkPromptsRef = {
    get current() {
        return globalState.customPromptsAdaptiveDeepthinkState;
    },
    set current(prompts) {
        globalState.customPromptsAdaptiveDeepthinkState = prompts;
    },
};

export const globalAdaptiveDeepthinkPromptsManager = new AdaptiveDeepthinkPromptsManager(adaptiveDeepthinkPromptsRef);
