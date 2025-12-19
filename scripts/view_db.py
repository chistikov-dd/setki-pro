#!/usr/bin/env python3
"""
Скрипт для просмотра содержимого SQLite базы данных SETKI Desktop
"""

import sqlite3
import os
from pathlib import Path

# Путь к БД
DB_PATH = Path.home() / ".local/share/com.chistikov.tauri-app/setki.db"

def print_separator(title=""):
    """Красивый разделитель"""
    if title:
        print(f"\n{'='*60}")
        print(f"  {title}")
        print('='*60)
    else:
        print('-'*60)

def view_database():
    """Просмотр всех таблиц и данных"""

    if not DB_PATH.exists():
        print(f"❌ База данных не найдена: {DB_PATH}")
        return

    print(f"📊 База данных: {DB_PATH}")
    print(f"📦 Размер: {DB_PATH.stat().st_size / 1024:.2f} KB")

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()

        # Получить список таблиц
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
        tables = cursor.fetchall()

        print_separator("СПИСОК ТАБЛИЦ")
        for i, (table_name,) in enumerate(tables, 1):
            cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
            count = cursor.fetchone()[0]
            print(f"{i}. {table_name} ({count} записей)")

        # Показать содержимое каждой таблицы
        for (table_name,) in tables:
            print_separator(f"ТАБЛИЦА: {table_name}")

            # Получить структуру
            cursor.execute(f"PRAGMA table_info({table_name})")
            columns = cursor.fetchall()
            col_names = [col[1] for col in columns]

            print("Колонки:", ", ".join(col_names))
            print_separator()

            # Получить данные
            cursor.execute(f"SELECT * FROM {table_name}")
            rows = cursor.fetchall()

            if rows:
                # Заголовки
                print(" | ".join(f"{name:20}" for name in col_names))
                print("-" * (len(col_names) * 22))

                # Данные
                for row in rows:
                    formatted_row = []
                    for val in row:
                        if val is None:
                            formatted_row.append("NULL")
                        elif isinstance(val, str) and len(val) > 20:
                            formatted_row.append(val[:17] + "...")
                        else:
                            formatted_row.append(str(val))
                    print(" | ".join(f"{val:20}" for val in formatted_row))
            else:
                print("(пусто)")

        conn.close()
        print_separator("ЗАВЕРШЕНО")

    except sqlite3.Error as e:
        print(f"❌ Ошибка SQLite: {e}")
    except Exception as e:
        print(f"❌ Ошибка: {e}")

if __name__ == "__main__":
    view_database()
