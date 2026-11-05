import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    include: ['testes/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'referencia', 'out', '.vite'],
  },
});
