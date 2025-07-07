import React from 'react';
import { XIcon } from './icons';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl';
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, size = 'md' }) => {
  if (!isOpen) return null;

  const sizeClasses: { [key: string]: string } = {
    sm: 'modal--sm',
    md: 'modal--md',
    lg: 'modal--lg',
    xl: 'modal--xl',
    '2xl': 'modal--2xl',
    '3xl': 'modal--3xl',
    '4xl': 'modal--4xl',
    '5xl': 'modal--5xl',
  };

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={`modal ${sizeClasses[size] || 'modal--md'}`}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1} 
        aria-labelledby="modal-title"
      >
        <div className="modal__header">
          <h2 id="modal-title" className="modal__title">{title}</h2>
          <button
            onClick={onClose}
            className="btn btn--ghost btn--icon"
            aria-label="Close modal"
          >
            <XIcon className="icon" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};