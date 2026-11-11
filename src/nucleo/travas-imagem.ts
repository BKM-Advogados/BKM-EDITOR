// Camada travada na imagem (rodada 3, B2): a pessoa trava pela tela e nada da IA mexe nela. Projeto.aplicarPatch pede
// motivoDaTrava antes de gravar um patch que não é da pessoa e recusa com o motivo: o patch é aplicado numa cópia, e
// cada camada travada de antes tem de sair igual (mesma página, mesmo id, mesmo conteúdo). Mudar a ordem da pilha passa (a camada não muda);
// mexer, apagar ou destravar não. Travar passa. Destravar pela IA só pela ferramenta destravar_camadas (classe cartão),
// que roda dentro de `destravando`. Ver docs/imagem.md.
import jsonpatch, {type Operation} from 'fast-json-patch';
import type {CamadaImagem, DocImagem, OperacaoPatch} from './documentos';

let destravarPermitido = false;

/** Roda `f` (uma chamada síncrona a aplicarPatch) com o destravar liberado para a IA. */
export const destravando = <T,>(f: () => T): T => {
  destravarPermitido = true;
  try {
    return f();
  } finally {
    destravarPermitido = false;
  }
};

/** Documento com camadas: a imagem (com ou sem páginas) e também a animação, de propósito. O cadeado da Animação
 *  (CamadasAnimacao) grava o mesmo `travada`, e travar_camadas e destravar_camadas valem lá (M4 da auditoria do MCP). */
const temCamadas = (d: unknown): d is DocImagem => {
  const x = d as DocImagem | null;
  return Boolean(x) && typeof x === 'object' && (Array.isArray(x!.camadas) || Array.isArray(x!.paginas));
};

const semTrava = (c: CamadaImagem) => {
  const {travada: _t, ...resto} = c;
  return JSON.stringify(resto);
};

/** Todas as camadas por "página\0id" (página sem `paginas` é a raiz), com o JSON delas inteiro e sem a trava. */
const porChave = (d: DocImagem) => {
  const mapa = new Map<string, {travada: boolean; json: string; semTrava: string}[]>();
  const listas: [string, CamadaImagem[]][] = Array.isArray(d.paginas)
    ? d.paginas.map((p, k) => [p?.id ?? `#${k}`, Array.isArray(p?.camadas) ? p.camadas : []])
    : [['raiz', Array.isArray(d.camadas) ? d.camadas : []]];
  for (const [pagina, camadas] of listas) {
    for (const c of camadas) {
      if (!c || typeof c !== 'object') continue;
      const k = `${pagina}\u0000${c.id}`;
      mapa.set(k, [...(mapa.get(k) ?? []), {travada: c.travada === true, json: JSON.stringify(c), semTrava: semTrava(c)}]);
    }
  }
  return mapa;
};

/** Por que o patch (que não é da pessoa) não pode passar: mexe numa camada travada; null se pode. Travar passa. */
export const motivoDaTrava = (doc: unknown, patch: OperacaoPatch[], autor: string): string | null => {
  if (autor === 'pessoa' || !temCamadas(doc)) return null;
  const antes = porChave(doc);
  if (![...antes.values()].some((l) => l.some((x) => x.travada))) return null;
  let depois: unknown;
  try {
    depois = jsonpatch.applyPatch(structuredClone(doc), patch as Operation[], false, false).newDocument;
  } catch {
    return null; // patch que não se aplica cai no erro de sempre, adiante
  }
  const agora = temCamadas(depois) ? porChave(depois) : new Map<string, {travada: boolean; json: string; semTrava: string}[]>();
  for (const [k, lista] of antes) {
    if (!lista.some((x) => x.travada)) continue;
    const id = k.split('\u0000')[1];
    const depoisDela = agora.get(k) ?? [];
    // a chave de uma camada travada não ganha cópias: uma cópia igual (mesmo id) bastaria para "provar" que a travada
    // ficou como estava, e a original poderia ser mexida ou destravada
    if (depoisDela.length > lista.length) {
      return `a camada ${id} está travada pela pessoa: não crie outra camada com o mesmo id (use um id novo)`;
    }
    // cada travada de antes casa com uma camada diferente de depois (o par é consumido)
    const livres = [...depoisDela];
    const consumir = (achar: (y: (typeof livres)[number]) => boolean) => {
      const i = livres.findIndex(achar);
      if (i >= 0) livres.splice(i, 1);
      return i >= 0;
    };
    for (const x of lista.filter((y) => y.travada)) {
      if (consumir((y) => y.json === x.json)) continue;
      // mesma camada, só sem a trava: é destravar, que a IA só faz pela ferramenta destravar_camadas
      const destravada = consumir((y) => !y.travada && y.semTrava === x.semTrava);
      if (destravada && destravarPermitido) continue;
      return destravada
        ? `a camada ${id} está travada pela pessoa: destravar é pela ferramenta destravar_camadas, com o ok da pessoa`
        : `a camada ${id} está travada pela pessoa: nada foi gravado. Deixe essa camada fora do patch ou peça para destravar`;
    }
  }
  return null;
};
