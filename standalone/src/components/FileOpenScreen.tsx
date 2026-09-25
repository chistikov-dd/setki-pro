import { useState } from 'react';
import { Button } from './ui/Button';
import { Card, CardContent } from './ui/Card';
import { pickAndLoadTournamentFile } from '../services/api';
import type { LoadedTournamentFile } from '../types';

interface FileOpenScreenProps {
  onLoaded: (data: LoadedTournamentFile) => void;
}

/**
 * Первый экран приложения: судья вручную выбирает JSON-файл турнира,
 * заранее выгруженный веб-приложением. Никакого автопоиска/сети.
 */
export function FileOpenScreen({ onLoaded }: FileOpenScreenProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePickFile = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await pickAndLoadTournamentFile();
      if (data) {
        onLoaded(data);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Не удалось загрузить файл турнира: ${message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen w-full flex items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-100">
      <Card variant="elevated" className="max-w-md w-full text-center">
        <CardContent>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">SETKI KEEPER</h1>
          <p className="text-gray-600 mb-6">
            Автономное судейское приложение. Выберите файл турнира (JSON), полученный от организатора.
          </p>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={handlePickFile}
            disabled={isLoading}
          >
            {isLoading ? 'Загрузка...' : 'Открыть файл турнира'}
          </Button>
          {error && (
            <p className="text-red-600 text-sm mt-4">{error}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
