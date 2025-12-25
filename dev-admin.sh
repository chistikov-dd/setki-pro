#!/bin/bash
# Запуск SETKI.PRO KEEPER в режиме АДМИНА для тестирования

echo "🔧 Запуск SETKI.PRO KEEPER - Профиль: АДМИН"
echo "=========================================="
echo "Данные будут храниться в: ~/.setki-keeper-admin/"

# Устанавливаем переменную окружения для изменения директории данных
export SETKI_DATA_DIR="$HOME/.setki-keeper-admin"

# Порты для Vite dev server
export VITE_PORT=1420
export VITE_HMR_PORT=1421
echo "Порт Vite: $VITE_PORT (HMR: $VITE_HMR_PORT)"
echo ""

# Создаем директорию если не существует
mkdir -p "$SETKI_DATA_DIR/data"

echo "✅ Директория данных создана: $SETKI_DATA_DIR"
echo "🚀 Запуск приложения..."
echo ""

# Запускаем Tauri в dev режиме
npm run tauri dev
