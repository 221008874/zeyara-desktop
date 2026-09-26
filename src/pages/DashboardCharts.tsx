import React from 'react';
import { Box, Paper, Typography, useTheme } from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { LineChart } from '@mui/x-charts/LineChart';
import { PieChart } from '@mui/x-charts/PieChart';
import { api } from '../lib/api';
import { EmptyState } from '../design-system/EmptyState';
import { TableSkeleton } from '../design-system/TableSkeleton';
import { appointmentStatusLabel, categoryLabel } from '../lib/format';

/** Buckets an age into a label used for the age-distribution histogram. */
const ageBucket = (age: unknown): string => {
  const n = Number(age);
  if (!Number.isFinite(n) || n < 0) return 'غير محدد';
  if (n < 1) return 'أقل من سنة';
  if (n <= 5) return '1-5';
  if (n <= 12) return '6-12';
  if (n <= 18) return '13-18';
  if (n <= 30) return '19-30';
  if (n <= 45) return '31-45';
  if (n <= 60) return '46-60';
  return 'أكثر من 60';
};

const AGE_ORDER = ['أقل من سنة', '1-5', '6-12', '13-18', '19-30', '31-45', '46-60', 'أكثر من 60', 'غير محدد'];

const dayKey = (value: unknown): string | null => {
  if (!value) return null;
  const text = String(value);
  // Accept both a plain YYYY-MM-DD and an ISO timestamp.
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return m ? m[1] : null;
};

const lastNDays = (n: number): string[] => {
  const out: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
};

/**
 * Dashboard charts.
 *
 * Replaces the seven JavaFX charts (DashboardCharts.java) that the secretary and
 * doctor clients drew from their local SQLite mirrors. Everything here is derived
 * client-side from endpoints this app already calls, so no server change is needed.
 *
 * Each chart degrades independently: a failed fetch blanks only its own card rather
 * than taking down the dashboard.
 */
