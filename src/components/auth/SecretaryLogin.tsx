import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Input } from '../ui/Input';
import { useAuthStore } from '../../stores/authStore';

interface SecretaryLoginProps {
  onBack: () => void;
  onSuccess?: () => void;
}

export const SecretaryLogin: React.FC<SecretaryLoginProps> = ({ onBack, onSuccess }) => {
  const [pin, setPin] = useState(['', '', '', '', '', '']);
  const [secretaryName, setSecretaryName] = useState('');
  const [serverIp, setServerIp] = useState('192.168.0.101');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const { loginAsSecretary, isLoading, error } = useAuthStore();

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handlePinChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newPin = [...pin];
    newPin[index] = value.slice(-1);
    setPin(newPin);
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').slice(0, 6);
    if (!/^\d+$/.test(pastedData)) return;
    const newPin = [...pin];
    for (let i = 0; i < pastedData.length; i++) newPin[i] = pastedData[i];
    setPin(newPin);
    const nextIndex = Math.min(pastedData.length, 5);
    inputRefs.current[nextIndex]?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pinString = pin.join('');
    if (pinString.length === 6 && secretaryName.trim() && serverIp.trim()) {
      try {
        const serverUrl = serverIp.trim().startsWith('http')
          ? serverIp.trim()
          : `http://${serverIp.trim()}`;
        await loginAsSecretary(pinString, secretaryName.trim(), serverUrl);
        onSuccess?.();
      } catch {
        // Ошибка обрабатывается в store
      }
    }
  };

  const isPinComplete = pin.every(digit => digit !== '');

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-teal-50 to-gray-100 p-6">
      <div className="w-full max-w-lg px-4">
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

        <Card variant="elevated">
          <CardHeader>
            <div className="flex items-center gap-4 mb-6">
              <div className="p-4 rounded-xl bg-teal-50 border-2 border-teal-200">
                {/* Иконка планшета/формы */}
                <svg className="w-10 h-10 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
              <div>
                <CardTitle className="text-3xl mb-2">
                  Вход секретаря
                </CardTitle>
                <p className="text-gray-800 text-sm">
                  Стол взвешивания и регистрации
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-7">
              {/* PIN-код */}
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-5 text-center uppercase tracking-wider">
                  PIN-код турнира
                </label>
                <div className="flex gap-3 justify-center">
                  {pin.map((digit, index) => (
                    <input
                      key={index}
                      ref={(el) => { inputRefs.current[index] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handlePinChange(index, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(index, e)}
                      onPaste={index === 0 ? handlePaste : undefined}
                      disabled={isLoading}
                      className={`w-14 h-16 text-center text-2xl font-bold bg-white border-2 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 disabled:opacity-50 transition-colors ${
                        digit ? 'border-teal-500 bg-teal-50' : 'border-gray-400'
                      }`}
                    />
                  ))}
                </div>

                {error && (
                  <div className="mt-5 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                    <p className="text-sm text-red-400 text-center">{error}</p>
                  </div>
                )}
              </div>

              {/* IP адрес сервера */}
              <Input
                label="IP адрес сервера администратора"
                type="text"
                placeholder="192.168.0.101"
                value={serverIp}
                onChange={(e) => setServerIp(e.target.value)}
                disabled={isLoading}
              />

              {/* Имя секретаря */}
              <Input
                label="Ваше имя"
                type="text"
                placeholder="Введите ваше имя"
                value={secretaryName}
                onChange={(e) => setSecretaryName(e.target.value)}
                disabled={isLoading}
              />

              <Button
                type="submit"
                variant="primary"
                fullWidth
                disabled={isLoading || !isPinComplete || !secretaryName.trim() || !serverIp.trim()}
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

            <div className="mt-8 p-4 rounded-lg bg-teal-50 border border-teal-200">
              <p className="text-gray-900 text-sm text-center leading-relaxed">
                <span className="font-semibold">Стол взвешивания и регистрации</span>
                <br />
                PIN-код и IP-адрес получите у администратора турнира
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
