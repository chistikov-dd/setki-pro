import { Button } from '../ui/Button';
import { formatTime } from '../../lib/utils';

interface ResetConfirmDialogProps {
  currentRedScore: number;
  currentBlueScore: number;
  currentSeconds: number;
  totalSeconds: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ResetConfirmDialog({
  currentRedScore,
  currentBlueScore,
  currentSeconds,
  totalSeconds,
  onConfirm,
  onCancel,
}: ResetConfirmDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-white border border-gray-400 rounded-lg p-6 max-w-lg w-full mx-4">
        <h2 className="text-2xl font-bold text-white mb-4">Сброс всего</h2>

        <div className="mb-6">
          <p className="text-gray-900 mb-4">
            Сбросить баллы и время? Это действие нельзя отменить.
          </p>

          <div className="bg-white/50 border border-gray-400 rounded-lg p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-gray-800">Текущий счёт:</span>
              <div className="flex items-center gap-2">
                <span className="text-blue-400 text-xl font-bold">{currentBlueScore}</span>
                <span className="text-gray-700">-</span>
                <span className="text-red-400 text-xl font-bold">{currentRedScore}</span>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-gray-800">После сброса:</span>
              <div className="flex items-center gap-2">
                <span className="text-gray-800 text-xl font-bold">0</span>
                <span className="text-gray-700">-</span>
                <span className="text-gray-800 text-xl font-bold">0</span>
              </div>
            </div>

            <div className="border-t border-gray-400 pt-3 mt-3">
              <div className="flex justify-between items-center">
                <span className="text-gray-800">Текущее время:</span>
                <span className="text-gray-900 text-xl font-mono font-bold">
                  {formatTime(currentSeconds)}
                </span>
              </div>

              <div className="flex justify-between items-center mt-2">
                <span className="text-gray-800">После сброса:</span>
                <span className="text-gray-800 text-xl font-mono font-bold">
                  {formatTime(totalSeconds)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="danger"
            size="lg"
            onClick={onConfirm}
            className="flex-1"
          >
            Сбросить
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
