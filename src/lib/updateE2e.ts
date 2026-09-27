/**
 * Gate for the updater E2E entry point.
 *
 * The flag lives in the process environment rather than the build, so the same signed
 * installer carries the harness inert in production and active only when a test launches
 * it with `ZEYARA_UPDATE_E2E` set. Baking it in at build time would have meant shipping a
 * second binary whose updater configuration could drift from the real one, and the E2E
 * would then be testing something other than what is released.
 *
 * The name is the same for every role and the value is not a secret - it only decides
 * whether a test page renders. It grants no capability: the page can do exactly what the
 * dashboard banner already can, and only reaches the updater through the same functions.
 */
export async function updateE2eEnabled(): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const cfg = await invoke<{ enabled: boolean }>('update_e2e_config');
    return cfg?.enabled === true;
  } catch {
    // No Tauri runtime (browser/dev) or the command is unavailable: never the E2E build.
    return false;
  }
}
