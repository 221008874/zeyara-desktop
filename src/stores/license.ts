import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../lib/api';

interface LicenseStatus {
  activated: boolean;
  locked: boolean;
  reason: string | null;
  expiryDate: string | null;
  daysUntilExpiry: number | null;
  serverOnline: boolean;
}

interface LicenseState {
  status: LicenseStatus | null;
  isLoading: boolean;
  check: () => Promise<LicenseStatus>;
  activate: (key: string) => Promise<{ status: string; message: string }>;
}

export const useLicenseStore = create<LicenseState>()(
  persist(
    (set) => ({
      status: null,
      isLoading: true,

check: async () => {
        try {
          const res = await api.get('/api/license/status');
          const data = res.data;
          let expiryDate: string | null = null;
          let daysUntilExpiry: number | null = null;
          try {
            const expiryRes = await api.get('/api/license/expiry-info');
            expiryDate = expiryRes.data?.expiryDate ?? null;
            daysUntilExpiry = expiryRes.data?.daysUntilExpiry ?? null;
          } catch { /* expiry-info may require auth; optional display */ }
          const status: LicenseStatus = {
            activated: !data.locked,
            locked: data.locked ?? true,
            reason: data.reason ?? null,
            expiryDate,
            daysUntilExpiry,
            serverOnline: true,
          };
          set({ status, isLoading: false });
          return status;
        } catch (err: any) {
          const status: LicenseStatus = {
            activated: false,
            locked: true,
            reason: 'Server unreachable',
            expiryDate: null,
            daysUntilExpiry: null,
            serverOnline: false,
          };
          set({ status, isLoading: false });
          return status;
        }
      },

      activate: async (key: string) => {
        const res = await api.post('/api/license/validate-server', { licenseKey: key });
        const data = res.data;
        const status: LicenseStatus = {
          activated: data.status === 'VALID' || data.status === 'OK',
          locked: data.status !== 'VALID' && data.status !== 'OK',
          reason: data.message ?? null,
          expiryDate: data.expiryDate ?? null,
          daysUntilExpiry: data.daysUntilExpiry ?? null,
          serverOnline: true,
        };
        set({ status });
        return data;
      },
    }),
    {
      name: 'zeyara_license',
      partialize: (state) => ({ status: state.status }),
    }
  )
);
