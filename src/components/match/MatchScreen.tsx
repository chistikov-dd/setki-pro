import { useEffect, useState, useCallback, useRef } from 'react';
import { WebviewWindow, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useShallow } from 'zustand/react/shallow';
import { useMatchStore, matchStoreSelectors } from '../../stores/matchStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useServerModeStore } from '../../stores/serverModeStore';
import { useMatchTimer } from '../../hooks/useMatchTimer';
import { useToast } from '../../hooks/useToast';
import { useMatchWebSocket } from '../../hooks/useMatchWebSocket';
import { useSound } from '../../hooks/useSound';
import { useSyncWorker } from '../../hooks/useSyncWorker';
import { useDisplayMode } from '../../hooks/useResponsive';
import { closePublicDisplay } from '../../utils/publicDisplay';
// import { fileLogger } from '../../utils/fileLogger'; // Unused
import type { Match, Participant } from '../../types';
import { MatchTimer } from './MatchTimer';
import { ParticipantPanel } from './ParticipantPanel';
import { MatchEndDialog } from './MatchEndDialog';
import { TimerEditDialog } from './TimerEditDialog';
import { ResetConfirmDialog } from './ResetConfirmDialog';
import { HelpDialog } from './HelpDialog';
// import { NextMatchCard } from './NextMatchCard'; // Unused - temporarily commented
import { Toast, ToastContainer } from '../ui/Toast';
import { Button } from '../ui/Button';
import { Wifi, WifiOff } from 'lucide-react';
import { CallAdminButton } from '../judge/CallAdminButton';

interface MatchScreenProps {
  match: Match;
  categoryName?: string;
  onExit: () => void;
}

/**
 * Custom hook для отправки обновлений в публичное табло
 * FIX: Используем useRef для предотвращения infinite loop
 */
function useMatchUpdateEmitter(
  redFighter: Participant | null,
  blueFighter: Participant | null,
  redScore: number,
  blueScore: number,
  remainingSeconds: number,
  isRunning: boolean
) {
  const prevDataRef = useRef({
    redScore,
    blueScore,
    remainingSeconds,
    isRunning,
  });

  useEffect(() => {
    const prev = prevDataRef.current;

    // Отправляем только если данные изменились
    const hasChanged =
      prev.redScore !== redScore ||
      prev.blueScore !== blueScore ||
      prev.remainingSeconds !== remainingSeconds ||
      prev.isRunning !== isRunning;

    if (hasChanged) {
      const data = {
        redFighter,
        blueFighter,
        redScore,
        blueScore,
        remainingSeconds,
        isRunning,
      };

      if (import.meta.env.DEV) {
        console.log('[useMatchUpdateEmitter] 📤 Отправка обновления:', {
          redScore,
          blueScore,
          remainingSeconds,
          isRunning,
        });
      }

      emit('match-update', data).catch((error) => {
        if (import.meta.env.DEV) {
          console.error('[useMatchUpdateEmitter] ❌ Ошибка отправки:', error);
        }
      });

      // Обновляем ref после отправки
      prevDataRef.current = { redScore, blueScore, remainingSeconds, isRunning };
    }
  }, [redFighter?.id, blueFighter?.id, redScore, blueScore, remainingSeconds, isRunning]);
}

