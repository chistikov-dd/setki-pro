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

export const CreateBracketDialog: React.FC<CreateBracketDialogProps> = ({
  tournamentId,
  onClose,
  onSuccess,
}) => {
  const [bracketName, setBracketName] = useState('');
  const [participantCount] = useState(16); // Всегда 16 участников
  const [isCreating, setIsCreating] = useState(false);
  const [sports, setSports] = useState<Sport[]>([]);
  const [selectedSportId, setSelectedSportId] = useState<number | null>(null);
  const [characteristics, setCharacteristics] = useState<CharacteristicField[]>([]);
  const [characteristicValues, setCharacteristicValues] = useState<Record<string, string>>({});
  const [gender, setGender] = useState<'male' | 'female' | 'mixed'>('male');
  const [minAge, setMinAge] = useState<number | ''>('');
  const [maxAge, setMaxAge] = useState<number | ''>('');
  const [minWeight, setMinWeight] = useState<number | ''>('');
  const [maxWeight, setMaxWeight] = useState<number | ''>('');
  const [isLoadingCharacteristics, setIsLoadingCharacteristics] = useState(false);
  const { showToast } = useToast();
  const { handleError } = useErrorHandler();
  const { mode, serverUrl: rawServerUrl } = useServerModeStore();
  // Используем serverUrl только если режим local-client (как в BracketSelection)
  const serverUrl = mode === 'local-client' ? rawServerUrl : null;

  console.log('[CreateBracketDialog] Текущий режим:', mode);
  console.log('[CreateBracketDialog] Raw serverUrl:', rawServerUrl);
  console.log('[CreateBracketDialog] Финальный serverUrl:', serverUrl);

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
    console.log('[CreateBracketDialog] ========== СОЗДАНИЕ СЕТКИ ==========');
    console.log('[CreateBracketDialog] Турнир ID:', tournamentId);
    console.log('[CreateBracketDialog] Название сетки:', bracketName.trim());
    console.log('[CreateBracketDialog] Количество участников:', participantCount);
    console.log('[CreateBracketDialog] Вид спорта:', selectedSport?.name, '(ID:', selectedSportId, ')');
    console.log('[CreateBracketDialog] Пол:', gender);
    console.log('[CreateBracketDialog] Характеристики:', characteristicValues);
    console.log('[CreateBracketDialog] serverUrl для создания:', serverUrl);
    console.log('[CreateBracketDialog] Режим работы:', mode);

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
          minAge: minAge || undefined,
          maxAge: maxAge || undefined,
          minWeight: minWeight || undefined,
          maxWeight: maxWeight || undefined,
        },
        serverUrl
      );

      console.log('[CreateBracketDialog] ✅ Сетка создана с ID:', bracketId);
      showToast(`Сетка создана (ID: ${bracketId})`, 'success');

      // Даём время на сохранение данных в БД перед перезагрузкой списка
      console.log('[CreateBracketDialog] Ждём 300ms перед вызовом onSuccess...');
      setTimeout(() => {
        console.log('[CreateBracketDialog] Вызываем onSuccess() и onClose()');
        onSuccess();
        onClose();
      }, 300);
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
            <div className="grid grid-cols-2 gap-2">
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
            </div>
          </div>

          {/* Возраст */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Возраст (опционально)
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">От (лет)</label>
                <input
                  type="number"
                  value={minAge}
                  onChange={(e) => setMinAge(e.target.value ? Number(e.target.value) : '')}
                  placeholder="Мин"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">До (лет)</label>
                <input
                  type="number"
                  value={maxAge}
                  onChange={(e) => setMaxAge(e.target.value ? Number(e.target.value) : '')}
                  placeholder="Макс"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min="0"
                />
              </div>
            </div>
          </div>

          {/* Вес */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Вес (опционально)
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">От (кг)</label>
                <input
                  type="number"
                  value={minWeight}
                  onChange={(e) => setMinWeight(e.target.value ? Number(e.target.value) : '')}
                  placeholder="Мин"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">До (кг)</label>
                <input
                  type="number"
                  value={maxWeight}
                  onChange={(e) => setMaxWeight(e.target.value ? Number(e.target.value) : '')}
                  placeholder="Макс"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min="0"
                />
              </div>
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
