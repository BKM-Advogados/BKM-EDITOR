// Ids estáveis para cenas, blocos e itens do roteiro. A posição no array muda quando alguém insere um bloco; o id não,
// e é nele que comentário e seleção se ancoram. Só preenche o que falta: id que já existe nunca muda.
import type {Roteiro} from './resolver';

type Obj = Record<string, unknown>;

export const garantirIds = (r: Roteiro): {roteiro: Roteiro; mudou: boolean} => {
  const copia = structuredClone(r) as Roteiro;
  const usados = new Set<string>();
  const coletar = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(coletar);
    else if (x && typeof x === 'object') {
      const o = x as Obj;
      if (typeof o.id === 'string') usados.add(o.id);
      Object.values(o).forEach(coletar);
    }
  };
  coletar(copia.cenas);
  let mudou = false;
  const livre = (base: string) => {
    let n = 1;
    while (usados.has(`${base}-${n}`)) n++;
    const id = `${base}-${n}`;
    usados.add(id);
    mudou = true;
    return id;
  };
  let partes = 0;
  for (const cena of copia.cenas as Obj[]) {
    if (cena.tipo === 'parte') partes++;
    if (typeof cena.id !== 'string') {
      const base = cena.tipo === 'parte' ? `parte${partes}` : String(cena.tipo);
      cena.id = usados.has(base) ? livre(base) : (usados.add(base), (mudou = true), base);
    }
    for (const b of (cena.blocos ?? []) as Obj[]) {
      if (typeof b.id !== 'string') b.id = livre(`${String(cena.id)}-${String(b.tipo)}`);
      for (const lista of ['itens', 'barras', 'marcas', 'faixas'] as const) {
        for (const it of (b[lista] ?? []) as Obj[]) if (typeof it.id !== 'string') it.id = livre(`${String(b.id)}-item`);
      }
    }
  }
  return {roteiro: copia, mudou};
};
