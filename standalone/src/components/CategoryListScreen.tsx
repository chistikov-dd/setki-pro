import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import type { Category, Tournament } from '../types';

interface CategoryListScreenProps {
  tournament: Tournament;
  categories: Category[];
  onSelectCategory: (category: Category) => void;
  onReopenFile: () => void;
}

export function CategoryListScreen({ tournament, categories, onSelectCategory, onReopenFile }: CategoryListScreenProps) {
  return (
    <div className="h-screen w-full flex flex-col bg-gradient-to-br from-gray-50 via-white to-gray-100">
      <header className="px-6 py-4 border-b border-gray-300 flex items-center justify-between bg-white/60">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{tournament.title}</h1>
          <p className="text-sm text-gray-500">Выберите категорию</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onReopenFile}>
          Открыть другой файл
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {categories.length === 0 ? (
          <p className="text-gray-500 text-center mt-12">В этом турнире нет категорий</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {categories.map((category) => (
              <Card
                key={category.id ?? category.name}
                variant="bordered"
                hoverable
                interactive
                onClick={() => onSelectCategory(category)}
              >
                <CardContent>
                  <h2 className="text-base font-semibold text-gray-900">{category.name}</h2>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