export const DashboardCharts: React.FC = () => {
  const theme = useTheme();
  const [loading, setLoading] = React.useState(true);
  const [patients, setPatients] = React.useState<any[]>([]);
  const [appointments, setAppointments] = React.useState<any[]>([]);
  const [payments, setPayments] = React.useState<any[]>([]);
  const [expenses, setExpenses] = React.useState<any[]>([]);
  const [failed, setFailed] = React.useState<string[]>([]);

  const series = React.useMemo(
    () => ({
      primary: theme.palette.primary.main,
      success: theme.palette.success.main,
      warning: theme.palette.warning.main,
      error: theme.palette.error.main,
      secondary: theme.palette.text.secondary,
    }),
    [theme],
  );

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const problems: string[] = [];
      const grab = async (url: string, key: string, setter: (v: any[]) => void) => {
        try {
          const res = await api.get(url);
          if (cancelled) return;
          setter(Array.isArray(res.data) ? res.data : []);
        } catch {
          problems.push(key);
        }
      };
      await Promise.all([
        grab('/api/patients', 'patients', setPatients),
        grab('/api/appointments', 'appointments', setAppointments),
        grab('/api/expenses', 'expenses', setExpenses),
        // Clinic-wide payments are admin-only; a doctor/secretary gets a filtered list.
        grab('/api/payments', 'payments', setPayments),
      ]);
      if (!cancelled) {
        setFailed(problems);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Revenue trend + revenue vs expenses (last 14 days) ──────────────────────
  const trend = React.useMemo(() => {
    const days = lastNDays(14);
    const collected = new Map<string, number>();
    for (const p of payments) {
      const key = dayKey(p.paymentDate);
      if (!key) continue;
      collected.set(key, (collected.get(key) ?? 0) + Number(p.paidAmount || 0));
    }
    const spent = new Map<string, number>();
    for (const e of expenses) {
      if (e.status && e.status !== 'APPROVED') continue; // only approved money leaves the till
      const key = dayKey(e.expenseDate ?? e.date);
      if (!key) continue;
      spent.set(key, (spent.get(key) ?? 0) + Number(e.amount || 0));
    }
    return {
      labels: days.map((d) => d.slice(5)), // MM-DD
      collected: days.map((d) => Number((collected.get(d) ?? 0).toFixed(2))),
      spent: days.map((d) => Number((spent.get(d) ?? 0).toFixed(2))),
    };
  }, [payments, expenses]);

  // ── Appointment status distribution ─────────────────────────────────────────
  const statusPie = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of appointments) {
      const key = a.status ?? 'UNKNOWN';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return {
      ids: [...counts.keys()],
      values: [...counts.values()],
      labels: [...counts.keys()].map((k) => appointmentStatusLabel(k) ?? k),
    };
  }, [appointments]);

  // ── Online vs walk-in ───────────────────────────────────────────────────────
  const channelPie = React.useMemo(() => {
    let online = 0;
    let walkIn = 0;
    for (const a of appointments) {
      if (a.cloudAppointmentId) online++;
      else walkIn++;
    }
    return { online, walkIn, total: online + walkIn };
  }, [appointments]);

  // ── Gender split + age distribution ─────────────────────────────────────────
  const genderPie = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of patients) {
      const key = (p.gender ?? 'غير محدد').toString().trim().toLowerCase() || 'غير محدد';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const order = ['male', 'female', 'other', 'غير محدد'];
    const ids = [...counts.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return {
      ids,
      values: ids.map((k) => counts.get(k) ?? 0),
      labels: ids.map((k) => (k === 'male' ? 'ذكر' : k === 'female' ? 'أنثى' : k === 'other' ? 'آخر' : 'غير محدد')),
    };
  }, [patients]);

  const ageHist = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of patients) counts.set(ageBucket(p.age), (counts.get(ageBucket(p.age)) ?? 0) + 1);
    return {
      data: AGE_ORDER.map((k) => counts.get(k) ?? 0),
      // Age buckets read left-to-right even in RTL, so pin the axis direction.
      reversed: AGE_ORDER,
    };
  }, [patients]);

  // ── Expenses by category ────────────────────────────────────────────────────
  const expenseBars = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of expenses) {
      const key = e.category ?? 'OTHER';
      counts.set(key, (counts.get(key) ?? 0) + Number(e.amount || 0));
    }
    const ids = [...counts.keys()];
    return { ids, data: ids.map((k) => Number((counts.get(k) ?? 0).toFixed(2))) };
  }, [expenses]);

  if (loading) return <TableSkeleton cols={6} rows={3} />;

  // Nothing at all to plot — say so rather than rendering four empty axes.
  if (patients.length === 0 && appointments.length === 0 && expenses.length === 0 && payments.length === 0) {
    return (
      <Paper sx={{ p: 2 }}>
        <EmptyState
          title="لا توجد بيانات كافية للرسوم البيانية"
          hint="تظهر الرسوم البيانية تلقائياً بعد تسجيل المرضى أو المواعيد أو المصروفات."
        />
      </Paper>
    );
  }

  const card = (title: string, body: React.ReactNode) => (
    <GridCard>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
        {title}
      </Typography>
      {body}
    </GridCard>
  );

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
      {card(
        'الإيرادات المحصّلة — آخر 14 يوم',
        <LineChart
          height={220}
          xAxis={[{ scaleType: 'point', data: trend.labels }]}
          series={[{ data: trend.collected, label: 'محصّل', color: series.success, area: true }]}
          hideLegend
        />,
      )}

      {card(
        'المحصّل مقابل المصروف',
        <LineChart
          height={220}
          xAxis={[{ scaleType: 'point', data: trend.labels }]}
          series={[
            { data: trend.collected, label: 'محصّل', color: series.success },
            { data: trend.spent, label: 'مصروف', color: series.error },
          ]}
        />,
      )}

      {card(
        'حالات المواعيد',
        statusPie.values.length ? (
          <PieChart
            height={220}
            series={[
              {
                data: statusPie.values.map((value, i) => ({
                  id: statusPie.ids[i],
                  value,
                  label: statusPie.labels[i],
                  color: [series.primary, series.success, series.warning, series.error, series.secondary][i % 5],
                })),
                innerRadius: 40,
                paddingAngle: 2,
                cornerRadius: 4,
              },
            ]}
          />
        ) : (
          <NoData />
        ),
      )}

      {card(
        'الحجز الإلكتروني مقابل الحضور المباشر',
        channelPie.total ? (
          <PieChart
            height={220}
            series={[
              {
                data: [
                  { id: 'online', value: channelPie.online, label: 'حجز إلكتروني', color: series.primary },
                  { id: 'walkin', value: channelPie.walkIn, label: 'حضور مباشر', color: series.secondary },
                ],
                innerRadius: 40,
                paddingAngle: 2,
                cornerRadius: 4,
              },
            ]}
          />
        ) : (
          <NoData />
        ),
      )}

      {card(
        'توزيع المرضى حسب العمر',
        <BarChart
          height={220}
          xAxis={[{ scaleType: 'band', data: ageHist.reversed, categoryGapRatio: 0.3 }]}
          series={[{ data: ageHist.data, label: 'عدد المرضى', color: series.primary }]}
          hideLegend
        />,
      )}

      {card(
        'توزيع المرضى حسب الجنس',
        genderPie.values.length ? (
          <PieChart
            height={220}
            series={[
              {
                data: genderPie.values.map((value, i) => ({
                  id: genderPie.ids[i],
                  value,
                  label: genderPie.labels[i],
                  color: [series.primary, series.warning, series.secondary, series.error][i % 4],
                })),
                innerRadius: 40,
                paddingAngle: 2,
                cornerRadius: 4,
              },
            ]}
          />
        ) : (
          <NoData />
        ),
      )}

      {card(
        'المصروفات حسب البند',
        expenseBars.ids.length ? (
          <BarChart
            height={240}
            layout="horizontal"
            yAxis={[
              {
                scaleType: 'band',
                data: expenseBars.ids.map((c) => categoryLabel(c) ?? c),
                width: 110,
              },
            ]}
            series={[{ data: expenseBars.data, label: 'المصروف', color: series.warning }]}
            hideLegend
          />
        ) : (
          <NoData />
        ),
      )}

      {failed.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ gridColumn: '1 / -1' }}>
          تعذّر تحميل: {failed.join('، ')}
        </Typography>
      )}
    </Box>
  );
};

const GridCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Paper sx={{ p: 2 }}>{children}</Paper>
);

const NoData: React.FC = () => (
  <Box sx={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <Typography variant="body2" color="text.secondary">
      لا توجد بيانات
    </Typography>
  </Box>
);
