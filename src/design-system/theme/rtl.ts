import createCache from '@emotion/cache';
import stylisPluginRTL from 'stylis-plugin-rtl';

export function createRtlCache() {
  return createCache({
    key: 'muirtl',
    stylisPlugins: [stylisPluginRTL],
  });
}

export function createLtrCache() {
  return createCache({
    key: 'muiltr',
  });
}
