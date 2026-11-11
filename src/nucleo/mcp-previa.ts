// Prévias do vídeo para o agente (frente IDE, docs/ide.md): ver_quadro, ver_cenas e ver_trecho renderizam com a mesma
// composição da exportação (Remotion) e gravam em saidas/previas/, fora do git, devolvendo o caminho absoluto. O agente
// vê o quadro pela imagem que vem na resposta do MCP; a pessoa vê no chat da IDE quando o agente escreve
// `![...](caminho absoluto)` (o T3 Code mostra imagem e vídeo assim). Servem ao MCP por stdio (a IDE, sem o app aberto)
// e ao do app (HTTP). O render fica em src/main/previa.ts, injetado por definirServicoPrevia (como a música e o
// contraste): aqui só a escolha do documento e do tempo, os nomes, a limpeza da pasta e a resposta. Sem z.union (o
// Gemini e o modo strict do DeepSeek recusam): a cena vem como texto, número ou id. Classe "livre" no
// portão: não mexem nos documentos nem no diário, nada sai do PC, e o que gravam é descartável (a pasta guarda as
// últimas PREVIAS_MAX e PREVIAS_MAX_BYTES; as mais velhas saem).
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {mkdirSync, readdirSync, rmSync, statSync} from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import type {Manifesto} from './documentos';
import {ErroProjeto, type Projeto} from './projeto';

export const PASTA_PREVIAS = 'saidas/previas';
export const PREVIAS_MAX = 40;
export const PREVIAS_MAX_BYTES = 400 * 1024 * 1024;
export const TRECHO_MAX_MS = 60_000;
export const CENAS_MAX = 48;
export const FRACAO_PADRAO = 0.75; // com os blocos da cena já na tela (o mesmo padrão do script de quadros)
const LADO_QUADRO = 960; // o lado maior do quadro de ver_quadro, sem escala pedida
const LADO_CELULA = 360; // o lado maior de cada quadro da folha de contato
const MARGEM_FOLHA = 8;
const LADO_IMAGEM_MCP = 1024; // a imagem que vai dentro da resposta (o agente vê)
const IMAGEM_MCP_MAX_BYTES = 1_500_000;

// ---------- o que o render (src/main/previa.ts) oferece ----------
export type CenaDoVideo = {n: number; id?: string; nome?: string; t_in: number; t_out: number};
export type InfoVideo = {composicao: string; largura: number; altura: number; fps: number; duracao_ms: number; cenas: CenaDoVideo[]; avisos: string[]};
export type AvisoPrevia = (mensagem: string, fracao?: number) => void;
export type ServicoPrevia = {
  /** Formato, duração e cenas do documento (sem renderizar). Lança com a mensagem do montador se não for vídeo. */
  info: (projeto: Projeto, documento: string) => InfoVideo;
  /** Um PNG por tempo (ms do vídeo), nos arquivos dados, na escala dada (1 = tamanho do documento). */
  quadros: (projeto: Projeto, p: {documento: string; tempos_ms: number[]; arquivos: string[]; escala: number; aviso?: AvisoPrevia}) => Promise<void>;
  /** MP4 H.264 com som de de_ms até ate_ms, na escala dada. */
  trecho: (projeto: Projeto, p: {documento: string; de_ms: number; ate_ms: number; arquivo: string; escala: number; aviso?: AvisoPrevia}) => Promise<void>;
  /** Junta imagens numa grade (folha de contato) em PNG, cada uma redimensionada para a célula. */
  folha: (p: {arquivos: string[]; colunas: number; celula: {largura: number; altura: number}; margem: number; destino: string}) => Promise<void>;
  /** JPEG pequeno de uma imagem (lado maior até `lado`) para ir dentro da resposta do MCP; null se não der. */
  miniatura: (arquivo: string, tamanho: {largura: number; altura: number}) => Promise<Uint8Array | null>;
};

