import { useState } from 'react';
import { RefreshCw, CheckCircle, AlertCircle, Upload } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { syncChanges, resetSyncFlags } from '../../services/api';

interface SyncProgressProps {
  tournamentId: number;
}

export const SyncProgress = ({ tournamentId: _tournamentId }: SyncProgressProps) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [syncedCount, setSyncedCount] = useState<number>(0);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncStatus('idle');
    setErrorMessage('');

    try {
      const count = await syncChanges();
      setSyncedCount(count);
      setSyncStatus('success');
      setLastSyncTime(new Date());
    } catch (error) {
      setSyncStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Ошибка синхронизации');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleForceSync = async () => {
    setIsSyncing(true);
    setSyncStatus('idle');
    setErrorMessage('');

    try {
      await resetSyncFlags();
      const count = await syncChanges();
      setSyncedCount(count);
      setSyncStatus('success');
      setLastSyncTime(new Date());
    } catch (error) {
      setSyncStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Ошибка синхронизации');
    } finally {
      setIsSyncing(false);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <Card variant="bordered">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="w-5 h-5" />
          Синхронизация данных
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Status Message */}
          {syncStatus === 'success' && lastSyncTime && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-300 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-green-900">
                  {syncedCount > 0
                    ? `Выгружено матчей: ${syncedCount}`
                    : 'Нет новых данных для выгрузки'}
                </p>
                <p className="text-xs text-green-700">
                  Последняя синхронизация: {formatTime(lastSyncTime)}
                </p>
              </div>
            </div>
          )}

          {syncStatus === 'error' && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-300 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-red-900">Ошибка синхронизации</p>
                <p className="text-xs text-red-700">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Description */}
          <div className="text-sm text-gray-800">
            <p className="mb-2">
              Выгрузить все результаты поединков на сервер setki.pro
            </p>
            <ul className="list-disc list-inside space-y-1 text-xs text-gray-700 ml-2">
              <li>Обновляются только несинхронизированные изменения</li>
              <li>Безопасно для offline режима</li>
              <li>Рекомендуется запускать после завершения турнира</li>
            </ul>
          </div>

          {/* Progress bar */}
          {isSyncing && (
            <div className="w-full">
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>Выгрузка на сервер...</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div className="bg-blue-500 h-2 rounded-full animate-pulse w-full" />
              </div>
            </div>
          )}

          {/* Sync Button */}
          <Button
            variant="primary"
            onClick={handleSync}
            disabled={isSyncing}
            fullWidth
            size="lg"
            className="mt-4"
          >
            {isSyncing ? (
              <>
                <RefreshCw className="w-5 h-5 mr-2 animate-spin" />
                Выгрузка...
              </>
            ) : (
              <>
                <RefreshCw className="w-5 h-5 mr-2" />
                Выгрузить результаты
              </>
            )}
          </Button>

          <Button
            variant="outline"
            onClick={handleForceSync}
            disabled={isSyncing}
            fullWidth
            size="sm"
            className="mt-2"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Выгрузить повторно
          </Button>

          {/* Last Sync Time (Idle state) */}
          {syncStatus === 'idle' && lastSyncTime && (
            <p className="text-xs text-center text-gray-700">
              Последняя синхронизация: {formatTime(lastSyncTime)}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
