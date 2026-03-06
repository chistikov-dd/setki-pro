import { useRef } from 'react';
import type { AdminCalledEvent } from '../../hooks/useAdminEventsWebSocket';

interface AdminCall {
  id: string;
  table_number: number;
  judge_name: string | null;
  message: string | null;
  timestamp: string;
}

interface AdminCallsPanelProps {
  calls: AdminCall[];
  onDismiss: (id: string) => void;
}

// Форматирует время вызова (HH:MM)
function formatTime(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export const AdminCallsPanel: React.FC<AdminCallsPanelProps> = ({ calls, onDismiss }) => {
  if (calls.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="bg-orange-50 border border-orange-300 rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-orange-100 border-b border-orange-300">
          <svg className="w-5 h-5 text-orange-600 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
          </svg>
          <span className="font-semibold text-orange-800">
            Вызовы администратора ({calls.length})
          </span>
        </div>
        <div className="divide-y divide-orange-200">
          {calls.map((call) => (
            <div key={call.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-orange-900 text-base">
                    Стол №{call.table_number}
                  </span>
                  {call.judge_name && (
                    <span className="text-sm text-orange-700">— {call.judge_name}</span>
                  )}
                  <span className="text-xs text-orange-500 ml-auto">
                    {formatTime(call.timestamp)}
                  </span>
                </div>
                {call.message && (
                  <p className="text-sm text-orange-600 mt-0.5">{call.message}</p>
                )}
              </div>
              <button
                onClick={() => onDismiss(call.id)}
                className="flex-shrink-0 text-xs text-orange-500 hover:text-orange-800 hover:bg-orange-100 px-2 py-1 rounded transition-colors"
              >
                Убрать
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// Hook для использования в AdminDashboard
export function useAdminCalls() {
  const callsRef = useRef<AdminCall[]>([]);
  // Используем внешний setState — передаём через callback
  const setCallsRef = useRef<((calls: AdminCall[]) => void) | null>(null);

  const addCall = (event: AdminCalledEvent) => {
    const newCall: AdminCall = {
      id: `${event.table_number}-${event.timestamp}`,
      table_number: event.table_number,
      judge_name: event.judge_name,
      message: event.message,
      timestamp: event.timestamp,
    };
    callsRef.current = [...callsRef.current.filter(c => c.table_number !== event.table_number), newCall];
    setCallsRef.current?.(callsRef.current);
  };

  const dismissCall = (id: string) => {
    callsRef.current = callsRef.current.filter(c => c.id !== id);
    setCallsRef.current?.(callsRef.current);
  };

  return { addCall, dismissCall, setCallsRef };
}

export type { AdminCall };
