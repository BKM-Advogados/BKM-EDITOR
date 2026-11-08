// Fontes das composições. As quatro famílias do Estúdio (Inter, Archivo, IBM Plex Sans e IBM Plex Mono, licença OFL, o
// subconjunto latin que cobre o português) vêm empacotadas no app, em fontes-pacote/: a exportação e a prévia não
// dependem da internet (antes cada família ia buscar o arquivo em fonts.gstatic.com e o render falhava depois de 60 s,
// sem rede ou atrás de um proxy). As fontes de arquivo de um kit de marca (fontes/ do projeto ou pasta do kit) entram
// pelo endereço do servidor de mídia. Uma fonte que não carrega nunca cancela a exportação: a família vira um apelido
// de uma fonte do sistema (Segoe UI, Arial…) e o texto sai nela, com um aviso no console. Fonte nova do Google entra
// aqui, com o arquivo em fontes-pacote/ e a licença ao lado; fonte de arquivo entra pelo kit (menu → Marca…).
import {continueRender, delayRender} from 'remotion';
import archivoVariavel from './fontes-pacote/archivo-latin-wght-normal.woff2';
import interVariavel from './fontes-pacote/inter-latin-wght-normal.woff2';
import mono100 from './fontes-pacote/ibm-plex-mono-latin-100-normal.woff2';
import mono200 from './fontes-pacote/ibm-plex-mono-latin-200-normal.woff2';
import mono300 from './fontes-pacote/ibm-plex-mono-latin-300-normal.woff2';
import mono400 from './fontes-pacote/ibm-plex-mono-latin-400-normal.woff2';
import mono500 from './fontes-pacote/ibm-plex-mono-latin-500-normal.woff2';
import mono600 from './fontes-pacote/ibm-plex-mono-latin-600-normal.woff2';
import mono700 from './fontes-pacote/ibm-plex-mono-latin-700-normal.woff2';
import sans100 from './fontes-pacote/ibm-plex-sans-latin-100-normal.woff2';
import sans200 from './fontes-pacote/ibm-plex-sans-latin-200-normal.woff2';
import sans300 from './fontes-pacote/ibm-plex-sans-latin-300-normal.woff2';
import sans400 from './fontes-pacote/ibm-plex-sans-latin-400-normal.woff2';
import sans500 from './fontes-pacote/ibm-plex-sans-latin-500-normal.woff2';
import sans600 from './fontes-pacote/ibm-plex-sans-latin-600-normal.woff2';
import sans700 from './fontes-pacote/ibm-plex-sans-latin-700-normal.woff2';

/** Uma variante (peso e estilo) de uma fonte, pelo endereço do arquivo. Fonte variável leva `pesoMax`: o arquivo serve a
 *  todos os pesos de `peso` a `pesoMax` ("100 900"), não a um só. */
export type FonteDeArquivo = {familia: string; url: string; peso?: number; pesoMax?: number; estilo?: 'normal' | 'italic'};

/** Da fonte que o kit ou o projeto descrevem (peso_max) para a que o carregador pede. */
export const deFonteArquivo = (f: {familia: string; peso?: number; peso_max?: number; estilo?: 'normal' | 'italic'}, url: string): FonteDeArquivo =>
  ({familia: f.familia, url, peso: f.peso, pesoMax: f.peso_max, estilo: f.estilo});

const estaticas = (familia: string, urls: string[]): FonteDeArquivo[] => urls.map((url, i) => ({familia, url, peso: (i + 1) * 100}));

/** As famílias que vêm no app. O nome é o que o tema e as camadas dizem em `fonte`. */
const EMPACOTADAS: Record<string, FonteDeArquivo[]> = {
  Archivo: [{familia: 'Archivo', url: archivoVariavel, peso: 100, pesoMax: 900}],
  'IBM Plex Mono': estaticas('IBM Plex Mono', [mono100, mono200, mono300, mono400, mono500, mono600, mono700]),
  'IBM Plex Sans': estaticas('IBM Plex Sans', [sans100, sans200, sans300, sans400, sans500, sans600, sans700]),
  Inter: [{familia: 'Inter', url: interVariavel, peso: 100, pesoMax: 900}],
};
/** O nome continua "do Google" por onde a família nasceu (a licença é a OFL); o arquivo agora vai dentro do app. */
export const FONTES_GOOGLE = ['Archivo', 'IBM Plex Mono', 'IBM Plex Sans', 'Inter'];

const SISTEMA = ['Segoe UI', 'Helvetica Neue', 'Arial', 'Roboto', 'DejaVu Sans'];
/** O apelido da fonte que não veio: uma fonte do sistema, em negrito de verdade quando a variante é de peso 600 ou mais. */
const sistemaPara = (v: FonteDeArquivo) => SISTEMA.map((n) => `local("${n}${(v.peso ?? 400) >= 600 && !v.pesoMax ? ' Bold' : ''}")`).join(', ');
const TEMPO_MS = 12_000;
const NOVA_TENTATIVA_MS = 5_000;

