import React from 'react';
import { ModalType, getModalState } from './GlobalModals';

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
