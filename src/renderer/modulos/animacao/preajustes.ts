// O "modo animar" explícito (como o Animate do Rive), para mexer num valor não criar quadro-chave sem querer. Os
// pré-ajustes de entrada e de saída moram no núcleo (src/nucleo/animacao-preajustes.ts), que o MCP também usa.
// ---------- modo animar ----------
let animar = false;
const ouvintes = new Set<() => void>();
export const modoAnimar = {
  get: () => animar,
  alternar() {
    animar = !animar;
    ouvintes.forEach((f) => f());
  },
  assinar(f: () => void) {
    ouvintes.add(f);
    return () => {
      ouvintes.delete(f);
    };
  },
};
