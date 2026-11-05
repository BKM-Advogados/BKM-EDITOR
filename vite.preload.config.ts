import {defineConfig} from 'vite';

export default defineConfig({
  // mesma pasta do processo principal (main.ts carrega o preload de __dirname); ver vite.main.config.ts
  build: {outDir: '.vite/app'},
});
