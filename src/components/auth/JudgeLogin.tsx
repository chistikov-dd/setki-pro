import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Input } from '../ui/Input';
import { useAuthStore } from '../../stores/authStore';
import { checkCachedPin } from '../../services/api';

interface JudgeLoginProps {
  onBack: () => void;
  onSuccess?: () => void;
}

export const JudgeLogin: React.FC<JudgeLoginProps> = ({
  onBack,
  onSuccess
}) => {
  const [pin, setPin] = useState(['', '', '', '', '', '']);
  const [judgeName, setJudgeName] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [isOfflineAvailable, setIsOfflineAvailable] = useState(false);
  const [isCheckingPin, setIsCheckingPin] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const { loginAsJudge, isLoading, error } = useAuthStore();

  useEffect(() => {
    // Фокус на первом поле при загрузке
    inputRefs.current[0]?.focus();
  }, []);

  // Проверить доступность PIN в offline режиме
  useEffect(() => {
    const pinString = pin.join('');
    if (pinString.length === 6) {
      setIsCheckingPin(true);
      checkCachedPin(pinString)
        .then(available => {
          setIsOfflineAvailable(available);
        })
        .catch(() => {
          setIsOfflineAvailable(false);
        })
        .finally(() => {
          setIsCheckingPin(false);
        });
    } else {
      setIsOfflineAvailable(false);
    }
  }, [pin]);

  const handlePinChange = (index: number, value: string) => {
    // Разрешаем только цифры
    if (!/^\d*$/.test(value)) return;

    const newPin = [...pin];
    newPin[index] = value.slice(-1); // Берём только последнюю цифру
    setPin(newPin);

    // Автоматический переход к следующему полю
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      // Переход к предыдущему полю при Backspace
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').slice(0, 6);
    if (!/^\d+$/.test(pastedData)) return;

    const newPin = [...pin];
    for (let i = 0; i < pastedData.length; i++) {
      newPin[i] = pastedData[i];
    }
    setPin(newPin);

    // Фокус на следующем пустом поле или на последнем
    const nextIndex = Math.min(pastedData.length, 5);
    inputRefs.current[nextIndex]?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const pinString = pin.join('');
    const tableNum = parseInt(tableNumber);
    if (pinString.length === 6 && judgeName.trim() && !isNaN(tableNum) && tableNum > 0) {
      try {
        await loginAsJudge(pinString, judgeName.trim(), tableNum);
        onSuccess?.();
      } catch (err) {
        // Ошибка уже обработана в store
      }
    }
  };

  const isPinComplete = pin.every(digit => digit !== '');
  const isTableNumberValid = tableNumber && !isNaN(parseInt(tableNumber)) && parseInt(tableNumber) > 0;

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
              <div className="p-4 rounded-xl bg-emerald-50 border-2 border-emerald-200">
                <svg className="w-10 h-10 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <CardTitle className="text-3xl mb-2">
                  Вход судьи
                </CardTitle>
                <p className="text-gray-800 text-sm">
                  Введите PIN-код от администратора столов
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-7">
              {/* PIN-код */}
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-5 text-center uppercase tracking-wider">
                  PIN-код
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
                      className={`w-14 h-16 text-center text-2xl font-bold bg-white border-2 rounded-xl text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:opacity-50 transition-colors ${
                        digit ? 'border-emerald-500 bg-emerald-50' : 'border-gray-400'
                      }`}
                    />
                  ))}
                </div>
                {/* Индикатор offline доступности - показываем только если PIN в кэше */}
                {isPinComplete && !error && isOfflineAvailable && (
                  <div className="mt-5">
                    {isCheckingPin ? (
                      <div className="flex items-center justify-center gap-2 text-gray-800 text-sm">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Проверка...</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2 text-emerald-600 text-sm">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>Доступен offline режим</span>
                      </div>
                    )}
                  </div>
                )}

                {error && (
                  <div className="mt-5 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                    <p className="text-sm text-red-400 text-center">{error}</p>
                  </div>
                )}
              </div>

              {/* Номер стола */}
              <Input
                label="Номер стола"
                type="number"
                placeholder="Введите номер стола"
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                disabled={isLoading}
                min="1"
              />

              {/* Имя судьи */}
              <Input
                label="Ваше имя"
                type="text"
                placeholder="Введите ваше имя"
                value={judgeName}
                onChange={(e) => setJudgeName(e.target.value)}
                disabled={isLoading}
              />

              <Button
                type="submit"
                variant="primary"
                fullWidth
                disabled={isLoading || !isPinComplete || !judgeName.trim() || !isTableNumberValid}
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

            <div className="mt-8 p-4 rounded-lg bg-emerald-50 border border-emerald-200">
              <p className="text-gray-900 text-sm text-center leading-relaxed">
                {isOfflineAvailable && isPinComplete ? (
                  <>
                    <span className="text-emerald-600 font-semibold">Offline режим активен</span>
                    <br />
                    Вы можете войти без подключения к интернету
                  </>
                ) : (
                  <>PIN-код можно получить у администратора столов</>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