const deArquivo = new Map<string, FonteDeArquivo[]>(); // família → variantes de kit e de projeto
const esperas = new Map<string, Promise<void>>(); // família + url + peso + estilo → carregamento (nunca rejeita)
const falhou = new Map<string, number>(); // quando a variante falhou, para tentar de novo só depois de um tempo

const chaveDe = (v: FonteDeArquivo) => `${v.familia}|${v.url}|${v.peso ?? ''}|${v.pesoMax ?? ''}|${v.estilo ?? ''}`; // o mesmo arquivo sob duas famílias carrega duas vezes
const formatoDe = (url: string) => {
  const ext = url.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
  return ({ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2'} as Record<string, string>)[ext];
};

/** Registra fontes de arquivo (uma entrada por peso e estilo). Repetir não faz mal; variante nova de uma família em uso é
 *  pedida no próximo fonte(). */
export const registrarFontesDeArquivo = (lista: FonteDeArquivo[]) => {
  for (const f of lista) {
    if (!f.familia || !f.url) continue;
    const variantes = deArquivo.get(f.familia) ?? [];
    if (variantes.some((v) => chaveDe(v) === chaveDe(f))) continue;
    variantes.push(f);
    deArquivo.set(f.familia, variantes);
  }
};

const variantesDe = (nome: string): FonteDeArquivo[] => [...(EMPACOTADAS[nome] ?? []), ...(deArquivo.get(nome) ?? [])];

const descritores = (v: FonteDeArquivo): FontFaceDescriptors => ({
  weight: v.pesoMax ? `${v.peso ?? 100} ${v.pesoMax}` : v.peso ? String(v.peso) : undefined,
  style: v.estilo,
});

const comPrazo = <T,>(p: Promise<T>) => new Promise<T>((ok, falha) => {
  const t = setTimeout(() => falha(new Error(`passou de ${TEMPO_MS / 1000} s`)), TEMPO_MS);
  p.then((x) => (clearTimeout(t), ok(x)), (e) => (clearTimeout(t), falha(e)));
});

/** Carrega a variante pelo CSS (url() vale em http e em file://, e a mesma rota serve a prévia e o render). Segura o
 *  render (delayRender) até chegar ou falhar; falhou, a família vira apelido de uma fonte do sistema e o render segue. */
const carregarVariante = (v: FonteDeArquivo): Promise<void> => {
  const chave = chaveDe(v);
  const jaTem = esperas.get(chave);
  if (jaTem && !(falhou.has(chave) && Date.now() - falhou.get(chave)! > NOVA_TENTATIVA_MS)) return jaTem;
  if (typeof FontFace === 'undefined') return Promise.resolve(); // Node (testes): registra sem carregar
  const handle = delayRender(`Fonte ${v.familia} (${v.url})`, {timeoutInMilliseconds: TEMPO_MS + 8_000});
  const formato = formatoDe(v.url);
  falhou.delete(chave);
  const p = (async () => {
    try {
      const face = new FontFace(v.familia, `url("${v.url}")${formato ? ` format("${formato}")` : ''}`, descritores(v));
      await comPrazo(face.load());
      document.fonts.add(face);
    } catch (e) {
      falhou.set(chave, Date.now());
      console.warn(`[fontes] ${v.familia} não carregou de ${v.url} (${(e as Error).message}): o texto sai numa fonte do sistema`);
      try {
        const reserva = new FontFace(v.familia, sistemaPara(v), descritores(v));
        await reserva.load();
        document.fonts.add(reserva);
      } catch {
        /* sem nenhuma das fontes do sistema: o navegador escolhe a dele */
      }
    } finally {
      continueRender(handle);
    }
  })();
  esperas.set(chave, p);
  return p;
};

/** "IBM Plex Sans" → pede os arquivos da família (os do app e os do kit ou do projeto) e devolve o nome para o font-family;
 *  nome desconhecido volta como está (fonte do sistema). */
export const fonte = (nome: string): string => {
  for (const v of variantesDe(nome)) void carregarVariante(v);
  return nome;
};

/** Espera as famílias terminarem de carregar (ou falharem): a exportação da imagem desenha num canvas e precisa da fonte
 *  pronta, o que o document.fonts.ready sozinho não garante para arquivo que ainda nem foi pedido. */
export const aguardarFontes = async (nomes: string[]): Promise<void> => {
  const pedidos = [...new Set(nomes)].flatMap((n) => variantesDe(n).map((v) => carregarVariante(v)));
  await Promise.all(pedidos);
};

/** As fontes que a interface oferece: as quatro do app e as de arquivo já conhecidas (do kit ou do projeto). */
export const listarFontes = (): {nome: string; origem: 'google' | 'arquivo'}[] => [
  ...FONTES_GOOGLE.map((nome) => ({nome, origem: 'google' as const})),
  ...[...deArquivo.keys()].filter((n) => !FONTES_GOOGLE.includes(n)).sort((a, b) => a.localeCompare(b, 'pt-BR')).map((nome) => ({nome, origem: 'arquivo' as const})),
];
