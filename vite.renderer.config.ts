import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    // módulos pesados (3D, terminal, prévia) saem em pedaços carregados sob demanda
    chunkSizeWarningLimit: 1500,
  },
});
