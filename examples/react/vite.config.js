import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { localP2PConfig } from '../viteLocalP2PConfig.js';

export default defineConfig({
  plugins: [react()],
  ...localP2PConfig(import.meta.url),
});
