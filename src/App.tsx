import React from 'react';
import { AppRoutes } from './routes';
import UpdateE2ePage from './pages/UpdateE2ePage';
import { updateE2eEnabled } from './lib/updateE2e';

/**
 * Application root.
 *
 * The updater E2E harness is an alternate root rather than a route. Registering it in the
 * router would put it in the route table, from where the sidebar's `ROUTE_ACCESS` map and
 * any future navigation work would treat it as a real page; keeping it out of the router
 * means it cannot appear in production navigation at all. It renders only when
 * `ZEYARA_UPDATE_E2E` is set in the environment, and the flag is re-checked here on every
 * mount rather than baked in at build time, so a production installer ships with the
 * harness inert.
 *
 * With the flag unset - the normal case - this renders exactly what it always did.
 */
function App() {
  const [e2e, setE2e] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let live = true;
    void updateE2eEnabled().then((enabled) => {
      if (live) setE2e(enabled);
    });
    return () => {
      live = false;
    };
  }, []);

  // Unknown means "not the E2E build in this process". Rendering the normal app first
  // avoids a flash of the harness and means a failed probe degrades to production.
  if (e2e === true) return <UpdateE2ePage />;
  return <AppRoutes />;
}

export default App;
