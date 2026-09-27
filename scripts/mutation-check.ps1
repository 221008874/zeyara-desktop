# Mutation check for the client's critical policies.
#
# A green test proves nothing by itself: the guard could render for everyone and the test
# would still pass if it never exercised the deny path. Each mutation breaks one policy the
# way a plausible regression would, and counts as killed only if the suite actually fails.
#
# Detection uses vitest's exit code, not its output. The first version of this script
# parsed stdout and reported all thirteen mutations as surviving, including ones that are
# demonstrably caught - the harness was wrong, not the tests.
#
# Restoration is `git checkout --`, so a mutation cannot survive a crash or a Ctrl-C.
$suites = @(
  'src/test/accessControl.test.tsx'
  'src/test/apiClient.test.ts'
  'src/test/authLifecycle.test.ts'
  'src/test/licenseStore.test.ts'
  'src/test/setupGate.test.tsx'
  'src/test/sseClient.test.ts'
  'src/test/serverUrl.test.ts'
  'src/test/updatePolicy.test.ts'
  'src/test/navigation.test.ts'
)

$mutations = @(
  @{ name = 'RoleGuard: always allow (deny removed)'
     file = 'src/app-shell/accessControl.tsx'
     from = 'if (!session?.role || !roles.includes(session.role)) {'
     to   = 'if (false) {' }

  @{ name = 'RoleGuard: ignore the missing-role case'
     file = 'src/app-shell/accessControl.tsx'
     from = 'if (!session?.role || !roles.includes(session.role)) {'
     to   = 'if (session?.role && !roles.includes(session.role)) {' }

  @{ name = 'ProtectedRoute: skip the forced password change'
     file = 'src/app-shell/accessControl.tsx'
     from = 'if (session.mustChangePassword) return <ChangePasswordPage />;'
     to   = 'if (false) return <ChangePasswordPage />;' }

  @{ name = 'SetupGate: key off the persisted flag (the bug that was fixed)'
     file = 'src/app-shell/accessControl.tsx'
     from = "if (verdict === 'firstUse') return <SetupWizardPage />;"
     to   = 'if (!firstUseComplete) return <SetupWizardPage />;' }

  @{ name = 'LicenseGate: treat an unknown status as activated'
     file = 'src/app-shell/accessControl.tsx'
     from = 'if (!status?.activated) return <LicenseScreen />;'
     to   = 'if (false) return <LicenseScreen />;' }

  @{ name = 'setup: report first use when the server is unreachable'
     file = 'src/stores/setup.ts'
     from = "          set({ isChecking: false });`n          return false;"
     to   = "          set({ isChecking: false, firstUseComplete: false });`n          return true;" }

  @{ name = 'api: no refresh mutex (rotate per concurrent 401)'
     file = 'src/lib/api.ts'
     from = 'if (!refreshPromise) {'
     to   = 'if (true) {' }

  @{ name = 'api: do not replay the request after a successful refresh'
     file = 'src/lib/api.ts'
     from = 'if (refreshed) {'
     to   = 'if (false) {' }

  @{ name = 'api: do not clear the session when the refresh fails'
     file = 'src/lib/api.ts'
     from = 'useAuthStore.getState().clearSession();'
     to   = '/* mutated: no logout */' }

  @{ name = 'api: send an Authorization header with no session'
     file = 'src/lib/api.ts'
     from = 'if (token) {'
     to   = 'if (true) {' }

  @{ name = 'api: do not surface the server error message'
     file = 'src/lib/api.ts'
     from = 'errorMsg = errBody.error ?? errBody.message ?? errorMsg;'
     to   = '/* mutated: always the generic status */' }

  @{ name = 'license: activate when the server omits `locked` (the fail-open that was fixed)'
     file = 'src/stores/license.ts'
     from = 'activated: data.locked === false,'
     to   = 'activated: !data.locked,' }

  @{ name = 'license: do not fail closed when the server is unreachable'
     file = 'src/stores/license.ts'
     from = '            activated: false,'
     to   = '            activated: true,' }

  @{ name = 'serverUrl: allow plain HTTP to a non-loopback host in production'
     file = 'src/lib/serverUrl.ts'
     from = "if (!isLoopbackHost(url.hostname)) {"
     to   = 'if (false) {' }

  @{ name = 'updatePolicy: offer a downgrade'
     file = 'src/lib/updatePolicy.ts'
     from = "if (cmp < 0) return { offer: false, reason: 'older' };"
     to   = "if (cmp < 0) return { offer: true, from: pc.normalised, to: parseVersion(latest)!.normalised };" }
)

# Baseline: the unmutated suite must pass, otherwise "killed" means nothing.
npx vitest run @suites --testTimeout=20000 *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "  ABORT: the suite is already failing before any mutation."
  exit 1
}
Write-Host "  baseline green"

$killed = 0
$survived = @()
$skipped = @()

foreach ($m in $mutations) {
  # Normalised to LF before matching: git restores these files with CRLF, so a multi-line
  # anchor written with `n silently stopped matching and the mutation was skipped. A skipped
  # mutation is worse than a failing one - it looks like a pass.
  $raw = (Get-Content -LiteralPath $m.file -Raw) -replace "`r`n", "`n"
  if (-not $raw.Contains($m.from)) {
    Write-Host ("  SKIP     {0}   (anchor not found)" -f $m.name)
    $skipped += $m.name
    continue
  }

  $mutated = $raw.Replace($m.from, $m.to)
  if ($mutated -eq $raw) { Write-Host ("  SKIP     {0}   (no change)" -f $m.name); continue }
  Set-Content -LiteralPath $m.file -Value $mutated -NoNewline

  npx vitest run @suites --testTimeout=20000 *> $null
  $code = $LASTEXITCODE

  git checkout -- $m.file 2>$null

  if ($code -eq 0) {
    Write-Host ("  SURVIVED {0}" -f $m.name)
    $survived += $m.name
  } else {
    Write-Host ("  killed   {0}" -f $m.name)
    $killed++
  }
}

Write-Host ""
Write-Host ("killed {0} of {1} applied mutations" -f $killed, ($mutations.Count - $skipped.Count))
if ($skipped.Count) { Write-Host ("skipped: " + ($skipped -join '; ')) }
if ($survived.Count) {
  Write-Host "SURVIVED (tests are too weak here):"
  $survived | ForEach-Object { Write-Host ("  - " + $_) }
} else {
  Write-Host "no mutation survived"
}
