/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CustomizablePromptsDeepthink } from './DeepthinkPrompts';

export class DeepthinkPromptsManager {
    private promptsRef: { current: CustomizablePromptsDeepthink };
    private listeners: Set<(state: CustomizablePromptsDeepthink) => void>;

    constructor(promptsRef: { current: CustomizablePromptsDeepthink }) {
        this.promptsRef = promptsRef;
        this.listeners = new Set();
    }

    public subscribe(listener: (state: CustomizablePromptsDeepthink) => void): () => void {
        this.listeners.add(listener);
        listener(this.promptsRef.current);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private notifyListeners(): void {
        const snapshot = { ...this.promptsRef.current };
        this.listeners.forEach(listener => listener(snapshot));
    }

    public updatePrompt(key: keyof CustomizablePromptsDeepthink, value: string): void {
        this.promptsRef.current[key] = value;
        this.notifyListeners();
    }

    public updateModel(key: keyof CustomizablePromptsDeepthink, value: string): void {
        if (value === '') {
            delete this.promptsRef.current[key];
        } else {
            this.promptsRef.current[key] = value;
        }
        this.notifyListeners();
    }

    public getPrompts(): CustomizablePromptsDeepthink {
        return this.promptsRef.current;
    }

    public setPrompts(prompts: CustomizablePromptsDeepthink): void {
        this.promptsRef.current = prompts;
        this.notifyListeners();
    }
}
