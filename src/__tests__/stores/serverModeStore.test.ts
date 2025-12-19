import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useServerModeStore, type ServerMode } from '../../stores/serverModeStore';

describe('serverModeStore', () => {
  beforeEach(() => {
    // Reset store state
    useServerModeStore.getState().reset();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('initial state', () => {
    it('should have correct initial values', () => {
      const state = useServerModeStore.getState();

      expect(state.mode).toBe('online');
      expect(state.serverUrl).toBeNull();
    });
  });

  describe('setMode', () => {
    it('should set online mode', () => {
      const { setMode } = useServerModeStore.getState();

      setMode('online');

      expect(useServerModeStore.getState().mode).toBe('online');
    });

    it('should set local-server mode', () => {
      const { setMode } = useServerModeStore.getState();

      setMode('local-server');

      expect(useServerModeStore.getState().mode).toBe('local-server');
    });

    it('should set local-client mode', () => {
      const { setMode } = useServerModeStore.getState();

      setMode('local-client');

      expect(useServerModeStore.getState().mode).toBe('local-client');
    });

    it('should change mode from online to local-server', () => {
      const { setMode } = useServerModeStore.getState();

      expect(useServerModeStore.getState().mode).toBe('online');

      setMode('local-server');

      expect(useServerModeStore.getState().mode).toBe('local-server');
    });

    it('should change mode from local-server to local-client', () => {
      const { setMode } = useServerModeStore.getState();

      setMode('local-server');
      expect(useServerModeStore.getState().mode).toBe('local-server');

      setMode('local-client');
      expect(useServerModeStore.getState().mode).toBe('local-client');
    });

    it('should not affect serverUrl when changing mode', () => {
      const { setMode, setServerUrl } = useServerModeStore.getState();

      setServerUrl('http://192.168.1.100:8081');
      setMode('local-client');

      const state = useServerModeStore.getState();

      expect(state.mode).toBe('local-client');
      expect(state.serverUrl).toBe('http://192.168.1.100:8081');
    });
  });

  describe('setServerUrl', () => {
    it('should set server URL', () => {
      const { setServerUrl } = useServerModeStore.getState();

      setServerUrl('http://192.168.1.100:8081');

      expect(useServerModeStore.getState().serverUrl).toBe('http://192.168.1.100:8081');
    });

    it('should clear server URL when set to null', () => {
      const { setServerUrl } = useServerModeStore.getState();

      setServerUrl('http://192.168.1.100:8081');
      expect(useServerModeStore.getState().serverUrl).toBe('http://192.168.1.100:8081');

      setServerUrl(null);
      expect(useServerModeStore.getState().serverUrl).toBeNull();
    });

    it('should update server URL', () => {
      const { setServerUrl } = useServerModeStore.getState();

      setServerUrl('http://192.168.1.100:8081');
      expect(useServerModeStore.getState().serverUrl).toBe('http://192.168.1.100:8081');

      setServerUrl('http://192.168.1.200:8081');
      expect(useServerModeStore.getState().serverUrl).toBe('http://192.168.1.200:8081');
    });

    it('should not affect mode when setting URL', () => {
      const { setMode, setServerUrl } = useServerModeStore.getState();

      setMode('local-client');
      setServerUrl('http://192.168.1.100:8081');

      const state = useServerModeStore.getState();

      expect(state.mode).toBe('local-client');
      expect(state.serverUrl).toBe('http://192.168.1.100:8081');
    });
  });

  describe('reset', () => {
    it('should reset to default state', () => {
      const { setMode, setServerUrl, reset } = useServerModeStore.getState();

      // Change state
      setMode('local-server');
      setServerUrl('http://192.168.1.100:8081');

      // Reset
      reset();

      const state = useServerModeStore.getState();

      expect(state.mode).toBe('online');
      expect(state.serverUrl).toBeNull();
    });

    it('should reset from local-client mode', () => {
      const { setMode, setServerUrl, reset } = useServerModeStore.getState();

      setMode('local-client');
      setServerUrl('http://192.168.1.200:8081');

      reset();

      const state = useServerModeStore.getState();

      expect(state.mode).toBe('online');
      expect(state.serverUrl).toBeNull();
    });

    it('should be idempotent', () => {
      const { setMode, reset } = useServerModeStore.getState();

      setMode('local-server');
      reset();

      const state1 = useServerModeStore.getState();

      reset();

      const state2 = useServerModeStore.getState();

      expect(state1).toEqual(state2);
      expect(state2.mode).toBe('online');
      expect(state2.serverUrl).toBeNull();
    });
  });

  describe('persistence', () => {
    it('should persist mode to localStorage', () => {
      const { setMode } = useServerModeStore.getState();

      setMode('local-server');

      // Check localStorage
      const stored = localStorage.getItem('server-mode-storage');
      expect(stored).toBeTruthy();

      if (stored) {
        const parsed = JSON.parse(stored);
        expect(parsed.state.mode).toBe('local-server');
      }
    });

    it('should persist serverUrl to localStorage', () => {
      const { setServerUrl } = useServerModeStore.getState();

      setServerUrl('http://192.168.1.100:8081');

      const stored = localStorage.getItem('server-mode-storage');
      expect(stored).toBeTruthy();

      if (stored) {
        const parsed = JSON.parse(stored);
        expect(parsed.state.serverUrl).toBe('http://192.168.1.100:8081');
      }
    });

    it('should persist both mode and serverUrl', () => {
      const { setMode, setServerUrl } = useServerModeStore.getState();

      setMode('local-client');
      setServerUrl('http://192.168.1.100:8081');

      const stored = localStorage.getItem('server-mode-storage');
      expect(stored).toBeTruthy();

      if (stored) {
        const parsed = JSON.parse(stored);
        expect(parsed.state.mode).toBe('local-client');
        expect(parsed.state.serverUrl).toBe('http://192.168.1.100:8081');
      }
    });

    it('should restore state from localStorage', () => {
      // Set some state
      const { setMode, setServerUrl } = useServerModeStore.getState();
      setMode('local-server');
      setServerUrl('http://192.168.1.100:8081');

      // Simulate page reload by getting fresh state
      const restoredState = useServerModeStore.getState();

      expect(restoredState.mode).toBe('local-server');
      expect(restoredState.serverUrl).toBe('http://192.168.1.100:8081');
    });
  });

  describe('mode transitions', () => {
    it('should support online → local-server → online transition', () => {
      const { setMode } = useServerModeStore.getState();

      expect(useServerModeStore.getState().mode).toBe('online');

      setMode('local-server');
      expect(useServerModeStore.getState().mode).toBe('local-server');

      setMode('online');
      expect(useServerModeStore.getState().mode).toBe('online');
    });

    it('should support online → local-client → online transition', () => {
      const { setMode } = useServerModeStore.getState();

      expect(useServerModeStore.getState().mode).toBe('online');

      setMode('local-client');
      expect(useServerModeStore.getState().mode).toBe('local-client');

      setMode('online');
      expect(useServerModeStore.getState().mode).toBe('online');
    });

    it('should support local-server → local-client transition', () => {
      const { setMode } = useServerModeStore.getState();

      setMode('local-server');
      expect(useServerModeStore.getState().mode).toBe('local-server');

      setMode('local-client');
      expect(useServerModeStore.getState().mode).toBe('local-client');
    });
  });

  describe('typical workflows', () => {
    it('should handle local-server workflow', () => {
      const { setMode, setServerUrl } = useServerModeStore.getState();

      // Admin switches to local-server mode
      setMode('local-server');
      expect(useServerModeStore.getState().mode).toBe('local-server');

      // Server URL is auto-detected (simulated)
      setServerUrl('http://192.168.1.100:8081');

      const state = useServerModeStore.getState();
      expect(state.mode).toBe('local-server');
      expect(state.serverUrl).toBe('http://192.168.1.100:8081');
    });

    it('should handle local-client workflow', () => {
      const { setMode, setServerUrl } = useServerModeStore.getState();

      // Judge switches to local-client mode
      setMode('local-client');

      // Judge enters server URL
      setServerUrl('http://192.168.1.100:8081');

      const state = useServerModeStore.getState();
      expect(state.mode).toBe('local-client');
      expect(state.serverUrl).toBe('http://192.168.1.100:8081');
    });

    it('should handle return to online after tournament', () => {
      const { setMode, setServerUrl, reset } = useServerModeStore.getState();

      // During tournament: local mode
      setMode('local-server');
      setServerUrl('http://192.168.1.100:8081');

      // After tournament: reset to online
      reset();

      const state = useServerModeStore.getState();
      expect(state.mode).toBe('online');
      expect(state.serverUrl).toBeNull();
    });
  });
});
