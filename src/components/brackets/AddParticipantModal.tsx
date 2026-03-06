import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useBracketEditorStore } from '../../stores/bracketEditorStore';
import { useAuthStore } from '../../stores/authStore';
import { useServerModeStore } from '../../stores/serverModeStore';
import { Button } from '../ui/Button';

interface FighterSuggestion {
  id: number;
  full_name: string;
  club_name: string | null;
  gender: string | null;
}

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
  const { mode, serverUrl } = useServerModeStore();

  const [fighterName, setFighterName] = useState('');
  const [clubName, setClubName] = useState('');
  const [fighterId, setFighterId] = useState<number | undefined>(undefined);
  const [suggestions, setSuggestions] = useState<FighterSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // Поиск при изменении имени
  useEffect(() => {
    if (fighterName.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        let results: FighterSuggestion[];
        if (mode === 'local-client' && serverUrl) {
          // Судья: запрос к локальному серверу админа
          const resp = await fetch(
            `${serverUrl}/api/v1/desktop/fighters/search?q=${encodeURIComponent(fighterName)}`,
            { headers: { 'Authorization': `Bearer ${user?.access_token ?? ''}` } }
          );
          results = resp.ok ? await resp.json() : [];
        } else {
          // Админ: читаем из локальной SQLite
          results = await invoke<FighterSuggestion[]>('search_fighters', { query: fighterName });
        }
        setSuggestions(results);
        setShowSuggestions(results.length > 0);
      } catch {
        setSuggestions([]);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [fighterName, mode, serverUrl, user?.access_token]);

  // Закрытие по клику вне списка
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!isAddParticipantModalOpen || !selectedMatch || !selectedSlot) return null;

  const handleSelectSuggestion = (f: FighterSuggestion) => {
    setFighterName(f.full_name);
    setClubName(f.club_name ?? '');
    setFighterId(f.id);
    setShowSuggestions(false);
  };

  const handleNameChange = (value: string) => {
    setFighterName(value);
    // Сброс выбранного ID если имя изменили вручную
    setFighterId(undefined);
  };

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
          fighter_id: fighterId,
          fighter_name: fighterName.trim(),
          club_name: clubName.trim() || undefined,
        },
        user?.role === 'referee' ? user.judge_name : undefined,
        user?.role === 'admin' ? user.user_id : undefined
      );

      setFighterName('');
      setClubName('');
      setFighterId(undefined);
      onParticipantAdded();
    } catch (error) {
      console.error('[AddParticipantModal] Ошибка при добавлении участника:', error);
    }
  };

  const handleClose = () => {
    setFighterName('');
    setClubName('');
    setFighterId(undefined);
    setSuggestions([]);
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
          <div className="relative" ref={suggestionsRef}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Имя участника <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={fighterName}
              onChange={(e) => handleNameChange(e.target.value)}
              onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
              placeholder="Фамилия Имя (от 3 символов)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isLoading}
              autoComplete="off"
              required
            />
            {fighterId && (
              <span className="absolute right-3 top-9 text-xs text-green-600">✓ из базы</span>
            )}
            {showSuggestions && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {suggestions.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => handleSelectSuggestion(f)}
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-0"
                  >
                    <div className="font-medium text-gray-900 text-sm">{f.full_name}</div>
                    {f.club_name && (
                      <div className="text-xs text-gray-500">{f.club_name}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
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
