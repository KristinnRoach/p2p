import { fileURLToPath, URL } from 'node:url';

export function localP2PConfig(configUrl) {
  return {
    resolve: {
      alias: {
        '@kidlib/p2p': fileURLToPath(new URL('../../src/index.js', configUrl)),
      },
    },
    optimizeDeps: {
      exclude: ['@kidlib/p2p'],
    },
    server: {
      fs: {
        allow: [fileURLToPath(new URL('../..', configUrl))],
      },
    },
  };
}
