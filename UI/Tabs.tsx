import { getCurrentMode, getActiveDeepthinkPipeline } from './Tabs';
import { ApplicationMode } from '../Core/Types';

export interface TabButtonProps {
    id: string | number;
    label: string;
    isActive: boolean;
    onClick: (id: string | number) => void;
    className?: string;
}

export const TabButton: React.FC<TabButtonProps> = ({ id, label, isActive, onClick, className = '' }) => {
    return (
        <button
            className={`tab-button ${isActive ? 'active' : ''} ${className}`}
            onClick={() => onClick(id)}
        >
            {label}
        </button>
    );
};

export const useCurrentMode = (): ApplicationMode => {
    return getCurrentMode();
};

export const useActiveDeepthinkPipeline = () => {
    return getActiveDeepthinkPipeline();
};
