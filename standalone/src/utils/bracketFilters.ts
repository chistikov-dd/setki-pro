import type { Bracket, CharacteristicSchemaField, Match } from '../types';
import { parseAgeRangeFromCategoryName } from './parseAgeFromCategoryName';

export type BracketStatusFilter = 'all' | 'not_started' | 'in_progress' | 'completed';

/**
 * Фильтр по текущей активной стадии сетки (см. getBracketCurrentStage) — независим
 * от BracketStatusFilter: сетка "в финале" может быть not_started (финал ещё не
 * начат) или in_progress (финал уже идёт), это не пересекается со статусом.
 */
export type BracketStageFilter = 'all' | 'semifinal' | 'final';

export interface BracketListFilters {
  searchQuery: string;
  sportId: number | 'all';
  gender: string | 'all';
  status: BracketStatusFilter;
  /** Нижняя граница диапазона фильтра по возрасту (лет) или null, если не задана. */
  ageFrom: number | null;
  /** Верхняя граница диапазона фильтра по возрасту (лет) или null, если не задана. */
  ageTo: number | null;
  /**
   * Динамические фильтры по характеристикам турнира (ключ характеристики -> выбранное
   * значение или 'all'). Пустой объект означает "все характеристики = все значения"
   * (фильтр неактивен). Значения характеристик берутся из bracket.characteristic_filters.
   */
  characteristics: Record<string, string | 'all'>;
  /** Фильтр по текущей активной стадии сетки (полуфинал/финал/все). */
  stage: BracketStageFilter;
}

export const DEFAULT_BRACKET_FILTERS: BracketListFilters = {
  searchQuery: '',
  sportId: 'all',
  gender: 'all',
  status: 'all',
  ageFrom: null,
  ageTo: null,
  characteristics: {},
  stage: 'all',
};

/**
 * Эффективный возрастной диапазон сетки для целей фильтрации/наличия данных: если у сетки
 * заполнены явные min_age/max_age (хотя бы одно из полей) — используем их как есть (не
 * подменяем распарсенным значением, даже частично). Если ОБА поля отсутствуют — пробуем
 * fallback-парсинг из category_name (см. parseAgeRangeFromCategoryName) — на реальных
 * турнирах с setki.pro min_age/max_age бывают не заполнены организатором, но возраст почти
 * всегда закодирован в самом названии категории.
 *
 * Не мутирует и не переопределяет исходные Bracket.min_age/max_age — только вычисляет
 * значение для использования внутри hasAnyAgeData/filterBrackets.
 */
export function getEffectiveAgeRange(bracket: Bracket): { min: number | null; max: number | null } {
  if (bracket.min_age != null || bracket.max_age != null) {
    return { min: bracket.min_age ?? null, max: bracket.max_age ?? null };
  }

  const parsed = parseAgeRangeFromCategoryName(bracket.category_name);
  if (parsed) {
    return { min: parsed.min, max: parsed.max };
  }

  return { min: null, max: null };
}

/**
 * Отфильтровать список сеток турнира по тексту поиска (название категории ИЛИ
 * имя участника во вложенных матчах), виду спорта и полу.
 *
 * В standalone-версии участники приходят прямо во вложенных bracket.matches
 * (без отдельного кэша participantsByBracket, как в основном проекте) — поэтому
 * поиск по участнику делается напрямую по match.participant1/2.full_name.
 */
