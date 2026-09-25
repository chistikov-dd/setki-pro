import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { PublicDisplay } from '../components/match/PublicDisplay';
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
    const unlisten = listen<MatchData>('match-update', (event) => {
      setMatchData(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

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
