import React from 'react';
import { cn } from '../../lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'bordered' | 'elevated';
  hoverable?: boolean;
  interactive?: boolean; // Для keyboard navigation
}

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'default',
  hoverable = false,
  interactive = false,
  className,
  onClick,
  ...props
}) => {
  const variants = {
    default: 'bg-white',
    bordered: 'bg-white border border-gray-400',
    elevated: 'bg-white shadow-lg border border-gray-400',
  };

  const hoverStyles = hoverable
    ? 'transition-all duration-200 hover:shadow-xl hover:-translate-y-1 hover:border-blue-400/50 cursor-pointer'
    : '';

  const interactiveStyles = interactive
    ? 'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'
    : '';

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (interactive && onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      (onClick as any)(e);
    }
  };

  return (
    <div
      className={cn('rounded-lg p-6', variants[variant], hoverStyles, interactiveStyles, className)}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? 'button' : undefined}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <div className={cn('mb-4', className)} {...props}>
      {children}
    </div>
  );
};

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <h3 className={cn('text-xl font-semibold text-gray-900', className)} {...props}>
      {children}
    </h3>
  );
};

export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className,
  ...props
}) => {
  return (
    <div className={cn('text-gray-800', className)} {...props}>
      {children}
    </div>
  );
};
