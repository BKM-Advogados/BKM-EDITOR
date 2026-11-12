// Ferramentas MCP do Plano do vídeo (Onda B, frente 2; o plano em src/nucleo/plano-video.ts e docs/ia.md):
// - ler_plano (livre): o plano, o estado e o próximo passo. A IA lê antes de montar uma peça nova.
// - escrever_plano (livre): grava ou reescreve o plano em plano.json, com diário e Reverter; o estado volta a
//   "aguardando" e a revisão sobe. No app, a conversa mostra o cartão com "Aprovar plano" e "Pedir ajuste".
// - aprovar_plano (cartão): registra a aprovação que a pessoa deu na conversa. Com o app aberto, o portão pergunta a ela
//   antes (o botão do cartão faz o mesmo sem passar pela IA); sem o app (MCP por stdio), não há a quem perguntar e a
//   aprovação dada na conversa basta.
// Nada bloqueia a montagem: o guia do projeto é que manda esperar o plano aprovado num pedido novo.
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {decidirPlano, escreverPlano, planoEmTexto, proximoPasso, type PlanoVideo} from './plano-video';
import {ErroProjeto, type Projeto} from './projeto';

const texto = (x: unknown) => ({content: [{type: 'text' as const, text: typeof x === 'string' ? x : JSON.stringify(x, null, 2)}]});
const erro = (e: unknown) => ({
  isError: true,
  content: [{type: 'text' as const, text: e instanceof ErroProjeto ? `${e.codigo}: ${e.message}` : String((e as Error)?.message ?? e)}],
});
const seguro = <A,>(f: (a: A) => unknown) => async (a: A) => {
  try {
    return texto(await f(a));
  } catch (e) {
    return erro(e);
  }
};

const resposta = (p: PlanoVideo) => ({existe: true, estado: p.estado, revisao: p.revisao, plano: p, texto: planoEmTexto(p), proximo_passo: proximoPasso(p)});

const CENA = z.object({
  cena: z.string().describe('nome curto da cena, ex.: "Abertura"'),
  mostra: z.string().describe('o que aparece na tela'),
  fala: z.string().optional().describe('o que se fala na cena, se houver narração'),
  duracao_s: z.number().positive().max(600).optional(),
});

export const registrarPlano = (servidor: McpServer, projeto: Projeto, autor: string, origem: string) => {
  servidor.registerTool('ler_plano', {
    description: 'O Plano do vídeo deste projeto (plano.json): objetivo, público, formato e duração, roteiro cena a cena, mídia, narração e música, com o estado (aguardando, aprovado ou ajustar), a revisão, o ajuste que a pessoa pediu e o próximo passo. Leia antes de montar uma peça nova: só monte com o plano aprovado.',
    inputSchema: {},
  }, seguro(() => {
    const p = projeto.plano();
    return p ? resposta(p) : {existe: false, proximo_passo: proximoPasso(null)};
  }));

  servidor.registerTool('escrever_plano', {
    description: 'Escreve (ou reescreve) o Plano do vídeo antes de montar uma peça nova. O estado volta a "aguardando" e a revisão sobe; no app, a pessoa vê o plano na conversa com "Aprovar plano" e "Pedir ajuste". Depois de escrever, mostre o plano em poucas linhas e espere: não monte até ler_plano dizer "aprovado". Pedido pequeno (trocar cor, texto, tempo) não precisa de plano.',
    inputSchema: {
      objetivo: z.string().min(1).describe('o que o vídeo deve conseguir, numa frase'),
      publico: z.string().describe('para quem é'),
      formato_e_duracao: z.string().describe('ex.: "Reels 9:16, cerca de 45 s"'),
      roteiro: z.array(CENA).min(1).max(40).describe('cena a cena, na ordem'),
      midia_usar: z.array(z.string()).optional().describe('arquivos do projeto (midia/) ou do kit que vai usar'),
      midia_falta: z.array(z.string()).optional().describe('o que a pessoa precisa mandar (foto, logo, gravação)'),
      narracao: z.string().describe('quem fala e como (voz da pessoa, narração por IA com a voz X, só texto na tela)'),
      musica: z.string().describe('trilha ou nenhuma, e o clima'),
      notas: z.string().optional().describe('o que você supôs sem perguntar, e o que fica para depois'),
    },
  }, seguro((a: {objetivo: string; publico: string; formato_e_duracao: string; roteiro: z.infer<typeof CENA>[]; midia_usar?: string[]; midia_falta?: string[];
    narracao: string; musica: string; notas?: string}) => {
    const p = projeto.alterarPlano((anterior) => escreverPlano(anterior, {
      objetivo: a.objetivo, publico: a.publico, formato_e_duracao: a.formato_e_duracao, roteiro: a.roteiro,
      midia: {usar: a.midia_usar ?? [], falta: a.midia_falta ?? []}, narracao: a.narracao, musica: a.musica, notas: a.notas,
    }, origem, new Date().toISOString()), {autor, origem, rotulo: 'plano do vídeo escrito'});
    return resposta(p);
  }));

  servidor.registerTool('aprovar_plano', {
    description: 'Registra que a pessoa aprovou o Plano do vídeo na conversa (sem a tela do app, por exemplo no Claude Desktop ou na IDE). Passe a revisão que ela viu (de ler_plano ou escrever_plano). Com o app aberto, o app pergunta a ela antes. Nunca aprove por conta própria.',
    inputSchema: {revisao: z.number().int().min(1).describe('a revisão do plano que a pessoa aprovou')},
  }, seguro(({revisao}: {revisao: number}) => {
    const p = projeto.alterarPlano((atual) => decidirPlano(atual, revisao, {decisao: 'aprovar'}, `pessoa, pela conversa (${origem})`, new Date().toISOString()),
      {autor, origem, rotulo: `plano do vídeo aprovado (revisão ${revisao})`});
    return resposta(p);
  }));
};
