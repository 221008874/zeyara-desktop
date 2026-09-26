import { describe, it, expect } from 'vitest';
import { ROUTE_ACCESS, NAV_ITEMS, rolesFor, canAccess, ALL_ROLES, CLINICIAN_ROLES, ADMIN_ROLES } from '../app-shell/navigation';
import type { Role } from '../stores/auth';

const R: Role[] = ['ADMIN', 'DOCTOR', 'SECRETARY'];

describe('role access map', () => {
  it('covers every sidebar destination', () => {
    const missing = NAV_ITEMS.filter((i) => !(i.path in ROUTE_ACCESS)).map((i) => i.path);
    expect(missing).toEqual([]);
  });

  it('declares a distinct path for patient editing and viewing', () => {
    // The defect this replaced: the sidebar hid patient editing from SECRETARY while
    // the route carried no guard, so a typed URL reached the screen anyway.
    expect(rolesFor('/patients/:id/edit')).toEqual(CLINICIAN_ROLES);
    expect(rolesFor('/patients/:id')).toEqual(ALL_ROLES);
  });

  it('restricts administrative sections to ADMIN', () => {
    for (const p of ['/users', '/clinic-profile', '/backups', '/infra', '/server-manager']) {
      expect(rolesFor(p)).toEqual(ADMIN_ROLES);
    }
  });

  it('keeps money safe and reports away from SECRETARY', () => {
    for (const p of ['/financial', '/money-safe', '/reports', '/medications', '/history']) {
      expect(rolesFor(p)).not.toContain('SECRETARY');
    }
  });

  it('excludes DOCTOR from community bookings but allows SECRETARY', () => {
    expect(rolesFor('/online-bookings')).toEqual(['ADMIN', 'SECRETARY']);
  });

  it('allows every role the core receptionist screens', () => {
    for (const p of ['/dashboard', '/patients', '/patients/new', '/appointments', '/appointments/new', '/outstanding', '/notifications']) {
      expect(rolesFor(p)).toEqual(ALL_ROLES);
    }
  });

  it('defaults an unknown path to the least privilege, not the most', () => {
    // A typo in a route must not silently grant the screen to everyone.
    expect(rolesFor('/does-not-exist')).toEqual([]);
  });
});

describe('canAccess', () => {
  it.each(R)('lets %s reach a shared screen', (role) => {
    expect(canAccess('/patients', role)).toBe(true);
  });

  it('denies SECRETARY the money safe', () => {
    expect(canAccess('/money-safe', 'SECRETARY')).toBe(false);
  });

  it('denies DOCTOR user administration', () => {
    expect(canAccess('/users', 'DOCTOR')).toBe(false);
  });

  it('denies SECRETARY patient editing', () => {
    expect(canAccess('/patients/:id/edit', 'SECRETARY')).toBe(false);
  });

  it('denies everything when the role is missing', () => {
    // Fail closed: a session with no role must not see the whole app.
    expect(canAccess('/patients', undefined)).toBe(false);
    expect(canAccess('/dashboard', undefined)).toBe(false);
  });

  it('agrees with the sidebar for every nav item', () => {
    for (const role of R) {
      for (const item of NAV_ITEMS) {
        expect(canAccess(item.path, role)).toBe(rolesFor(item.path).includes(role));
      }
    }
  });
});
