// Modelo "Carrossel narrado (9:16)" da tela inicial (Onda B): o carrossel narrado feito em cima do vídeo de cenas, sem o
// roteiro.json do resolvedor próprio (docs/carrossel-narrado.md). A estrutura é a dele (gancho, partes, dúvida e fecho),
// em 1080×1920, com o texto falado de cada cena em `narracao.texto` (narração por IA, docs/narracao.md). O caminho:
// trocar os textos da tela e da fala, gerar a narração (ou gravar uma por cena), "Ajustar as cenas à fala" (a cena passa
// a durar a fala) e "Transcrever" (as legendas palavra a palavra). As durações de partida saem da mesma estimativa do
// teleprompter (medirFala), para o vídeo já tocar no ritmo de uma fala antes de gerar. Os blocos entram em ms contados do
// começo da cena e ficam acima da faixa das legendas (y até 0,68).
import {TEMA_NEUTRO, type BlocoCenas, type CenaCenas, type DocCenas} from './cenas';
import type {Formato} from './formatos';
import {configDaNarracao, medirFala} from './narracao';

const CONFIG = configDaNarracao(undefined);
const SUAVE = TEMA_NEUTRO.suave;

/** Duração de partida: a fala estimada mais a folga e a margem padrão da narração, em passos de 100 ms. */
const duracaoDaFala = (texto: string) => Math.max(2500, Math.round((medirFala(texto, CONFIG).segundos * 1000 + CONFIG.folga_ms + CONFIG.margem_ms) / 100) * 100);

type Cena = {id: string; nome: string; fala: string; blocos: Omit<BlocoCenas, 'id'>[]};

const CENAS: Cena[] = [
  {id: 'gancho', nome: 'Gancho', fala: 'Você sabia que dá para explicar um assunto inteiro em menos de um minuto? Fica comigo.', blocos: [
    {tipo: 'texto', em: 0, x: 0.08, y: 0.2, largura: 0.84, alinhar: 'esquerda', tam: 0.035, peso: 600, cor: SUAVE, texto: 'O TEMA DO VÍDEO'},
    {tipo: 'titulo', em: 300, x: 0.08, y: 0.27, largura: 0.84, alinhar: 'esquerda', tam: 0.1, texto: 'A pergunta que **prende** quem passa'},
  ]},
  {id: 'parte-1', nome: 'Parte 1', fala: 'Primeiro, o que é preciso saber. São três pontos, e cada um entra na tela quando eu falo dele.', blocos: [
    {tipo: 'texto', em: 0, x: 0.08, y: 0.16, largura: 0.84, alinhar: 'esquerda', tam: 0.035, peso: 600, cor: SUAVE, texto: 'PARTE 1 DE 2'},
    {tipo: 'titulo', em: 200, x: 0.08, y: 0.22, largura: 0.84, alinhar: 'esquerda', tam: 0.075, texto: 'O que é preciso saber'},
    {tipo: 'lista', em: 1200, x: 0.08, y: 0.4, largura: 0.84, alinhar: 'esquerda', itens: ['Primeiro ponto', 'Segundo ponto', 'Terceiro ponto']},
  ]},
  {id: 'parte-2', nome: 'Parte 2', fala: 'Agora o número que importa: setenta por cento. É ele que muda a decisão.', blocos: [
    {tipo: 'texto', em: 0, x: 0.08, y: 0.16, largura: 0.84, alinhar: 'esquerda', tam: 0.035, peso: 600, cor: SUAVE, texto: 'PARTE 2 DE 2'},
    {tipo: 'numero', em: 900, x: 0.08, y: 0.28, largura: 0.84, alinhar: 'centro', de: 0, ate: 70, sufixo: '%', rotulo: 'o que o número mede'},
  ]},
  {id: 'duvida', nome: 'Dúvida', fala: 'E aí, isso vale para o seu caso? Deixa a sua dúvida nos comentários.', blocos: [
    {tipo: 'titulo', em: 0, x: 0.08, y: 0.3, largura: 0.84, alinhar: 'centro', tam: 0.085, texto: 'E no **seu** caso?'},
    {tipo: 'texto', em: 1500, x: 0.1, y: 0.48, largura: 0.8, alinhar: 'centro', cor: SUAVE, texto: 'Deixe a sua dúvida nos comentários'},
  ]},
  {id: 'fecho', nome: 'Fecho', fala: 'Salva este vídeo para ver depois e manda para quem precisa saber disso.', blocos: [
    {tipo: 'titulo', em: 0, x: 0.08, y: 0.32, largura: 0.84, alinhar: 'centro', tam: 0.08, texto: 'Salve e compartilhe'},
    {tipo: 'texto', em: 800, x: 0.1, y: 0.48, largura: 0.8, alinhar: 'centro', cor: SUAVE, texto: 'Conteúdo informativo'},
  ]},
];

/** O documento do modelo: um vídeo de cenas vertical com a fala de cada cena escrita e a duração estimada por ela. */
export const modeloCarrosselNarrado = (formato: Formato = {largura: 1080, altura: 1920, fps: 30}): DocCenas => ({
  tipo: 'cenas',
  formato,
  tema: {...TEMA_NEUTRO},
  cenas: CENAS.map((c): CenaCenas => ({
    id: c.id,
    nome: c.nome,
    duracao_ms: duracaoDaFala(c.fala),
    blocos: c.blocos.map((b, i) => ({id: `${c.id}-${b.tipo}-${i + 1}`, ...b})),
    narracao: {texto: c.fala},
  })),
  efeitos: [],
});
