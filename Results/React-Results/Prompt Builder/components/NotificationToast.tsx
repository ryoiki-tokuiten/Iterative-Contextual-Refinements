import React, { useEffect } from 'react';
import { NotificationState } from '../types';
import { CheckIcon, ErrorIcon, InfoIcon, WarningIcon, XIcon } from './icons';

interface NotificationToastProps extends NotificationState {
  onDismiss: (id: string) => void;
}

const icons: { [key in NotificationState['type']]: React.ReactNode } = {
  success: <CheckIcon className="notification__icon notification__icon--success" />,
  error: <ErrorIcon className="notification__icon notification__icon--error" />,
  info: <InfoIcon className="notification__icon notification__icon--info" />,
  warning: <WarningIcon className="notification__icon notification__icon--warning" />,
};

export const NotificationToast: React.FC<NotificationToastProps> = ({
  id,
  message,
  type,
  duration = 3000,
  onDismiss,
}) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(id);
    }, duration);
    return () => clearTimeout(timer);
  }, [id, duration, onDismiss]);

  return (
    <div
      className="notification"
      role="alert"
      aria-live={type === 'error' ? 'assertive' : 'polite'}
    >
      {icons[type]}
      <div className="notification__content">
          <p className="notification__message">{message}</p>
      </div>
      <button
        onClick={() => onDismiss(id)}
        className="btn btn--ghost btn--icon btn--sm notification__close-btn"
        aria-label="Dismiss notification"
      >
        <XIcon className="icon"/>
      </button>
    </div>
  );
};

interface NotificationContainerProps {
  notifications: NotificationState[];
  onDismiss: (id: string) => void;
}

export const NotificationContainer: React.FC<NotificationContainerProps> = ({ notifications, onDismiss }) => {
  if (!notifications.length) return null;

  return (
    <div className="notification-container">
      {notifications.map((notification) => (
        <NotificationToast key={notification.id} {...notification} onDismiss={onDismiss} />
      ))}
    </div>
  );
};