export function filterBrackets(brackets: Bracket[], filters: BracketListFilters): Bracket[] {
  return brackets.filter((bracket) => {
    if (filters.sportId !== 'all' && bracket.sport_id !== filters.sportId) {
      return false;
    }

    if (filters.gender !== 'all' && (bracket.gender || '') !== filters.gender) {
      return false;
    }

    if (filters.status !== 'all' && bracket.status !== filters.status) {
      return false;
    }

    if (filters.ageFrom != null || filters.ageTo != null) {
      // Сетка проходит фильтр, только если её возрастной диапазон ТОЧНО совпадает с
      // заданными границами фильтра (а не просто пересекается с ним) — например,
      // фильтр "9-10" должен показывать только категорию "9-10 лет", а не "10-11".
      // Если задана только одна граница фильтра — проверяем точное совпадение именно
      // этой границы, вторая не ограничивается. Отсутствующая граница у самой сетки —
      // как "неизвестно", и в этом случае сетку не исключаем (снисходительны к
      // данным без возрастной информации).
      const effectiveAge = getEffectiveAgeRange(bracket);

      if (effectiveAge.min == null && effectiveAge.max == null) {
        // У сетки нет возрастных данных вообще (ни явных полей, ни распознаваемых в
        // названии) — не исключаем её из результатов.
      } else {
        if (filters.ageFrom != null && effectiveAge.min !== filters.ageFrom) {
          return false;
        }
        if (filters.ageTo != null && effectiveAge.max !== filters.ageTo) {
          return false;
        }
      }
    }

    if (filters.searchQuery.trim() !== '') {
      const query = filters.searchQuery.toLowerCase().trim();
      const categoryMatch = bracket.category_name.toLowerCase().includes(query);
      const participantMatch = bracket.matches?.some(
        (m) =>
          m.participant1?.full_name?.toLowerCase().includes(query) ||
          m.participant2?.full_name?.toLowerCase().includes(query)
      );
      if (!categoryMatch && !participantMatch) {
        return false;
      }
    }

    for (const [key, selectedValue] of Object.entries(filters.characteristics)) {
      if (selectedValue === 'all') continue;
      const hasMatchingCharacteristic = bracket.characteristic_filters?.some(
        (filter) => filter.key === key && String(filter.value).trim() === selectedValue
      );
      if (!hasMatchingCharacteristic) {
        return false;
      }
    }

    if (filters.stage !== 'all') {
      if (getBracketCurrentStage(bracket) !== filters.stage) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Получить уникальные виды спорта из списка сеток (id -> название).
 */
export function getUniqueSports(brackets: Bracket[]): Array<{ id: number; name: string }> {
  const sportsMap = new Map<number, string>();
  for (const bracket of brackets) {
    if (bracket.sport_id != null && bracket.sport_name) {
      sportsMap.set(bracket.sport_id, bracket.sport_name);
    }
  }
  return Array.from(sportsMap.entries()).map(([id, name]) => ({ id, name }));
}

/**
 * Получить уникальные значения пола из списка сеток.
 */
export function getUniqueGenders(brackets: Bracket[]): string[] {
  const genders = new Set<string>();
  for (const bracket of brackets) {
    if (bracket.gender) {
      genders.add(bracket.gender);
    }
  }
  return Array.from(genders);
}

/**
 * Есть ли хотя бы у одной сетки турнира данные о возрасте (min_age/max_age) —
 * используется, чтобы показывать фильтр по возрасту только когда он имеет смысл
 * (аналогично тому, как uniqueSports/uniqueGenders показываются только при наличии данных).
 */
export function hasAnyAgeData(brackets: Bracket[]): boolean {
  return brackets.some((bracket) => {
    const effective = getEffectiveAgeRange(bracket);
    return effective.min != null || effective.max != null;
  });
}

export function getGenderLabel(gender: string): string {
  switch (gender) {
    case 'male':
      return 'Мужчины';
    case 'female':
      return 'Женщины';
    case 'mixed':
      return 'Смешанные';
    default:
      return gender;
  }
}

/**
 * Человекочитаемая метка для значения фильтра по статусу сетки (включая 'all').
 */
export function getStatusFilterLabel(status: BracketStatusFilter): string {
  switch (status) {
    case 'all':
      return 'Все';
    case 'not_started':
      return 'Не начатые';
    case 'in_progress':
      return 'В процессе';
    case 'completed':
      return 'Завершённые';
    default:
      return status;
  }
}

/**
 * Получить список характеристик турнира, пригодных для фильтрации (use_as_category_tag === true
 * И есть options), взятых из characteristics_schema ПЕРВОЙ сетки турнира — схема считается
 * одинаковой для всех сеток одного турнира (тот же принцип, что в основном проекте, см.
 * desktop_setki/src/components/judge/BracketSelection.tsx). Дедуплицировано по field.key.
 */
export function getAvailableCharacteristics(brackets: Bracket[]): CharacteristicSchemaField[] {
  if (brackets.length === 0) return [];

  const schema = brackets[0]?.characteristics_schema;
  if (!schema || !Array.isArray(schema)) return [];

  const filtered = schema.filter((field) => field.use_as_category_tag && field.options);

  const uniqueByKey = new Map<string, CharacteristicSchemaField>();
  for (const field of filtered) {
    if (!uniqueByKey.has(field.key)) {
      uniqueByKey.set(field.key, field);
    }
  }

  return Array.from(uniqueByKey.values());
}

/**
 * Получить уникальные значения одной характеристики (по её key) среди всех сеток турнира —
 * собирается из bracket.characteristic_filters (не из schema.options, т.к. на конкретном
 * турнире может использоваться не весь набор опций схемы). Значения нормализуются через
 * String(...).trim() перед дедупликацией.
 */
export function getCharacteristicValues(brackets: Bracket[], key: string): string[] {
  const values = new Set<string>();
  for (const bracket of brackets) {
    if (!bracket.characteristic_filters || !Array.isArray(bracket.characteristic_filters)) continue;
    for (const filter of bracket.characteristic_filters) {
      if (filter.key === key) {
        values.add(String(filter.value).trim());
      }
    }
  }
  return Array.from(values);
}

/**
 * Определить текущую активную стадию сетки — стадию раунда, к которому относится
 * СЛЕДУЮЩИЙ несыгранный матч сетки. Использует ту же семантику roundsFromEnd, что и
 * getRoundName из bracketLayout.ts (0 = финал, 1 = полуфинал).
 *
 * Возвращает null, если у сетки нет матчей, нет незавершённых матчей (сетка полностью
 * сыграна — это отдельно покрывается статус-фильтром "Завершена"), либо следующий
 * несыгранный раунд дальше полуфинала (роли "Полуфинал"/"Финал" тут не применимы).
 *
 * TBD-заглушки (матчи будущих раундов, где ОБА участника ещё не определены победителями
 * предыдущих раундов) игнорируются при поиске "следующего несыгранного матча" — иначе
 * сетка с реально готовым к игре финалом никогда не покажет стадию "Финал", застряв на
 * вечно пустых будущих слотах. Матч с ХОТЯ БЫ ОДНИМ определившимся участником (второй
 * слот TBD, ждём победителя другого полуфинала) — это уже реальный "следующий матч",
 * не пропускается.
 */
export function getBracketCurrentStage(bracket: Bracket): 'final' | 'semifinal' | null {
  const matches = bracket.matches;
  if (!matches || matches.length === 0) return null;

  const maxRound = Math.max(...matches.map((m) => m.round_number));

  const isTbdStub = (m: Match) => !m.participant1 && !m.participant2;

  const nextUnplayedRounds = matches
    .filter((m) => m.status !== 'completed' && !isTbdStub(m))
    .map((m) => m.round_number);

  if (nextUnplayedRounds.length === 0) {
    // Либо сетка полностью сыграна, либо все незавершённые матчи — чистые TBD-заглушки
    // (в валидной сетке такого не должно быть, т.к. финал не может быть TBD-заглушкой
    // сам по себе после того как все реальные матчи сыграны, но на всякий случай не падаем).
    return null;
  }

  const nextRound = Math.min(...nextUnplayedRounds);
  const roundsFromEnd = maxRound - nextRound;

  if (roundsFromEnd === 0) return 'final';
  if (roundsFromEnd === 1) return 'semifinal';
  return null;
}

/**
 * Человекочитаемая метка для значения фильтра по стадии сетки (включая 'all').
 */
export function getStageFilterLabel(stage: BracketStageFilter): string {
  switch (stage) {
    case 'all':
      return 'Все стадии';
    case 'semifinal':
      return 'Полуфиналы';
    case 'final':
      return 'Финалы';
    default:
      return stage;
  }
}
