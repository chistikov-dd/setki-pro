import { memo } from 'react';

interface FloatingEditButtonProps {
  isEditMode: boolean;
  onClick: () => void;
}

/**
 * Плавающая кнопка редактирования (FAB - Floating Action Button)
 * Всегда видна в правом нижнем углу экрана при прокрутке
 */
export const FloatingEditButton = memo(({ isEditMode, onClick }: FloatingEditButtonProps) => {
  return (
    <button
      onClick={onClick}
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-6 py-4 rounded-full shadow-2xl transition-all duration-300 hover:scale-105 hover:shadow-3xl ${
        isEditMode
          ? 'bg-green-500 text-white hover:bg-green-600'
          : 'bg-blue-500 text-white hover:bg-blue-600'
      }`}
      title={isEditMode ? 'Выключить режим редактирования' : 'Включить режим редактирования'}
      style={{
        minWidth: '160px',
      }}
    >
      {/* Иконка */}
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d={isEditMode
            ? "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            : "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
          }
        />
      </svg>

      {/* Текст */}
      <span className="font-semibold text-base">
        {isEditMode ? 'Готово' : 'Редактировать'}
      </span>
    </button>
  );
});

FloatingEditButton.displayName = 'FloatingEditButton';
