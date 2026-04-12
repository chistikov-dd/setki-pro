import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useServerModeStore } from '../../stores/serverModeStore';
import { getSecretaryParticipants, getSecretaryStats, confirmSecretaryParticipant } from '../../services/api';
import type { SecretaryParticipant, SecretaryStats } from '../../types';
import { useToast } from '../../hooks/useToast';
import { Toast } from '../ui/Toast';

// Число лет со склонением
function formatAge(birthDate: string): string {
  if (!birthDate) return '';
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  if (age < 0) return '';
  const mod10 = age % 10;
  const mod100 = age % 100;
  let suffix = 'лет';
  if (mod100 < 11 || mod100 > 14) {
    if (mod10 === 1) suffix = 'год';
    else if (mod10 >= 2 && mod10 <= 4) suffix = 'года';
  }
  return `${age} ${suffix}`;
}

// Форматирование даты рождения
function formatBirthDate(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

// Статус оплаты
function PaymentBadge({ status }: { status: string }) {
  if (status === 'paid' || status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        Оплачено
      </span>
    );
  }
  if (status === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500 border border-gray-200">
        Отменена
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700 border border-yellow-200">
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      Ожидает оплаты
    </span>
  );
}

export const SecretaryDashboard: React.FC = () => {
  const { user, logout } = useAuthStore();
  const { serverUrl } = useServerModeStore();
  const { toasts, showToast } = useToast();

  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SecretaryParticipant[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selected, setSelected] = useState<SecretaryParticipant | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [stats, setStats] = useState<SecretaryStats | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<number | null>(null);

  const tournamentId = user?.tournament_id;
  const accessToken = user?.access_token ?? '';
  const effectiveServerUrl = serverUrl ?? '';

  // Загрузить статистику
  const loadStats = useCallback(async () => {
    if (!tournamentId || !effectiveServerUrl) return;
    try {
      const s = await getSecretaryStats({
        tournamentId,
        serverUrl: effectiveServerUrl,
        accessToken,
      });
      setStats(s);
    } catch {
      // тихая ошибка
    }
  }, [tournamentId, effectiveServerUrl, accessToken]);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 15000); // обновлять каждые 15с
    return () => clearInterval(interval);
  }, [loadStats]);

  // Поиск с debounce
  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    if (search.trim().length < 3) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    searchTimeout.current = window.setTimeout(async () => {
      if (!tournamentId || !effectiveServerUrl) return;
      setIsSearching(true);
      try {
        const results = await getSecretaryParticipants({
          tournamentId,
          search: search.trim(),
          serverUrl: effectiveServerUrl,
          accessToken,
        });
        setSearchResults(results);
        setShowDropdown(results.length > 0);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [search, tournamentId, effectiveServerUrl, accessToken]);

  // Закрыть dropdown при клике снаружи
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        searchRef.current && !searchRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSelectParticipant = (p: SecretaryParticipant) => {
    setSelected(p);
    setShowDropdown(false);
    setSearch(p.full_name);
  };

  const handleConfirm = async () => {
    if (!selected || !tournamentId || !effectiveServerUrl) return;
    setIsConfirming(true);
    try {
      await confirmSecretaryParticipant({
        fighterId: selected.fighter_id,
        tournamentId,
        serverUrl: effectiveServerUrl,
        accessToken,
      });
      setSelected({ ...selected, is_confirmed: true });
      showToast(`${selected.full_name} — допущен к соревнованиям`, 'success', 3000);
      loadStats();
    } catch (e) {
      showToast('Ошибка подтверждения. Попробуйте ещё раз.', 'error', 3000);
    } finally {
      setIsConfirming(false);
    }
  };

  const handleSearchClear = () => {
    setSearch('');
    setSelected(null);
    setSearchResults([]);
    setShowDropdown(false);
    searchRef.current?.focus();
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Toast уведомления */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(t => (
          <Toast
            key={t.id}
            message={t.message}
            type={t.type}
            duration={t.duration}
            onClose={() => {}}
          />
        ))}
      </div>

      {/* Шапка */}
      <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          {/* Левая часть: название */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-teal-50 border border-teal-200 shrink-0">
              <svg className="w-6 h-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="font-bold text-gray-900 text-base truncate">
                Взвешивание и регистрация
              </div>
              {user?.judge_name && (
                <div className="text-xs text-gray-500 truncate">{user.judge_name}</div>
              )}
            </div>
          </div>

          {/* Центр: счётчик */}
          {stats && (
            <div className="flex flex-col items-center shrink-0">
              <div className="text-2xl font-black text-gray-900 leading-none">
                {stats.confirmed}
                <span className="text-gray-400 font-normal text-lg">/{stats.total}</span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">допущено</div>
            </div>
          )}

          {/* Правая часть: выход */}
          <button
            onClick={logout}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            <span className="hidden sm:inline">Выйти</span>
          </button>
        </div>

        {/* По видам спорта */}
        {stats && stats.by_sport.length > 0 && (
          <div className="max-w-4xl mx-auto mt-2 flex gap-3 flex-wrap">
            {stats.by_sport.map(s => (
              <div key={s.sport_name} className="flex items-center gap-1.5 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-full px-3 py-1">
                <span className="font-medium text-gray-800">{s.sport_name}</span>
                <span className="text-teal-600 font-semibold">{s.confirmed}/{s.total}</span>
              </div>
            ))}
          </div>
        )}
      </header>

      {/* Основной контент */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Строка поиска */}
        <div className="relative">
          <div className="flex items-center gap-2 bg-white border-2 border-gray-200 rounded-xl px-4 py-3 focus-within:border-teal-500 transition-colors shadow-sm">
            {isSearching ? (
              <svg className="w-5 h-5 text-teal-500 animate-spin shrink-0" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            )}
            <input
              ref={searchRef}
              type="text"
              placeholder="Введите ФИО участника (минимум 3 символа)..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
              className="flex-1 bg-transparent outline-none text-gray-900 text-base placeholder-gray-400"
              autoComplete="off"
            />
            {search && (
              <button
                onClick={handleSearchClear}
                className="shrink-0 p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Подсказка при коротком вводе */}
          {search.length > 0 && search.length < 3 && (
            <p className="mt-1.5 text-xs text-gray-400 px-1">Введите ещё {3 - search.length} символ(а)...</p>
          )}

          {/* Выпадающий список результатов */}
          {showDropdown && searchResults.length > 0 && (
            <div
              ref={dropdownRef}
              className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-gray-200 shadow-xl z-30 max-h-72 overflow-y-auto"
            >
              {searchResults.map(p => (
                <button
                  key={p.fighter_id}
                  onClick={() => handleSelectParticipant(p)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0"
                >
                  {/* Индикатор статуса */}
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${p.is_confirmed ? 'bg-green-400' : 'bg-red-400'}`} />
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900 text-sm truncate">{p.full_name}</div>
                    <div className="text-xs text-gray-500 truncate">{p.club_name || '—'}</div>
                  </div>
                  {p.is_confirmed && (
                    <div className="ml-auto shrink-0">
                      <span className="text-xs text-green-600 font-medium">Допущен</span>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Нет результатов */}
          {showDropdown && searchResults.length === 0 && !isSearching && search.length >= 3 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl border border-gray-200 shadow-xl z-30 px-4 py-3 text-sm text-gray-500">
              Участники не найдены
            </div>
          )}
        </div>

        {/* Карточка выбранного участника */}
        {selected ? (
          <ParticipantCard
            participant={selected}
            onConfirm={handleConfirm}
            isConfirming={isConfirming}
            serverUrl={effectiveServerUrl}
            tournamentId={tournamentId ?? 0}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <svg className="w-16 h-16 mb-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-base font-medium text-gray-500">Найдите участника по ФИО</p>
            <p className="text-sm text-gray-400 mt-1">Введите минимум 3 символа в поле поиска</p>
          </div>
        )}
      </main>
    </div>
  );
};

// ====== Карточка участника ======

interface ParticipantCardProps {
  participant: SecretaryParticipant;
  onConfirm: () => void;
  isConfirming: boolean;
  serverUrl: string;
  tournamentId: number;
}

const ParticipantCard: React.FC<ParticipantCardProps> = ({
  participant, onConfirm, isConfirming, serverUrl, tournamentId
}) => {
  const [openDocUrl, setOpenDocUrl] = useState<string | null>(null);

  const age = formatAge(participant.birth_date);
  const birthDateFormatted = formatBirthDate(participant.birth_date);

  const handleOpenDoc = (url: string) => {
    // Если URL — имя файла (без http), строим путь к LAN-серверу
    const fullUrl = url.startsWith('http')
      ? url
      : `${serverUrl}/api/v1/secretary/docs/${tournamentId}/${url}`;
    setOpenDocUrl(fullUrl);
  };

  return (
    <div className="bg-white rounded-2xl border-2 border-gray-200 shadow-sm overflow-hidden">
      {/* Статус-полоска */}
      <div className={`h-1.5 w-full ${participant.is_confirmed ? 'bg-green-400' : 'bg-red-400'}`} />

      <div className="p-5 sm:p-6 space-y-5">
        {/* Основная информация */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-1">{participant.full_name}</h2>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                {participant.club_name || 'Клуб не указан'}
              </span>
              {participant.birth_date && (
                <span className="flex items-center gap-1">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {birthDateFormatted}{age ? ` (${age})` : ''}
                </span>
              )}
              {participant.declared_weight != null && (
                <span className="flex items-center gap-1">
                  <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
                  </svg>
                  {participant.declared_weight} кг
                </span>
              )}
            </div>
          </div>

          {/* Статус допуска */}
          {participant.is_confirmed ? (
            <div className="shrink-0 flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2">
              <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-semibold text-green-700">Допущен</span>
            </div>
          ) : (
            <div className="shrink-0 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2">
              <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-semibold text-red-600">Не допущен</span>
            </div>
          )}
        </div>

        {/* Заявки */}
        {participant.entries.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Заявки</h3>
            <div className="space-y-2">
              {participant.entries.map(entry => (
                <div key={entry.id} className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 text-sm truncate">{entry.category_name}</div>
                    <div className="text-xs text-gray-500">{entry.sport_name}</div>
                  </div>
                  <PaymentBadge status={entry.payment_status || entry.status} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Документы */}
        {participant.entries.some(e => e.documents && e.documents.length > 0) && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Документы</h3>
            <div className="flex flex-wrap gap-2">
              {participant.entries.flatMap(e => e.documents || []).map(doc => (
                <button
                  key={doc.id}
                  onClick={() => handleOpenDoc(doc.url)}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  {doc.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Кнопка подтверждения */}
        {!participant.is_confirmed && (
          <button
            onClick={onConfirm}
            disabled={isConfirming}
            className="w-full flex items-center justify-center gap-3 bg-teal-500 hover:bg-teal-600 disabled:bg-teal-300 text-white font-bold text-base rounded-xl px-6 py-4 transition-colors shadow-sm"
          >
            {isConfirming ? (
              <>
                <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Подтверждение...
              </>
            ) : (
              <>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                Подтвердить присутствие
              </>
            )}
          </button>
        )}
      </div>

      {/* Просмотр документа */}
      {openDocUrl && (
        <DocumentViewer url={openDocUrl} onClose={() => setOpenDocUrl(null)} />
      )}
    </div>
  );
};

// ====== Просмотр документа ======

interface DocumentViewerProps {
  url: string;
  onClose: () => void;
}

const DocumentViewer: React.FC<DocumentViewerProps> = ({ url, onClose }) => {
  const isPdf = url.toLowerCase().includes('.pdf');

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80" onClick={onClose}>
      {/* Шапка */}
      <div
        className="flex items-center justify-between px-4 py-3 bg-gray-900 shrink-0"
        onClick={e => e.stopPropagation()}
      >
        <span className="text-white text-sm font-medium truncate max-w-xs">{url.split('/').pop()}</span>
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-gray-300 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          Закрыть
        </button>
      </div>

      {/* Содержимое */}
      <div className="flex-1 overflow-auto" onClick={e => e.stopPropagation()}>
        {isPdf ? (
          <iframe
            src={url}
            className="w-full h-full border-0"
            title="Документ"
          />
        ) : (
          <div className="flex items-center justify-center h-full p-4">
            <img
              src={url}
              alt="Документ"
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            />
          </div>
        )}
      </div>
    </div>
  );
};
