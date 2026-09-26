import React from 'react';
import {
  Box, Paper, Typography, Button, TextField, Alert, Chip, CircularProgress,
  Table, TableBody, TableCell, TableHead, TableRow, LinearProgress, Stack, Divider,
} from '@mui/material';
import { invoke } from '@tauri-apps/api/core';

// Types matching JavaFX screenController + InfraHealthController
type InfraHealth = any;
type LicenseStatus = { locked: boolean; reason: string; timestamp: number } | null;
type LicenseExpiry = { licenseKey: string; expiryDate: string; daysUntilExpiry: number; status: string } | null;
type ServerState = { running: boolean; port: number | null; pid: number | null; mode: string };

const isTauri = () => {
  try { return !!(window as any).__TAURI__ || !!(window as any).__TAURI_INTERNALS__; } catch { return false; }
};

const apiGet = async (path: string) => {
  const { api } = await import('../lib/api');
  const res = await api.get(path);
  return res.data ?? res;
};
const apiPost = async (path: string, body?: any) => {
  const { api } = await import('../lib/api');
  const res = await api.post(path, body);
  return res.data ?? res;
};

export const ServerManagerPage: React.FC = () => {
  const [serverState, setServerState] = React.useState<ServerState>({ running: false, port: null, pid: null, mode: 'offline' });
  const [operationInProgress, setOperationInProgress] = React.useState(false);
  const [infra, setInfra] = React.useState<InfraHealth | null>(null);
  const [licenseStatus, setLicenseStatus] = React.useState<LicenseStatus>(null);
  const [licenseExpiry, setLicenseExpiry] = React.useState<LicenseExpiry>(null);
  const [licenseKeyInput, setLicenseKeyInput] = React.useState('');
  const [phoneInput, setPhoneInput] = React.useState('');
  const [dangerStatus, setDangerStatus] = React.useState<{ msg: string; ok: boolean } | null>(null);
  const [manageStatus, setManageStatus] = React.useState<string>('Ready');
  const [logs, setLogs] = React.useState<string>('Loading logs...');
  const [healthError, setHealthError] = React.useState<string | null>(null);
  const [firewallOk, setFirewallOk] = React.useState<boolean | null>(null);
  const [updateInfo, setUpdateInfo] = React.useState<any>(null);
  const [updateError, setUpdateError] = React.useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = React.useState(false);
  const [systemInfo, setSystemInfo] = React.useState<any>(null);
  const [telegramPending, setTelegramPending] = React.useState<any[]>([]);
  const [telegramStatus, setTelegramStatus] = React.useState<string | null>(null);

  // Poll server state via Rust or HTTP
  const refreshServerState = React.useCallback(async () => {
    try {
      if (isTauri()) {
        const s = await invoke<ServerState>('get_server_state');
        setServerState(s);
      } else {
        // HTTP fallback: probe health
        try {
          await apiGet('/api/health');
          const h = await apiGet('/api/health/infrastructure').catch(() => null);
          setServerState({ running: true, port: 8081, pid: null, mode: h ? 'remote' : 'remote' });
        } catch {
          setServerState({ running: false, port: null, pid: null, mode: 'offline' });
        }
      }
    } catch {}
  }, []);

  const refreshInfra = React.useCallback(async () => {
    try {
      const data = await apiGet('/api/health/infrastructure');
      setInfra(data);
      setHealthError(null);
    } catch (e: any) {
      setHealthError(e?.message || 'Health check failed');
    }
  }, []);

  const refreshLicense = React.useCallback(async () => {
    try {
      const s = await apiGet('/api/license/status');
      setLicenseStatus(s);
      try {
        const e = await apiGet('/api/license/expiry-info');
        setLicenseExpiry(e);
      } catch {}
    } catch {}
  }, []);

  const refreshLogs = React.useCallback(async () => {
    try {
      if (isTauri()) {
        const txt = await invoke<string>('get_server_logs', { lines: 200 });
        setLogs(txt || '(empty)');
      } else {
        // Fallback: try to fetch via API if available, else placeholder
        setLogs('Logs available only in Tauri mode. Use error-log.txt next to the server binary.');
      }
    } catch {}
  }, []);

  const refreshFirewall = React.useCallback(async () => {
    if (!isTauri()) return;
    try {
      const ok = await invoke<boolean>('check_firewall');
      setFirewallOk(ok);
      if (!ok) {
        // Try auto-add
        try { await invoke('fix_firewall'); setFirewallOk(true); } catch {}
      }
    } catch { setFirewallOk(false); }
  }, []);

  const refreshUpdate = React.useCallback(async () => {
    try {
      const data = await apiGet('/api/update/check?app=server');
      setUpdateInfo(data);
    } catch {}
  }, []);

  const refreshTelegramLinks = React.useCallback(async () => {
    try {
      const data = await apiGet('/api/admin/telegram-links/pending');
      setTelegramPending(Array.isArray(data) ? data : []);
    } catch {
      setTelegramPending([]);
    }
  }, []);

  const approveTelegramLink = async (requestId: string) => {
    try {
      await apiPost(`/api/admin/telegram-links/${requestId}/approve`);
      setTelegramStatus('Telegram link approved.');
      await refreshTelegramLinks();
    } catch (e: any) {
      setTelegramStatus(e?.message || 'Telegram link approval failed.');
    }
  };

  const refreshSystemInfo = React.useCallback(async () => {
    if (!isTauri()) return;
    try {
      const info = await invoke<any>('get_system_info');
      setSystemInfo(info);
    } catch {}
  }, []);

  // Initial + polling
  React.useEffect(() => {
    refreshServerState(); refreshInfra(); refreshLicense(); refreshLogs(); refreshFirewall(); refreshUpdate(); refreshSystemInfo(); refreshTelegramLinks();
    const id1 = setInterval(refreshServerState, 5000);
    const id2 = setInterval(refreshInfra, 5000);
    const id3 = setInterval(refreshLicense, 30000);
    const id4 = setInterval(refreshLogs, 10000);
    const id5 = setInterval(refreshTelegramLinks, 30000);
    return () => { clearInterval(id1); clearInterval(id2); clearInterval(id3); clearInterval(id4); clearInterval(id5); };
  }, [refreshServerState, refreshInfra, refreshLicense, refreshLogs, refreshFirewall, refreshUpdate, refreshSystemInfo, refreshTelegramLinks]);

  // Actions — Start/Stop/Restart (Tauri sidecar or remote)
  const handleStart = async () => {
    if (operationInProgress) return;
    setOperationInProgress(true);
    setManageStatus('Starting...');
    try {
      if (isTauri()) {
        const res: any = await invoke('start_server', { port: null });
        setManageStatus(`Started on port ${res.port} (pid ${res.pid})`);
      } else {
        setManageStatus('Start is only available in Tauri desktop — please run the server jar manually: java -DADMIN_PASSWORD=*** -jar clinic-server.jar');
      }
      await refreshServerState(); await refreshInfra();
    } catch (e: any) {
      setManageStatus(e?.toString() || 'Start failed');
    } finally { setOperationInProgress(false); }
  };
  const handleStop = async () => {
    if (!confirm('Stop the clinic server? All clients will be disconnected.')) return;
    if (operationInProgress) return;
    setOperationInProgress(true);
    setManageStatus('Stopping...');
    try {
      if (isTauri()) {
        await invoke('stop_server');
        setManageStatus('Stopped');
      } else {
        setManageStatus('Stop is only available in Tauri desktop');
      }
      await refreshServerState();
    } catch (e: any) { setManageStatus(e?.toString() || 'Stop failed'); }
    finally { setOperationInProgress(false); }
  };
  const handleRestart = async () => {
    if (serverState.running) {
      if (!confirm('Restart the server? Clients will be briefly disconnected.')) return;
    }
    if (operationInProgress) return;
    setOperationInProgress(true);
    setManageStatus('Restarting...');
    try {
      if (isTauri()) {
        await invoke('restart_server');
        setManageStatus('Restarted');
      } else {
        // Fallback: try stop then start via HTTP not possible — inform
        await handleStop(); await new Promise(r => setTimeout(r, 2000)); await handleStart();
      }
      await refreshServerState(); await refreshInfra();
    } catch (e: any) { setManageStatus(e?.toString() || 'Restart failed'); }
    finally { setOperationInProgress(false); }
  };

  // License actions — 100% parity with screenController
  const handleVerify = async () => {
    const key = licenseKeyInput.trim();
    if (!key) { setDangerStatus({ msg: 'Please enter your license key.', ok: false }); return; }
    setDangerStatus(null);
    try {
      const res: any = await apiPost('/api/license/validate-server', { licenseKey: key });
      const status = (res?.status || '').toUpperCase();
      if (status === 'VALID' || status === 'GRACE_PERIOD') {
        setDangerStatus({ msg: 'License verified! Server is now unlocked.', ok: true });
        await refreshLicense();
      } else if (['EXPIRED','INACTIVE','DEVICE_MISMATCH','INVALID'].includes(status)) {
        setDangerStatus({ msg: `License ${status.toLowerCase()}. Contact support.`, ok: false });
      } else {
        setDangerStatus({ msg: `Unexpected response: ${status} — ${res?.message || ''}`, ok: false });
      }
    } catch (e: any) {
      setDangerStatus({ msg: `Connection error: ${e?.message || e}`, ok: false });
    }
  };
  const handleReport = async () => {
    const phone = phoneInput.trim();
    if (!phone) { setDangerStatus({ msg: 'Please enter your phone number to send a report.', ok: false }); return; }
    const key = licenseKeyInput.trim() || (licenseStatus as any)?.licenseKey || 'NOT_PROVIDED';
    try {
      await apiPost('/api/license/report', { licenseKey: key, phone, source: 'SERVER_GUI' });
      setDangerStatus({ msg: `Support request sent! We will contact you at ${phone} within 24 hours.`, ok: true });
      setPhoneInput('');
    } catch (e: any) { setDangerStatus({ msg: `Failed to send report: ${e?.message || e}`, ok: false }); }
  };
  const handleRefreshLicense = async () => {
    setManageStatus('Syncing from Firebase...');
    try {
      const res: any = await apiPost('/api/license/sync', {});
      const locked = !!res?.locked;
      setManageStatus(locked ? `Server still locked: ${res?.message || ''}` : 'Synced from Firebase');
      await refreshLicense();
    } catch (e: any) { setManageStatus(e?.message || 'Sync failed'); }
  };
  const handleForceSync = async () => {
    const key = licenseKeyInput.trim();
    const body = key ? { licenseKey: key } : {};
    setManageStatus('Force-syncing...');
    try {
      const res: any = await apiPost('/api/license/sync', body);
      const locked = !!res?.locked;
      setManageStatus(locked ? 'Server locked after sync' : 'Key synced and applied');
      await refreshLicense();
    } catch (e: any) { setManageStatus(e?.message || 'Force sync failed'); }
  };
  const handleSyncLicense = async () => {
    await handleRefreshLicense();
  };
  const handleForceSyncNow = async () => {
    try { await apiPost('/api/sync/now', {}); setManageStatus('Force sync triggered'); } catch (e: any) { setManageStatus(e?.message || 'Sync failed'); }
  };
  const handleFirewallFix = async () => {
    if (!isTauri()) return;
    try { await invoke('fix_firewall'); setFirewallOk(true); } catch { setFirewallOk(false); }
    setTimeout(refreshFirewall, 3000);
  };
  const handleUpdateDownload = async () => {
    if (!updateInfo || updateBusy) return;
    setUpdateBusy(true);
    setUpdateError(null);
    try {
      const { downloadVerifiedUpdate } = await import('../lib/updateCheck');
      await downloadVerifiedUpdate(updateInfo);
      setManageStatus(`Update ${updateInfo.latestVersion} downloaded and checksum-verified.`);
    } catch (e: any) {
      setUpdateError(e?.message || 'Update download failed.');
    } finally { setUpdateBusy(false); }
  };
  const handleSendErrorReport = async () => {
    const phone = prompt('Enter your phone number for error report:');
    if (!phone) return;
    try {
      await apiPost('/api/license/error-report', { phone, errorLogs: logs.slice(0, 5000) });
      alert('Error report sent');
    } catch (e: any) { alert('Failed: ' + (e?.message || e)); }
  };

  const locked = !!licenseStatus?.locked;
  const reason = licenseStatus?.reason || '';
  const days = licenseExpiry?.daysUntilExpiry;
  const expiryBadge = days != null ? (
    days > 30 ? { text: `Expires in ${days} days`, color: 'success' as const } :
    days > 15 ? { text: `Expires in ${days} days`, color: 'info' as const } :
    days > 7 ? { text: `Expires in ${days} days`, color: 'warning' as const } :
    days > 3 ? { text: `Expires in ${days} days`, color: 'warning' as const } :
    days > 1 ? { text: `Expires in ${days} days`, color: 'error' as const } :
    days === 1 ? { text: 'Expires tomorrow!', color: 'error' as const } :
    { text: 'Expires today!', color: 'error' as const }
  ) : null;

  const infraRows = React.useMemo(() => {
    if (!infra) return [];
    const rows: any[] = [];
    rows.push({ component: 'Server', status: infra.status || infra.connectionStatus?.server || 'UNKNOWN', detail: infra['app.uptime'] || '' });
    rows.push({ component: 'Database', status: infra['db.status'] || infra.connectionStatus?.database || 'UNKNOWN', detail: `${infra['db.product'] || ''} / ${infra['db.url'] || ''}` });
    rows.push({ component: 'JVM Heap', status: (infra['jvm.heap.usedPct'] || 0) > 85 ? 'WARNING' : 'HEALTHY', detail: `${infra['jvm.heap.usedMb'] || 0} MB / ${infra['jvm.heap.maxMb'] || 0} MB` });
    rows.push({ component: 'OS', status: 'RUNNING', detail: `${infra['os.name'] || ''} / ${infra['os.processors'] || '?'} cores / Load: ${infra['os.loadAverage'] || 'N/A'}` });
    rows.push({ component: 'Threads', status: 'ACTIVE', detail: `${infra['threads.active'] || 0} active threads` });
    rows.push({ component: 'JVM', status: 'RUNNING', detail: `v${infra['jvm.version'] || ''} / Up: ${infra['app.uptime'] || ''}` });
    return rows;
  }, [infra]);

  const barColor = (pct: number) => pct < 70 ? 'success' : pct < 85 ? 'warning' : 'error';
  const cpuPct = Number(infra?.['jvm.heap.usedPct'] || infra?.cpuPct || 0);
  const ramPct = Number(infra?.['memory.usedPct'] || 0);
  const diskPct = Number(infra?.['disk.usedPct'] || 0);
  const dbPct = Number(infra?.['database.usedPct'] || 0);

  return (
    <Box sx={{ p: 2, maxWidth: 1280, mx: 'auto' }}>
      {/* Header */}
      <Paper sx={{ p: 2, mb: 2, display: 'flex', alignItems: 'center', gap: 2, bgcolor: '#0F172A', color: '#F8FAFC' }}>
        <Box sx={{ width: 44, height: 44, borderRadius: '50%', bgcolor: '#14B8A6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>⬢</Box>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 16, color: '#F8FAFC' }}>Zeyara Server Manager</Typography>
          <Typography sx={{ fontSize: 11, color: '#94A3B8' }}>Real-time server control and monitoring  •  Start  •  Stop  •  Restart  •  Monitor</Typography>
        </Box>
        <Chip label={`IP ${systemInfo?.ip || infra?.['serverIp'] || '-'}`} size="small" sx={{ bgcolor: '#132D2E', color: '#5EEAD4', border: '1px solid #1E4A4A' }} />
        <Chip label={`PORT ${serverState.port ?? '-'}`} size="small" sx={{ bgcolor: '#132D2E', color: '#F0FDFA', border: '1px solid #1E4A4A' }} />
      </Paper>

      {/* License status strip */}
      <Paper sx={{ p: 2, mb: 2, display: licenseStatus ? 'block' : 'none', bgcolor: '#111827', border: '1px solid #1E293B' }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: locked ? '#EF4444' : '#10B981' }} />
          <Typography sx={{ fontWeight: 700, fontSize: 12, color: '#94A3B8' }}>LICENSE STATUS</Typography>
          {expiryBadge && <Chip label={expiryBadge.text} color={expiryBadge.color} size="small" />}
        </Stack>
        <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
          <Typography variant="caption" sx={{ color: '#64748B' }}>Key: <span style={{ color: '#CBD5E1' }}>{(licenseExpiry as any)?.licenseKey || licenseStatus?.reason ? '***' : '—'}</span></Typography>
          <Typography variant="caption" sx={{ color: '#64748B' }}>Status: <span style={{ color: locked ? '#EF4444' : '#10B981' }}>{locked ? 'Locked' : 'Active'}</span></Typography>
          <Typography variant="caption" sx={{ color: '#64748B' }}>Expiry: <span style={{ color: '#CBD5E1' }}>{licenseExpiry?.expiryDate || '—'}</span></Typography>
        </Stack>
        {locked && (
          <Alert severity="error" sx={{ mt: 2 }}>
            <strong>SERVER LOCKED</strong> — {reason || 'License validation failed'}
          </Alert>
        )}
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '280px 1fr' }, gap: 2 }}>
        {/* Sidebar */}
        <Stack spacing={2}>
          <Paper sx={{ p: 2, textAlign: 'center', bgcolor: '#111827', border: '1px solid #1E293B' }}>
            <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: serverState.running ? (locked ? '#EF4444' : '#10B981') : '#475569', mx: 'auto', mb: 1 }} />
            <Typography sx={{ fontWeight: 700, color: '#F8FAFC' }}>{serverState.running ? (locked ? 'Locked' : 'Online') : 'Offline'}</Typography>
            <Typography variant="caption" sx={{ color: '#94A3B8' }}>Server</Typography>
          </Paper>

          <Paper sx={{ p: 2, bgcolor: '#111827', border: '1px solid #1E293B' }}>
            <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.08, color: '#64748B', mb: 1 }}>SYSTEM</Typography>
            <Stack spacing={1}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="caption" sx={{ color: '#94A3B8' }}>CLIENTS</Typography><Typography variant="caption" sx={{ color: '#F1F5F9', fontWeight: 600 }}>{infra?.clients?.drConnected ?? 0}</Typography></Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="caption" sx={{ color: '#94A3B8' }}>UPTIME</Typography><Typography variant="caption" sx={{ color: '#F1F5F9', fontWeight: 600 }}>{infra?.['app.uptime'] || '—'}</Typography></Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><Typography variant="caption" sx={{ color: '#94A3B8' }}>MODE</Typography><Typography variant="caption" sx={{ color: '#F1F5F9', fontWeight: 600 }}>{serverState.mode}</Typography></Box>
            </Stack>
          </Paper>

          <Paper sx={{ p: 2, bgcolor: '#111827', border: '1px solid #1E293B' }}>
            <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.08, color: '#64748B', mb: 1 }}>LIVE STATUS</Typography>
            {[
              { label: 'Server', dot: serverState.running ? 'dot-active' : 'dot-muted', text: serverState.running ? 'UP' : 'DOWN' },
              { label: 'Database', dot: infra?.connectionStatus?.database === 'CONNECTED' ? 'dot-active' : 'dot-danger', text: infra?.connectionStatus?.database || '—' },
              { label: 'Sync', dot: infra?.connectionStatus?.sync?.status === 'ACTIVE' ? 'dot-active' : 'dot-warning', text: infra?.connectionStatus?.sync?.status || '—' },
              { label: 'Firebase', dot: infra?.connectionStatus?.firebase === 'REACHABLE' ? 'dot-active' : 'dot-danger', text: infra?.connectionStatus?.firebase || '—' },
            ].map(r => (
              <Box key={r.label} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.5 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: r.dot === 'dot-active' ? '#10B981' : r.dot === 'dot-warning' ? '#F59E0B' : r.dot === 'dot-danger' ? '#EF4444' : '#475569' }} />
                <Box sx={{ flex: 1 }}><Typography variant="caption" sx={{ color: '#CBD5E1' }}>{r.label}</Typography><Typography variant="caption" sx={{ color: '#94A3B8', display: 'block' }}>{r.text}</Typography></Box>
              </Box>
            ))}
            <Button fullWidth size="small" variant="outlined" sx={{ mt: 1, borderColor: '#334155', color: '#CBD5E1' }} onClick={async () => { const { api } = await import('../lib/api'); await api.post('/api/sync/now', {}).catch(()=>{}); }}>
              ↻ Sync Now
            </Button>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: firewallOk ? '#10B981' : firewallOk === false ? '#EF4444' : '#475569' }} />
              <Typography variant="caption" sx={{ color: firewallOk ? '#10B981' : firewallOk === false ? '#EF4444' : '#94A3B8', flex: 1 }}>
                {firewallOk ? 'Firewall OK' : firewallOk === false ? 'Blocked — Click to allow' : 'Checking...'}
              </Typography>
            </Box>
            {firewallOk === false && <Button size="small" fullWidth variant="outlined" onClick={handleFirewallFix}>Fix Firewall (Admin)</Button>}
          </Paper>

          <Paper sx={{ p: 2, bgcolor: '#111827', border: '1px solid #1E293B' }}>
            <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.08, color: '#64748B', mb: 1 }}>LICENSE</Typography>
            <Typography variant="caption" sx={{ color: '#94A3B8', display: 'block', mb: 1 }}>{manageStatus}</Typography>
            <TextField size="small" fullWidth placeholder="License key (optional)" value={licenseKeyInput} onChange={e => setLicenseKeyInput(e.target.value)} sx={{ mb: 1, input: { color: '#F1F5F9' } }} />
            <Stack spacing={1}>
              <Button size="small" variant="outlined" onClick={handleRefreshLicense} sx={{ borderColor: '#334155', color: '#CBD5E1' }}>↻ Refresh</Button>
              <Button size="small" variant="outlined" onClick={handleForceSync} sx={{ borderColor: '#334155', color: '#CBD5E1' }}>↻ Force Sync</Button>
              <Button size="small" variant="outlined" onClick={() => { const k = prompt('Enter Admin License Key'); if (k) { setLicenseKeyInput(k); setTimeout(handleVerify, 100); } }} sx={{ borderColor: '#334155', color: '#CBD5E1' }}>✓ Admin Unlock</Button>
            </Stack>
          </Paper>
        </Stack>

        {/* Main */}
        <Stack spacing={2}>
          {/* Danger */}
          {locked && (
            <Paper sx={{ p: 3, bgcolor: '#1C1917', border: '1px solid #7C2D12' }}>
              <Typography sx={{ fontWeight: 800, color: '#F59E0B' }}>SERVER LOCKED</Typography>
              <Typography variant="body2" sx={{ color: '#FDBA74', mb: 2 }}>{reason || 'License validation failed'}</Typography>
              <Typography variant="caption" sx={{ color: '#94A3B8' }}>LICENSE KEY</Typography>
              <TextField fullWidth size="small" placeholder="Enter your license key" value={licenseKeyInput} onChange={e => setLicenseKeyInput(e.target.value)} sx={{ mb: 1, input: { color: '#F1F5F9' } }} />
              <Button fullWidth variant="contained" sx={{ bgcolor: '#14B8A6', color: '#042F2E', fontWeight: 700 }} onClick={handleVerify}>✓ Verify &amp; Unlock Server</Button>
              {dangerStatus && <Alert severity={dangerStatus.ok ? 'success' : 'error'} sx={{ mt: 2 }}>{dangerStatus.msg}</Alert>}
              <Divider sx={{ my: 2, borderColor: '#44403C' }} />
              <Typography variant="caption" sx={{ color: '#F59E0B' }}>⚠ Invalid License — Contact Support</Typography>
              <TextField fullWidth size="small" placeholder="Enter mobile number for verification" value={phoneInput} onChange={e => setPhoneInput(e.target.value.replace(/[^+\d]/g,''))} sx={{ mt: 1, input: { color: '#F1F5F9' } }} />
              <Button fullWidth variant="outlined" sx={{ mt: 1, borderColor: '#334155', color: '#CBD5E1' }} onClick={handleReport}>✉ Submit Support Request</Button>
            </Paper>
          )}

          {/* Offline banner */}
          {infra?.connectionStatus && (infra.connectionStatus.server !== 'UP' || (infra.connectionStatus.sync?.pendingCount || 0) > 0) && (
            <Alert severity="warning" action={<Button size="small" onClick={handleForceSyncNow}>Retry Sync</Button>}>
              {(infra.connectionStatus.server !== 'UP' ? 'Offline Mode — server unreachable' : `Offline Mode — ${infra.connectionStatus.sync.pendingCount} pending record(s)`) + (infra.connectionStatus.sync?.lastSyncTime ? ` — Last sync: ${infra.connectionStatus.sync.lastSyncTime.slice(11,16)}` : '')}
            </Alert>
          )}

          <Paper sx={{ p: 2, bgcolor: '#111827', border: '1px solid #1E293B' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography sx={{ fontWeight: 700, fontSize: 12, color: '#F8FAFC' }}>Telegram Link Requests</Typography>
              <Button size="small" variant="outlined" onClick={refreshTelegramLinks}>Refresh</Button>
            </Box>
            {telegramStatus && <Alert severity="info" sx={{ mb: 1 }}>{telegramStatus}</Alert>}
            {telegramPending.length === 0 ? (
              <Typography variant="caption" color="text.secondary">No pending Telegram links.</Typography>
            ) : (
              <Table size="small">
                <TableHead><TableRow><TableCell>Phone</TableCell><TableCell>Patient ID</TableCell><TableCell>Action</TableCell></TableRow></TableHead>
                <TableBody>
                  {telegramPending.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell sx={{ color: '#CBD5E1' }}>{request.phone || '—'}</TableCell>
                      <TableCell sx={{ color: '#CBD5E1' }}>{request.patientId || '—'}</TableCell>
                      <TableCell><Button size="small" color="success" onClick={() => approveTelegramLink(request.id)}>Approve</Button></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Paper>

          {/* Infrastructure */}
          <Paper sx={{ p: 2, bgcolor: '#111827', border: '1px solid #1E293B' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography sx={{ fontWeight: 700, color: '#F8FAFC' }}>Infrastructure Dashboard</Typography>
              <Button size="small" variant="outlined" onClick={refreshInfra} sx={{ borderColor: '#334155', color: '#CBD5E1' }}>Refresh Now</Button>
            </Box>
            {healthError && <Alert severity="error" sx={{ mb: 2 }}>{healthError}</Alert>}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 2, mb: 2 }}>
              {[
                { label: 'CPU', value: cpuPct, color: barColor(cpuPct) },
                { label: 'RAM', value: ramPct, color: barColor(ramPct) },
                { label: 'Disk', value: diskPct, color: barColor(diskPct) },
                { label: 'Database', value: dbPct, color: barColor(dbPct) },
              ].map(m => (
                <Paper key={m.label} sx={{ p: 2, textAlign: 'center', bgcolor: '#0F172A', border: '1px solid #1E293B' }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.08, color: '#64748B' }}>{m.label}</Typography>
                  <LinearProgress variant="determinate" value={Math.min(100, Math.max(0, m.value))} color={m.color as any} sx={{ height: 6, borderRadius: 3, my: 1, bgcolor: '#1E293B' }} />
                  <Typography sx={{ fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', color: '#F8FAFC' }}>{Number.isFinite(m.value) ? `${m.value.toFixed(1)}%` : '—'}</Typography>
                </Paper>
              ))}
            </Box>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ color: '#64748B', fontWeight: 700, fontSize: 11 }}>Component</TableCell>
                  <TableCell sx={{ color: '#64748B', fontWeight: 700, fontSize: 11 }}>Status</TableCell>
                  <TableCell sx={{ color: '#64748B', fontWeight: 700, fontSize: 11 }}>Detail</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {infraRows.map((r, i) => (
                  <TableRow key={i} sx={{ bgcolor: i % 2 === 0 ? '#0F172A' : '#111827' }}>
                    <TableCell sx={{ color: '#CBD5E1' }}>{r.component}</TableCell>
                    <TableCell sx={{ color: r.status === 'CONNECTED' || r.status === 'HEALTHY' || r.status === 'UP' || r.status === 'RUNNING' || r.status === 'ACTIVE' ? '#10B981' : r.status === 'WARNING' || r.status === 'DEGRADED' ? '#F59E0B' : '#EF4444', fontWeight: 700 }}>{r.status}</TableCell>
                    <TableCell sx={{ color: '#94A3B8', fontSize: 12 }}>{r.detail}</TableCell>
                  </TableRow>
                ))}
                {!infra && <TableRow><TableCell colSpan={3} align="center" sx={{ color: '#64748B' }}>No content in table</TableCell></TableRow>}
              </TableBody>
            </Table>
            <Typography variant="caption" sx={{ color: '#64748B', mt: 1, display: 'block' }}>Last updated: {infra ? new Date().toLocaleTimeString() : '—'}</Typography>
          </Paper>

          {/* Logs */}
          <Paper sx={{ p: 2, bgcolor: '#111827', border: '1px solid #1E293B' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography sx={{ fontWeight: 700, fontSize: 12, color: '#94A3B8' }}>Server Activity Log</Typography>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#F59E0B', ml: 1 }} />
              <Box sx={{ flex: 1 }} />
              <Button size="small" variant="text" sx={{ color: '#94A3B8' }} onClick={() => { navigator.clipboard.writeText(logs); }}>📋 Copy</Button>
              <Button size="small" variant="text" sx={{ color: '#94A3B8' }} onClick={handleSendErrorReport}>✉ Report</Button>
            </Box>
            <Box sx={{ bgcolor: '#020617', border: '1px solid #1E293B', borderRadius: 1, p: 1, maxHeight: 200, overflow: 'auto', fontFamily: 'IBM Plex Mono, monospace', fontSize: 11, color: '#CBD5E1', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {logs}
            </Box>
          </Paper>

          {/* Controls */}
          <Stack direction="row" spacing={1}>
            <Button fullWidth variant="contained" disabled={serverState.running || operationInProgress} onClick={handleStart} sx={{ bgcolor: '#14B8A6', color: '#042F2E', fontWeight: 700, '&:disabled': { bgcolor: '#1E293B', color: '#475569' } }}>
              {operationInProgress && !serverState.running ? <CircularProgress size={16} /> : '▶  Start'}
            </Button>
            <Button fullWidth variant="outlined" disabled={!serverState.running || operationInProgress} onClick={handleStop} sx={{ borderColor: '#334155', color: '#CBD5E1' }}>■  Stop</Button>
            <Button fullWidth variant="outlined" disabled={operationInProgress} onClick={handleRestart} sx={{ borderColor: '#334155', color: '#CBD5E1' }}>↺  Restart</Button>
            <Button fullWidth variant="outlined" disabled={operationInProgress} onClick={handleSyncLicense} sx={{ borderColor: '#334155', color: '#CBD5E1' }}>↻  Sync</Button>
          </Stack>
          {updateInfo?.updateAvailable && (
            <Alert severity={updateInfo.forceUpdate ? 'error' : 'info'}>
              Update {updateInfo.latestVersion} available —{' '}
              <Button size="small" disabled={updateBusy} onClick={handleUpdateDownload}>
                {updateBusy ? 'Verifying…' : 'Download'}
              </Button>
              {updateInfo.releaseNotes && <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>{updateInfo.releaseNotes}</Typography>}
            </Alert>
          )}
          {updateError && <Alert severity="error" onClose={() => setUpdateError(null)}>{updateError}</Alert>}
        </Stack>
      </Box>
    </Box>
  );
};
