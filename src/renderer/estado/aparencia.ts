// Aparência da interface (Preferências › Aparência): tema, contraste, densidade, tamanho e movimento. Fica no
// armazenamento local da janela (é da máquina, não do projeto) e vira atributos no <html> que os tokens leem
// (estilo/tokens.ts): data-tema, data-contraste, data-densidade, data-faixa e data-movimento. "Sistema" segue o que o
// sistema operacional pede (prefers-color-scheme, prefers-contrast, prefers-reduced-motion) e acompanha a troca ao vivo.
import {useSyncExternalStore} from 'react';

export type Aparencia = {
  tema: 'sistema' | 'escuro' | 'claro';
  contraste: 'sistema' | 'normal' | 'alto';
  densidade: 'auto' | 'confortavel' | 'compacta'; // auto: compacta na faixa C (janela abaixo de 1600×800)
  escala: number; // tamanho da interface: 0,9 a 1,5
  movimento: 'sistema' | 'reduzido' | 'normal';
};

export const APARENCIA_PADRAO: Aparencia = {tema: 'escuro', contraste: 'sistema', densidade: 'auto', escala: 1, movimento: 'sistema'};
export const ESCALAS = [0.9, 1, 1.1, 1.25, 1.5];
const CHAVE = 'estudio:aparencia';

const um = <T extends string>(v: unknown, validos: readonly T[], padrao: T): T => (validos.includes(v as T) ? (v as T) : padrao);

/** Lê com calma o que estiver gravado (campo que falta ou torto vale o padrão). */
export const normalizarAparencia = (x: unknown): Aparencia => {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  const escala = typeof o.escala === 'number' && Number.isFinite(o.escala) ? Math.min(1.5, Math.max(0.9, o.escala)) : APARENCIA_PADRAO.escala;
  return {
    tema: um(o.tema, ['sistema', 'escuro', 'claro'] as const, APARENCIA_PADRAO.tema),
    contraste: um(o.contraste, ['sistema', 'normal', 'alto'] as const, APARENCIA_PADRAO.contraste),
    densidade: um(o.densidade, ['auto', 'confortavel', 'compacta'] as const, APARENCIA_PADRAO.densidade),
    escala,
    movimento: um(o.movimento, ['sistema', 'reduzido', 'normal'] as const, APARENCIA_PADRAO.movimento),
  };
};

const lerGravada = (): Aparencia => {
  try {
    return normalizarAparencia(JSON.parse(localStorage.getItem(CHAVE) ?? 'null'));
  } catch {
    return APARENCIA_PADRAO;
  }
};

const consulta = (q: string) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null);
const sistemaClaro = () => Boolean(consulta('(prefers-color-scheme: light)')?.matches);
const sistemaAlto = () => Boolean(consulta('(prefers-contrast: more)')?.matches);
const sistemaReduz = () => Boolean(consulta('(prefers-reduced-motion: reduce)')?.matches);

/** O que vale de fato, com "sistema" resolvido. */
export const efetiva = (a: Aparencia, s = {claro: sistemaClaro(), alto: sistemaAlto(), reduz: sistemaReduz()}) => ({
  tema: a.tema === 'sistema' ? (s.claro ? 'claro' : 'escuro') : a.tema,
  contraste: a.contraste === 'sistema' ? (s.alto ? 'alto' : 'normal') : a.contraste,
  movimento: a.movimento === 'sistema' ? (s.reduz ? 'reduzido' : 'normal') : a.movimento,
}) as {tema: 'escuro' | 'claro'; contraste: 'normal' | 'alto'; movimento: 'normal' | 'reduzido'};

/** Faixa de layout de docs/tela.md: C (compacta) abaixo de 1600×800, P (padrão) acima. */
export const faixaDaJanela = (): 'C' | 'P' => (window.innerWidth < 1600 || window.innerHeight < 800 ? 'C' : 'P');

let atual: Aparencia = typeof localStorage === 'undefined' ? APARENCIA_PADRAO : lerGravada();
const ouvintes = new Set<() => void>();
// o que os componentes leem: a escolha e o que vale de fato (muda também quando o sistema troca de tema)
let foto = {escolha: atual, ...efetiva(atual)};
const avisar = () => {
  foto = {escolha: atual, ...efetiva(atual)};
  ouvintes.forEach((f) => f());
};

const aplicarNoDocumento = () => {
  if (typeof document === 'undefined') return;
  const raiz = document.documentElement;
  const e = efetiva(atual);
  raiz.dataset.tema = e.tema;
  raiz.dataset.contraste = e.contraste;
  raiz.dataset.movimento = e.movimento;
  raiz.dataset.densidade = atual.densidade;
  raiz.dataset.faixa = faixaDaJanela();
  // tamanho da interface: zoom do CSS na raiz (o Chromium do Electron segue o zoom padronizado, com coordenadas de
  // evento e de getBoundingClientRect no mesmo espaço); 100% não põe nada
  raiz.style.zoom = atual.escala === 1 ? '' : String(atual.escala);
};

export const aparencia = {
  get: () => atual,
  efetiva: () => efetiva(atual),
  definir(m: Partial<Aparencia>) {
    atual = normalizarAparencia({...atual, ...m});
    try {
      localStorage.setItem(CHAVE, JSON.stringify(atual));
    } catch {
      /* sem armazenamento: vale até fechar */
    }
    aplicarNoDocumento();
    avisar();
  },
  assinar(f: () => void) {
    ouvintes.add(f);
    return () => {
      ouvintes.delete(f);
    };
  },
};

/** A escolha da pessoa e o que vale de fato (tema, contraste e movimento com o sistema resolvido). */
export const usarAparencia = () => useSyncExternalStore(aparencia.assinar, () => foto);

/** Liga a aparência à janela: aplica agora e acompanha o sistema e o tamanho da janela. */
export const instalarAparencia = () => {
  if (typeof window === 'undefined') return;
  aplicarNoDocumento();
  const mudou = () => {
    aplicarNoDocumento();
    avisar();
  };
  for (const q of ['(prefers-color-scheme: light)', '(prefers-contrast: more)', '(prefers-reduced-motion: reduce)']) consulta(q)?.addEventListener('change', mudou);
  let faixa = faixaDaJanela();
  window.addEventListener('resize', () => {
    if (faixaDaJanela() === faixa) return;
    faixa = faixaDaJanela();
    document.documentElement.dataset.faixa = faixa;
  });
};
