import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface EditParticipantModalProps {
  open: boolean;
  initialName?: string;
  initialClub?: string;
  onConfirm: (fullName: string, clubName: string) => void;
  onClose: () => void;
}

/**
 * Простая модалка добавления/замены участника в слоте матча (offline —
 * без поиска по базе бойцов, просто произвольные имя+клуб).
 */
export function EditParticipantModal({ open, initialName, initialClub, onConfirm, onClose }: EditParticipantModalProps) {
  const [name, setName] = useState(initialName || '');
  const [club, setClub] = useState(initialClub || '');

  const handleSubmit = () => {
    if (!name.trim()) return;
    onConfirm(name.trim(), club.trim());
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{initialName ? 'Заменить участника' : 'Добавить участника'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Имя участника</label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Иванов Иван"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Клуб (опционально)</label>
            <Input
              value={club}
              onChange={(e) => setClub(e.target.value)}
              placeholder="Клуб"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
            />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <Button variant="primary" className="flex-1" onClick={handleSubmit} disabled={!name.trim()}>
            Сохранить
          </Button>
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Отмена
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
