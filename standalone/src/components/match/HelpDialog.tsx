import { Button } from '../ui/Button';

interface HelpDialogProps {
  onClose: () => void;
}

export function HelpDialog({ onClose }: HelpDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-white border border-gray-400 rounded-lg p-6 max-w-2xl w-full mx-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-white">Справка по горячим клавишам</h2>
          <button
            onClick={onClose}
            className="text-gray-800 hover:text-white text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="space-y-6">
          {/* Управление таймером */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Управление таймером</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-white/50 px-4 py-2 rounded">
                <span className="text-gray-900">Старт / Пауза</span>
                <kbd className="px-3 py-1 bg-gray-700 rounded text-white font-mono">Space</kbd>
              </div>
            </div>
          </div>

          {/* Начисление баллов */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Начисление баллов</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-blue-400 font-semibold mb-2">Синий угол</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between bg-white/50 px-3 py-2 rounded">
                    <span className="text-gray-900">+1 балл</span>
                    <kbd className="px-2 py-1 bg-gray-700 rounded text-white font-mono text-sm">1</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-white/50 px-3 py-2 rounded">
                    <span className="text-gray-900">+2 балла</span>
                    <kbd className="px-2 py-1 bg-gray-700 rounded text-white font-mono text-sm">2</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-white/50 px-3 py-2 rounded">
                    <span className="text-gray-900">+3 балла</span>
                    <kbd className="px-2 py-1 bg-gray-700 rounded text-white font-mono text-sm">3</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-white/50 px-3 py-2 rounded">
                    <span className="text-gray-900">+4 балла</span>
                    <kbd className="px-2 py-1 bg-gray-700 rounded text-white font-mono text-sm">4</kbd>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-sm text-red-400 font-semibold mb-2">Красный угол</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between bg-white/50 px-3 py-2 rounded">
                    <span className="text-gray-900">+1 балл</span>
                    <kbd className="px-2 py-1 bg-gray-700 rounded text-white font-mono text-sm">Q</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-white/50 px-3 py-2 rounded">
                    <span className="text-gray-900">+2 балла</span>
                    <kbd className="px-2 py-1 bg-gray-700 rounded text-white font-mono text-sm">W</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-white/50 px-3 py-2 rounded">
                    <span className="text-gray-900">+3 балла</span>
                    <kbd className="px-2 py-1 bg-gray-700 rounded text-white font-mono text-sm">E</kbd>
                  </div>
                  <div className="flex items-center justify-between bg-white/50 px-3 py-2 rounded">
                    <span className="text-gray-900">+4 балла</span>
                    <kbd className="px-2 py-1 bg-gray-700 rounded text-white font-mono text-sm">R</kbd>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Предупреждения */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Предупреждения</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center justify-between bg-white/50 px-4 py-2 rounded">
                <span className="text-blue-400">Синему</span>
                <kbd className="px-3 py-1 bg-gray-700 rounded text-white font-mono">Z</kbd>
              </div>
              <div className="flex items-center justify-between bg-white/50 px-4 py-2 rounded">
                <span className="text-red-400">Красному</span>
                <kbd className="px-3 py-1 bg-gray-700 rounded text-white font-mono">X</kbd>
              </div>
            </div>
          </div>

          {/* Другие действия */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Другие действия</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between bg-white/50 px-4 py-2 rounded">
                <span className="text-gray-900">Завершить поединок</span>
                <kbd className="px-3 py-1 bg-gray-700 rounded text-white font-mono">Enter</kbd>
              </div>
              <div className="flex items-center justify-between bg-white/50 px-4 py-2 rounded">
                <span className="text-gray-900">Отменить последнее действие</span>
                <kbd className="px-3 py-1 bg-gray-700 rounded text-white font-mono">Ctrl + Z</kbd>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <Button
            variant="primary"
            onClick={onClose}
            className="w-full"
          >
            Закрыть
          </Button>
        </div>
      </div>
    </div>
  );
}
