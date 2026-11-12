// O conteúdo do projeto de exemplo ("Ver um exemplo", exemplo.ts): um vídeo de cenas curto, vertical, que mostra o que
// uma cena tem (título, texto, lista, número e imagem com movimento), no tema neutro e sem marca de ninguém. As imagens
// são SVG desenhados aqui, sem foto nem arte de terceiros. `scripts/gerar-exemplo.ts` grava estes arquivos em
// exemplos/exemplo/ e o teste (testes/exemplo.test.ts) confere que a pasta versionada é exatamente esta: para mudar o
// exemplo, mude aqui e rode `npm run exemplo`. O CLAUDE.md não vai junto: o app o escreve ao abrir a cópia, já com o
// texto da versão instalada.
import {TEMA_NEUTRO, type BlocoCenas, type CenaCenas, type DocCenas} from './cenas';
import type {Manifesto} from './documentos';

// o mesmo texto do serializar de projeto.ts, aqui sem node:fs: a prévia web (scripts/previa-web) importa este arquivo
const serializar = (doc: unknown) => `${JSON.stringify(doc, null, 2)}\n`;

const CAMINHO_DOC = 'video/video.json';
export const IMAGENS_DO_EXEMPLO = {paisagem: 'midia/exemplo-paisagem.svg', blocos: 'midia/exemplo-blocos.svg'};

const bloco = (cena: string, n: number, b: Omit<BlocoCenas, 'id'>): BlocoCenas => ({id: `${cena}-${b.tipo}-${n}`, ...b});

const CENAS: CenaCenas[] = [
  {id: 'abertura', nome: 'Abertura', duracao_ms: 4000, blocos: [
    bloco('abertura', 1, {tipo: 'titulo', em: 0, x: 0.08, y: 0.36, largura: 0.84, alinhar: 'centro', texto: 'Seu primeiro vídeo no **Estúdio**'}),
    bloco('abertura', 2, {tipo: 'texto', em: 700, x: 0.1, y: 0.56, largura: 0.8, alinhar: 'centro', cor: TEMA_NEUTRO.suave,
      texto: 'Cada cena tem a sua duração e blocos que entram no tempo certo.'}),
  ]},
  {id: 'blocos', nome: 'Blocos', duracao_ms: 5500, blocos: [
    bloco('blocos', 1, {tipo: 'titulo', em: 0, x: 0.08, y: 0.14, largura: 0.84, alinhar: 'esquerda', tam: 0.07, texto: 'O que cabe numa cena'}),
    bloco('blocos', 2, {tipo: 'lista', em: 500, x: 0.08, y: 0.3, largura: 0.84, alinhar: 'esquerda',
      itens: ['Título e texto, com **destaque**', 'Lista como esta', 'Número que conta sozinho', 'Imagem com movimento']}),
    bloco('blocos', 3, {tipo: 'imagem', em: 1500, x: 0.18, y: 0.6, largura: 0.64, altura: 0.28, ajuste: 'conter', src: IMAGENS_DO_EXEMPLO.blocos}),
  ]},
  {id: 'numero', nome: 'Número', duracao_ms: 4500, blocos: [
    bloco('numero', 1, {tipo: 'numero', em: 0, x: 0.1, y: 0.32, largura: 0.8, alinhar: 'centro', de: 0, ate: 30, rotulo: 'quadros por segundo, como sai na exportação'}),
    bloco('numero', 2, {tipo: 'texto', em: 1800, x: 0.1, y: 0.62, largura: 0.8, alinhar: 'centro', cor: TEMA_NEUTRO.suave,
      texto: 'O número conta de um valor a outro enquanto a cena passa.'}),
  ]},
  {id: 'imagem', nome: 'Imagem', duracao_ms: 5000, blocos: [
    bloco('imagem', 1, {tipo: 'imagem', em: 0, x: 0, y: 0, largura: 1, altura: 1, ajuste: 'cobrir', src: IMAGENS_DO_EXEMPLO.paisagem,
      movimento: {tipo: 'aproximar', intensidade: 0.15, suave: true}}),
    bloco('imagem', 2, {tipo: 'texto', em: 600, x: 0.08, y: 0.74, largura: 0.84, alinhar: 'centro', peso: 600,
      texto: 'Imagens entram com **zoom suave**, sem programa de edição.'}),
  ]},
  {id: 'fecho', nome: 'Fecho', duracao_ms: 4500, blocos: [
    bloco('fecho', 1, {tipo: 'titulo', em: 0, x: 0.08, y: 0.36, largura: 0.84, alinhar: 'centro', texto: 'Agora é com **você**'}),
    bloco('fecho', 2, {tipo: 'texto', em: 600, x: 0.1, y: 0.56, largura: 0.8, alinhar: 'centro', cor: TEMA_NEUTRO.suave,
      texto: 'Mude o que quiser: este projeto é uma cópia. Ou peça ao Claude uma peça nova.'}),
  ]},
];

