import { DCAPromptsState } from './DCAPrompts';

export class DCAPromptsManager {
    private stateRef: { current: DCAPromptsState };

    constructor(stateRef: { current: DCAPromptsState }) {
        this.stateRef = stateRef;
    }

    public getPrompts(): DCAPromptsState {
        return { ...this.stateRef.current };
    }

    public setPrompts(prompts: DCAPromptsState): void {
        this.stateRef.current = { ...prompts };
    }
}
