import { useEffect } from 'react';
import type { ScoringConfig } from '../../types';
import { Button } from '../ui/Button';

interface ScoringButtonsProps {
  config: ScoringConfig;
  onAddScore: (participant: 'red' | 'blue', points: number, actionName: string) => void;
  onAddWarning: (participant: 'red' | 'blue') => void;
  redWarnings: number;
  blueWarnings: number;
}

export function ScoringButtons({
  config,
  onAddScore,
  onAddWarning,
  redWarnings,
  blueWarnings,
}: ScoringButtonsProps) {
  const maxWarnings = config.warnings.max_count;

  // Hotkeys for scoring
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if input/textarea focused
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      // Red corner: 1-9
      const redKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];
      const redIndex = redKeys.indexOf(e.code);
      if (redIndex !== -1 && redIndex < config.actions.length) {
        e.preventDefault();
        const action = config.actions[redIndex];
        onAddScore('red', action.points, action.name);
        return;
      }

      // Blue corner: Q-Y
      const blueKeys = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO'];
      const blueIndex = blueKeys.indexOf(e.code);
      if (blueIndex !== -1 && blueIndex < config.actions.length) {
        e.preventDefault();
        const action = config.actions[blueIndex];
        onAddScore('blue', action.points, action.name);
        return;
      }

      // Warnings
      if (e.code === 'KeyZ' && redWarnings < maxWarnings) {
        e.preventDefault();
        onAddWarning('red');
      } else if (e.code === 'KeyX' && blueWarnings < maxWarnings) {
        e.preventDefault();
        onAddWarning('blue');
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [config, onAddScore, onAddWarning, redWarnings, blueWarnings, maxWarnings]);

  // Keys for display
  const redKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const blueKeys = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O'];

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Red Corner Actions */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-red-400 text-center">
          Баллы красному
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {config.actions.map((action, index) => (
            <Button
              key={index}
              variant="red"
              size="md"
              onClick={() => onAddScore('red', action.points, action.name)}
              className="flex flex-col items-center py-3"
            >
              <span className="text-xl font-bold">{action.points}</span>
              <span className="text-xs mt-1">{action.name}</span>
              <span className="text-xs text-gray-900 mt-0.5">({redKeys[index]})</span>
            </Button>
          ))}
        </div>

        {/* Red Warning */}
        {config.warnings.enabled && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => onAddWarning('red')}
            disabled={redWarnings >= maxWarnings}
            fullWidth
          >
            Предупреждение (Z) - {redWarnings}/{maxWarnings}
          </Button>
        )}
      </div>

      {/* Blue Corner Actions */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-blue-400 text-center">
          Баллы синему
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {config.actions.map((action, index) => (
            <Button
              key={index}
              variant="blue"
              size="md"
              onClick={() => onAddScore('blue', action.points, action.name)}
              className="flex flex-col items-center py-3"
            >
              <span className="text-xl font-bold">{action.points}</span>
              <span className="text-xs mt-1">{action.name}</span>
              <span className="text-xs text-gray-900 mt-0.5">({blueKeys[index]})</span>
            </Button>
          ))}
        </div>

        {/* Blue Warning */}
        {config.warnings.enabled && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => onAddWarning('blue')}
            disabled={blueWarnings >= maxWarnings}
            fullWidth
          >
            Предупреждение (X) - {blueWarnings}/{maxWarnings}
          </Button>
        )}
      </div>
    </div>
  );
}
