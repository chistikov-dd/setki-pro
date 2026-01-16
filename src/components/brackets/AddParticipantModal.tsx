import { useState } from 'react';
import { useBracketEditorStore } from '../../stores/bracketEditorStore';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../ui/Button';

interface AddParticipantModalProps {
  bracketId: number;
  onParticipantAdded: () => void;
}

export const AddParticipantModal: React.FC<AddParticipantModalProps> = ({ bracketId, onParticipantAdded }) => {
  const {
    isAddParticipantModalOpen,
    selectedMatch,
    selectedSlot,
    closeModals,
    addParticipant,
    isLoading,
    error,
  } = useBracketEditorStore();

  const { user } = useAuthStore();

  const [fighterName, setFighterName] = useState('');
  const [clubName, setClubName] = useState('');

  if (!isAddParticipantModalOpen || !selectedMatch || !selectedSlot) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fighterName.trim()) {
      alert('Введите имя участника');
      return;
    }

    try {
      await addParticipant(
        bracketId,
        selectedMatch.id,
        selectedSlot,
        {
          fighter_name: fighterName.trim(),
          club_name: clubName.trim() || undefined,
        },
        user?.role === 'referee' ? user.judge_name : undefined,
        user?.role === 'admin' ? user.user_id : undefined
      );

      // Очистить форму
      setFighterName('');
      setClubName('');

      onParticipantAdded();
    } catch (error) {
      console.error('[AddParticipantModal] Ошибка при добавлении участника:', error);
      // Ошибка уже отображается через error из store
    }
  };

  const handleClose = () => {
    setFighterName('');
    setClubName('');
    closeModals();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-gray-900">Добавить участника</h3>
          <button
            onClick={handleClose}
            className="text-gray-500 hover:text-gray-700"
            disabled={isLoading}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded text-red-600 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Имя участника <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={fighterName}
              onChange={(e) => setFighterName(e.target.value)}
              placeholder="Фамилия Имя"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isLoading}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Клуб (необязательно)
            </label>
            <input
              type="text"
              value={clubName}
              onChange={(e) => setClubName(e.target.value)}
              placeholder="Название клуба"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isLoading}
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              variant="primary"
              className="flex-1"
              disabled={isLoading}
            >
              {isLoading ? 'Добавление...' : 'Добавить'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleClose}
              disabled={isLoading}
            >
              Отмена
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
