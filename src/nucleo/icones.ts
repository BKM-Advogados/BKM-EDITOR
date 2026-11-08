// Ícones do Estúdio: o Lucide (ISC, 2020 ícones, versão em icones-indice.json) e a busca em português. O índice (nome em
// inglês e as etiquetas do Lucide) serve ao MCP e à interface; a geometria de cada ícone fica só na interface
// (src/renderer/modulos/imagem/icones-geometria.json), porque só ela pinta. A pessoa e a IA procuram por "balança",
// "contrato" ou "prazo": o léxico abaixo leva a palavra em português aos nomes do Lucide. Palavra fora do léxico ainda
// acha o que o nome ou as etiquetas em inglês dizem ("clock", "arrow"). Ver docs/marca.md.
import indiceJson from './icones-indice.json';

const INDICE = (indiceJson as {icones: Record<string, string>}).icones;
export const VERSAO_LUCIDE = (indiceJson as {lucide: string}).lucide;
export const NOMES_DE_ICONES = Object.keys(INDICE);
const CONJUNTO = new Set(NOMES_DE_ICONES);

export const existeIcone = (nome: string) => CONJUNTO.has(nome);
export const etiquetasDoIcone = (nome: string) => INDICE[nome] ?? '';

/** Sem acento, minúsculas: a chave do léxico e da busca. */
export const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Palavra em português (sem acento) → nomes de ícone do Lucide, do mais certo ao menos. O que ficou de fora: a busca
 *  também lê o nome e as etiquetas em inglês. Cada nome aqui existe no índice (testes/icones.test.ts confere). */
