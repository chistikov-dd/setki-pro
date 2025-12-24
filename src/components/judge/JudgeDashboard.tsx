import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useServerModeStore } from '../../stores/serverModeStore';
import { useSyncWorker } from '../../hooks/useSyncWorker';
import { Button } from '../ui/Button';
import { BracketSelection } from './BracketSelection';
import { TournamentBracket } from '../brackets/TournamentBracket';
import { MatchScreen } from '../match/MatchScreen';
import { reserveBracket, getBracketMatches, releaseBracket } from '../../services/api';
import type { Match } from '../../types';

export const JudgeDashboard: React.FC = () => {
  const { user, logout } = useAuthStore();
  const { currentSession, loadTournamentSession } = useSessionStore();
  const serverMode = useServerModeStore();
  const [selectedBracketId, setSelectedBracketId] = useState<number | null>(null);
  const [selectedBracketName, setSelectedBracketName] = useState<string>('');
  const [lastSelectedBracketId, setLastSelectedBracketId] = useState<number | null>(null);
  const [isReserving, setIsReserving] = useState(false);
  const [reservationError, setReservationError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);
  const [activeMatch, setActiveMatch] = useState<Match | null>(null);
  const [bracketSelectionReloadTrigger, setBracketSelectionReloadTrigger] = useState(0);

  // Background синхронизация при старте приложения и каждые 30 секунд
  useSyncWorker({
    enabled: true,
    interval: 30000,
    serverMode,
    onSyncSuccess: () => {
      console.log('[JudgeDashboard] Background sync успешна');
    },
    onSyncError: (error) => {
      console.error('[JudgeDashboard] Background sync ошибка:', error);
    },
  });

  // Загружаем сессию турнира только если её нет в localStorage
  useEffect(() => {
    if (user?.tournament_id && !currentSession) {
      console.log('[JudgeDashboard] Сессия не найдена в localStorage, загружаем из API...');
      loadTournamentSession(user.tournament_id)
        .then(() => {
          console.log('[JudgeDashboard] Сессия загружена успешно');
        })
        .catch((error) => {
          console.error('[JudgeDashboard] Ошибка загрузки сессии:', error);
        });
    } else if (currentSession) {
      console.log('[JudgeDashboard] Сессия восстановлена из localStorage:', currentSession);
    }
  }, [user?.tournament_id, currentSession, loadTournamentSession]);

  const handleLogout = async () => {
    // Освобождаем сетку перед выходом
    if (selectedBracketId) {
      try {
        await releaseBracket(selectedBracketId);
      } catch (error) {
        console.error('Ошибка освобождения сетки при выходе:', error);
      }
    }
    logout();
  };

  // Освобождаем сетку при размонтировании компонента
  useEffect(() => {
    return () => {
      if (selectedBracketId) {
        releaseBracket(selectedBracketId).catch((error) => {
          console.error('Ошибка освобождения сетки при размонтировании:', error);
        });
      }
    };
  }, [selectedBracketId]);

  // Загрузка матчей сетки
  useEffect(() => {
    if (selectedBracketId) {
      loadMatches(selectedBracketId);
    }
  }, [selectedBracketId]);

  const loadMatches = async (bracketId: number) => {
    setIsLoadingMatches(true);
    try {
      // Получаем serverUrl из store для локального сервера
      const { mode, serverUrl } = useServerModeStore.getState();
      const url = mode === 'local-client' ? serverUrl : null;

      console.log('[JudgeDashboard] Загрузка матчей, bracket_id:', bracketId, 'mode:', mode, 'serverUrl:', url);
      const data = await getBracketMatches(bracketId, url);

      // Преобразуем MatchResponse в Match
      const mappedMatches: Match[] = data.map((matchResponse: any) => {
        return {
          id: matchResponse.id,
          bracket_id: matchResponse.bracket_id,
          round_number: matchResponse.round_number,
          match_number: matchResponse.match_number,
          winner_id: matchResponse.winner_id,
          status: matchResponse.status,
          score_participant1: matchResponse.score_participant1 ?? 0,
          score_participant2: matchResponse.score_participant2 ?? 0,
          warnings_participant1: 0,
          warnings_participant2: 0,
          result_type: matchResponse.result_type,
          participant1: matchResponse.participant1 || (matchResponse.participant1_id ? {
            id: matchResponse.participant1_id,
            fighter_id: matchResponse.participant1_id,
            full_name: matchResponse.fighter1_name || 'TBD',
            club_name: matchResponse.fighter1_club || matchResponse.participant1?.club_name,
          } : undefined),
          participant2: matchResponse.participant2 || (matchResponse.participant2_id ? {
            id: matchResponse.participant2_id,
            fighter_id: matchResponse.participant2_id,
            full_name: matchResponse.fighter2_name || 'TBD',
            club_name: matchResponse.fighter2_club || matchResponse.participant2?.club_name,
          } : undefined),
        };
      });

      setMatches(mappedMatches);
    } catch (error) {
      console.error('Ошибка загрузки матчей:', error);
      setReservationError('Не удалось загрузить матчи сетки');
    } finally {
      setIsLoadingMatches(false);
    }
  };

  const handleBracketSelect = async (bracketId: number, categoryName: string) => {
    if (!user?.judge_name || user?.user_id === undefined) {
      setReservationError('Данные судьи не найдены');
      console.error('User data:', user);
      return;
    }

    setIsReserving(true);
    setReservationError(null);

    try {
      await reserveBracket(bracketId, user.judge_name, user.user_id);
      setSelectedBracketId(bracketId);
      setLastSelectedBracketId(bracketId); // Сохраняем для прокрутки при возврате
      setSelectedBracketName(categoryName);
      console.log('Сетка зарезервирована:', bracketId, categoryName);
    } catch (error) {
      setReservationError(error instanceof Error ? error.message : 'Ошибка резервирования');
      console.error('Ошибка резервирования сетки:', error);
    } finally {
      setIsReserving(false);
    }
  };

  const handleStartMatch = (matchId: number) => {
    const match = matches.find(m => m.id === matchId);
    console.log('handleStartMatch: найден матч', match);

    if (match) {
      console.log('handleStartMatch: установка activeMatch');
      setActiveMatch(match);
    } else {
      console.error('handleStartMatch: матч не найден с ID', matchId);
    }
  };

  const handleExitMatch = async () => {
    setActiveMatch(null);
    // Перезагружаем матчи чтобы увидеть обновленный статус
    if (selectedBracketId) {
      loadMatches(selectedBracketId);
    }
    // Также обновляем список сеток для актуализации статусов
    handleBracketEdited();
  };

  const handleBackToBracketSelection = async () => {
    // Освобождаем сетку при возврате к выбору
    if (selectedBracketId) {
      try {
        await releaseBracket(selectedBracketId);
        console.log('Сетка освобождена:', selectedBracketId);
      } catch (error) {
        console.error('Ошибка освобождения сетки:', error);
      }
    }
    // Сбрасываем только selectedBracketId, lastSelectedBracketId остается для прокрутки
    setSelectedBracketId(null);
    // Обновить список сеток чтобы увидеть обновленные статусы
    handleBracketEdited();
  };

  // Callback для перезагрузки BracketSelection после редактирования сетки
  const handleBracketEdited = () => {
    setBracketSelectionReloadTrigger(prev => prev + 1);
    console.log('Запрос на перезагрузку списка сеток после редактирования');
  };

  // Если активен матч, показываем полноэкранный MatchScreen
  if (activeMatch) {
    return <MatchScreen match={activeMatch} categoryName={selectedBracketName} onExit={handleExitMatch} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-100 p-6">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Панель судьи
            </h1>
            <p className="text-gray-800">
              Добро пожаловать, {user?.judge_name || 'Судья'}!
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={handleLogout}
            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Выйти
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-full mx-auto">
        {selectedBracketId ? (
          <div className="space-y-4">
            {/* Кнопка назад */}
            <div className="flex items-center justify-end mb-4">
              <Button onClick={handleBackToBracketSelection} variant="secondary">
                ← Выбрать другую сетку
              </Button>
            </div>

            {/* Турнирная сетка */}
            {isLoadingMatches ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-400 border-t-blue-500 mb-4"></div>
                  <p className="text-gray-800">Загрузка матчей...</p>
                </div>
              </div>
            ) : matches.length > 0 ? (
              <TournamentBracket
                matches={matches}
                onStartMatch={handleStartMatch}
                categoryName={selectedBracketName}
                bracketId={selectedBracketId}
                onMatchesReload={() => loadMatches(selectedBracketId)}
                onBracketEdited={handleBracketEdited}
              />
            ) : (
              <div className="bg-white/30 border border-gray-400/50 rounded-lg p-8 text-center">
                <p className="text-gray-800">Нет матчей в этой сетке</p>
                <p className="text-gray-700 text-sm mt-2">
                  Возможно, данные не были скачаны администратором
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-gradient-to-br from-gray-800/50 to-gray-100/50 backdrop-blur-sm rounded-2xl border border-gray-400/50 p-8">
            {reservationError && (
              <div className="mb-6 bg-red-500/10 border border-red-500/50 rounded-lg p-4">
                <p className="text-red-400 font-medium">Ошибка резервирования</p>
                <p className="text-red-300 text-sm mt-1">{reservationError}</p>
              </div>
            )}

            {user?.tournament_id ? (
              isReserving ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-400 border-t-blue-500 mb-4"></div>
                    <p className="text-gray-800">Резервирование сетки...</p>
                  </div>
                </div>
              ) : (
                <BracketSelection
                  tournamentId={user.tournament_id}
                  onBracketSelect={handleBracketSelect}
                  lastSelectedBracketId={lastSelectedBracketId}
                  reloadTrigger={bracketSelectionReloadTrigger}
                />
              )
            ) : (
              <div className="text-center py-12">
                <div className="mb-6">
                  <div className="inline-block p-6 rounded-full bg-red-500/10 border-2 border-red-500/30 mb-4">
                    <svg className="w-16 h-16 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
                <h2 className="text-2xl font-bold text-white mb-3">
                  Нет активного турнира
                </h2>
                <p className="text-gray-800 mb-8 max-w-md mx-auto">
                  Не найден ID турнира в вашей сессии. Попробуйте выйти и войти снова.
                </p>
                <Button onClick={handleLogout} variant="secondary">
                  Выйти
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
