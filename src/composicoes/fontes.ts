// Fontes das composições: as do Google Fonts (licença OFL), carregadas sob demanda, e as de arquivo (fontes próprias de
// um kit de marca, em fontes/ do projeto ou na pasta do kit), carregadas pela URL do servidor de mídia com o loadFont do
// @remotion/fonts, que segura o render (delayRender) até a fonte chegar. Do Google só ficam registradas as do tema
// neutro (Inter) e do tema da Cliente: cada import puxa o código da família para o pacote, e o motor do Mac registrava 41 (ver
// desempenho.md). Fonte do Google nova entra aqui; fonte de arquivo entra pelo kit (menu → Marca…).
import {loadFont as carregarArquivo} from '@remotion/fonts';
import {loadFont as Archivo} from '@remotion/google-fonts/Archivo';
import {loadFont as IBMPlexMono} from '@remotion/google-fonts/IBMPlexMono';
import {loadFont as IBMPlexSans} from '@remotion/google-fonts/IBMPlexSans';
import {loadFont as Inter} from '@remotion/google-fonts/Inter';

type Carregador = (estilo: 'normal', opcoes: {subsets: string[]; ignoreTooManyRequestsWarning: boolean}) => {fontFamily: string};
const GOOGLE: Record<string, Carregador> = {Archivo, IBMPlexMono, IBMPlexSans, Inter} as unknown as Record<string, Carregador>;
export const FONTES_GOOGLE = ['Archivo', 'IBM Plex Mono', 'IBM Plex Sans', 'Inter'];

/** Uma variante (peso e estilo) de uma fonte de arquivo, pela URL que o servidor de mídia serve. Fonte variável leva
 *  `pesoMax`: o arquivo serve a todos os pesos de `peso` a `pesoMax` ("100 900"), não a um só. */
export type FonteDeArquivo = {familia: string; url: string; peso?: number; pesoMax?: number; estilo?: 'normal' | 'italic'};

/** Da fonte que o kit ou o projeto descrevem (peso_max) para a que o carregador pede. */
export const deFonteArquivo = (f: {familia: string; peso?: number; peso_max?: number; estilo?: 'normal' | 'italic'}, url: string): FonteDeArquivo =>
  ({familia: f.familia, url, peso: f.peso, pesoMax: f.peso_max, estilo: f.estilo});
const FORMATO: Record<string, 'truetype' | 'opentype' | 'woff' | 'woff2'> = {ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2'};

const carregadas = new Map<string, string>(); // nome → font-family CSS
const deArquivo = new Map<string, FonteDeArquivo[]>(); // família → variantes
const pedidas = new Set<string>(); // URLs já entregues ao FontFace

/** Registra fontes de arquivo (uma entrada por peso e estilo). Repetir não faz mal; variante nova de uma família já em
 *  uso é pedida no próximo fonte(). */
export const registrarFontesDeArquivo = (lista: FonteDeArquivo[]) => {
  for (const f of lista) {
    if (!f.familia || !f.url) continue;
    const variantes = deArquivo.get(f.familia) ?? [];
    if (variantes.some((v) => v.url === f.url)) continue;
    variantes.push(f);
    deArquivo.set(f.familia, variantes);
    carregadas.delete(f.familia);
  }
};

const pedirArquivos = (familia: string) => {
  for (const v of deArquivo.get(familia) ?? []) {
    if (pedidas.has(v.url)) continue;
    pedidas.add(v.url);
    if (typeof FontFace === 'undefined') continue; // Node (testes): registra sem carregar
    const ext = v.url.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
    carregarArquivo({family: familia, url: v.url, format: FORMATO[ext] ?? 'truetype', weight: v.pesoMax ? `${v.peso ?? 100} ${v.pesoMax}` : v.peso ? String(v.peso) : undefined, style: v.estilo})
      .catch(() => pedidas.delete(v.url)); // arquivo que não veio: o texto sai na fonte do sistema e a próxima vez tenta de novo
  }
};

/** "IBM Plex Sans" → carrega e devolve o font-family CSS. Família de arquivo registrada carrega pelos arquivos dela;
 *  nome desconhecido volta como está (fonte do sistema). */
export const fonte = (nome: string): string => {
  const ja = carregadas.get(nome);
  if (ja) return ja;
  const google = GOOGLE[nome.replace(/\s+/g, '')];
  let familia = nome;
  if (google) familia = google('normal', {subsets: ['latin', 'latin-ext'], ignoreTooManyRequestsWarning: true}).fontFamily;
  else if (deArquivo.has(nome)) pedirArquivos(nome);
  carregadas.set(nome, familia);
  return familia;
};

/** As fontes que a interface oferece: as do Google registradas e as de arquivo já conhecidas (do kit ou do projeto). */
export const listarFontes = (): {nome: string; origem: 'google' | 'arquivo'}[] => [
  ...FONTES_GOOGLE.map((nome) => ({nome, origem: 'google' as const})),
  ...[...deArquivo.keys()].filter((n) => !FONTES_GOOGLE.includes(n)).sort((a, b) => a.localeCompare(b, 'pt-BR')).map((nome) => ({nome, origem: 'arquivo' as const})),
];
