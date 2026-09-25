import { CSSProperties, memo } from 'react';

interface SkeletonProps {
  variant?: 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  className?: string;
  animation?: 'pulse' | 'wave' | 'none';
}

export const Skeleton: React.FC<SkeletonProps> = ({
  variant = 'text',
  width,
  height,
  className = '',
  animation = 'none', // По умолчанию БЕЗ анимации для production
}) => {
  const baseClasses = 'bg-gray-200';

  const variantClasses = {
    text: 'rounded',
    circular: 'rounded-full',
    rectangular: 'rounded-lg',
  };

  const animationClasses = {
    pulse: 'animate-pulse',
    wave: 'animate-shimmer',
    none: '',
  };

  const style: CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
  };

  // Default heights based on variant
  if (!height) {
    if (variant === 'text') {
      style.height = '1em';
    } else if (variant === 'circular') {
      style.height = '40px';
      style.width = '40px';
    }
  }

  return (
    <div
      className={`${baseClasses} ${variantClasses[variant]} ${animationClasses[animation]} ${className}`}
      style={style}
    />
  );
};

// Skeleton для карточки турнира
export const TournamentCardSkeleton: React.FC = memo(() => {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <Skeleton variant="rectangular" height={48} className="mb-3" />
      <Skeleton variant="text" width="80%" />
      <Skeleton variant="text" width="60%" />
      <div className="flex gap-2">
        <Skeleton variant="text" width={80} />
        <Skeleton variant="text" width={80} />
      </div>
      <Skeleton variant="rectangular" height={40} className="mt-4" />
    </div>
  );
});

// Skeleton для карточки сетки
export const BracketCardSkeleton: React.FC = memo(() => {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="flex items-start justify-between mb-2">
        <Skeleton variant="text" width="70%" height={24} />
        <Skeleton variant="rectangular" width={60} height={24} />
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton variant="circular" width={16} height={16} />
          <Skeleton variant="text" width="40%" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton variant="circular" width={16} height={16} />
          <Skeleton variant="text" width="50%" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton variant="circular" width={16} height={16} />
          <Skeleton variant="text" width="45%" />
        </div>
      </div>
      <Skeleton variant="rectangular" height={36} className="mt-4" />
    </div>
  );
});

// Skeleton для мониторинга судейских столов
export const JudgeTableRowSkeleton: React.FC = memo(() => {
  return (
    <div className="flex items-center gap-4 p-3 bg-white rounded-lg border border-gray-200">
      <Skeleton variant="text" width={120} />
      <Skeleton variant="text" width={200} className="flex-1" />
      <Skeleton variant="text" width={100} />
    </div>
  );
});

// Skeleton для активных поединков
export const ActiveMatchCardSkeleton: React.FC = memo(() => {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="flex justify-between items-center mb-3">
        <Skeleton variant="text" width="60%" height={20} />
        <Skeleton variant="rectangular" width={80} height={24} />
      </div>

      {/* Участники */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Skeleton variant="text" width="50%" />
          <Skeleton variant="text" width={40} height={32} />
        </div>
        <div className="flex items-center justify-between">
          <Skeleton variant="text" width="50%" />
          <Skeleton variant="text" width={40} height={32} />
        </div>
      </div>

      {/* Предупреждения */}
      <div className="flex gap-2">
        <Skeleton variant="circular" width={8} height={8} />
        <Skeleton variant="circular" width={8} height={8} />
      </div>

      <Skeleton variant="text" width="40%" className="text-sm" />
    </div>
  );
});

// Skeleton для списка (универсальный)
interface SkeletonListProps {
  count?: number;
  itemComponent?: React.ComponentType;
  className?: string;
}

export const SkeletonList: React.FC<SkeletonListProps> = ({
  count = 3,
  itemComponent: ItemComponent = TournamentCardSkeleton,
  className = '',
}) => {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, index) => (
        <ItemComponent key={index} />
      ))}
    </div>
  );
};
