import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { fileURLToPath, URL } from 'node:url';
import { localP2PConfig } from '../viteLocalP2PConfig.js';

const p2pConfig = localP2PConfig(import.meta.url);

export default defineConfig({
  plugins: [solid()],
  ...p2pConfig,
  resolve: {
    alias: {
      ...p2pConfig.resolve.alias,
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
});
