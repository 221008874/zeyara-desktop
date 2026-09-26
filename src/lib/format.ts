export const timeZoneLabel = (tz?: string | null): string => {
  const map: Record<string, string> = {
    MORNING: 'صباحاً',
    AFTERNOON: 'بعد الظهر',
    NIGHT: 'مساءً',
    EVENING: 'مساءً',
  };
  return map[tz ?? ''] ?? (tz || '—');
};

export const appointmentStatusLabel = (s?: string | null): string => {
  const map: Record<string, string> = {
    SCHEDULED: 'مجدول',
    MOVED: 'مؤجل',
    DONE: 'مكتمل',
    CANCELLED: 'ملغي',
    NO_SHOW: 'لم يحضر',
    CHECKED_IN: 'وصل',
  };
  return map[s ?? ''] ?? (s || '—');
};

export const appointmentStatusColor = (s?: string | null): 'success' | 'error' | 'warning' | 'info' | 'default' => {
  const map: Record<string, any> = {
    SCHEDULED: 'info',
    MOVED: 'warning',
    DONE: 'success',
    CANCELLED: 'error',
  };
  return map[s ?? ''] ?? 'default';
};

export const moneySafeTypeLabel = (type?: string | null): string => {
  return type === 'CREDIT' ? 'إيداع' : type === 'DEBIT' ? 'سحب' : (type || '—');
};

export const sourceTypeLabel = (source?: string | null): string => {
  const map: Record<string, string> = {
    PAYMENT: '💵 مدفوعات المرضى',
    EXPENSE: '📋 المصروفات',
    MANUAL: '✏️ إدخالات يدوية',
    REFUND: '↩️ استرداد',
    ADJUSTMENT: '⚖️ تسوية',
  };
  return map[source ?? ''] ?? (source || '—');
};

export const expenseStatusLabel = (s?: string | null): string => {
  const map: Record<string, string> = {
    PENDING: '⏳ معلق',
    APPROVED: '✅ موافق عليه',
    REJECTED: '❌ مرفوض',
  };
  return map[s ?? ''] ?? (s || '—');
};

/** Mirrors the server's ScheduleNotificationType enum. */
export const notificationTypeLabel = (t?: string | null): string => {
  const map: Record<string, string> = {
    CREATED: '🆕 حجز جديد',
    CONFIRMED: '✅ تم التأكيد',
    RESCHEDULE: '🔄 تمت إعادة الجدولة',
    CANCEL: '❌ تم الإلغاء',
    PAYMENT: '💳 دفعة',
    REMINDER: '⏰ تذكير',
  };
  return map[t ?? ''] ?? (t || '—');
};

export const categoryLabel = (code?: string | null): string => {
  const map: Record<string, string> = {
    RENT: 'إيجار',
    SALARY: 'رواتب',
    EQUIPMENT: 'معدات',
    MARKETING: 'تسويق',
    UTILITIES: 'مرافق',
    SUPPLIES: 'مستلزمات',
    OTHER: 'أخرى',
  };
  return map[code ?? ''] ?? (code || '—');
};

export const fmtMoney = (v: any): string => `${Number(v ?? 0).toFixed(2)} ج.م`;

export const fmtDateTime = (v?: string | null): string => {
  if (!v) return '—';
  return v.replace('T', ' ');
};

export const todayISO = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const addDaysISO = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const nowTimestampLocal = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export const currentYearMonth = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
