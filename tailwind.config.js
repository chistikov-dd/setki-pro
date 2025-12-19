/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Custom breakpoints для судейского приложения
      screens: {
        'hd': '1366px',    // HD минимум для судейских столов
        'fhd': '1920px',   // Full HD - основное разрешение
        '2k': '2560px',    // 2K/QHD для публичных табло
        '4k': '3840px',    // 4K/UHD для больших экранов
      },

      // Цветовая палитра проекта
      colors: {
        // Цвета бойцов (для удобства)
        'fighter-red': {
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          900: '#7f1d1d',
        },
        'fighter-blue': {
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
      },

      // Spacing для компактных режимов
      spacing: {
        'safe': '0.5rem',      // 8px - минимальный безопасный padding
        'compact': '0.75rem',   // 12px - компактный режим
        'comfortable': '1.5rem', // 24px - комфортный режим
      },

      // Font sizes для судейских панелей
      fontSize: {
        // Размеры для имён участников
        'participant-sm': ['1.25rem', { lineHeight: '1.2' }],  // 20px
        'participant-md': ['1.875rem', { lineHeight: '1.2' }], // 30px
        'participant-lg': ['3rem', { lineHeight: '1.1' }],     // 48px

        // Размеры для счёта
        'score-sm': ['2.25rem', { lineHeight: '1' }],  // 36px
        'score-md': ['3.75rem', { lineHeight: '1' }],  // 60px
        'score-lg': ['6rem', { lineHeight: '1' }],     // 96px

        // Размеры для таймера
        'timer-sm': ['3.75rem', { lineHeight: '1' }],   // 60px
        'timer-md': ['6.25rem', { lineHeight: '1' }],   // 100px
        'timer-lg': ['11.25rem', { lineHeight: '1' }],  // 180px
        'timer-xl': ['12.5rem', { lineHeight: '1' }],   // 200px
      },

      // Высоты для scoring buttons
      height: {
        'btn-compact': '2.5rem',    // 40px
        'btn-comfortable': '3.5rem', // 56px
        'btn-large': '4rem',        // 64px
      },

      // Анимации для судейского интерфейса (только триггерные, без постоянных)
      animation: {
        'score-pulse': 'pulse 0.3s ease-in-out', // Только при добавлении балла
        'warning-shake': 'shake 0.5s ease-in-out', // Только при предупреждении
        'slide-in': 'slideIn 0.3s ease-out', // Только для Toast уведомлений
      },

      keyframes: {
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-4px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(4px)' },
        },
        slideIn: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
