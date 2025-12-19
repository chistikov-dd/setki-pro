import { Button } from '../ui/Button';

interface ExitConfirmDialogProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export function ExitConfirmDialog({ onConfirm, onCancel }: ExitConfirmDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-white border border-gray-400 rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-2xl font-bold text-white mb-4">Выход к сетке</h2>

        <p className="text-gray-900 mb-6">
          Вернуться к выбору сетки? Прогресс поединка будет сохранен.
        </p>

        <div className="flex gap-3">
          <Button
            variant="primary"
            size="lg"
            onClick={onConfirm}
            className="flex-1"
          >
            Выйти
          </Button>
          <Button
            variant="ghost"
            size="lg"
            onClick={onCancel}
            className="flex-1"
          >
            Отмена
          </Button>
        </div>
      </div>
    </div>
  );
}