let servico: ServicoPrevia | null = null;
export const definirServicoPrevia = (s: ServicoPrevia | null) => {
  servico = s;
};
const exigirServico = () => {
  if (!servico) throw new Error('as prévias precisam do render do Estúdio, que não está disponível neste servidor MCP');
  return servico;
};

// ---------- contas puras (testadas em testes/previa-mcp.test.ts) ----------
/** O documento pedido ou, sem pedido, o primeiro vídeo do projeto (senão a primeira animação). */
export const documentoDaPrevia = (m: Manifesto, documento?: string) => {
  if (documento) {
    if (!m.documentos.some((d) => d.id === documento)) throw new ErroProjeto(`documento não achado: ${documento}`, 'nao_achado');
    return documento;
  }
  const d = m.documentos.find((x) => x.modulo === 'video') ?? m.documentos.find((x) => x.modulo === 'animacao');
  if (!d) throw new ErroProjeto('este projeto não tem vídeo nem animação para ver', 'nao_achado');
  return d.id;
};

/** A cena pelo número (1 é a primeira) ou pelo id. */
export const acharCena = (cenas: CenaDoVideo[], cena: string | number) => {
  if (!cenas.length) throw new ErroProjeto('este documento não tem cenas; use tempo_ms', 'nao_achado');
  const c = typeof cena === 'number' || /^\d+$/.test(String(cena)) ? cenas.find((x) => x.n === Number(cena)) : cenas.find((x) => x.id === cena);
  if (!c) throw new ErroProjeto(`cena não achada: ${cena} (o vídeo tem ${cenas.length} cena${cenas.length === 1 ? '' : 's'}, de 1 a ${cenas.length})`, 'nao_achado');
  return c;
};

/** Tempo dentro da cena: fração 0 é o começo e 1 o último quadro dela. */
export const tempoNaCena = (c: CenaDoVideo, fracao: number, fps: number) => {
  const ultimo = Math.max(c.t_in, c.t_out - 1000 / fps);
  return Math.round(c.t_in + Math.min(1, Math.max(0, fracao)) * (ultimo - c.t_in));
};

/** Escala para o lado maior caber em `lado` px (sem aumentar). */
export const escalaPara = (largura: number, altura: number, lado: number) => Math.min(1, lado / Math.max(largura, altura));

/** Colunas da folha de contato: a grade fica perto de quadrada, seja o vídeo em pé ou deitado. */
export const colunasDaFolha = (n: number, largura: number, altura: number) => Math.max(1, Math.min(n, Math.ceil(Math.sqrt((n * altura) / largura))));

/** Tamanho da folha e canto de cada célula (margem em volta e entre as células). Lados pares: a miniatura sai em JPEG 4:2:0. */
export const gradeDaFolha = (n: number, colunas: number, celula: {largura: number; altura: number}, margem: number) => {
  const linhas = Math.max(1, Math.ceil(n / colunas));
  const par = (x: number) => x + (x % 2);
  return {
    linhas,
    largura: par(colunas * celula.largura + (colunas + 1) * margem),
    altura: par(linhas * celula.altura + (linhas + 1) * margem),
    cantos: Array.from({length: n}, (_, i) => ({x: margem + (i % colunas) * (celula.largura + margem), y: margem + Math.floor(i / colunas) * (celula.altura + margem)})),
  };
};

/** Quais prévias apagar: fica a mais nova sempre, e as outras enquanto couberem no número e no tamanho. */
export const previasParaApagar = (lista: {nome: string; mtime_ms: number; bytes: number}[], max = PREVIAS_MAX, maxBytes = PREVIAS_MAX_BYTES) => {
  const ordem = [...lista].sort((a, b) => b.mtime_ms - a.mtime_ms);
  let soma = 0;
  return ordem.filter((p, i) => {
    soma += p.bytes;
    return i > 0 && (i >= max || soma > maxBytes);
  }).map((p) => p.nome);
};

