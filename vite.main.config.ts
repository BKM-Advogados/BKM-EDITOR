import {defineConfig} from 'vite';

export default defineConfig({
  define: {
    // `ws` (usado pelo Remotion) quebra no Rollup se tentar os auxiliares nativos opcionais
    'process.env.WS_NO_BUFFER_UTIL': JSON.stringify('1'),
    'process.env.WS_NO_UTF_8_VALIDATE': JSON.stringify('1'),
  },
  build: {
    rollupOptions: {
      // nativos e o bundler do Remotion (webpack) ficam fora do pacote do processo principal
      external: ['@remotion/bundler', '@lydell/node-pty', 'fsevents'],
    },
  },
});
