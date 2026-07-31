import React, { useEffect, useState } from 'react';
import { BaseModal } from '../Deepthink/Deepthink.tsx';
import { DeepthinkFilesystemTab } from '../Deepthink/DeepthinkFilesystemTab';

/**
 * Compatibility bridge for existing workspace launch controls. The explorer
 * itself is now the Deepthink Filesystem tab.
 */
export const VirtualEnvironmentModal: React.FC = () => {
    const [repositoryId, setRepositoryId] = useState<string | null>(null);

    useEffect(() => {
        const openFilesystem = (event: Event) => {
            const id = (event as CustomEvent<{ repositoryId?: string }>).detail?.repositoryId;
            if (id) {
                setRepositoryId(id);
                return;
            }
            window.dispatchEvent(new CustomEvent('openDeepthinkFilesystem'));
        };
        window.addEventListener('openVirtualEnvironment', openFilesystem);
        return () => window.removeEventListener('openVirtualEnvironment', openFilesystem);
    }, []);

    if (!repositoryId) return null;
    return (
        <BaseModal
            title="Virtual Environment"
            className="fullscreen-modal"
            noPadding
            onClose={() => setRepositoryId(null)}
        >
            <DeepthinkFilesystemTab repositoryId={repositoryId} />
        </BaseModal>
    );
};

export default VirtualEnvironmentModal;
