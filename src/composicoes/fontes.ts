// Fontes do Google Fonts (licença OFL) carregadas sob demanda. Só as do tema neutro (Inter) e do tema da Cliente ficam
// registradas: cada import puxa o código da família para o pacote, e o motor do Mac registrava 41 (ver desempenho.md).
// Fonte nova entra aqui.
import {loadFont as Archivo} from '@remotion/google-fonts/Archivo';
import {loadFont as IBMPlexMono} from '@remotion/google-fonts/IBMPlexMono';
import {loadFont as IBMPlexSans} from '@remotion/google-fonts/IBMPlexSans';
import {loadFont as Inter} from '@remotion/google-fonts/Inter';

type Carregador = (estilo: 'normal', opcoes: {subsets: string[]; ignoreTooManyRequestsWarning: boolean}) => {fontFamily: string};
const REGISTRO: Record<string, Carregador> = {Archivo, IBMPlexMono, IBMPlexSans, Inter} as unknown as Record<string, Carregador>;

const carregadas = new Map<string, string>();

/** "IBM Plex Sans" → carrega e devolve o font-family CSS. Nome desconhecido volta como está (fonte do sistema). */
export const fonte = (nome: string): string => {
  const ja = carregadas.get(nome);
  if (ja) return ja;
  const loader = REGISTRO[nome.replace(/\s+/g, '')];
  const familia = loader ? loader('normal', {subsets: ['latin', 'latin-ext'], ignoreTooManyRequestsWarning: true}).fontFamily : nome;
  carregadas.set(nome, familia);
  return familia;
};
