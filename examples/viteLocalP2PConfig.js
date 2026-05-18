import { fileURLToPath, URL } from 'node:url';

export function localP2PConfig(configUrl) {
  const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));

  return {
    resolve: {
      alias: [
        {
          find: /^@kidlib\/p2p$/,
          replacement: `${sourceRoot}/index.js`,
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
