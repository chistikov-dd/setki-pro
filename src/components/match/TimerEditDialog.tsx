import { useState, useEffect } from 'react';
import { Button } from '../ui/Button';

interface TimerEditDialogProps {
  currentSeconds: number;
  onConfirm: (minutes: number, seconds: number) => void;
  onCancel: () => void;
}

export function TimerEditDialog({ currentSeconds, onConfirm, onCancel }: TimerEditDialogProps) {
  const currentMinutes = Math.floor(currentSeconds / 60);
  const currentSecs = currentSeconds % 60;

  const [minutes, setMinutes] = useState(currentMinutes.toString());
  const [seconds, setSeconds] = useState(currentSecs.toString());

  useEffect(() => {
    // Focus first input on mount
    const input = document.getElementById('timer-minutes-input');
    if (input) {
      (input as HTMLInputElement).focus();
      (input as HTMLInputElement).select();
    }
  }, []);

  const handleConfirm = () => {
    const mins = parseInt(minutes) || 0;
    const secs = parseInt(seconds) || 0;

    // Validation
    if (mins < 0 || mins > 99) {
      alert('Минуты должны быть от 0 до 99');
      return;
    }
    if (secs < 0 || secs > 59) {
      alert('Секунды должны быть от 0 до 59');
      return;
    }

    onConfirm(mins, secs);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-white border border-gray-400 rounded-lg p-6 max-w-md w-full mx-4">
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Изменить время</h2>

        <div className="grid grid-cols-2 gap-4 mb-6">
          {/* Minutes */}
          <div>
            <label htmlFor="timer-minutes-input" className="block text-sm text-gray-800 mb-2">
              Минуты
            </label>
            <input
              id="timer-minutes-input"
              type="number"
              min="0"
              max="99"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full px-4 py-3 bg-white border border-gray-400 rounded text-gray-900 text-2xl text-center focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Seconds */}
          <div>
            <label htmlFor="timer-seconds-input" className="block text-sm text-gray-800 mb-2">
              Секунды
            </label>
            <input
              id="timer-seconds-input"
              type="number"
              min="0"
              max="59"
              value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full px-4 py-3 bg-white border border-gray-400 rounded text-gray-900 text-2xl text-center focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="text-sm text-gray-700 mb-6">
          <p>• Минуты: 0-99</p>
          <p>• Секунды: 0-59</p>
          <p>• Enter - применить, Esc - отмена</p>
        </div>

        <div className="flex gap-3">
          <Button
            variant="primary"
            size="lg"
            onClick={handleConfirm}
            className="flex-1"
          >
            Применить
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
