import React from 'react';
import { ModalType, getModalState, closeModal } from './GlobalModals';
import { Icon } from './Icons';

export interface ModalProps {
    id: string;
    type: ModalType;
    children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ id, children }) => {
    return (
        <div id={id} className="modal-overlay">
            <div className="modal-content">
                {children}
            </div>
        </div>
    );
};

export const RedTeamModal: React.FC = () => {
    const state = getModalState('red-team');
    return (
        <div id="red-team-full-modal" className={`modal red-team-full-modal ${state.isActive ? 'active' : ''}`}>
            <div className="modal-header">
                <h3 className="modal-title">Red Team Reasoning</h3>
                <button className="modal-close-button" onClick={() => closeModal('red-team')} aria-label="Close modal">
                    <Icon name="close" />
                </button>
            </div>
            <div id="red-team-modal-content" className="modal-body">
                <pre>{state.content}</pre>
            </div>
        </div>
    );
};

export const DeepthinkRedTeamModal: React.FC = () => {
    const state = getModalState('deepthink-red-team');
    return (
        <div id="deepthink-red-team-full-modal" className={`modal red-team-full-modal ${state.isActive ? 'active' : ''}`}>
            <div className="modal-header">
                <h3 className="modal-title">Deepthink Red Team Reasoning</h3>
                <button className="modal-close-button" onClick={() => closeModal('deepthink-red-team')} aria-label="Close modal">
                    <Icon name="close" />
                </button>
            </div>
            <div id="deepthink-red-team-modal-content" className="modal-body">
                <pre>{state.content}</pre>
            </div>
        </div>
    );
};

export const PatchesModal: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return (
        <div id="patches-modal-overlay" className="modal-overlay">
            <div className="modal-content">
                <button id="patches-modal-close-button" className="modal-close">&times;</button>
                {children}
            </div>
        </div>
    );
};

export const useModalState = (type: ModalType) => {
    return getModalState(type);
};
