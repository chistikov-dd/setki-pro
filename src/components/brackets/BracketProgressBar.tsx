import React from 'react';

interface BracketProgressBarProps {
  completed: number;
  total: number;
  className?: string;
}

export const BracketProgressBar: React.FC<BracketProgressBarProps> = ({
  completed,
  total,
  className = '',
}) => {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className={`w-full ${className}`}>
      <div className="flex items-center justify-between text-sm text-gray-700 mb-1">
        <span className="font-medium">
          {completed}/{total} матчей
        </span>
        <span className="font-bold">{percentage}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
        <div
          className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};
