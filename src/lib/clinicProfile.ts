import { api } from './api';

export interface ClinicProfile {
  id?: number;
  clinicName?: string;
  address?: string;
  phone?: string;
  email?: string;
  license?: string;
  doctorName?: string;
  doctorTitle?: string;
}

let cache: ClinicProfile | null = null;
let loaded = false;

/** Fetch the clinic profile once per session (cached). Returns null on failure. */
export async function getClinicProfile(): Promise<ClinicProfile | null> {
  if (loaded) return cache;
  try {
    const res = await api.get<ClinicProfile>('/api/clinic-profile');
    cache = res.data && typeof res.data === 'object' ? res.data : null;
  } catch {
    cache = null;
  } finally {
    loaded = true;
  }
  return cache;
}

export function invalidateClinicProfile(): void {
  loaded = false;
  cache = null;
}
