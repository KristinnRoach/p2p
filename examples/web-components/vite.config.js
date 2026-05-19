import { localP2PConfig } from '../viteLocalP2PConfig.js';

export default {
  ...localP2PConfig(import.meta.url),
};