const DOIS = (n: number, k = 2) => String(n).padStart(k, '0');
/** "quadro-video-12400ms-20261110-153012-087.png": o nome diz o quê e de quando, e não repete (o chat mostra cada um). */
export const nomeDaPrevia = (tipo: string, documento: string, detalhe: string, ext: string, agora = new Date()) => {
  const carimbo = `${agora.getFullYear()}${DOIS(agora.getMonth() + 1)}${DOIS(agora.getDate())}-${DOIS(agora.getHours())}${DOIS(agora.getMinutes())}${DOIS(agora.getSeconds())}-${DOIS(agora.getMilliseconds(), 3)}`;
  const seguro = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${tipo}-${seguro(documento)}${detalhe ? `-${seguro(detalhe)}` : ''}-${carimbo}.${ext}`;
};

const segundos = (ms: number) => `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0).replace('.', ',')} s`;

// ---------- a pasta das prévias ----------
const pastaDasPrevias = (projeto: Projeto) => {
  const pasta = projeto.caminho(PASTA_PREVIAS);
  mkdirSync(pasta, {recursive: true});
  return pasta;
};

/** Apaga as prévias mais velhas além do limite (só arquivos desta pasta, nunca outra coisa de saidas/). */
export const limparPrevias = (pasta: string, max = PREVIAS_MAX, maxBytes = PREVIAS_MAX_BYTES) => {
  let lista: {nome: string; mtime_ms: number; bytes: number}[] = [];
  try {
    lista = readdirSync(pasta).flatMap((nome) => {
      const st = statSync(path.join(pasta, nome));
      return st.isFile() ? [{nome, mtime_ms: st.mtimeMs, bytes: st.size}] : [];
    });
  } catch {
    return [];
  }
  const apagar = previasParaApagar(lista, max, maxBytes);
  for (const nome of apagar) rmSync(path.join(pasta, nome), {force: true});
  return apagar;
};

// ---------- resposta ----------
type Conteudo = {type: 'text'; text: string} | {type: 'image'; data: string; mimeType: string};
const resposta = (dados: Record<string, unknown>, imagem?: Uint8Array | null) => {
  const content: Conteudo[] = [{type: 'text', text: JSON.stringify(dados, null, 2)}];
  if (imagem && imagem.byteLength <= IMAGEM_MCP_MAX_BYTES) content.push({type: 'image', data: Buffer.from(imagem).toString('base64'), mimeType: 'image/jpeg'});
  return {content};
};
const erro = (e: unknown) => ({
  isError: true,
  content: [{type: 'text' as const, text: e instanceof ErroProjeto ? `${e.codigo}: ${e.message}` : String((e as Error)?.message ?? e)}],
});

/** Progresso para o cliente MCP que pediu (progressToken): render leva segundos, e o primeiro do processo empacota as
 *  composições. Um aviso por segundo no máximo; o transporte que não entrega notificação (HTTP em JSON) só ignora. */
type Extra = {_meta?: {progressToken?: string | number}; sendNotification?: (n: {method: 'notifications/progress'; params: {progressToken: string | number; progress: number; message?: string}}) => Promise<void>};
const avisoDoMcp = (extra: Extra | undefined): AvisoPrevia => {
  const token = extra?._meta?.progressToken;
  let ultimo = 0;
  let passo = 0;
  return (mensagem, fracao) => {
    if (token === undefined || !extra?.sendNotification) return;
    const agora = Date.now();
    if (agora - ultimo < 1000 && fracao !== undefined && fracao < 1) return;
    ultimo = agora;
    passo += 1;
    void extra.sendNotification({method: 'notifications/progress', params: {progressToken: token, progress: passo, message: mensagem}}).catch(() => undefined);
  };
};

const textoDaCena = (c?: CenaDoVideo) => (c ? `cena ${c.n}${c.nome ? ` (${c.nome})` : c.id ? ` (${c.id})` : ''}` : undefined);
/** O markdown da imagem ou do vídeo; caminho com espaço ou parêntese vai entre < > (CommonMark), como as pastas
 *  "Sem título · 05/11 14h32" que o app cria. */
export const markdownDaPrevia = (alt: string, arquivo: string) => `![${alt.replace(/[[\]]/g, '')}](${/[\s()<>]/.test(arquivo) ? `<${arquivo}>` : arquivo})`;
const markdown = markdownDaPrevia;
const COMO_MOSTRAR = 'Para a pessoa ver no chat da IDE (T3 Code, Claude Code), ponha o campo markdown na resposta.';

// ---------- ferramentas ----------
export const registrarPrevia = (servidor: McpServer, projeto: Projeto) => {
  const tempoEntrada = {
    documento: z.string().optional().describe('id do documento de vídeo ou animação; sem ele, o primeiro vídeo do projeto'),
    escala: z.number().min(0.1).max(1).optional().describe('1 = tamanho do documento; sem ela, o lado maior fica em 960 px'),
  };

  servidor.registerTool('ver_quadro', {
    description: 'Renderiza um quadro do vídeo (vídeo de cenas, carrossel narrado ou animação) com a mesma composição da exportação e grava um PNG em saidas/previas/. '
      + 'Escolha o instante por tempo_ms (ms do vídeo) ou por cena (número, 1 é a primeira, ou id) e fracao (0 = começo da cena, 1 = fim; padrão 0,75). '
      + 'Devolve o caminho absoluto, um markdown pronto para mostrar à pessoa e a imagem para você ver. Não muda nada no projeto. '
      + 'A primeira prévia de um processo leva mais (prepara o navegador e, fora do app instalado, empacota as composições).',
    inputSchema: {
      ...tempoEntrada,
      tempo_ms: z.number().min(0).optional().describe('instante do vídeo em ms'),
      cena: z.coerce.string().optional().describe('número da cena ("1" é a primeira) ou id'),
      fracao: z.number().min(0).max(1).optional().describe('ponto da cena, de 0 (começo) a 1 (fim); padrão 0,75'),
    },
    annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: false},
  }, async (a: {documento?: string; escala?: number; tempo_ms?: number; cena?: string; fracao?: number}, extra?: Extra) => {
    try {
      const s = exigirServico();
      const documento = documentoDaPrevia(projeto.manifesto(), a.documento);
      const info = s.info(projeto, documento);
      if (a.cena !== undefined && a.tempo_ms !== undefined) throw new ErroProjeto('use tempo_ms ou cena, não os dois', 'patch');
      const cena = a.cena !== undefined ? acharCena(info.cenas, a.cena) : undefined;
      const tempo = cena ? tempoNaCena(cena, a.fracao ?? FRACAO_PADRAO, info.fps) : Math.round(a.tempo_ms ?? 0);
      if (tempo > info.duracao_ms) throw new ErroProjeto(`tempo_ms ${tempo} passa do fim do vídeo (${info.duracao_ms} ms)`, 'patch');
      const escala = a.escala ?? escalaPara(info.largura, info.altura, LADO_QUADRO);
      const pasta = pastaDasPrevias(projeto);
      const arquivo = path.join(pasta, nomeDaPrevia('quadro', documento, `${tempo}ms`, 'png'));
      const aviso = avisoDoMcp(extra);
      await s.quadros(projeto, {documento, tempos_ms: [tempo], arquivos: [arquivo], escala, aviso});
      limparPrevias(pasta);
      const largura = Math.round(info.largura * escala);
      const altura = Math.round(info.altura * escala);
      const k = escalaPara(largura, altura, LADO_IMAGEM_MCP);
      const imagem = await s.miniatura(arquivo, {largura: Math.round(largura * k), altura: Math.round(altura * k)}).catch(() => null);
      const naCena = cena ?? info.cenas.find((c) => tempo >= c.t_in && tempo < c.t_out);
      const alt = `${documento} em ${segundos(tempo)}${naCena ? `, ${textoDaCena(naCena)}` : ''}`;
      return resposta({arquivo, markdown: markdown(alt, arquivo), documento, tempo_ms: tempo, ...(naCena ? {cena: {n: naCena.n, id: naCena.id, nome: naCena.nome}} : {}),
        largura, altura, duracao_ms: info.duracao_ms, ...(info.avisos.length ? {avisos: info.avisos} : {}), como_mostrar: COMO_MOSTRAR}, imagem);
    } catch (e) {
      return erro(e);
    }
  });

  servidor.registerTool('ver_cenas', {
    description: 'Folha de contato do vídeo de cenas: um quadro de cada cena (no ponto fracao, padrão 0,75), lado a lado numa imagem só, em saidas/previas/. '
      + `As cenas vão em ordem, da esquerda para a direita e de cima para baixo (até ${CENAS_MAX}; use cenas para escolher). `
      + 'Devolve o caminho absoluto, um markdown pronto para mostrar à pessoa e a imagem para você ver. Não muda nada no projeto.',
    inputSchema: {
      documento: tempoEntrada.documento,
      fracao: z.number().min(0).max(1).optional().describe('ponto de cada cena, de 0 (começo) a 1 (fim); padrão 0,75'),
      cenas: z.array(z.coerce.string()).optional().describe('só estas cenas (número ou id), na ordem dada'),
    },
    annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: false},
  }, async (a: {documento?: string; fracao?: number; cenas?: string[]}, extra?: Extra) => {
    try {
      const s = exigirServico();
      const documento = documentoDaPrevia(projeto.manifesto(), a.documento);
      const info = s.info(projeto, documento);
      if (!info.cenas.length) throw new ErroProjeto(`${documento} não tem cenas; use ver_quadro com tempo_ms`, 'patch');
      const todas = a.cenas?.length ? a.cenas.map((c) => acharCena(info.cenas, c)) : info.cenas;
      const escolhidas = todas.slice(0, CENAS_MAX);
      const fracao = a.fracao ?? FRACAO_PADRAO;
      const escala = escalaPara(info.largura, info.altura, LADO_CELULA);
      const celula = {largura: Math.round(info.largura * escala), altura: Math.round(info.altura * escala)};
      const pasta = pastaDasPrevias(projeto);
      const temporaria = path.join(pasta, `.folha-${process.pid}-${Date.now()}`);
      mkdirSync(temporaria, {recursive: true});
      const tempos = escolhidas.map((c) => tempoNaCena(c, fracao, info.fps));
      const arquivos = escolhidas.map((c) => path.join(temporaria, `${String(c.n).padStart(3, '0')}.png`));
      const colunas = colunasDaFolha(escolhidas.length, celula.largura, celula.altura);
      const arquivo = path.join(pasta, nomeDaPrevia('cenas', documento, '', 'png'));
      try {
        await s.quadros(projeto, {documento, tempos_ms: tempos, arquivos, escala, aviso: avisoDoMcp(extra)});
        await s.folha({arquivos, colunas, celula, margem: MARGEM_FOLHA, destino: arquivo});
      } finally {
        rmSync(temporaria, {recursive: true, force: true});
      }
      limparPrevias(pasta);
      const {linhas, largura, altura} = gradeDaFolha(escolhidas.length, colunas, celula, MARGEM_FOLHA);
      const k = escalaPara(largura, altura, LADO_IMAGEM_MCP * 1.5);
      const imagem = await s.miniatura(arquivo, {largura: Math.round(largura * k), altura: Math.round(altura * k)}).catch(() => null);
      return resposta({
        arquivo, markdown: markdown(`folha de contato de ${documento}`, arquivo), documento, colunas, linhas, largura, altura,
        cenas: escolhidas.map((c, i) => ({n: c.n, id: c.id, nome: c.nome, tempo_ms: tempos[i], linha: Math.floor(i / colunas) + 1, coluna: (i % colunas) + 1})),
        ...(todas.length > CENAS_MAX ? {cortadas: `só as primeiras ${CENAS_MAX} de ${todas.length}; peça as outras em cenas`} : {}),
        ...(info.avisos.length ? {avisos: info.avisos} : {}), como_mostrar: COMO_MOSTRAR,
      }, imagem);
    } catch (e) {
      return erro(e);
    }
  });

  servidor.registerTool('ver_trecho', {
    description: `Renderiza um trecho do vídeo, com som, em MP4 (H.264) reduzido, em saidas/previas/: de de_ms a ate_ms (até ${TRECHO_MAX_MS / 1000} s), ou a cena inteira com cena. `
      + 'O som sai mixado e no alvo de loudness, como na exportação; a marca d\'água por destino não entra. Devolve o caminho absoluto e um markdown para a pessoa ver o vídeo no chat da IDE. '
      + 'Leva alguns segundos por segundo de vídeo. Não muda nada no projeto.',
    inputSchema: {
      documento: tempoEntrada.documento,
      de_ms: z.number().min(0).optional().describe('começo do trecho em ms do vídeo (padrão 0)'),
      ate_ms: z.number().min(0).optional().describe('fim do trecho em ms (padrão: 10 s depois do começo, ou o fim do vídeo)'),
      cena: z.coerce.string().optional().describe('em vez de de_ms e ate_ms: a cena inteira (número, "1" é a primeira, ou id)'),
      escala: z.number().min(0.1).max(1).optional().describe('1 = tamanho do documento; padrão 0,5'),
    },
    annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: false},
  }, async (a: {documento?: string; de_ms?: number; ate_ms?: number; cena?: string; escala?: number}, extra?: Extra) => {
    try {
      const s = exigirServico();
      const documento = documentoDaPrevia(projeto.manifesto(), a.documento);
      const info = s.info(projeto, documento);
      if (a.cena !== undefined && (a.de_ms !== undefined || a.ate_ms !== undefined)) throw new ErroProjeto('use cena ou de_ms e ate_ms, não os dois', 'patch');
      const cena = a.cena !== undefined ? acharCena(info.cenas, a.cena) : undefined;
      const de = Math.round(cena ? cena.t_in : a.de_ms ?? 0);
      const ate = Math.round(Math.min(info.duracao_ms, cena ? cena.t_out : a.ate_ms ?? de + 10_000));
      if (de >= info.duracao_ms) throw new ErroProjeto(`de_ms ${de} passa do fim do vídeo (${info.duracao_ms} ms)`, 'patch');
      if (ate <= de) throw new ErroProjeto('ate_ms precisa ser maior que de_ms', 'patch');
      if (ate - de > TRECHO_MAX_MS) throw new ErroProjeto(`o trecho tem ${segundos(ate - de)}; peça até ${TRECHO_MAX_MS / 1000} s por vez`, 'patch');
      const escala = a.escala ?? 0.5;
      const pasta = pastaDasPrevias(projeto);
      const arquivo = path.join(pasta, nomeDaPrevia('trecho', documento, `${de}-${ate}ms`, 'mp4'));
      try {
        await s.trecho(projeto, {documento, de_ms: de, ate_ms: ate, arquivo, escala, aviso: avisoDoMcp(extra)});
      } catch (e) {
        rmSync(arquivo, {force: true}); // o arquivo pela metade não fica
        throw e;
      }
      limparPrevias(pasta);
      const alt = `${documento}, de ${segundos(de)} a ${segundos(ate)}${cena ? `, ${textoDaCena(cena)}` : ''}`;
      return resposta({arquivo, markdown: markdown(alt, arquivo), documento, de_ms: de, ate_ms: ate, escala,
        largura: Math.round(info.largura * escala), altura: Math.round(info.altura * escala), ...(info.avisos.length ? {avisos: info.avisos} : {}), como_mostrar: COMO_MOSTRAR});
    } catch (e) {
      return erro(e);
    }
  });
};
