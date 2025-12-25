import { create } from 'zustand';

export interface ConnectedJudge {
  user_id: number;
  judge_name: string;
  table_number: number;
  tournament_id: number;
  connected_at: string; // ISO timestamp
}

interface JudgeMonitorState {
  // Map: table_number -> ConnectedJudge
  connectedJudges: Map<number, ConnectedJudge>;

  // Действия
  addJudge: (judge: ConnectedJudge) => void;
  removeJudge: (table_number: number) => void;
  clearJudges: () => void;
}

export const useJudgeMonitorStore = create<JudgeMonitorState>((set) => ({
  connectedJudges: new Map(),

  addJudge: (judge) => {
    set((state) => {
      const newMap = new Map(state.connectedJudges);
      newMap.set(judge.table_number, judge);
      return { connectedJudges: newMap };
    });
  },

  removeJudge: (table_number) => {
    set((state) => {
      const newMap = new Map(state.connectedJudges);
      newMap.delete(table_number);
      return { connectedJudges: newMap };
    });
  },

  clearJudges: () => {
    set({ connectedJudges: new Map() });
  },
}));
