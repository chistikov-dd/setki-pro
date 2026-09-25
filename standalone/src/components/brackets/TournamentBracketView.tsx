import { useMemo, useState } from 'react';
import { MatchCard, type ParticipantSlot } from './MatchCard';
import { EditParticipantModal } from './EditParticipantModal';
import { Button } from '../ui/Button';
import { computeBracketLayout, getRoundName, CARD_WIDTH } from '../../utils/bracketLayout';
import { setMatchParticipant, clearMatchParticipant, swapMatchParticipants } from '../../services/api';
import type { Match } from '../../types';

interface TournamentBracketViewProps {
  matches: Match[];
  onOpenMatch: (matchId: number) => void;
  onMatchesChanged?: () => void;
}

interface SelectedSlot {
  matchId: number;
  slot: ParticipantSlot;
}

/**
 * Вид турнирной сетки: раунды расположены по горизонтали, матчи внутри
 * раунда — по вертикали с центрированием относительно родительской пары
 * (классическая раскладка "скобки"), карточки соединены SVG-линиями.
 *
 * Также содержит режим редактирования участников (click-to-place):
 * администратор/судья может кликнуть по участнику, затем по целевому слоту —
 * если целевой слот занят, участники меняются местами, если пуст — участник
 * перемещается. Редактировать можно только матчи со статусом 'scheduled'.
 */
export function TournamentBracketView({ matches, onOpenMatch, onMatchesChanged }: TournamentBracketViewProps) {
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);
  const [modalTarget, setModalTarget] = useState<{ matchId: number; slot: ParticipantSlot } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const layout = useMemo(() => computeBracketLayout(matches), [matches]);
  const maxRound = layout.rounds.length > 0 ? layout.rounds[layout.rounds.length - 1].roundNumber : 0;

  const findMatch = (matchId: number) => matches.find((m) => m.id === matchId);

  const handleSlotClick = async (matchId: number, slot: ParticipantSlot) => {
    setErrorMessage(null);
    const match = findMatch(matchId);
    if (!match) return;
    const participant = slot === 1 ? match.participant1 : match.participant2;

    if (!selectedSlot) {
      // Первый клик: выбираем участника (только если слот занят — иначе сразу открываем "добавить")
      if (participant) {
        setSelectedSlot({ matchId, slot });
      } else {
        setModalTarget({ matchId, slot });
      }
      return;
    }

    // Второй клик — тот же слот: отмена выбора
    if (selectedSlot.matchId === matchId && selectedSlot.slot === slot) {
      setSelectedSlot(null);
      return;
    }

    // Второй клик — целевой слот: swap/move
    try {
      await swapMatchParticipants(selectedSlot.matchId, selectedSlot.slot, matchId, slot);
      onMatchesChanged?.();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSelectedSlot(null);
    }
  };

  const handleAddParticipant = (matchId: number, slot: ParticipantSlot) => {
    setErrorMessage(null);
    setModalTarget({ matchId, slot });
  };

  const handleRemoveParticipant = async (matchId: number, slot: ParticipantSlot) => {
    setErrorMessage(null);
    try {
      await clearMatchParticipant(matchId, slot);
      onMatchesChanged?.();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleModalConfirm = async (fullName: string, clubName: string) => {
    if (!modalTarget) return;
    try {
      await setMatchParticipant(modalTarget.matchId, modalTarget.slot, fullName, clubName);
      onMatchesChanged?.();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setModalTarget(null);
    }
  };

  const modalMatch = modalTarget ? findMatch(modalTarget.matchId) : null;
  const modalParticipant = modalMatch
    ? modalTarget?.slot === 1
      ? modalMatch.participant1
      : modalMatch.participant2
    : undefined;

  if (matches.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        В этой сетке пока нет матчей
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-auto p-6">
      <div className="flex items-center justify-between mb-4 sticky left-0">
        <Button
          variant={isEditMode ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => {
            setIsEditMode((prev) => !prev);
            setSelectedSlot(null);
            setErrorMessage(null);
          }}
        >
          {isEditMode ? 'Готово' : 'Редактировать сетку'}
        </Button>
        {isEditMode && (
          <p className="text-sm text-gray-500 ml-3">
            Кликните по участнику, затем по целевому слоту, чтобы переместить или поменять местами. Редактировать можно только ещё не начатые матчи.
          </p>
        )}
      </div>

      {errorMessage && (
        <div className="mb-4 px-4 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {errorMessage}
        </div>
      )}

      <div
        className="relative"
        style={{
          width: `${layout.totalWidth}px`,
          height: `${layout.totalHeight}px`,
          minHeight: '300px',
        }}
      >
        <svg
          className="absolute top-0 left-0 pointer-events-none"
          style={{ width: '100%', height: '100%', overflow: 'visible' }}
        >
          {layout.lines.map((d, i) => (
            <path key={i} d={d} stroke="#4b5563" strokeWidth="2" fill="none" opacity="0.8" />
          ))}
        </svg>

        {layout.rounds.map((round) => {
          const x = layout.positions.find((p) => p.match.round_number === round.roundNumber)?.x ?? 0;
          return (
            <div
              key={round.roundNumber}
              className="absolute text-center text-sm font-semibold text-gray-600"
              style={{ left: `${x}px`, top: '20px', width: `${CARD_WIDTH}px` }}
            >
              {getRoundName(round.roundNumber, maxRound)}
            </div>
          );
        })}

        {layout.positions.map(({ match, x, y }) => (
          <div key={match.id} className="absolute" style={{ left: `${x}px`, top: `${y}px` }}>
            <MatchCard
              match={match}
              width={CARD_WIDTH}
              onOpenMatch={onOpenMatch}
              isEditMode={isEditMode}
              selectedSlot={selectedSlot}
              onSlotClick={handleSlotClick}
              onAddParticipant={handleAddParticipant}
              onRemoveParticipant={handleRemoveParticipant}
            />
          </div>
        ))}
      </div>

      <EditParticipantModal
        open={!!modalTarget}
        initialName={modalParticipant?.full_name}
        initialClub={modalParticipant?.club_name}
        onConfirm={handleModalConfirm}
        onClose={() => setModalTarget(null)}
      />
    </div>
  );
}
