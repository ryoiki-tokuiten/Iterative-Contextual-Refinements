import React from 'react';
import { Modal } from './Modal';
import { WarningIcon } from './icons';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  confirmButtonText?: string;
  cancelButtonText?: string;
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmButtonText = 'Confirm',
  cancelButtonText = 'Cancel',
}) => {
  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="md">
        <div className="modal__body">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-md)' }}>
                <WarningIcon className="icon" style={{ width: '2rem', height: '2rem', color: 'var(--accent-warning)', flexShrink: 0, marginTop: '4px' }} /> 
                <div style={{ color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: '1.6' }}>{message}</div>
            </div>
        </div>
        
        <div className="modal__footer">
          <button
            type="button"
            onClick={onClose}
            className="btn btn--secondary"
          >
            {cancelButtonText}
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose(); 
            }}
            className="btn btn--danger"
          >
            {confirmButtonText}
          </button>
        </div>
    </Modal>
  );
};