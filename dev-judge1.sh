#!/bin/bash
# Запуск SETKI.PRO KEEPER в режиме СУДЬИ 1 для тестирования

echo "🔧 Запуск SETKI.PRO KEEPER - Профиль: СУДЬЯ 1"
echo "============================================"
echo "Данные будут храниться в: ~/.setki-keeper-judge1/"

# Устанавливаем переменную окружения для изменения директории данных
export SETKI_DATA_DIR="$HOME/.setki-keeper-judge1"

# Порты для Vite dev server (отличаются от админа!)
export VITE_PORT=1430
export VITE_HMR_PORT=1431
echo "Порт Vite: $VITE_PORT (HMR: $VITE_HMR_PORT)"
echo ""

# Создаем директорию если не существует
mkdir -p "$SETKI_DATA_DIR/data"

echo "✅ Директория данных создана: $SETKI_DATA_DIR"
echo "🚀 Запуск приложения..."
echo ""

# Запускаем Tauri в dev режиме
npm run tauri dev
