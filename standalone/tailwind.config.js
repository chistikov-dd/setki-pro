/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      screens: {
        'hd': '1366px',
        'fhd': '1920px',
        '2k': '2560px',
        '4k': '3840px',
      },

      colors: {
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

      spacing: {
        'safe': '0.5rem',
        'compact': '0.75rem',
        'comfortable': '1.5rem',
      },

      fontSize: {
        'participant-sm': ['1.25rem', { lineHeight: '1.2' }],
        'participant-md': ['1.875rem', { lineHeight: '1.2' }],
        'participant-lg': ['3rem', { lineHeight: '1.1' }],

        'score-sm': ['2.25rem', { lineHeight: '1' }],
        'score-md': ['3.75rem', { lineHeight: '1' }],
        'score-lg': ['6rem', { lineHeight: '1' }],

        'timer-sm': ['3.75rem', { lineHeight: '1' }],
        'timer-md': ['6.25rem', { lineHeight: '1' }],
        'timer-lg': ['11.25rem', { lineHeight: '1' }],
        'timer-xl': ['12.5rem', { lineHeight: '1' }],
      },

      height: {
        'btn-compact': '2.5rem',
        'btn-comfortable': '3.5rem',
        'btn-large': '4rem',
      },

      animation: {
        'score-pulse': 'pulse 0.3s ease-in-out',
        'warning-shake': 'shake 0.5s ease-in-out',
        'slide-in': 'slideIn 0.3s ease-out',
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
