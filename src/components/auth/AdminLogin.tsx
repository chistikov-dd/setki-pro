import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Input } from '../ui/Input';
import { useAuthStore } from '../../stores/authStore';

interface AdminLoginProps {
  onBack: () => void;
  onSuccess?: () => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({
  onBack,
  onSuccess
}) => {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');

  const { loginAsAdmin, isLoading, error } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (login.trim() && password.trim()) {
      try {
        await loginAsAdmin(login, password);
        onSuccess?.();
      } catch (err) {
        // Ошибка уже обработана в store
      }
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-blue-50 to-gray-100 p-6">
      <div className="w-full max-w-lg px-4">
        {/* Back button */}
        <button
          onClick={onBack}
          className="mb-8 flex items-center gap-2 text-gray-800 hover:text-gray-900 transition-colors group"
          disabled={isLoading}
        >
          <svg className="w-5 h-5 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span>Назад</span>
        </button>

        {/* Card */}
        <Card variant="elevated">
          <CardHeader>
            <div className="flex items-center gap-4 mb-6">
              <div className="p-4 rounded-xl bg-blue-500/10 border-2 border-blue-500/30">
                <svg className="w-10 h-10 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <CardTitle className="text-3xl mb-2">
                  Вход администратора
                </CardTitle>
                <p className="text-gray-800 text-sm">
                  Используйте данные организатора из веб-приложения
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <Input
                label="Логин"
                type="text"
                placeholder="Введите логин"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                disabled={isLoading}
                autoFocus
              />

              <Input
                label="Пароль"
                type="password"
                placeholder="Введите пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                error={error ?? undefined}
              />

              <Button
                type="submit"
                variant="primary"
                fullWidth
                disabled={isLoading || !login.trim() || !password.trim()}
                className="!mt-8"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Вход...
                  </span>
                ) : (
                  'Войти в систему'
                )}
              </Button>
            </form>

            <div className="mt-8 p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
              <p className="text-gray-800 text-sm text-center leading-relaxed">
                После входа вы сможете создать сессию турнира и управлять столами
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
