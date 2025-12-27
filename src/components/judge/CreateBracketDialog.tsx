import { useState, useEffect } from 'react';
import { createEmptyBracket, getCachedBrackets } from '../../services/api';
import { Button } from '../ui/Button';
import { useToast } from '../../hooks/useToast';
import { useErrorHandler } from '../../utils/errorHandler';
import { useServerModeStore } from '../../stores/serverModeStore';

interface CreateBracketDialogProps {
  tournamentId: number;
  onClose: () => void;
  onSuccess: () => void;
}

interface Sport {
  id: number;
  name: string;
}

interface CharacteristicField {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}

const PARTICIPANT_COUNT_OPTIONS = [4, 8, 16, 32, 64];

export const CreateBracketDialog: React.FC<CreateBracketDialogProps> = ({
  tournamentId,
  onClose,
  onSuccess,
}) => {
  const [bracketName, setBracketName] = useState('');
  const [participantCount, setParticipantCount] = useState(8);
  const [isCreating, setIsCreating] = useState(false);
  const [sports, setSports] = useState<Sport[]>([]);
  const [selectedSportId, setSelectedSportId] = useState<number | null>(null);
  const [characteristics, setCharacteristics] = useState<CharacteristicField[]>([]);
  const [characteristicValues, setCharacteristicValues] = useState<Record<string, string>>({});
  const [gender, setGender] = useState<'male' | 'female' | 'mixed'>('male');
  const [isLoadingCharacteristics, setIsLoadingCharacteristics] = useState(false);
  const { showToast } = useToast();
  const { handleError } = useErrorHandler();
  const { serverUrl } = useServerModeStore();

  // Загрузить виды спорта
  useEffect(() => {
    const loadSports = async () => {
      try {
        const brackets = await getCachedBrackets(tournamentId, serverUrl);

        // Собрать уникальные виды спорта
        const uniqueSports = new Map<number, string>();
        brackets.forEach((bracket: any) => {
          if (bracket.sport_id && bracket.sport_name) {
            uniqueSports.set(bracket.sport_id, bracket.sport_name);
          }
        });

        const sportsList = Array.from(uniqueSports.entries()).map(([id, name]) => ({ id, name }));
        setSports(sportsList);

        // Выбрать первый вид спорта по умолчанию
        if (sportsList.length > 0) {
          setSelectedSportId(sportsList[0].id);
        }
      } catch (error) {
        console.error('[CreateBracketDialog] Failed to load sports:', error);
      }
    };

    loadSports();
  }, [tournamentId, serverUrl]);

  // Загрузить характеристики при выборе вида спорта
  useEffect(() => {
    if (selectedSportId === null) return;

    const loadCharacteristics = async () => {
      setIsLoadingCharacteristics(true);
      console.log('[CreateBracketDialog] Загрузка характеристик для вида спорта ID:', selectedSportId);

      try {
        const brackets = await getCachedBrackets(tournamentId, serverUrl);
        console.log('[CreateBracketDialog] Загружено сеток:', brackets.length);

        // Найти сетку с выбранным видом спорта
        const bracketWithSport = brackets.find(
          (b: any) => b.sport_id === selectedSportId && b.characteristics_schema
        );

        console.log('[CreateBracketDialog] Найдена сетка с schema:', !!bracketWithSport);

        if (bracketWithSport?.characteristics_schema) {
          console.log('[CreateBracketDialog] Схема характеристик:', bracketWithSport.characteristics_schema);

          // Отфильтровать только характеристики с use_as_category_tag: true
          const fields = bracketWithSport.characteristics_schema.filter(
            (field: any) => field.use_as_category_tag && field.options && Array.isArray(field.options)
          ) as CharacteristicField[];

          console.log('[CreateBracketDialog] Отфильтровано характеристик:', fields.length);
          fields.forEach((f: CharacteristicField) => console.log('  -', f.label, ':', f.options.length, 'опций'));

          setCharacteristics(fields);

          // Инициализировать значения первыми опциями
          const initialValues: Record<string, string> = {};
          fields.forEach((field: CharacteristicField) => {
            initialValues[field.key] = field.options[0]?.value || '';
          });
          setCharacteristicValues(initialValues);
        } else {
          console.log('[CreateBracketDialog] Характеристики не найдены для данного вида спорта');
          setCharacteristics([]);
          setCharacteristicValues({});
        }
      } catch (error) {
        console.error('[CreateBracketDialog] Failed to load characteristics:', error);
      } finally {
        setIsLoadingCharacteristics(false);
      }
    };

    loadCharacteristics();
  }, [selectedSportId, tournamentId, serverUrl]);

  const handleCreate = async () => {
    if (!bracketName.trim()) {
      showToast('Введите название сетки', 'error');
      return;
    }

    if (selectedSportId === null) {
      showToast('Выберите вид спорта', 'error');
      return;
    }

    const selectedSport = sports.find(s => s.id === selectedSportId);
    console.log('[CreateBracketDialog] Creating bracket:');
    console.log('  Турнир ID:', tournamentId);
    console.log('  Название сетки:', bracketName.trim());
    console.log('  Количество участников:', participantCount);
    console.log('  Вид спорта:', selectedSport?.name, '(ID:', selectedSportId, ')');
    console.log('  Пол:', gender);
    console.log('  Характеристики:', characteristicValues);
    console.log('  Количество характеристик:', Object.keys(characteristicValues).length);

    setIsCreating(true);
    try {
      const bracketId = await createEmptyBracket(
        {
          tournamentId,
          bracketName: bracketName.trim(),
          participantCount,
          sportId: selectedSportId,
          gender,
          characteristicValues,
        },
        serverUrl
      );

      console.log('[CreateBracketDialog] Bracket created with ID:', bracketId);
      showToast(`Сетка создана (ID: ${bracketId})`, 'success');
      onSuccess();
      onClose();
    } catch (error) {
      console.error('[CreateBracketDialog] Error creating bracket:', error);
      handleError(error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 my-8">
        <h2 className="text-2xl font-bold mb-4">Создать пустую сетку</h2>

        <div className="space-y-4">
          {/* Название сетки */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Название сетки
            </label>
            <input
              type="text"
              value={bracketName}
              onChange={(e) => setBracketName(e.target.value)}
              placeholder="Например: Юноши до 16 лет, вес до 50 кг"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>

          {/* Вид спорта */}
          {sports.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Вид спорта
              </label>
              <select
                value={selectedSportId || ''}
                onChange={(e) => setSelectedSportId(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {sports.map((sport) => (
                  <option key={sport.id} value={sport.id}>
                    {sport.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Пол */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Пол
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setGender('male')}
                className={`
                  px-4 py-2 rounded-md font-medium transition-colors
                  ${
                    gender === 'male'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }
                `}
              >
                Мужской
              </button>
              <button
                onClick={() => setGender('female')}
                className={`
                  px-4 py-2 rounded-md font-medium transition-colors
                  ${
                    gender === 'female'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }
                `}
              >
                Женский
              </button>
              <button
                onClick={() => setGender('mixed')}
                className={`
                  px-4 py-2 rounded-md font-medium transition-colors
                  ${
                    gender === 'mixed'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }
                `}
              >
                Смешанный
              </button>
            </div>
          </div>

          {/* Характеристики */}
          {selectedSportId !== null && (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">
                Характеристики
              </label>

              {isLoadingCharacteristics ? (
                <div className="text-sm text-gray-500 italic py-2">
                  Загрузка характеристик...
                </div>
              ) : characteristics.length > 0 ? (
                characteristics.map((field) => (
                  <div key={field.key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      {field.label}
                    </label>
                    <select
                      value={characteristicValues[field.key] || ''}
                      onChange={(e) =>
                        setCharacteristicValues((prev) => ({
                          ...prev,
                          [field.key]: e.target.value,
                        }))
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    >
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))
              ) : (
                <div className="text-sm text-gray-500 italic py-2">
                  Для этого вида спорта нет дополнительных характеристик
                </div>
              )}
            </div>
          )}

          {/* Количество участников */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Количество участников
            </label>
            <div className="grid grid-cols-5 gap-2">
              {PARTICIPANT_COUNT_OPTIONS.map((count) => (
                <button
                  key={count}
                  onClick={() => setParticipantCount(count)}
                  className={`
                    px-4 py-2 rounded-md font-medium transition-colors
                    ${
                      participantCount === count
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }
                  `}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          {/* Информация */}
          <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-800">
            <p>
              <strong>Тип сетки:</strong> Single Elimination
            </p>
            <p>
              <strong>Количество раундов:</strong> {Math.log2(participantCount)}
            </p>
            <p className="mt-2 text-xs text-blue-600">
              Сетка будет создана с пустыми матчами. Вы сможете добавить участников позже.
            </p>
          </div>

          {/* Кнопки */}
          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleCreate}
              disabled={isCreating || !bracketName.trim()}
              className="flex-1"
            >
              {isCreating ? 'Создание...' : 'Создать'}
            </Button>
            <Button onClick={onClose} variant="secondary" disabled={isCreating}>
              Отмена
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