export const LEXICO: Record<string, string[]> = {
  // direito e justiça
  balanca: ['scale'], justica: ['scale', 'gavel', 'landmark'], lei: ['scale', 'gavel', 'scroll-text', 'book-open'], leis: ['scale', 'book-open', 'scroll-text'],
  direito: ['scale', 'book-open', 'gavel'], direitos: ['scale', 'shield-check', 'book-open'], juiz: ['gavel'], juiza: ['gavel'], sentenca: ['gavel', 'scroll-text'],
  decisao: ['gavel', 'circle-check'], tribunal: ['landmark', 'gavel'], forum: ['landmark', 'gavel'], vara: ['landmark', 'gavel'], advogado: ['briefcase', 'gavel', 'scale'],
  advogada: ['briefcase', 'gavel', 'scale'], advocacia: ['briefcase', 'scale'], processo: ['folder-open', 'file-stack', 'scale'], processos: ['file-stack', 'folders'],
  audiencia: ['gavel', 'users', 'mic'], recurso: ['file-up', 'gavel', 'rotate-ccw'], liminar: ['siren', 'gavel', 'alarm-clock'], peticao: ['file-pen', 'file-text', 'pen-line'],
  contrato: ['file-text', 'handshake', 'file-pen', 'signature'], contratos: ['files', 'file-text', 'handshake'], clausula: ['file-text', 'list'], assinatura: ['signature', 'pen-line', 'file-pen'],
  assinar: ['signature', 'pen-line', 'file-pen'], documento: ['file-text', 'file'], documentos: ['files', 'file-stack', 'file-text'], pasta: ['folder', 'folder-open'], arquivo: ['archive', 'file', 'folder-archive'],
  acordo: ['handshake', 'file-check', 'scale'], conciliacao: ['handshake', 'scale'], mediacao: ['handshake', 'messages-square'], negociacao: ['handshake', 'messages-square', 'scale'],
  heranca: ['scroll-text', 'landmark', 'users'], testamento: ['scroll-text', 'file-pen', 'pen-line'], procuracao: ['file-pen', 'signature', 'stamp'], carimbo: ['stamp'], cartorio: ['stamp', 'landmark', 'file-check'],
  // prazo, tempo e agenda
  prazo: ['clock', 'calendar-clock', 'hourglass', 'timer', 'alarm-clock'], prazos: ['calendar-clock', 'clock', 'hourglass'], tempo: ['clock', 'hourglass', 'timer'], data: ['calendar', 'calendar-days'],
  calendario: ['calendar', 'calendar-days'], agenda: ['calendar', 'calendar-days', 'calendar-clock'], hora: ['clock', 'timer'], horas: ['clock', 'timer'], relogio: ['clock', 'alarm-clock'],
  cronometro: ['timer'], urgente: ['siren', 'alarm-clock', 'triangle-exclamation-point'], urgencia: ['siren', 'alarm-clock'], vencimento: ['calendar-clock', 'calendar-x', 'alarm-clock'],
  jornada: ['clock', 'calendar-clock'], ferias: ['tree-palm', 'sun', 'umbrella', 'plane'], feriado: ['calendar-heart', 'party-popper', 'sun'], viagem: ['plane', 'luggage', 'map'],
  // trabalho
  trabalho: ['briefcase', 'hammer', 'hard-hat'], trabalhador: ['hard-hat', 'user-round', 'hammer'], empregado: ['user-round', 'hard-hat', 'briefcase'], empregador: ['building', 'briefcase'],
  funcionario: ['user-round', 'badge-check', 'briefcase'], colaborador: ['user-round', 'users'], patrao: ['building', 'briefcase'], empresa: ['building', 'building-complex', 'factory'],
  fabrica: ['factory'], obra: ['hard-hat', 'construction', 'hammer'], carteira: ['wallet', 'book-user', 'id-card'], registro: ['file-check', 'clipboard-check', 'id-card'],
  admissao: ['user-plus', 'door-open'], contratacao: ['user-plus', 'handshake'], demissao: ['door-open', 'log-out', 'user-x', 'user-minus'], rescisao: ['file-x', 'door-open', 'user-x'],
  desligamento: ['log-out', 'door-open', 'user-x'], sindicato: ['users', 'handshake', 'megaphone'], greve: ['megaphone', 'hand'], protesto: ['megaphone', 'flag'],
  aviso: ['bell', 'triangle-exclamation-point', 'megaphone'], previo: ['bell', 'calendar-clock'], extra: ['clock-plus', 'plus'], noturno: ['moon', 'moon-star'], insalubridade: ['skull', 'triangle-exclamation-point', 'biohazard'],
  assedio: ['octagon-exclamation-point', 'hand', 'ban'], discriminacao: ['ban', 'users'], acidente: ['ambulance', 'siren', 'bandage'], estabilidade: ['shield-check', 'lock'],
  // dinheiro
  dinheiro: ['banknote', 'coins', 'wallet', 'circle-dollar-sign'], salario: ['banknote', 'wallet', 'hand-coins'], pagamento: ['credit-card', 'banknote', 'hand-coins'], pagar: ['credit-card', 'banknote', 'hand-coins'],
  valor: ['circle-dollar-sign', 'banknote'], valores: ['coins', 'banknote'], multa: ['receipt', 'banknote', 'triangle-exclamation-point'], indenizacao: ['hand-coins', 'banknote', 'scale'],
  fgts: ['piggy-bank', 'landmark'], inss: ['landmark', 'shield'], previdencia: ['landmark', 'piggy-bank', 'shield'], aposentadoria: ['piggy-bank', 'armchair', 'landmark'], banco: ['landmark', 'building'],
  imposto: ['receipt', 'percent', 'landmark'], tributo: ['receipt', 'percent', 'landmark'], porcentagem: ['percent'], percentual: ['percent'], calculo: ['calculator'], calculadora: ['calculator'],
  decimo: ['gift', 'calendar'], terceiro: ['gift'], bonus: ['gift', 'award'], cobranca: ['receipt', 'banknote', 'bell'], divida: ['banknote', 'trending-down', 'receipt'], credito: ['credit-card', 'trending-up'],
  poupanca: ['piggy-bank'], investimento: ['trending-up', 'chart-line', 'coins'], lucro: ['trending-up', 'circle-dollar-sign'], prejuizo: ['trending-down'], nota: ['receipt', 'file-text'], recibo: ['receipt'],
  // alertas e estados
  atencao: ['triangle-exclamation-point', 'circle-exclamation-point', 'octagon-exclamation-point'], alerta: ['bell-ring', 'triangle-exclamation-point', 'siren'], perigo: ['triangle-exclamation-point', 'skull', 'flame'],
  cuidado: ['triangle-exclamation-point', 'octagon-exclamation-point'], erro: ['circle-x', 'x', 'octagon-x'], errado: ['x', 'circle-x'], certo: ['check', 'circle-check'], correto: ['check', 'circle-check'],
  ok: ['check', 'circle-check', 'thumbs-up'], confirmado: ['circle-check', 'badge-check'], aprovado: ['circle-check', 'badge-check', 'thumbs-up'], proibido: ['ban', 'circle-slash'], vedado: ['ban', 'circle-slash'],
  dica: ['lightbulb'], ideia: ['lightbulb', 'sparkles'], pergunta: ['circle-question-mark'], duvida: ['circle-question-mark'], informacao: ['info'], importante: ['badge-exclamation-point', 'star', 'flag'],
  novo: ['sparkles', 'badge-plus'], destaque: ['star', 'sparkles', 'highlighter'], sucesso: ['trophy', 'award', 'circle-check'], premio: ['trophy', 'award', 'medal'], meta: ['target', 'flag'], objetivo: ['target', 'flag'],
  // pessoas e lugares
  pessoa: ['user', 'user-round'], pessoas: ['users', 'users-round'], cliente: ['user-round', 'user-check', 'handshake'], familia: ['users', 'house', 'heart-handshake'], casa: ['house'], moradia: ['house', 'key-round'],
  imovel: ['house', 'building', 'key-round'], aluguel: ['key-round', 'house', 'receipt'], terreno: ['land-plot', 'map'], escola: ['graduation-cap', 'school', 'book-open'], estudo: ['book-open', 'graduation-cap', 'library'],
  saude: ['heart-pulse', 'stethoscope'], doenca: ['thermometer', 'stethoscope', 'pill'], medico: ['stethoscope', 'hospital'], hospital: ['hospital', 'ambulance'], gravidez: ['baby'], gestante: ['baby'], bebe: ['baby'],
  carro: ['car'], transito: ['car', 'traffic-cone', 'signpost'], localizacao: ['map-pin', 'map'], endereco: ['map-pin', 'house'], mapa: ['map', 'map-pin'], cidade: ['building', 'map-pin'],
  consumidor: ['shopping-cart', 'shopping-bag', 'user-round'], compra: ['shopping-cart', 'shopping-bag'], loja: ['store', 'shopping-bag'], produto: ['package'], entrega: ['truck', 'package'],
  politica: ['landmark', 'vote', 'flag'], voto: ['vote', 'check'], bandeira: ['flag'],
  // comunicação
  telefone: ['phone', 'smartphone'], celular: ['smartphone'], email: ['mail', 'at-sign'], mensagem: ['message-circle', 'message-square', 'mail'], whatsapp: ['message-circle', 'phone'], chat: ['message-circle', 'messages-square'],
  reuniao: ['users', 'video', 'calendar'], microfone: ['mic'], podcast: ['mic-audio-lines', 'mic', 'radio'], video: ['video', 'play'], reels: ['clapperboard', 'video', 'film'], camera: ['camera', 'video'], foto: ['image', 'camera'],
  imagem: ['image', 'images'], musica: ['eighth-notes', 'headphones', 'audio-waveform'], som: ['volume-2', 'audio-lines', 'speaker'], compartilhar: ['share-2', 'share'], curtir: ['heart', 'thumbs-up'], salvar: ['bookmark', 'save', 'download'],
  favorito: ['star', 'heart', 'bookmark'], estrela: ['star'], coracao: ['heart'], megafone: ['megaphone'], anuncio: ['megaphone', 'badge-info'],
  // segurança, tecnologia e ciência
  seguranca: ['shield', 'shield-check', 'lock'], protecao: ['shield', 'shield-check'], privacidade: ['lock', 'eye-off', 'shield'], cadeado: ['lock', 'lock-keyhole'], chave: ['key', 'key-round'], senha: ['key-round', 'lock'],
  busca: ['search', 'scan-search'], pesquisa: ['search', 'microscope', 'flask-conical'], ciencia: ['flask-conical', 'microscope', 'atom'], quimica: ['flask-conical', 'beaker'], medicina: ['stethoscope', 'pill'],
  mundo: ['globe', 'earth'], planeta: ['globe', 'earth'], internet: ['globe', 'wifi', 'cloud'], nuvem: ['cloud'], tecnologia: ['cpu', 'laptop', 'smartphone'], computador: ['laptop', 'monitor', 'computer'],
  sistema: ['server', 'settings', 'cpu'], engrenagem: ['settings', 'cog'], ferramenta: ['wrench', 'hammer'], ferramentas: ['wrench', 'hammer'], grafico: ['chart-bar', 'chart-line', 'chart-pie'], crescimento: ['trending-up', 'chart-line', 'sprout'],
  queda: ['trending-down'], regra: ['ruler', 'list-checks', 'book-open'], norma: ['book-open', 'scroll-text', 'file-text'], lista: ['list', 'list-checks', 'clipboard-list'], passo: ['footprints', 'list-ordered'],
  etapa: ['list-ordered', 'footprints', 'flag'], checklist: ['list-checks', 'clipboard-check'], seta: ['arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'move-right', 'arrow-up-right', 'arrow-big-right', 'chevron-right'], direita: ['arrow-right', 'chevron-right'], esquerda: ['arrow-left', 'chevron-left'],
  cima: ['arrow-up', 'chevron-up'], baixo: ['arrow-down', 'chevron-down'], voltar: ['undo-2', 'arrow-left'], proximo: ['arrow-right', 'chevron-right'],
};

/** Singular simples: "contratos" → "contrato", "decisões" → "decisao" (já sem acento: "decisoes"). */
const singular = (t: string) => (t.endsWith('oes') ? `${t.slice(0, -3)}ao` : t.endsWith('es') && t.length > 4 ? t.slice(0, -2) : t.endsWith('s') && t.length > 3 ? t.slice(0, -1) : t);

export type ResultadoIcone = {nome: string; etiquetas: string; pontos: number};

const pontosDoTermo = (nome: string, etiquetas: string, termo: string, peso: number): number => {
  const partes = nome.split('-');
  let p = 0;
  if (nome === termo) p = 100;
  else if (nome.startsWith(`${termo}-`)) p = 60;
  else if (partes.includes(termo)) p = 45;
  else if (nome.includes(termo)) p = 25;
  else if (etiquetas.split(' ').includes(termo)) p = 18;
  else if (termo.length >= 4 && etiquetas.includes(termo)) p = 7;
  return p * peso;
};

/** Procura ícones por palavra em português ou em inglês: cada palavra vale pelo nome do ícone, pelas etiquetas e pelos
 *  nomes que o léxico liga a ela. Mais de uma palavra soma ("balança justiça"). Sem palavra: lista vazia. */
export const buscarIcones = (consulta: string, limite = 24): ResultadoIcone[] => {
  const palavras = semAcento(consulta).split(/[^a-z0-9]+/).filter(Boolean);
  if (!palavras.length) return [];
  const pontos = new Map<string, number>();
  for (const palavra of palavras) {
    const formas = [...new Set([palavra, singular(palavra)])];
    const exatos = formas.flatMap((f) => LEXICO[f] ?? []);
    // os nomes do léxico, do mais certo ao menos: 200 para o primeiro, descendo
    exatos.forEach((nome, i) => {
      if (CONJUNTO.has(nome)) pontos.set(nome, (pontos.get(nome) ?? 0) + Math.max(120, 200 - i * 14));
    });
    for (const nome of NOMES_DE_ICONES) {
      const et = INDICE[nome];
      const p = Math.max(...formas.map((f) => pontosDoTermo(nome, et, f, 1)));
      if (p > 0) pontos.set(nome, (pontos.get(nome) ?? 0) + p);
    }
  }
  return [...pontos.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, limite))
    .map(([nome, p]) => ({nome, etiquetas: INDICE[nome], pontos: p}));
};

/** O ícone mais parecido com um nome que não existe (para a mensagem de erro sugerir). */
export const sugerirIcones = (nome: string, limite = 5) => buscarIcones(nome.replace(/[-_]+/g, ' '), limite).map((r) => r.nome);
