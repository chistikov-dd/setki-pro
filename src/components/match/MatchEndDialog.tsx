import { useState } from 'react';
import type { Participant } from '../../types';
import { Button } from '../ui/Button';

// Функция для удаления отчества: "Иванов Иван Иванович" -> "Иванов Иван"
function removePatronymic(fullName: string): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  // Берем только первые 2 части (Фамилия Имя)
  return parts.slice(0, 2).join(' ');
}

interface MatchEndDialogProps {
  redFighter: Participant | null;
  blueFighter: Participant | null;
  redScore: number;
  blueScore: number;
  onFinish: (
    resultType: 'points' | 'submission' | 'disqualification',
    winnerId?: number
  ) => void;
  onCancel: () => void;
  // Опциональные параметры для автоматического предзаполнения (при дисквалификации)
  initialResultType?: 'points' | 'submission' | 'disqualification';
  initialSelectedWinner?: 'red' | 'blue' | null;
}

export function MatchEndDialog({
  redFighter,
  blueFighter,
  redScore,
  blueScore,
  onFinish,
  onCancel,
  initialResultType = 'points',
  initialSelectedWinner = null,
}: MatchEndDialogProps) {
  const [resultType, setResultType] = useState<'points' | 'submission' | 'disqualification'>(initialResultType);
  const [selectedWinner, setSelectedWinner] = useState<'red' | 'blue' | null>(initialSelectedWinner);

  const handleConfirm = () => {
    if (resultType === 'points') {
      // Winner determined by score
      let winnerId: number | undefined;
      if (redScore > blueScore) {
        winnerId = redFighter?.id;
      } else if (blueScore > redScore) {
        winnerId = blueFighter?.id;
      }
      // Передаем winnerId явно, чтобы backend мог продвинуть победителя
      onFinish('points', winnerId);
    } else {
      // Manual winner selection required
      if (!selectedWinner) {
        alert('Выберите победителя');
        return;
      }
      const winnerId = selectedWinner === 'red' ? redFighter?.id : blueFighter?.id;
      onFinish(resultType, winnerId);
    }
  };

  // Determine points winner
  const pointsWinner = redScore > blueScore ? 'red' : blueScore > redScore ? 'blue' : 'draw';

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-white border border-gray-400 rounded-lg p-6 max-w-2xl w-full mx-4">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Завершение поединка</h2>

        <div className="space-y-6">
          {/* Result Type Selection */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-900">
              Тип завершения
            </label>
            <div className="grid grid-cols-3 gap-3">
              <Button
                variant={resultType === 'points' ? 'primary' : 'ghost'}
                onClick={() => setResultType('points')}
              >
                По баллам
              </Button>
              <Button
                variant={resultType === 'submission' ? 'primary' : 'ghost'}
                onClick={() => setResultType('submission')}
              >
                Сабмишен
              </Button>
              <Button
                variant={resultType === 'disqualification' ? 'primary' : 'ghost'}
                onClick={() => setResultType('disqualification')}
              >
                Дисквалификация
              </Button>
            </div>
          </div>

          {/* Winner Selection (for submission/disqualification) */}
          {resultType !== 'points' && (
            <div className="space-y-3">
              <label className="text-sm font-medium text-gray-900">
                Победитель
              </label>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  variant={selectedWinner === 'blue' ? 'blue' : 'ghost'}
                  size="lg"
                  onClick={() => setSelectedWinner('blue')}
                >
                  {removePatronymic(blueFighter?.full_name || '') || 'Синий'}
                </Button>
                <Button
                  variant={selectedWinner === 'red' ? 'red' : 'ghost'}
                  size="lg"
                  onClick={() => setSelectedWinner('red')}
                >
                  {removePatronymic(redFighter?.full_name || '') || 'Красный'}
                </Button>
              </div>
            </div>
          )}

          {/* Final Score Display */}
          <div className="bg-white rounded-lg p-4 space-y-2">
            <div className="text-sm text-gray-800 text-center">Финальный счет</div>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <div className="text-sm text-blue-400">Синий</div>
                <div className="text-4xl font-bold text-blue-500">{blueScore}</div>
                <div className="text-xs text-gray-800 mt-1 truncate">{removePatronymic(blueFighter?.full_name || '')}</div>
              </div>
              <div className="text-center">
                <div className="text-sm text-red-400">Красный</div>
                <div className="text-4xl font-bold text-red-500">{redScore}</div>
                <div className="text-xs text-gray-800 mt-1 truncate">{removePatronymic(redFighter?.full_name || '')}</div>
              </div>
            </div>

            {resultType === 'points' && pointsWinner !== 'draw' && (
              <div className="text-center text-sm text-green-600 font-semibold mt-2">
                Победитель: {pointsWinner === 'red' ? removePatronymic(redFighter?.full_name || '') : removePatronymic(blueFighter?.full_name || '')}
              </div>
            )}
            {resultType === 'points' && pointsWinner === 'draw' && (
              <div className="text-center text-sm text-yellow-600 font-semibold mt-2">
                Ничья
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={onCancel}
              className="flex-1"
            >
              Отмена
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirm}
              className="flex-1"
            >
              Подтвердить результат
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
