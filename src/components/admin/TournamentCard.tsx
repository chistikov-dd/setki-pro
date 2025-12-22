import { memo } from 'react';
import { Card } from '../ui/Card';
import type { TournamentBriefResponse } from '../../types';

interface TournamentCardProps {
  tournament: TournamentBriefResponse;
  isSelected: boolean;
  onClick: () => void;
}

export const TournamentCard = memo(({ tournament, isSelected, onClick }: TournamentCardProps) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-gray-600';
      case 'published': return 'bg-blue-600';
      case 'registration_open': return 'bg-green-600';
      case 'registration_closed': return 'bg-yellow-600';
      case 'in_progress': return 'bg-orange-600';
      case 'completed': return 'bg-gray-500';
      default: return 'bg-gray-600';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'draft': return 'Черновик';
      case 'published': return 'Опубликован';
      case 'registration_open': return 'Регистрация открыта';
      case 'registration_closed': return 'Регистрация закрыта';
      case 'in_progress': return 'Идет';
      case 'ongoing': return 'Идет';
      case 'completed': return 'Завершен';
      case 'upcoming': return 'Предстоящий';
      case 'cancelled': return 'Отменен';
      default: return status;
    }
  };

  return (
    <Card
      variant="bordered"
      hoverable
      interactive
      className={`${
        isSelected ? 'border-blue-500 bg-blue-900/20 ring-2 ring-blue-500/50' : ''
      }`}
      onClick={onClick}
      aria-label={`Выбрать турнир ${tournament.name}`}
      aria-pressed={isSelected}
    >
      <div className="space-y-3">
        {/* Tournament Name */}
        <h3 className="text-lg font-bold text-gray-900 truncate">
          {tournament.name}
        </h3>

        <div className="flex gap-4">
          {/* Tournament Image */}
          <div className="flex-shrink-0 w-32 h-32 bg-gray-700 rounded-lg overflow-hidden">
          {tournament.image_url ? (
            <img
              src={tournament.image_url}
              alt={tournament.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-700">
              <svg
                className="w-16 h-16"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
          )}
        </div>

        {/* Tournament Info */}
        <div className="flex-1 min-w-0">
          <div className="mb-2">
            <span
              className={`px-2 py-1 text-xs font-medium text-white rounded ${getStatusColor(
                tournament.status
              )}`}
            >
              {getStatusText(tournament.status)}
            </span>
          </div>

          <div className="space-y-1 text-sm text-gray-800">
            {tournament.start_date && (
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                <span>
                  {new Date(tournament.start_date).toLocaleDateString('ru-RU')}
                  {tournament.end_date &&
                    tournament.end_date !== tournament.start_date &&
                    ` - ${new Date(tournament.end_date).toLocaleDateString('ru-RU')}`}
                </span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
              <span>Сеток: {tournament.brackets_count}</span>
            </div>
          </div>
        </div>
        </div>
      </div>
    </Card>
  );
});
