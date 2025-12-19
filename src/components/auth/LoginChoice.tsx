import React from 'react';

interface LoginChoiceProps {
  onSelectRole: (role: 'admin' | 'judge') => void;
  onOpenServerMode: () => void;
}

export const LoginChoice: React.FC<LoginChoiceProps> = ({ onSelectRole, onOpenServerMode }) => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-blue-50 to-gray-100 p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-6xl px-2 sm:px-4">
        {/* Header */}
        <div className="text-center mb-8 sm:mb-10 lg:mb-14">
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 mb-2 tracking-tight">
            SETKI.PRO
          </h1>
          <p className="text-lg sm:text-xl lg:text-2xl text-gray-900 font-light tracking-wide">
            Судейское приложение
          </p>
        </div>

        {/* Role cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 lg:gap-6 mb-12 sm:mb-16 lg:mb-20">
          {/* Администратор */}
          <button
            className="group text-left bg-white rounded-xl px-6 py-6 sm:px-8 sm:py-8 lg:px-12 lg:py-10 border border-gray-400 hover:border-blue-500 hover:shadow-lg transition-all duration-200"
            onClick={() => onSelectRole('admin')}
          >
            {/* Icon */}
            <div className="mb-3 sm:mb-4 lg:mb-5">
              <div className="inline-flex p-3 sm:p-4 rounded-xl bg-blue-50 border border-blue-200">
                <svg className="w-10 h-10 sm:w-12 sm:h-12 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
            </div>

            {/* Content */}
            <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 sm:mb-3 group-hover:text-blue-600 transition-colors">
              Администратор столов
            </h3>
            <p className="text-gray-800 text-sm sm:text-base leading-relaxed mb-4 sm:mb-5 lg:mb-6">
              Создание сессии турнира, управление столами, генерация PIN-кодов
            </p>

            {/* Arrow indicator */}
            <div className="flex items-center text-blue-600 text-sm sm:text-base font-semibold group-hover:translate-x-1 transition-transform">
              <span>Войти</span>
              <svg className="w-4 h-4 sm:w-5 sm:h-5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </div>
          </button>

          {/* Судья */}
          <button
            className="group text-left bg-white rounded-xl px-6 py-6 sm:px-8 sm:py-8 lg:px-12 lg:py-10 border border-gray-400 hover:border-emerald-500 hover:shadow-lg transition-all duration-200"
            onClick={() => onSelectRole('judge')}
          >
            {/* Icon */}
            <div className="mb-3 sm:mb-4 lg:mb-5">
              <div className="inline-flex p-3 sm:p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                <svg className="w-10 h-10 sm:w-12 sm:h-12 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
            </div>

            {/* Content */}
            <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 sm:mb-3 group-hover:text-emerald-600 transition-colors">
              Судья на столе
            </h3>
            <p className="text-gray-800 text-sm sm:text-base leading-relaxed mb-4 sm:mb-5 lg:mb-6">
              Вход по PIN-коду для проведения поединков
            </p>

            {/* Arrow indicator */}
            <div className="flex items-center text-emerald-600 text-sm sm:text-base font-semibold group-hover:translate-x-1 transition-transform">
              <span>Войти</span>
              <svg className="w-4 h-4 sm:w-5 sm:h-5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </div>
          </button>
        </div>

        {/* Server Mode Button */}
        <div className="text-center mb-6 sm:mb-8">
          <button
            onClick={onOpenServerMode}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-white border border-gray-400 hover:border-purple-500 hover:shadow-md transition-all duration-200 group"
          >
            <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
            </svg>
            <span className="text-gray-900 font-medium group-hover:text-purple-600 transition-colors">
              Режим работы
            </span>
          </button>
        </div>

        {/* Footer */}
        <div className="text-center">
          <div className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-white/70 border border-gray-400">
            <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
            <span className="text-gray-800 text-sm">Версия 1.0.0</span>
            <span className="text-gray-900">•</span>
            <span className="text-gray-700 text-sm">Разработано для SETKI.PRO</span>
          </div>
        </div>
      </div>
    </div>
  );
};