export const DOC_DO_EXEMPLO: DocCenas = {tipo: 'cenas', formato: {largura: 1080, altura: 1920, fps: 30}, tema: {...TEMA_NEUTRO}, cenas: CENAS, efeitos: []};

export const MANIFESTO_DO_EXEMPLO: Manifesto = {formato: 1, nome: 'Exemplo', documentos: [{id: 'video', modulo: 'video', caminho: CAMINHO_DOC, titulo: 'Vídeo de exemplo'}]};

// paisagem abstrata: céu em degradê, sol e três camadas de morro, nas cores do tema neutro com um toque de azul-acinzentado
const SVG_PAISAGEM = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920" width="1080" height="1920">
  <defs>
    <linearGradient id="ceu" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1B2230"/>
      <stop offset="0.55" stop-color="#3A4658"/>
      <stop offset="1" stop-color="#8C96A3"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#ceu)"/>
  <circle cx="760" cy="760" r="150" fill="#E8E2D6" opacity="0.9"/>
  <path d="M0 1180 L220 980 L420 1120 L640 900 L860 1080 L1080 940 L1080 1920 L0 1920 Z" fill="#5A6576"/>
  <path d="M0 1340 L180 1220 L400 1330 L620 1180 L860 1310 L1080 1210 L1080 1920 L0 1920 Z" fill="#3B4452"/>
  <path d="M0 1520 L260 1420 L520 1500 L780 1390 L1080 1480 L1080 1920 L0 1920 Z" fill="#1E242D"/>
</svg>
`;

// esquema de uma cena: quatro retângulos que lembram título, texto, número e imagem
const SVG_BLOCOS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540">
  <rect x="8" y="8" width="944" height="524" rx="28" fill="#1A1F26" stroke="#A3ABB5" stroke-width="4"/>
  <rect x="64" y="72" width="520" height="56" rx="12" fill="#F2F2F2"/>
  <rect x="64" y="160" width="400" height="28" rx="8" fill="#A3ABB5"/>
  <rect x="64" y="208" width="340" height="28" rx="8" fill="#A3ABB5"/>
  <rect x="64" y="300" width="180" height="160" rx="16" fill="none" stroke="#F2F2F2" stroke-width="6"/>
  <text x="154" y="408" font-family="Inter, sans-serif" font-size="96" font-weight="700" fill="#F2F2F2" text-anchor="middle">30</text>
  <rect x="300" y="300" width="596" height="160" rx="16" fill="#3A4658"/>
  <circle cx="820" cy="350" r="26" fill="#E8E2D6"/>
  <path d="M300 460 L460 360 L580 430 L700 340 L896 460 Z" fill="#5A6576"/>
</svg>
`;

/** Os arquivos do exemplo, caminho relativo → texto (LF). */
export const arquivosDoExemplo = (): Record<string, string> => ({
  'estudio.json': serializar(MANIFESTO_DO_EXEMPLO),
  [CAMINHO_DOC]: serializar(DOC_DO_EXEMPLO),
  [IMAGENS_DO_EXEMPLO.paisagem]: SVG_PAISAGEM,
  [IMAGENS_DO_EXEMPLO.blocos]: SVG_BLOCOS,
});