export function MatchScreen({ match, categoryName, onExit }: MatchScreenProps) {
  if (import.meta.env.DEV) {
    console.log('[MatchScreen] ===== COMPONENT RENDER START =====');
    console.log('[MatchScreen] Match ID:', match?.id);
    console.log('[MatchScreen] Category:', categoryName);
    console.log('[MatchScreen] Has onExit:', !!onExit);
  }

  const mode = useDisplayMode();

  const [showEndDialog, setShowEndDialog] = useState(false);
  const [showTimerEditDialog, setShowTimerEditDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [showHelpDialog, setShowHelpDialog] = useState(false);
  const [publicWindowOpen, setPublicWindowOpen] = useState(false);
  const [autoEndDialogShown, setAutoEndDialogShown] = useState(false);
  const [disqualificationToastShown, setDisqualificationToastShown] = useState(false);
  // State для передачи предзаполненных данных в диалог завершения
  const [autoSelectedWinner, setAutoSelectedWinner] = useState<'red' | 'blue' | null>(null);
  const [autoResultType, setAutoResultType] = useState<'points' | 'submission' | 'disqualification' | null>(null);

  const { toasts, showToast, hideToast } = useToast();
  const { playSound } = useSound();
  const { currentSession } = useSessionStore();

  if (import.meta.env.DEV) {
    console.log('[MatchScreen] Hooks initialized, currentSession:', currentSession?.tournament_id);
  }

  // Zustand селекторы с shallow comparison для оптимизации ре-рендеров
  const { redFighter, blueFighter } = useMatchStore(useShallow(matchStoreSelectors.fighters));
  const { redScore, blueScore } = useMatchStore(useShallow(matchStoreSelectors.scores));
  const { redWarnings, blueWarnings } = useMatchStore(useShallow(matchStoreSelectors.warnings));
  const actions = useMatchStore(useShallow(matchStoreSelectors.actions)); // ВАЖНО: useShallow для избежания re-render
  const initialTimerSeconds = useMatchStore(matchStoreSelectors.initialTimerSeconds);
  const { nextMatch } = useMatchStore(useShallow(matchStoreSelectors.nextMatch));
  // match уже есть в пропсах - не нужен из store

  // Timer managed locally with useMatchTimer hook (not in store)
  // Fallback to 300 seconds (5 minutes) if initialTimerSeconds is undefined
  const timer = useMatchTimer(initialTimerSeconds || 300);

  // Ref для доступа к актуальному состоянию таймера в event handlers
  const timerRef = useRef(timer);
  useEffect(() => {
    timerRef.current = timer;
  }, [timer]);

  // Стабильные WebSocket callbacks
  const handleScoreUpdate = useCallback((data: any) => {
    if (import.meta.env.DEV) {
      console.log('[WebSocket] Score update received:', data);
    }

    // Фильтруем собственные обновления (эхо от сервера)
    if (data.source_pin && data.source_pin === currentSession?.pin_code) {
      if (import.meta.env.DEV) {
        console.log('[WebSocket] Ignoring own update (echo from server)');
      }
      return;
    }

    if (import.meta.env.DEV) {
      console.log('[WebSocket] Applying update from another table');
    }

    // Применяем удалённое обновление с timestamp-based conflict resolution
    const applied = actions.applyRemoteUpdate(data, data.timestamp || new Date().toISOString());

    if (applied) {
      showToast('Обновление с другого стола', 'info', 1500);
    }
  }, [currentSession?.pin_code, actions, showToast]);

  const handleMatchStart = useCallback(() => {
    if (import.meta.env.DEV) {
      console.log('[WebSocket] Match started on another table');
    }
  }, []);

  const handleMatchEnd = useCallback(() => {
    if (import.meta.env.DEV) {
      console.log('[WebSocket] Match ended on another table');
    }
    showToast('Матч завершен на другом столе', 'info', 3000);
  }, [showToast]);

  // WebSocket для real-time синхронизации между столами
  const { isConnected: wsConnected, sendScoreUpdate, sendMatchStart, sendMatchEnd, sendTimerUpdate } = useMatchWebSocket({
    matchId: match.id,
    pinCode: currentSession?.pin_code,
    autoConnect: true,
    onScoreUpdate: handleScoreUpdate,
    onMatchStart: handleMatchStart,
    onMatchEnd: handleMatchEnd,
  });

  // Получаем режим сервера для правильной синхронизации (с useShallow для стабильности)
  const serverMode = useServerModeStore(useShallow((state) => ({
    mode: state.mode,
    serverUrl: state.serverUrl,
  })));

  // Стабильные callbacks для useSyncWorker
  const handleSyncSuccess = useCallback((count: number) => {
    if (count > 0) {
      console.log(`[SyncWorker] Synced ${count} changes to backend`);
    }
  }, []);

  const handleSyncError = useCallback((error: Error) => {
    console.error('[SyncWorker] Sync error:', error);
    // Не показываем toast чтобы не отвлекать судью, логируем только в консоль
  }, []);

  // Background синхронизация с backend (каждые 30 секунд)
  useSyncWorker({
    enabled: true,
    interval: 30000, // 30 секунд
    serverMode, // Передаем режим для правильной синхронизации
    onSyncSuccess: handleSyncSuccess,
    onSyncError: handleSyncError,
  });

  const handleTimerClick = () => {
    if (timer.isRunning) {
      // Не разрешаем редактировать во время работы таймера
      return;
    }
    setShowTimerEditDialog(true);
  };

  const handleTimerEditConfirm = (minutes: number, seconds: number) => {
    const totalSeconds = minutes * 60 + seconds;
    timer.setDuration(totalSeconds);
    // Сохраняем время таймера для использования во всех последующих матчах
    actions.setTimerDuration(totalSeconds);
    setShowTimerEditDialog(false);
  };

  const handleResetClick = () => {
    setShowResetDialog(true);
  };

  const handleResetConfirm = async () => {
    await actions.resetAll();
    timer.reset(initialTimerSeconds);
    setShowResetDialog(false);
  };

  const handleExitClick = async () => {
    // Закрываем публичное табло при возврате к сетке
    await closePublicDisplay();
    onExit();
  };

  // Wrapper для undoLastAction с уведомлением
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

  // Wrapper для addScore с WebSocket синхронизацией и звуком
  const handleAddScore = async (participant: 'red' | 'blue', points: number, actionName: string) => {
    if (import.meta.env.DEV) {
      console.log('[MatchScreen.handleAddScore] Called for:', participant, {
        points,
        actionName,
        matchId: match.id,
      });
    }

    // Проиграть звук
    playSound('score', points);

    if (import.meta.env.DEV) {
      console.log('[MatchScreen.handleAddScore] Calling matchStore.addScore...');
    }

    // Обновить локальный state через matchStore
    await actions.addScore(participant, points, actionName);

    if (import.meta.env.DEV) {
      console.log('[MatchScreen.handleAddScore] matchStore.addScore completed');
    }

    // Получаем актуальные значения после обновления
    const currentState = useMatchStore.getState();

    // УДАЛЕНО: дублирующая отправка в публичное табло
    // useMatchUpdateEmitter автоматически отслеживает изменения счета и отправит обновление

    // Отправить событие через WebSocket для синхронизации с другими столами
    if (wsConnected && sendScoreUpdate) {
      const participantId = participant === 'red'
        ? redFighter?.id
        : blueFighter?.id;

      if (participantId) {
        sendScoreUpdate({
          participant_id: participantId,
          action_type: actionName,
          points,
          round_number: 1, // TODO: поддержка раундов
          timestamp: currentState.lastUpdateTimestamp || new Date().toISOString(),
          source_pin: currentSession?.pin_code, // Добавляем PIN для фильтрации эха
          red_score: currentState.redScore,
          blue_score: currentState.blueScore,
          red_warnings: currentState.redWarnings,
          blue_warnings: currentState.blueWarnings,
        });
      }
    }
  };

  // Wrapper для addWarning с WebSocket синхронизацией и звуком
  const handleAddWarning = async (participant: 'red' | 'blue') => {
    if (import.meta.env.DEV) {
      console.log('[MatchScreen.handleAddWarning] Called for:', participant, {
        currentWarnings: participant === 'red' ? redWarnings : blueWarnings,
      });
    }

    // Проиграть звук предупреждения
    playSound('warning');

    // Обновить локальный state через matchStore
    await actions.addWarning(participant);

    if (import.meta.env.DEV) {
      console.log('[MatchScreen.handleAddWarning] After addWarning, new warnings:', {
        redWarnings: useMatchStore.getState().redWarnings,
        blueWarnings: useMatchStore.getState().blueWarnings,
      });
    }

    // Отправить событие через WebSocket
    if (wsConnected && sendScoreUpdate) {
      const participantId = participant === 'red'
        ? redFighter?.id
        : blueFighter?.id;

      if (participantId) {
        // Получаем актуальные значения после обновления
        const currentState = useMatchStore.getState();

        sendScoreUpdate({
          participant_id: participantId,
          action_type: 'warning',
          points: 0,
          round_number: 1,
          timestamp: currentState.lastUpdateTimestamp || new Date().toISOString(),
          source_pin: currentSession?.pin_code, // Добавляем PIN для фильтрации эха
          red_score: currentState.redScore,
          blue_score: currentState.blueScore,
          red_warnings: currentState.redWarnings,
          blue_warnings: currentState.blueWarnings,
        });
      }
    }
  };

  // Initialize match on mount
  useEffect(() => {
    console.log('MatchScreen: Initializing match:', match);
    const matchDuration = 300; // 5 minutes (TODO: from config)

    // Get cleanup function reference once
    const cleanup = useMatchStore.getState().cleanup;
    const initMatch = useMatchStore.getState().initMatch;
    const loadNextMatch = useMatchStore.getState().loadNextMatch;

    initMatch(match, matchDuration)
      .then(() => {
        // Отправляем match_start после успешной инициализации
        if (sendMatchStart) {
          sendMatchStart();
          console.log('[WebSocket] Sent match_start event');
        }
        // Загружаем следующий матч
        loadNextMatch().catch((error) => {
          console.error('MatchScreen: Failed to load next match:', error);
        });
      })
      .catch((error) => {
        console.error('MatchScreen: Failed to initialize match:', error);
      });

    // Автоматически открыть публичное табло
    openPublicDisplay();

    return () => {
      cleanup();
      // Закрываем публичное табло при размонтировании компонента
      closePublicDisplay();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id]); // Только match.id, actions игнорируем

  // Захват курсора в основном окне (не даём уходить на второй монитор)
  useEffect(() => {
    const grabCursor = async () => {
      try {
        const currentWindow = getCurrentWebviewWindow();
        console.log('[MatchScreen] Захватываем курсор в основном окне');
        await currentWindow.setCursorGrab(true);
      } catch (error) {
        console.error('[MatchScreen] Ошибка при захвате курсора:', error);
      }
    };

    const releaseCursor = async () => {
      try {
        const currentWindow = getCurrentWebviewWindow();
        console.log('[MatchScreen] Освобождаем курсор');
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
    // Звук окончания времени
    if (timer.remainingSeconds === 0) {
      playSound('end');
    }
  }, [timer.remainingSeconds, timer.isRunning, playSound]);

  // Звук при старте таймера
  useEffect(() => {
    if (timer.isRunning) {
      playSound('start');
    }
  }, [timer.isRunning]); // Не добавляем playSound в зависимости чтобы избежать повторных вызовов

  // Debounced timer_update через WebSocket (каждые 5 секунд для оптимизации)
  useEffect(() => {
    // Отправляем только если изменения по 5 секунд или изменился статус (running/paused)
    if (wsConnected && sendTimerUpdate && (timer.remainingSeconds % 5 === 0 || timer.remainingSeconds === 0)) {
      sendTimerUpdate(timer.remainingSeconds, timer.isRunning);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer.remainingSeconds, timer.isRunning, wsConnected]); // sendTimerUpdate игнорируем

  // Открыть публичный дисплей в новом окне через Tauri API
  const openPublicDisplay = async () => {
    console.log('[PublicDisplay] Попытка открыть публичное окно через Tauri...');

    // If already open, don't create another one
    if (publicWindowOpen) {
      console.log('[PublicDisplay] Окно уже открыто согласно state');
      return;
    }

    try {
      // Get available monitors
      interface MonitorInfo {
        name: string | null;
        position_x: number;
        position_y: number;
        width: number;
        height: number;
        is_primary: boolean;
      }

      const monitors = await invoke<MonitorInfo[]>('get_available_monitors');
      console.log('[PublicDisplay] Доступные мониторы:', monitors);

      // Find secondary monitor (not primary)
      const secondaryMonitor = monitors.find(m => !m.is_primary);

      let windowX: number | undefined;
      let windowY: number | undefined;
      let windowWidth = 1920;
      let windowHeight = 1080;
      let centerWindow = true;

      if (secondaryMonitor) {
        // Place on secondary monitor
        console.log('[PublicDisplay] Найден второй монитор, размещаю там:', secondaryMonitor.name);
        windowX = secondaryMonitor.position_x;
        windowY = secondaryMonitor.position_y;
        windowWidth = secondaryMonitor.width;
        windowHeight = secondaryMonitor.height;
        centerWindow = false;
      } else {
        console.log('[PublicDisplay] Второй монитор не найден, открываю на текущем');
      }

      // Check if window already exists and close it first
      const existingWindow = await WebviewWindow.getByLabel('public-display');
      if (existingWindow) {
        console.log('[PublicDisplay] Окно уже существует, закрываю старое...');
        try {
          await existingWindow.close();
          // Small delay to ensure window is fully closed
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          console.warn('[PublicDisplay] Не удалось закрыть старое окно:', err);
        }
      }

      console.log('[PublicDisplay] Создаю новый WebviewWindow...');
      const webview = new WebviewWindow('public-display', {
        url: '/',
        title: 'Табло для зрителей',
        width: windowWidth,
        height: windowHeight,
        x: windowX,
        y: windowY,
        resizable: true,
        fullscreen: false,
        maximized: true, // Развернуто на весь экран
        center: centerWindow,
        focus: true,
        decorations: true, // Показываем системные кнопки (закрыть, свернуть, развернуть)
      });

      console.log('[PublicDisplay] WebviewWindow объект создан:', webview.label);

      // Wait for window to be ready
      webview.once('tauri://created', () => {
        console.log('[PublicDisplay] Окно успешно создано и готово');
        setPublicWindowOpen(true);

        // Отправляем начальные данные периодически первые 3 секунды
        // чтобы гарантировать, что слушатель в PublicDisplayPage успеет инициализироваться
        const sendInitialData = () => {
          const currentState = useMatchStore.getState();
          const initialData = {
            redFighter: currentState.redFighter,
            blueFighter: currentState.blueFighter,
            redScore: currentState.redScore,
            blueScore: currentState.blueScore,
            remainingSeconds: timer.remainingSeconds,
            isRunning: timer.isRunning,
          };
          console.log('[PublicDisplay] 📤 Отправка начальных данных:', {
            redFighterName: initialData.redFighter?.full_name,
            blueFighterName: initialData.blueFighter?.full_name,
            scores: `${initialData.redScore}:${initialData.blueScore}`,
          });
          // fileLogger.info - НЕ используем (может вызывать infinite loop)
          emit('match-update', initialData).catch((error) => {
            console.error('[PublicDisplay] ❌ Ошибка при отправке начальных данных:', error);
            // fileLogger.error - НЕ используем (может вызывать infinite loop)
          });
        };

        // Отправляем каждые 200ms первые 3 секунды (15 попыток)
        for (let i = 0; i < 15; i++) {
          setTimeout(sendInitialData, i * 200);
        }
      });

      webview.once('tauri://error', (e) => {
        console.error('[PublicDisplay] Ошибка создания окна:', e);
        setPublicWindowOpen(false);
      });

      // Listen for window destroy event (не блокируем закрытие)
      webview.once('tauri://destroyed', () => {
        console.log('[PublicDisplay] Окно закрыто пользователем');
        setPublicWindowOpen(false);
      });

    } catch (error) {
      console.error('[PublicDisplay] Ошибка при открытии окна:', error);
      alert(`Ошибка при открытии публичного табло: ${error}`);
      setPublicWindowOpen(false);
    }
  };

  // Отправляем обновления в публичное окно в реальном времени
  // FIX: Теперь использует useRef для предотвращения infinite loop
  useMatchUpdateEmitter(
    redFighter,
    blueFighter,
    redScore,
    blueScore,
    timer.remainingSeconds,
    timer.isRunning
  );

  // Global hotkeys
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      const session = useSessionStore.getState();

      // Debug: log all keypresses
      console.log('[Hotkey] Key pressed:', e.code, e.key);

      // Ignore if any dialog open
      if (showEndDialog || showTimerEditDialog || showResetDialog || showHelpDialog) {
        console.log('[Hotkey] Ignored - dialog open');
        return;
      }

      // Ignore if input/textarea focused
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        console.log('[Hotkey] Ignored - input focused');
        return;
      }

      // Space: Start/Pause timer
      if (e.code === 'Space') {
        e.preventDefault();
        const currentTimer = timerRef.current;
        console.log('[Hotkey] Space pressed, timer.isRunning:', currentTimer.isRunning);
        if (currentTimer.isRunning) {
          console.log('[Hotkey] Pausing timer');
          currentTimer.pause();
        } else {
          console.log('[Hotkey] Starting timer');
          currentTimer.start();
        }
        return;
      }

      // Enter: Finish match
      if (e.code === 'Enter') {
        e.preventDefault();
        setShowEndDialog(true);
        return;
      }

      // Ctrl+Z: Undo
      if (e.ctrlKey && e.code === 'KeyZ') {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Scoring hotkeys
      // QWER → красный (верхний): Q=+1, W=+2, E=+3, R=+4
      // 1234 → синий (нижний): 1=+1, 2=+2, 3=+3, 4=+4

      // Red corner (нижний): Q/W/E/R
      const redKeyMap: { [key: string]: number } = {
        'KeyQ': 1,
        'KeyW': 2,
        'KeyE': 3,
        'KeyR': 4,
      };

      if (redKeyMap[e.code]) {
        e.preventDefault();
        console.log('[Hotkey] Red:', e.code, '→', redKeyMap[e.code], 'points');
        const points = redKeyMap[e.code];
        handleAddScore('red', points, `+${points}`);
        return;
      }

      // Blue corner (нижний): 1/2/3/4
      const blueKeyMap: { [key: string]: number } = {
        'Digit1': 1,
        'Digit2': 2,
        'Digit3': 3,
        'Digit4': 4,
      };

      if (blueKeyMap[e.code]) {
        e.preventDefault();
        const points = blueKeyMap[e.code];
        handleAddScore('blue', points, `+${points}`);
        return;
      }

      // Warnings (Z - blue, X - red)
      // Allow adding warnings - when 4th warning is added (with max=3), auto-disqualification will trigger
      const config2 = session.currentSession?.scoring_config;
      if (config2?.warnings.enabled) {
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
  }, [showEndDialog, showTimerEditDialog, showResetDialog, showHelpDialog]); // actions, timer игнорируем

  // Auto-finish when timer reaches 0 (only once)
  useEffect(() => {
    if (timer.remainingSeconds === 0 && !showEndDialog && !autoEndDialogShown) {
      setShowEndDialog(true);
      setAutoEndDialogShown(true);
    }
  }, [timer.remainingSeconds, showEndDialog, autoEndDialogShown]);

  // Auto-open end dialog on disqualification (4th warning)
  useEffect(() => {
    const maxWarnings = currentSession?.scoring_config.warnings.max_count || 3;
    if ((redWarnings > maxWarnings || blueWarnings > maxWarnings) && !showEndDialog && !disqualificationToastShown) {
      console.log('[MatchScreen] Auto-opening end dialog - disqualification detected');

      // 1. Остановить таймер
      timer.pause();
      console.log('[MatchScreen] Timer paused due to disqualification');

      // 2. Определить победителя (противоположный участник)
      let winner: 'red' | 'blue' | null = null;
      if (redWarnings > maxWarnings) {
        winner = 'blue'; // Красный дисквалифицирован → побеждает синий
        console.log('[MatchScreen] Red disqualified, blue wins');
      } else if (blueWarnings > maxWarnings) {
        winner = 'red'; // Синий дисквалифицирован → побеждает красный
        console.log('[MatchScreen] Blue disqualified, red wins');
      }

      // 3. Предзаполнить данные для диалога
      setAutoResultType('disqualification');
      setAutoSelectedWinner(winner);

      showToast('Дисквалификация! Завершите матч', 'warning', 3000);
      setShowEndDialog(true);
      setDisqualificationToastShown(true);
    }
  }, [redWarnings, blueWarnings, showEndDialog, disqualificationToastShown, currentSession?.scoring_config.warnings.max_count, showToast, timer]);

  const [showCancelMatchDialog, setShowCancelMatchDialog] = useState(false);

  const handleCancelMatch = async () => {
    try {
      const serverUrl = serverMode.mode === 'local-client' ? (serverMode.serverUrl ?? undefined) : undefined;
      await invoke('cancel_match', { matchId: match.id, serverUrl });
      showToast('Матч отменён', 'success', 3000);
      setShowCancelMatchDialog(false);
      await closePublicDisplay();
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

      // Отправляем match_end через WebSocket
      if (wsConnected && sendMatchEnd) {
        sendMatchEnd(winnerId, resultType);
        console.log('[WebSocket] Sent match_end event');
      }

      // Показываем информацию о следующем матче, если он есть
      if (nextMatch && nextMatch.participant1 && nextMatch.participant2) {
        showToast(
          `Следующий бой: ${nextMatch.participant1.full_name} vs ${nextMatch.participant2.full_name}`,
          'info',
          4000
        );
      }

      setShowEndDialog(false);
      // Закрываем публичное табло при завершении матча
      await closePublicDisplay();
      onExit();
    } catch (error) {
      console.error('[MatchScreen] Failed to finish match:', error);
      showToast('Ошибка при завершении матча. Попробуйте ещё раз.', 'error', 3000);
      // Не закрываем диалог, чтобы пользователь мог повторить попытку
    }
  };

  const scoringConfig = currentSession?.scoring_config;

  // Если нет данных участников, показываем ошибку
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

  // Адаптивные размеры для header
  const headerSizes = {
    hd: {
      padding: 'px-2 py-1.5 sm:px-3 sm:py-2',
      text: 'text-[10px] sm:text-xs',
      iconSize: 14,
      buttonSize: 'sm' as const,
    },
    fullhd: {
      padding: 'px-3 py-2 sm:px-4 sm:py-2.5 lg:px-6 lg:py-3',
      text: 'text-xs sm:text-sm',
      iconSize: 16,
      buttonSize: 'sm' as const,
    },
  };

  const header = headerSizes[mode];

  // Адаптивные размеры кнопок в центральной зоне
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
          {/* WebSocket Status Indicator с детальной информацией */}
          <div
            className={`flex items-center gap-1.5 ${header.text}`}
            title={
              wsConnected
                ? 'Связь с сервером активна - изменения синхронизируются в реальном времени'
                : 'Нет связи с сервером - данные сохраняются локально и будут синхронизированы позже'
            }
          >
            {wsConnected ? (
              <>
                <Wifi size={header.iconSize} className="text-green-600" />
                <span className="text-green-700 hidden sm:inline font-medium">Синхронизация</span>
              </>
            ) : (
              <>
                <WifiOff size={header.iconSize} className="text-yellow-600" />
                <span className="text-yellow-700 hidden sm:inline font-medium">Локально</span>
              </>
            )}
          </div>
          <Button
            variant="secondary"
            size={header.buttonSize}
            onClick={openPublicDisplay}
            disabled={publicWindowOpen}
            className={mode === 'hd' ? 'text-[10px] sm:text-xs px-2 py-1' : undefined}
          >
            {publicWindowOpen ? '✓ Табло открыто' : 'Открыть табло для зрителей'}
          </Button>
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

      {/* Main content - Vertical layout */}
      <div className="flex-1 flex flex-col overflow-hidden w-full">
        {/* Blue Fighter Zone (верхний) - flex-1 */}
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
            maxWarnings={scoringConfig?.warnings.max_count || 3}
          />
        </div>

        {/* Red Fighter Zone (нижний) - flex-1 */}
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
            maxWarnings={scoringConfig?.warnings.max_count || 3}
          />
        </div>

        {/* Timer Zone - flex-[1.2] (чуть больше остальных) */}
        <div className="flex-[1.2] min-h-0 w-full border-t border-gray-400 overflow-hidden">
          <div className="h-full w-full flex items-stretch">
            {/* Left Controls */}
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

              <Button
                variant="danger"
                size="md"
                onClick={handleResetClick}
                className={controls.resetButton}
              >
                Сброс всего
              </Button>
            </div>

            {/* Center Timer */}
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

            {/* Right Controls */}
            <div className={`flex flex-col justify-center ${mode === 'hd' ? 'gap-2 px-2' : 'gap-4 px-4'} flex-shrink-0`}>
              <CallAdminButton />
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

      {/* Cancel Match Dialog */}
      {showCancelMatchDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-3">Отменить матч?</h3>
            <p className="text-gray-600 text-sm mb-6">
              Счёт и предупреждения будут сброшены. Победитель будет убран из следующего раунда.
              Это действие нельзя отменить.
            </p>
            <div className="flex gap-3">
              <Button
                variant="danger"
                className="flex-1"
                onClick={handleCancelMatch}
              >
                Да, отменить
              </Button>
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setShowCancelMatchDialog(false)}
              >
                Назад
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* End Dialog */}
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

      {/* Timer Edit Dialog */}
      {showTimerEditDialog && (
        <TimerEditDialog
          currentSeconds={timer.remainingSeconds}
          onConfirm={handleTimerEditConfirm}
          onCancel={() => setShowTimerEditDialog(false)}
        />
      )}

      {/* Reset Confirm Dialog */}
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

      {/* Help Dialog */}
      {showHelpDialog && (
        <HelpDialog
          onClose={() => setShowHelpDialog(false)}
        />
      )}

      {/* Next Match Card - плавающая карточка */}
      {/* Временно закомментирован */}
      {/* <NextMatchCard
        nextMatch={nextMatch}
        bracketName={categoryName}
        isLoading={isLoadingNextMatch}
      /> */}

      {/* Toast Notifications */}
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
