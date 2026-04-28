import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { localP2PConfig } from '../viteLocalP2PConfig.js';

export default defineConfig({
  plugins: [solid()],
  ...localP2PConfig(import.meta.url),
});
