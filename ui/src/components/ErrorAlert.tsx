import React from 'react';
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

type AlertType = 'error' | 'warning' | 'info';

interface ErrorAlertProps {
  type?: AlertType;
  title?: string;
  message: string;
  onRetry?: () => void;
  onClose?: () => void;
  className?: string;
}

export const ErrorAlert: React.FC<ErrorAlertProps> = ({
  type = 'error',
  title,
  message,
  onRetry,
  onClose,
  className = ''
}) => {
  const styles = {
    error: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      icon: 'text-red-500',
      title: 'text-red-800',
      text: 'text-red-700',
      button: 'bg-red-600 hover:bg-red-700'
    },
    warning: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-200',
      icon: 'text-yellow-500',
      title: 'text-yellow-800',
      text: 'text-yellow-700',
      button: 'bg-yellow-600 hover:bg-yellow-700'
    },
    info: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      icon: 'text-blue-500',
      title: 'text-blue-800',
      text: 'text-blue-700',
      button: 'bg-blue-600 hover:bg-blue-700'
    }
  };

  const style = styles[type];
  const Icon = type === 'error' ? AlertCircle : type === 'warning' ? AlertTriangle : Info;

  return (
    <div className={`rounded-lg border p-4 ${style.bg} ${style.border} ${className}`}>
      <div className="flex items-start">
        <Icon className={`w-5 h-5 mt-0.5 mr-3 ${style.icon}`} />
        <div className="flex-1">
          {title && (
            <h3 className={`font-medium mb-1 ${style.title}`}>{title}</h3>
          )}
          <p className={`text-sm ${style.text}`}>{message}</p>
          
          {(onRetry || onClose) && (
            <div className="mt-3 flex space-x-2">
              {onRetry && (
                <Button 
                  size="sm" 
                  onClick={onRetry}
                  className={style.button}
                >
                  重试
                </Button>
              )}
              {onClose && (
                <Button 
                  size="sm" 
                  variant="outline" 
                  onClick={onClose}
                >
                  <X className="w-4 h-4 mr-1" />
                  关闭
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ErrorAlert;
