import { fileURLToPath, URL } from 'node:url';

export function localP2PConfig(configUrl) {
  return {
    resolve: {
      alias: [
        {
          find: '@kidlib/p2p/solid',
          replacement: fileURLToPath(
            new URL('../../src/adapters/solid.js', configUrl),
          ),
        },
        {
          find: '@kidlib/p2p',
          replacement: fileURLToPath(new URL('../../src/index.js', configUrl)),
        },
        {
          find: '@shared',
          replacement: fileURLToPath(new URL('./shared', import.meta.url)),
        },
      ],
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
