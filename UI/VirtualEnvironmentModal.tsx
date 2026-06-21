import React, { useEffect } from 'react';

/**
 * Compatibility bridge for existing workspace launch controls. The explorer
 * itself is now the Deepthink Filesystem tab.
 */
export const VirtualEnvironmentModal: React.FC = () => {
    useEffect(() => {
        const openFilesystem = () => window.dispatchEvent(new CustomEvent('openDeepthinkFilesystem'));
        window.addEventListener('openVirtualEnvironment', openFilesystem);
        return () => window.removeEventListener('openVirtualEnvironment', openFilesystem);
    }, []);
    return null;
};

export default VirtualEnvironmentModal;
