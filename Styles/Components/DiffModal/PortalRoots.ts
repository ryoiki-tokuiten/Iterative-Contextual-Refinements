import { createRoot, type Root } from 'react-dom/client';

const roots = new Map<string, Root>();

export function getPortalRoot(id: string): Root | undefined {
    return roots.get(id);
}

export function getOrCreatePortalRoot(id: string): Root {
    const existingRoot = getPortalRoot(id);
    if (existingRoot) return existingRoot;

    const element = document.createElement('div');
    element.id = id;
    document.body.appendChild(element);

    const root = createRoot(element);
    roots.set(id, root);
    return root;
}

export function unmountPortalRoot(id: string): void {
    getPortalRoot(id)?.unmount();
    roots.delete(id);
    document.getElementById(id)?.remove();
}
