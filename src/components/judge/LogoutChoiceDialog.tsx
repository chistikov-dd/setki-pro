import { Button } from '../ui/Button';

interface LogoutChoiceDialogProps {
  onFullLogout: () => void;
  onQuickLogout: () => void;
  onCancel: () => void;
  judgeName?: string;
}

export function LogoutChoiceDialog({ onFullLogout, onQuickLogout, onCancel }: LogoutChoiceDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-gradient-to-br from-gray-800 to-gray-900 border border-gray-600 rounded-xl p-8 max-w-md w-full mx-4 shadow-2xl">
        <h2 className="text-2xl font-bold text-white mb-4">Выход</h2>

        <p className="text-gray-300 mb-6">
          Выберите способ выхода:
        </p>

        <div className="space-y-3">
          <Button
            variant="secondary"
            size="lg"
            onClick={onQuickLogout}
            className="w-full justify-start"
          >
            <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            <div className="text-left flex-1">
              <div>Быстрый выход</div>
              <div className="text-xs text-white mt-1">Данные сохранятся для повторного входа</div>
            </div>
          </Button>

          <Button
            variant="primary"
            size="lg"
            onClick={onFullLogout}
            className="w-full justify-start bg-red-600 hover:bg-red-700"
          >
            <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <div className="text-left flex-1">
              <div>Полный выход</div>
              <div className="text-xs text-white mt-1">Очистить все данные входа</div>
            </div>
          </Button>

          <Button
            variant="ghost"
            size="lg"
            onClick={onCancel}
            className="w-full text-white hover:bg-white/10"
          >
            Отмена
          </Button>
        </div>
      </div>
    </div>
  );
}
