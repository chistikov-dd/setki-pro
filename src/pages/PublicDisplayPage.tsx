import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { PublicDisplay } from '../components/match/PublicDisplay';
import { fileLogger } from '../utils/fileLogger';
import type { Participant } from '../types';

interface MatchData {
  redFighter: Participant | null;
  blueFighter: Participant | null;
  redScore: number;
  blueScore: number;
  remainingSeconds: number;
  isRunning: boolean;
}

export function PublicDisplayPage() {
  const [matchData, setMatchData] = useState<MatchData>({
    redFighter: null,
    blueFighter: null,
    redScore: 0,
    blueScore: 0,
    remainingSeconds: 300,
    isRunning: false,
  });

  useEffect(() => {
    console.log('[PublicDisplayPage] Инициализация публичного табло...');
    fileLogger.info('[PublicDisplayPage] Initializing public display');

    // Listen for match updates from main window
    const unlisten = listen<MatchData>('match-update', (event) => {
      console.log('[PublicDisplayPage] ✅ ПОЛУЧЕНО СОБЫТИЕ match-update!');
      fileLogger.info('[PublicDisplayPage] Received match-update event', {
        redFighter: event.payload.redFighter?.full_name,
        blueFighter: event.payload.blueFighter?.full_name,
        redScore: event.payload.redScore,
        blueScore: event.payload.blueScore,
        remainingSeconds: event.payload.remainingSeconds,
        isRunning: event.payload.isRunning,
      });
      setMatchData(event.payload);
    });

    fileLogger.info('[PublicDisplayPage] Event listener registered, waiting for data...');

    return () => {
      console.log('[PublicDisplayPage] Размонтирование компонента');
      fileLogger.info('[PublicDisplayPage] Component unmounting');
      unlisten.then((fn) => fn());
    };
  }, []);

  // Debug: логируем текущие данные при каждом рендере
  useEffect(() => {
    console.log('[PublicDisplayPage] 📊 Текущие данные для отображения:');
    console.log('  - redFighter:', matchData.redFighter ? matchData.redFighter.full_name : 'NULL');
    console.log('  - blueFighter:', matchData.blueFighter ? matchData.blueFighter.full_name : 'NULL');
    console.log('  - redScore:', matchData.redScore);
    console.log('  - blueScore:', matchData.blueScore);
    console.log('  - Полный объект:', JSON.stringify(matchData, null, 2));
  }, [matchData]);

  return (
    <PublicDisplay
      redFighter={matchData.redFighter}
      blueFighter={matchData.blueFighter}
      redScore={matchData.redScore}
      blueScore={matchData.blueScore}
      remainingSeconds={matchData.remainingSeconds}
      isRunning={matchData.isRunning}
    />
  );
}
