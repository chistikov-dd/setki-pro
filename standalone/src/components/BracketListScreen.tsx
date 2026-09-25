import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import type { Bracket, Category } from '../types';

interface BracketListScreenProps {
  category: Category;
  brackets: Bracket[];
  onSelectBracket: (bracket: Bracket) => void;
  onBack: () => void;
}

const statusLabels: Record<Bracket['status'], string> = {
  not_started: 'Не начата',
  in_progress: 'Идёт',
  completed: 'Завершена',
};

export function BracketListScreen({ category, brackets, onSelectBracket, onBack }: BracketListScreenProps) {
  return (
    <div className="h-screen w-full flex flex-col bg-gradient-to-br from-gray-50 via-white to-gray-100">
      <header className="px-6 py-4 border-b border-gray-300 flex items-center justify-between bg-white/60">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{category.name}</h1>
          <p className="text-sm text-gray-500">Выберите сетку</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Категории
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {brackets.length === 0 ? (
          <p className="text-gray-500 text-center mt-12">В этой категории нет сеток</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {brackets.map((bracket) => (
              <Card
                key={bracket.id}
                variant="bordered"
                hoverable
                interactive
                onClick={() => onSelectBracket(bracket)}
              >
                <CardContent>
                  <h2 className="text-base font-semibold text-gray-900 mb-1">
                    Сетка #{bracket.id}
                  </h2>
                  <p className="text-sm text-gray-500">{statusLabels[bracket.status]}</p>
                  {bracket.sport_name && (
                    <p className="text-xs text-gray-400 mt-1">{bracket.sport_name}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
