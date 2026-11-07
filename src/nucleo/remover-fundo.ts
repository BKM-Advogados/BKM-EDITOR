// Remover fundo: o modelo local (catálogo com licença, endereço fixo e SHA-256), o tamanho da entrada, o nome do
// arquivo sem fundo e os patches da camada. Só regras, sem disco nem rede: o processo principal baixa e grava
// (src/main/remover-fundo.ts), a interface roda o ONNX num Web Worker (src/renderer/modulos/imagem/removerFundo*.ts) e
// a ferramenta remover_fundo do MCP usa as mesmas funções. O arquivo da pessoa nunca é sobrescrito: o resultado vai
// para midia/<arquivo>.sem-fundo.png e a camada guarda o original em `src_original`. Ver docs/imagem.md.
import type {CamadaImagem, OperacaoPatch} from './documentos';

/** Um modelo de segmentação baixável. `bytes` e `sha256` conferem o arquivo; a entrada é RGB normalizada
 *  ((x/255 − média) / desvio), com o lado menor em `lado` px e os dois lados múltiplos de `multiplo`. */
export type ModeloFundo = {
  id: string;
  nome: string;
  licenca: string;
  origem: string; // repositório do modelo original
  url: string; // endereço fixo (revisão travada) do arquivo ONNX
  arquivo: string;
  bytes: number;
  sha256: string;
  lado: number;
  multiplo: number;
  maior: number; // teto do lado maior da entrada
  entrada: string;
  saida: string;
  media: number;
  desvio: number;
};

// MODNet (Ke e outros, AAAI 2022), retrato: recorta pessoa com cabelo e ombro, que é o caso do advogado na capa. A
// versão ONNX é a do Xenova (transformers.js), revisão fa2fa54 de 26/10/2025, Apache-2.0 como o original. 25,9 MB em
// fp32. Foi escolhido por ser o menor que dá conta de retrato; para objeto e logo, o ISNet (Apache-2.0, 170 MB) é o
// próximo da lista (docs/imagem.md).
export const MODNET: ModeloFundo = {
  id: 'modnet',
  nome: 'MODNet (retrato)',
  licenca: 'Apache-2.0',
  origem: 'https://github.com/ZHKKKe/MODNet',
  url: 'https://huggingface.co/Xenova/modnet/resolve/fa2fa546052fba4c08921230a26cc69a333fca12/onnx/model.onnx',
  arquivo: 'model.onnx',
  bytes: 25_888_640,
  sha256: '07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9',
  lado: 512,
  multiplo: 32,
  maior: 1024,
  entrada: 'input',
  saida: 'output',
  media: 0.5,
  desvio: 0.5,
};

export const MODELO_FUNDO = MODNET;

/** O que a interface sabe do modelo: se já está na máquina, o tamanho a baixar e onde fica. */
export type EstadoModeloFundo = {pronto: boolean; id: string; nome: string; licenca: string; bytes: number; pasta: string};

/** Tamanho da entrada do modelo para uma foto iw × ih: o lado menor vai a `lado` (sem passar do maior teto), os dois
 *  arredondados para múltiplo de `multiplo`. */
export const tamanhoDaEntrada = (iw: number, ih: number, m: Pick<ModeloFundo, 'lado' | 'multiplo' | 'maior'> = MODELO_FUNDO) => {
  const s = Math.min(m.lado / Math.max(1, Math.min(iw, ih)), m.maior / Math.max(1, Math.max(iw, ih)));
  const arredondar = (x: number) => Math.max(m.multiplo, Math.round((x * s) / m.multiplo) * m.multiplo);
  return {w: arredondar(iw), h: arredondar(ih)};
};

/** "midia/foto.jpg" → "midia/foto.sem-fundo.png"; arquivo fora de midia/ ganha o sem fundo dentro dela
 *  ("fotos/ana.jpg" → "midia/ana.sem-fundo.png"). Do original, se a camada já está sem fundo. */
export const caminhoSemFundo = (src: string) => {
  const semExt = src.replace(/\\/g, '/').replace(/\.sem-fundo\.png$/i, '').replace(/\.[^./]+$/, '');
  return `${semExt.startsWith('midia/') ? semExt : `midia/${semExt.split('/').pop()}`}.sem-fundo.png`;
};

/** Patch que troca a imagem da camada pela sem fundo e guarda o original (só da primeira vez). */
export const patchSemFundo = (c: CamadaImagem, caminho: string, semFundo: string): OperacaoPatch[] => [
  {op: 'test', path: `${caminho}/id`, value: c.id},
  {op: 'test', path: `${caminho}/src`, value: c.src},
  {op: 'replace', path: `${caminho}/src`, value: semFundo},
  ...(c.src_original ? [] : [{op: 'add' as const, path: `${caminho}/src_original`, value: c.src}]),
];

/** "Voltar ao original": a camada volta ao arquivo de antes (o sem fundo fica em midia/, para reusar). */
export const patchVoltarAoOriginal = (c: CamadaImagem, caminho: string): OperacaoPatch[] =>
  !c.src_original ? [] : [
    {op: 'test', path: `${caminho}/id`, value: c.id},
    {op: 'test', path: `${caminho}/src_original`, value: c.src_original},
    {op: c.src === undefined ? 'add' : 'replace', path: `${caminho}/src`, value: c.src_original},
    {op: 'remove', path: `${caminho}/src_original`},
  ];

// ---------- quem executa ----------
// O MCP roda no processo principal (HTTP) ou fora do app (stdio, sem janela): quem sabe remover fundo se registra aqui
// ao subir (src/main/remover-fundo.ts). Fora do app não há registro e a ferramenta avisa.

/** Recebe o caminho da imagem no projeto; grava o PNG sem fundo e devolve o caminho dele e o tempo do modelo. */
export type RemovedorDeFundo = (src: string) => Promise<{caminho: string; ms: number}>;

let removedor: RemovedorDeFundo | null = null;
export const definirRemovedorDeFundo = (f: RemovedorDeFundo | null) => {
  removedor = f;
};
export const removedorDeFundo = () => removedor;
