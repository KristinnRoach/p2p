import { fileURLToPath, URL } from 'node:url';

export function localP2PConfig(configUrl) {
  const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));

  return {
    resolve: {
      alias: [
        {
          find: /^@kidlib\/p2p\/components\/solid$/,
          replacement: `${sourceRoot}/components/solid/index.jsx`,
        },
        {
          find: /^@kidlib\/p2p\/components$/,
          replacement: `${sourceRoot}/components/web-components.js`,
        },
        {
          find: /^@kidlib\/p2p\/solid$/,
          replacement: `${sourceRoot}/adapters/solid.js`,
        },
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
      exclude: [
        '@kidlib/p2p',
        '@kidlib/p2p/components',
        '@kidlib/p2p/components/solid',
        '@kidlib/p2p/solid',
      ],
    },
    server: {
      fs: {
        allow: [fileURLToPath(new URL('../..', configUrl))],
      },
    },
  };
}
