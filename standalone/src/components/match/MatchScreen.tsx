import { useEffect, useState, useRef } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useShallow } from 'zustand/react/shallow';
import { useMatchStore, matchStoreSelectors } from '../../stores/matchStore';
import { useMatchTimer } from '../../hooks/useMatchTimer';
import { useToast } from '../../hooks/useToast';
import { useSound } from '../../hooks/useSound';
import { useDisplayMode } from '../../hooks/useResponsive';
import { cancelMatch as apiCancelMatch } from '../../services/api';
import { DEFAULT_SCORING_CONFIG } from '../../types';
import type { Match } from '../../types';
import { MatchTimer } from './MatchTimer';
import { ParticipantPanel } from './ParticipantPanel';
import { MatchEndDialog } from './MatchEndDialog';
import { TimerEditDialog } from './TimerEditDialog';
import { ResetConfirmDialog } from './ResetConfirmDialog';
import { HelpDialog } from './HelpDialog';
import { Toast, ToastContainer } from '../ui/Toast';
import { Button } from '../ui/Button';

interface MatchScreenProps {
  match: Match;
  categoryName?: string;
  onExit: () => void;
}

export function MatchScreen({ match, categoryName, onExit }: MatchScreenProps) {
  const mode = useDisplayMode();

  const [showEndDialog, setShowEndDialog] = useState(false);
  const [showTimerEditDialog, setShowTimerEditDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [showHelpDialog, setShowHelpDialog] = useState(false);
  const [autoEndDialogShown, setAutoEndDialogShown] = useState(false);
  const [disqualificationToastShown, setDisqualificationToastShown] = useState(false);
  const [autoSelectedWinner, setAutoSelectedWinner] = useState<'red' | 'blue' | null>(null);
  const [autoResultType, setAutoResultType] = useState<'points' | 'submission' | 'disqualification' | null>(null);
  const [showCancelMatchDialog, setShowCancelMatchDialog] = useState(false);

  const { toasts, showToast, hideToast } = useToast();
  const { playSound } = useSound();

  // Zustand селекторы с shallow comparison
  const { redFighter, blueFighter } = useMatchStore(useShallow(matchStoreSelectors.fighters));
  const { redScore, blueScore } = useMatchStore(useShallow(matchStoreSelectors.scores));
  const { redWarnings, blueWarnings } = useMatchStore(useShallow(matchStoreSelectors.warnings));
  const actions = useMatchStore(useShallow(matchStoreSelectors.actions));
  const initialTimerSeconds = useMatchStore(matchStoreSelectors.initialTimerSeconds);
  const { nextMatch } = useMatchStore(useShallow(matchStoreSelectors.nextMatch));

  const timer = useMatchTimer(initialTimerSeconds || 300);

  const timerRef = useRef(timer);
  useEffect(() => {
    timerRef.current = timer;
  }, [timer]);

  const handleTimerClick = () => {
    if (timer.isRunning) return;
    setShowTimerEditDialog(true);
  };

  const handleTimerEditConfirm = (minutes: number, seconds: number) => {
    const totalSeconds = minutes * 60 + seconds;
    timer.setDuration(totalSeconds);
    actions.setTimerDuration(totalSeconds);
    setShowTimerEditDialog(false);
  };

  const handleResetClick = () => setShowResetDialog(true);

  const handleResetConfirm = async () => {
    await actions.resetAll();
    timer.reset(initialTimerSeconds);
    setShowResetDialog(false);
  };

  const handleExitClick = async () => {
    onExit();
  };

  const handleUndo = async () => {
    const events = useMatchStore.getState().events;
    if (events.length === 0) {
      showToast('Нет действий для отмены', 'warning', 2000);
      return;
    }

    try {
      await actions.undoLastAction();
      showToast('Действие отменено', 'success', 2000);
    } catch (error) {
      console.error('Failed to undo:', error);
      showToast('Ошибка при отмене действия', 'error', 3000);
    }
  };

  const handleAddScore = async (participant: 'red' | 'blue', points: number, actionName: string) => {
    playSound('score', points);
    await actions.addScore(participant, points, actionName);
  };

  const handleAddWarning = async (participant: 'red' | 'blue') => {
    playSound('warning');
    await actions.addWarning(participant);
  };

  // Initialize match on mount
  useEffect(() => {
    const matchDuration = initialTimerSeconds || 300;

    const cleanup = useMatchStore.getState().cleanup;
    const initMatch = useMatchStore.getState().initMatch;
    const loadNextMatch = useMatchStore.getState().loadNextMatch;

    initMatch(match, matchDuration)
      .then(() => {
        loadNextMatch().catch((error) => {
          console.error('MatchScreen: Failed to load next match:', error);
        });
      })
      .catch((error) => {
        console.error('MatchScreen: Failed to initialize match:', error);
      });

    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id]);

  // Захват курсора в основном окне
  useEffect(() => {
    const grabCursor = async () => {
      try {
        const currentWindow = getCurrentWebviewWindow();
        await currentWindow.setCursorGrab(true);
      } catch (error) {
        console.error('[MatchScreen] Ошибка при захвате курсора:', error);
      }
    };

    const releaseCursor = async () => {
      try {
        const currentWindow = getCurrentWebviewWindow();
        await currentWindow.setCursorGrab(false);
      } catch (error) {
        console.error('[MatchScreen] Ошибка при освобождении курсора:', error);
      }
    };

    grabCursor();
    return () => {
      releaseCursor();
    };
  }, []);

  // Звук для последних 10 секунд таймера
  useEffect(() => {
    if (timer.isRunning && timer.remainingSeconds <= 10 && timer.remainingSeconds > 0) {
      playSound('timer');
    }
    if (timer.remainingSeconds === 0) {
      playSound('end');
    }
  }, [timer.remainingSeconds, timer.isRunning, playSound]);

  useEffect(() => {
    if (timer.isRunning) {
      playSound('start');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer.isRunning]);

  // Global hotkeys
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (showEndDialog || showTimerEditDialog || showResetDialog || showHelpDialog) return;

      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        const currentTimer = timerRef.current;
        if (currentTimer.isRunning) {
          currentTimer.pause();
        } else {
          currentTimer.start();
        }
        return;
      }

      if (e.code === 'Enter') {
        e.preventDefault();
        setShowEndDialog(true);
        return;
      }

      if (e.ctrlKey && e.code === 'KeyZ') {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Red corner (нижний): Q/W/E/R
      const redKeyMap: { [key: string]: number } = {
        KeyQ: 1,
        KeyW: 2,
        KeyE: 3,
        KeyR: 4,
      };

      if (redKeyMap[e.code]) {
        e.preventDefault();
        const points = redKeyMap[e.code];
        handleAddScore('red', points, `+${points}`);
        return;
      }

      // Blue corner (нижний): 1/2/3/4
      const blueKeyMap: { [key: string]: number } = {
        Digit1: 1,
        Digit2: 2,
        Digit3: 3,
        Digit4: 4,
      };

      if (blueKeyMap[e.code]) {
        e.preventDefault();
        const points = blueKeyMap[e.code];
        handleAddScore('blue', points, `+${points}`);
        return;
      }

      // Warnings (Z - blue, X - red)
      if (DEFAULT_SCORING_CONFIG.warnings.enabled) {
        if (e.code === 'KeyZ') {
          e.preventDefault();
          handleAddWarning('blue');
        } else if (e.code === 'KeyX') {
          e.preventDefault();
          handleAddWarning('red');
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEndDialog, showTimerEditDialog, showResetDialog, showHelpDialog]);

  // Auto-finish when timer reaches 0
  useEffect(() => {
    if (timer.remainingSeconds === 0 && !showEndDialog && !autoEndDialogShown) {
      setShowEndDialog(true);
      setAutoEndDialogShown(true);
    }
  }, [timer.remainingSeconds, showEndDialog, autoEndDialogShown]);

  // Auto-open end dialog on disqualification (4th warning)
  useEffect(() => {
    const maxWarnings = DEFAULT_SCORING_CONFIG.warnings.max_count;
    if ((redWarnings > maxWarnings || blueWarnings > maxWarnings) && !showEndDialog && !disqualificationToastShown) {
      timer.pause();

      let winner: 'red' | 'blue' | null = null;
      if (redWarnings > maxWarnings) {
        winner = 'blue';
      } else if (blueWarnings > maxWarnings) {
        winner = 'red';
      }

      setAutoResultType('disqualification');
      setAutoSelectedWinner(winner);

      showToast('Дисквалификация! Завершите матч', 'warning', 3000);
      setShowEndDialog(true);
      setDisqualificationToastShown(true);
    }
  }, [redWarnings, blueWarnings, showEndDialog, disqualificationToastShown, showToast, timer]);

  const handleCancelMatch = async () => {
    try {
      await apiCancelMatch(match.id);
      showToast('Матч отменён', 'success', 3000);
      setShowCancelMatchDialog(false);
      onExit();
    } catch (error) {
      console.error('[MatchScreen] Failed to cancel match:', error);
      showToast(`Ошибка при отмене матча: ${error}`, 'error', 4000);
    }
  };

  const handleFinishMatch = async (
    resultType: 'points' | 'submission' | 'disqualification',
    winnerId?: number
  ) => {
    try {
      const elapsed = (initialTimerSeconds || 300) - timerRef.current.remainingSeconds;
      await actions.finishMatch(resultType, winnerId, elapsed > 0 ? elapsed : undefined);

      if (nextMatch && nextMatch.participant1 && nextMatch.participant2) {
        showToast(
          `Следующий бой: ${nextMatch.participant1.full_name} vs ${nextMatch.participant2.full_name}`,
          'info',
          4000
        );
      }

      setShowEndDialog(false);
      onExit();
    } catch (error) {
      console.error('[MatchScreen] Failed to finish match:', error);
      showToast('Ошибка при завершении матча. Попробуйте ещё раз.', 'error', 3000);
    }
  };

  const scoringConfig = DEFAULT_SCORING_CONFIG;

  if (!redFighter || !blueFighter) {
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <p className="text-red-400 text-xl mb-4">Ошибка: участники не загружены</p>
          <Button onClick={onExit}>Вернуться к сетке</Button>
        </div>
      </div>
    );
  }

  const headerSizes = {
    hd: {
      padding: 'px-2 py-1.5 sm:px-3 sm:py-2',
      text: 'text-[10px] sm:text-xs',
      buttonSize: 'sm' as const,
    },
    fullhd: {
      padding: 'px-3 py-2 sm:px-4 sm:py-2.5 lg:px-6 lg:py-3',
      text: 'text-xs sm:text-sm',
      buttonSize: 'sm' as const,
    },
  };

  const header = headerSizes[mode];

  const controlButtonSizes = {
    hd: {
      startButton: 'text-base sm:text-lg px-4 py-3',
      resetButton: 'text-sm px-3 py-2',
      finishButton: 'text-base sm:text-lg px-4 py-3',
    },
    fullhd: {
      startButton: 'text-lg sm:text-xl px-6 py-4',
      resetButton: 'text-base px-4 py-3',
      finishButton: 'text-lg sm:text-xl px-6 py-4',
    },
  };

  const controls = controlButtonSizes[mode];

  return (
    <div className="h-screen overflow-hidden bg-gradient-to-br from-gray-50 via-white to-gray-100 flex flex-col select-none">
      {/* Header */}
      <div className={`bg-white/50 border-b border-gray-400 ${header.padding} flex items-center justify-between`}>
        <div className={`text-gray-900 ${header.text}`}>
          <span className="text-gray-700">Категория:</span> {categoryName || 'Не указана'}
        </div>
        <div className={`flex items-center ${mode === 'hd' ? 'gap-2' : 'gap-4'}`}>
          <Button
            variant="ghost"
            size={header.buttonSize}
            onClick={() => setShowHelpDialog(true)}
            className={mode === 'hd' ? 'w-6 h-6 p-0 flex items-center justify-center text-sm' : 'w-8 h-8 p-0 flex items-center justify-center'}
            title="Справка по горячим клавишам"
          >
            ?
          </Button>
          <Button
            variant="ghost"
            size={header.buttonSize}
            onClick={handleExitClick}
            className={mode === 'hd' ? 'text-[10px] sm:text-xs px-2 py-1' : undefined}
          >
            ← К сетке
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden w-full">
        <div className="flex-1 min-h-0 w-full">
          <ParticipantPanel
            participant={blueFighter}
            score={blueScore}
            warnings={blueWarnings}
            color="blue"
            onAddScore={(points, actionName) => handleAddScore('blue', points, actionName)}
            onAddWarning={() => handleAddWarning('blue')}
            onRemoveWarning={() => actions.removeWarning('blue')}
            hotkeys={['1', '2', '3', '4']}
            maxWarnings={scoringConfig.warnings.max_count}
          />
        </div>

        <div className="flex-1 min-h-0 w-full">
          <ParticipantPanel
            participant={redFighter}
            score={redScore}
            warnings={redWarnings}
            color="red"
            onAddScore={(points, actionName) => handleAddScore('red', points, actionName)}
            onAddWarning={() => handleAddWarning('red')}
            onRemoveWarning={() => actions.removeWarning('red')}
            hotkeys={['Q', 'W', 'E', 'R']}
            maxWarnings={scoringConfig.warnings.max_count}
          />
        </div>

        <div className="flex-[1.2] min-h-0 w-full border-t border-gray-400 overflow-hidden">
          <div className="h-full w-full flex items-stretch">
            <div className={`flex flex-col justify-center ${mode === 'hd' ? 'gap-2 px-2' : 'gap-3 px-4'} flex-shrink-0`}>
              {!timer.isRunning ? (
                <Button
                  variant="primary"
                  size="xl"
                  onClick={timer.start}
                  disabled={timer.remainingSeconds === 0}
                  className={`whitespace-nowrap ${controls.startButton}`}
                >
                  Старт<br />(Space)
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="xl"
                  onClick={timer.pause}
                  className={`whitespace-nowrap ${controls.startButton}`}
                >
                  Пауза<br />(Space)
                </Button>
              )}

              <Button variant="danger" size="md" onClick={handleResetClick} className={controls.resetButton}>
                Сброс всего
              </Button>
            </div>

            <div className="flex-1 min-w-0 overflow-hidden">
              <MatchTimer
                remainingSeconds={timer.remainingSeconds}
                isRunning={timer.isRunning}
                onStart={timer.start}
                onPause={timer.pause}
                onReset={() => timer.reset(initialTimerSeconds)}
                onClick={handleTimerClick}
              />
            </div>

            <div className={`flex flex-col justify-center ${mode === 'hd' ? 'gap-2 px-2' : 'gap-4 px-4'} flex-shrink-0`}>
              <Button
                variant="primary"
                size="xl"
                onClick={() => setShowEndDialog(true)}
                className={`whitespace-nowrap ${controls.finishButton}`}
              >
                Завершить<br />(Enter)
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCancelMatchDialog(true)}
                className="whitespace-nowrap text-red-500 hover:text-red-700 hover:bg-red-50 text-xs"
              >
                Отменить матч
              </Button>
            </div>
          </div>
        </div>
      </div>

      {showCancelMatchDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-3">Отменить матч?</h3>
            <p className="text-gray-600 text-sm mb-6">
              Счёт и предупреждения будут сброшены. Победитель будет убран из следующего раунда.
              Это действие нельзя отменить.
            </p>
            <div className="flex gap-3">
              <Button variant="danger" className="flex-1" onClick={handleCancelMatch}>
                Да, отменить
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => setShowCancelMatchDialog(false)}>
                Назад
              </Button>
            </div>
          </div>
        </div>
      )}

      {showEndDialog && (
        <MatchEndDialog
          redFighter={redFighter}
          blueFighter={blueFighter}
          redScore={redScore}
          blueScore={blueScore}
          onFinish={handleFinishMatch}
          onCancel={() => setShowEndDialog(false)}
          initialResultType={autoResultType || undefined}
          initialSelectedWinner={autoSelectedWinner}
        />
      )}

      {showTimerEditDialog && (
        <TimerEditDialog
          currentSeconds={timer.remainingSeconds}
          onConfirm={handleTimerEditConfirm}
          onCancel={() => setShowTimerEditDialog(false)}
        />
      )}

      {showResetDialog && (
        <ResetConfirmDialog
          currentRedScore={redScore}
          currentBlueScore={blueScore}
          currentSeconds={timer.remainingSeconds}
          totalSeconds={initialTimerSeconds}
          onConfirm={handleResetConfirm}
          onCancel={() => setShowResetDialog(false)}
        />
      )}

      {showHelpDialog && <HelpDialog onClose={() => setShowHelpDialog(false)} />}

      <ToastContainer>
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onClose={() => hideToast(toast.id)}
          />
        ))}
      </ToastContainer>
    </div>
  );
}
