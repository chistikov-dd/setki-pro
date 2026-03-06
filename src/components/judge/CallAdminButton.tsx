import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAuthStore } from '../../stores/authStore';
import { useServerModeStore } from '../../stores/serverModeStore';
import { Button } from '../ui/Button';

export const CallAdminButton: React.FC = () => {
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const { user } = useAuthStore();
  const { mode, serverUrl } = useServerModeStore();

  if (mode !== 'local-client' || !serverUrl) return null;

  const handleCall = async () => {
    if (isSending || sent) return;

    setIsSending(true);
    try {
      const base = serverUrl.includes('/api/v1')
        ? serverUrl
        : `${serverUrl.replace(/\/$/, '')}/api/v1`;

      const token = await invoke<string | null>('get_token');
      const response = await fetch(`${base}/desktop/call-admin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          table_number: user?.role === 'referee' ? user.table_number : 0,
          judge_name: user?.role === 'referee' ? user.judge_name : null,
          message: null,
        }),
      });

      if (response.ok) {
        setSent(true);
        setTimeout(() => setSent(false), 10000);
      }
    } catch (e) {
      console.error('[CallAdminButton] Failed to call admin:', e);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Button
      variant={sent ? 'ghost' : 'secondary'}
      size="sm"
      onClick={handleCall}
      disabled={isSending || sent}
      className={`text-xs ${sent ? 'text-green-600' : 'text-orange-600 hover:bg-orange-50 border-orange-300'}`}
    >
      {sent ? '✓ Вызов отправлен' : isSending ? '...' : 'Вызвать администратора'}
    </Button>
  );
};
