import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    include: ['testes/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 20000, // a máquina cheia (vários apps abertos) passa de 5 s nos testes de render
    exclude: ['node_modules', 'referencia', 'out', '.vite'],
  },
});
