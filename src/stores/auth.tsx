import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../lib/api';

export const ROLES = ['ADMIN', 'DOCTOR', 'SECRETARY'] as const;
export type Role = (typeof ROLES)[number];

interface Session {
  username: string;
  role: Role;
  token: string;
  refreshToken: string;
  mustChangePassword: boolean;
}

/**
 * The server is the only authority on a user's role.
 *
 * The role picker on the login screen exists solely to choose which login ENDPOINT to
 * call (/api/doctors/login vs /api/secretaries/login vs /api/admin/login). It must never
 * decide what the session role is, otherwise the UI would grant capabilities the backend
 * never granted. The response `role` claim is therefore preferred, and the selection is
 * only a fallback for a server that omits it.
 */
const roleFromServer = (value: unknown, fallback: Role): Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value)
    ? (value as Role)
    : fallback;

interface AuthState {
  session: Session | null;
  isLoading: boolean;
  login: (username: string, password: string, role: Role) => Promise<{ mustChangePassword: boolean; role: Role }>;
  bootstrapAdmin: (username: string, password: string) => Promise<void>;
  logout: () => void;
  clearSession: () => void;
  restore: () => Promise<void>;
  refresh: () => Promise<void>;
  markPasswordChanged: () => void;
  /** Update the access/refresh tokens in the store in-memory (used by the API client after a reactive refresh). */
  setTokens: (token: string, refreshToken: string) => void;
}

const LOGIN_ENDPOINTS: Record<string, string> = {
  ADMIN: '/api/admin/login',
  DOCTOR: '/api/doctors/login',
  SECRETARY: '/api/secretaries/login',
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      isLoading: true,

      login: async (username, password, role) => {
        const endpoint = LOGIN_ENDPOINTS[role];
        const res = await api.post(endpoint, { username, password });
        const { token, refreshToken } = res.data;
        const mustChangePassword = res.data.forceChange === true || res.data.mustChangePassword === true;
        const session: Session = {
          username: res.data.username ?? username,
          role: roleFromServer(res.data.role, role),
          token,
          refreshToken,
          mustChangePassword,
        };
        set({ session, isLoading: false });
        return { mustChangePassword, role: session.role };
      },

      bootstrapAdmin: async (username, password) => {
        const res = await api.post('/api/admin/bootstrap', { username, password });
        const session: Session = {
          username: res.data.username ?? username,
          role: roleFromServer(res.data.role, 'ADMIN'),
          token: res.data.token,
          refreshToken: res.data.refreshToken,
          mustChangePassword: res.data.forceChange === true || res.data.mustChangePassword === true,
        };
        set({ session, isLoading: false });
      },

      logout: () => {
        const session = get().session;
        if (session?.refreshToken) {
          void api.post('/api/auth/revoke', { refreshToken: session.refreshToken }).catch(() => {});
        }
        get().clearSession();
      },

      clearSession: () => {
        set({ session: null, isLoading: false });
        localStorage.removeItem('zeyara_session');
      },

      restore: async () => {
        // The persist middleware already hydrates the store from localStorage.
        // If a live session exists in memory (e.g. set by login() before this ran),
        // never clobber it with the possibly-stale persisted copy.
        const current = get().session;
        if (current?.token) {
          set({ isLoading: false });
          await get().refresh();
          return;
        }
        try {
          const raw = localStorage.getItem('zeyara_session');
          if (!raw) {
            set({ isLoading: false });
            return;
          }
          const parsed = JSON.parse(raw);
          const session: Session = parsed?.state?.session ?? parsed?.session;
          if (!session?.token) {
            set({ session: null, isLoading: false });
            return;
          }
          set({ session, isLoading: false });
          await get().refresh();
        } catch {
          set({ session: null, isLoading: false });
        }
      },

      refresh: async () => {
        const { session } = get();
        if (!session?.refreshToken) return;
        try {
          const res = await api.post('/api/auth/refresh', { refreshToken: session.refreshToken });
          const { token, refreshToken: newRefresh } = res.data;
          // Re-read the role on every refresh: if an administrator changed someone's role,
          // the client must narrow its UI on the next refresh instead of keeping a stale
          // grant until the user signs in again.
          set((s) => ({
            session: s.session
              ? {
                  ...s.session,
                  token,
                  refreshToken: newRefresh,
                  role: roleFromServer(res.data.role, s.session.role),
                }
              : null,
          }));
        } catch {
          get().logout();
        }
      },

      markPasswordChanged: () => {
        // The persist middleware writes the updated envelope to localStorage
        // on set(), so a manual rewrite here would be a redundant double-write.
        set((s) => ({
          session: s.session ? { ...s.session, mustChangePassword: false } : null,
        }));
      },

      setTokens: (token, refreshToken) => {
        set((s) => ({
          session: s.session ? { ...s.session, token, refreshToken } : null,
        }));
      },
    }),
    {
      name: 'zeyara_session',
      partialize: (state) => ({ session: state.session }),
      onRehydrateStorage: () => (state) => {
        // Always clear isLoading after hydration, even when no session exists,
        // so ProtectedRoute can redirect to /login instead of showing "Loading..." forever.
        if (state) {
          state.isLoading = false;
        }
      },
    }
  )
);
