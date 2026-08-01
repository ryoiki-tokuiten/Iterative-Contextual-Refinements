import { routingManager } from '../../../Routing';

export interface ProviderUI {
    mountButtons: (container: HTMLElement) => void;
}

export function getProviderManagementUI(): ProviderUI | null {
    return routingManager.getProviderManagementUI();
}

export function mountProviderButtons(containerRef: React.RefObject<HTMLDivElement | null>): boolean {
    const providerUI = getProviderManagementUI();
    if (providerUI && containerRef.current) {
        providerUI.mountButtons(containerRef.current);
        return true;
    }
    return false;
}

export function createPollingInterval(
    containerRef: React.RefObject<HTMLDivElement | null>,
    onMount: () => void
): number {
    return window.setInterval(() => {
        if (containerRef.current && containerRef.current.children.length === 0) {
            onMount();
        }
    }, 100);
}
