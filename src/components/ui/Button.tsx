import React from 'react';
import { cn } from '../../lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'red' | 'blue';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
  ...props
}) => {
  const baseStyles = 'font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 hover:shadow-lg';

  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 shadow-md hover:shadow-blue-500/50',
    secondary: 'bg-gray-300 text-gray-900 hover:bg-gray-400 focus:ring-gray-500 border border-gray-400 hover:border-gray-500',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 shadow-md hover:shadow-red-500/50',
    ghost: 'bg-transparent text-gray-900 hover:bg-gray-200 focus:ring-gray-500 border border-gray-400 hover:border-gray-500',
    red: 'bg-red-500 text-white hover:bg-red-600 focus:ring-red-400 shadow-md hover:shadow-red-400/50',
    blue: 'bg-blue-500 text-white hover:bg-blue-600 focus:ring-blue-400 shadow-md hover:shadow-blue-400/50',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
    xl: 'px-8 py-4 text-xl',
  };

  return (
    <button
      className={cn(
        baseStyles,
        variants[variant],
        sizes[size],
        fullWidth && 'w-full',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};
