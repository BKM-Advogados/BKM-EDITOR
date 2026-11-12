// A exportação final pelo MCP (docs/exportacao.md, "Pelo MCP"): o agente entrega o arquivo sem clicar em Exportar.
// - exportar_video: vídeo de cenas, carrossel narrado e animação, em MP4 (H.264, H.265) ou WebM (VP9), um arquivo por
//   destino como no diálogo. O render é o mesmo da tela (src/main/exportacao-video.ts), injetado por
//   definirServicoExportacao no app (main.ts), no MCP da IDE (mcp/nucleo.ts) e no do Claude Desktop (mcp/desktop.ts).
// - exportar_imagem e exportar_carrossel: a imagem e o carrossel são desenhados no canvas da janela (exportarPng.ts e
//   exportarPaginas.ts, os mesmos do diálogo), então só existem com o projeto aberto no app; com o app fechado, o serviço
//   não tem como desenhar e a ferramenta pede para abrir o projeto no Estúdio.
// - situacao_exportacao: o andamento (e o Cancelar) de um vídeo que passou do tempo de espera.
// Vídeo longo: o MCP da IDE espera o app no máximo 15 min (PRAZO_DO_APP_MS em mcp-app.ts), e até 10 deles podem ir no
// cartão do portão. Por isso exportar_video espera o arquivo até ESPERA_PADRAO_MS (4 min) e, se o render passar disso,
// devolve um id com a situação; o render segue no processo que o começou e o agente consulta com situacao_exportacao.
// Notificação de progresso não basta: o repasse da IDE ao app lê a resposta HTTP inteira, e o prazo dele não anda com ela.
// As três que gravam são "cartao" no portão (CLASSES de portao.ts); situacao_exportacao só lê e cancela, "livre".
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {z} from 'zod';
import {temPaginas} from './carrossel';
import {ehDocCenas} from './cenas';
import type {DocImagem, Manifesto, Modulo} from './documentos';
import {CODECS, ESCALAS_VIDEO, FORMATOS_IMAGEM_SAIDA, QUALIDADES, type Destino, type FormatoImagem, type OpcoesExportarVideo} from './exportacao';
import {FORMATOS_VIDEO} from './formatos';
import {OPCOES_LEGENDA_EXPORTACAO, type LegendaNaExportacao} from './legendas-exportacao';
import {markdownDaPrevia} from './mcp-previa';
import {lerPrefsExportacao} from './prefs-exportacao';
import {ErroProjeto, type Projeto} from './projeto';

// ---------- o que o render oferece (src/main/exportacao-video.ts e a ponte com a janela) ----------
export type AndamentoFinal = {tipo?: string; mensagem?: string; etapa?: string; progresso?: number; arquivo?: string; indice?: number; total?: number; geral?: number};
export type ResultadoVideoFinal = {ok: boolean; arquivos?: string[]; pasta?: string; mensagem?: string; cancelado?: boolean; avisos?: string[]};
export type PedidoImagemFinal = {documento: string; formato: FormatoImagem; qualidade: number; escala: number; nome?: string};
export type ResultadoImagemFinal = {ok: boolean; arquivo?: string; pasta?: string; faltaram?: string[]; mensagem?: string};
export type PedidoCarrosselFinal = {documento: string; pdf: boolean; nome?: string};
export type ResultadoCarrosselFinal = {ok: boolean; pasta?: string; pdf?: string; arquivos?: string[]; faltaram?: string[]; mensagem?: string};
export type ServicoExportacaoFinal = {
  /** O vídeo em saidas/ (uma exportação por vez, junto com a da tela). */
  video: (projeto: Projeto, documento: string, opcoes: Partial<OpcoesExportarVideo>, aviso?: (a: AndamentoFinal) => void) => Promise<ResultadoVideoFinal>;
  /** Para o vídeo em andamento. */
  cancelarVideo: () => void;
  /** A imagem desenhada pela janela do app; ausente fora do app. */
  imagem?: (projeto: Projeto, pedido: PedidoImagemFinal) => Promise<ResultadoImagemFinal>;
  /** O carrossel desenhado pela janela do app (PNG por página e o PDF); ausente fora do app. */
  carrossel?: (projeto: Projeto, pedido: PedidoCarrosselFinal) => Promise<ResultadoCarrosselFinal>;
};

let servico: ServicoExportacaoFinal | null = null;
export const definirServicoExportacao = (s: ServicoExportacaoFinal | null) => {
  servico = s;
};
const exigirServico = () => {
  if (!servico) throw new Error('a exportação precisa do render do Estúdio, que não está disponível neste servidor MCP');
  return servico;
};

export const ABRA_NO_APP = 'abra o projeto no Estúdio: a imagem e o carrossel são desenhados pela janela do app, e com o app fechado não há onde desenhar';

/** Quanto exportar_video espera o arquivo antes de devolver o id (o cartão e esta espera cabem nos 15 min da IDE). */
export const ESPERA_PADRAO_MS = 4 * 60 * 1000;
let esperaDaChamada = ESPERA_PADRAO_MS;
/** Só para os testes: outra espera (0 devolve o id na hora). */
export const definirEsperaDaChamada = (ms: number) => {
  esperaDaChamada = ms;
};

// ---------- contas puras (testadas em testes/exportacao-mcp.test.ts) ----------
const MODULOS_DE_VIDEO: Modulo[] = ['video', 'animacao'];

/** O documento pedido, ou o que a pessoa está vendo se for do módulo certo, ou o primeiro do módulo. */
export const documentoPara = (m: Manifesto, modulos: Modulo[], documento: string | undefined, naTela: string | undefined, oQue: string) => {
  if (documento) {
    const d = m.documentos.find((x) => x.id === documento);
    if (!d) throw new ErroProjeto(`documento não achado: ${documento}`, 'nao_achado');
    if (!modulos.includes(d.modulo)) throw new ErroProjeto(`${documento} é do módulo ${d.modulo}; ${oQue}`, 'patch');
    return d.id;
  }
  const tela = m.documentos.find((x) => x.id === naTela && modulos.includes(x.modulo));
  const d = tela ?? modulos.map((mod) => m.documentos.find((x) => x.modulo === mod)).find(Boolean);
  if (!d) throw new ErroProjeto(`este projeto não tem documento para isso (${oQue})`, 'nao_achado');
  return d.id;
};

const LIMITE_LADO = {min: 16, max: 7680};
const PRESETS = FORMATOS_VIDEO.map((f) => f.id);

/** "reels", "feed", "quadrado", "youtube" ou "LARGURAxALTURA" (16 a 7680) viram destinos; um personalizado por vez, como na tela. */
export const destinosDoPedido = (pedidos: string[]): Destino[] => {
  const destinos: Destino[] = [];
  for (const bruto of pedidos) {
    const t = bruto.trim().toLowerCase();
    const preset = FORMATOS_VIDEO.find((f) => f.id === t || f.proporcao === t);
    const medida = /^(\d{2,4})\s*[x×]\s*(\d{2,4})$/.exec(t);
    let d: Destino;
    if (preset) d = {id: preset.id, largura: preset.largura, altura: preset.altura};
    else if (medida) {
      const [largura, altura] = [Number(medida[1]), Number(medida[2])];
      if ([largura, altura].some((n) => n < LIMITE_LADO.min || n > LIMITE_LADO.max)) throw new ErroProjeto(`${bruto}: cada lado vai de ${LIMITE_LADO.min} a ${LIMITE_LADO.max} px`, 'patch');
      const igual = FORMATOS_VIDEO.find((f) => f.largura === largura && f.altura === altura);
      d = igual ? {id: igual.id, largura, altura} : {id: 'personalizado', largura, altura};
    } else throw new ErroProjeto(`destino desconhecido: ${bruto} (use ${PRESETS.join(', ')} ou LARGURAxALTURA, ex.: 1000x500)`, 'patch');
    if (destinos.some((x) => x.id === d.id)) {
      if (d.id === 'personalizado') throw new ErroProjeto('um tamanho personalizado por vez, como na tela', 'patch');
      continue; // o mesmo destino duas vezes sai uma
    }
    destinos.push(d);
  }
  return destinos;
};

// ---------- as exportações de vídeo desta conversa (o render segue depois que exportar_video devolve) ----------
export type SituacaoVideo = {
  exportacao: string;
  documento: string;
  situacao: 'renderizando' | 'pronta' | 'falhou' | 'cancelada';
  iniciada_em: string;
  terminada_em?: string;
  andamento?: {arquivo?: string; indice?: number; total?: number; etapa?: string; porcento?: number; geral_porcento?: number; mensagem?: string};
  arquivos?: string[];
  pasta?: string;
  avisos?: string[];
  mensagem?: string;
};
const GUARDADAS = 20;
const exportacoes = new Map<string, SituacaoVideo>();
const guardar = (s: SituacaoVideo) => {
  exportacoes.set(s.exportacao, s);
  while (exportacoes.size > GUARDADAS) exportacoes.delete(exportacoes.keys().next().value!);
};
/** Só para os testes: esquece as exportações guardadas. */
export const esquecerExportacoes = () => exportacoes.clear();

// ---------- resposta ----------
const texto = (x: unknown) => ({content: [{type: 'text' as const, text: typeof x === 'string' ? x : JSON.stringify(x, null, 2)}]});
const erro = (e: unknown) => ({
  isError: true,
  content: [{type: 'text' as const, text: e instanceof ErroProjeto ? `${e.codigo}: ${e.message}` : String((e as Error)?.message ?? e)}],
});
const relativo = (projeto: Projeto, arquivo: string) => path.relative(projeto.raiz, arquivo).split(path.sep).join('/');
const COMO_MOSTRAR = 'Para a pessoa abrir, ponha o caminho (ou o campo markdown, quando houver) na resposta.';

/** Progresso para o cliente MCP que pediu (progressToken), um aviso por segundo no máximo, e só enquanto a chamada está aberta. */
type Extra = {_meta?: {progressToken?: string | number}; sendNotification?: (n: {method: 'notifications/progress'; params: {progressToken: string | number; progress: number; total?: number; message?: string}}) => Promise<void>};
const avisoDoMcp = (extra: Extra | undefined, aberta: () => boolean) => {
  const token = extra?._meta?.progressToken;
  let ultimo = 0;
  let passo = 0;
  return (mensagem: string, fracao?: number) => {
    if (token === undefined || !extra?.sendNotification || !aberta()) return;
    const agora = Date.now();
    if (agora - ultimo < 1000 && fracao !== undefined && fracao < 1) return;
    ultimo = agora;
    passo += 1;
    void extra.sendNotification({method: 'notifications/progress', params: {progressToken: token, progress: passo, message: mensagem}}).catch(() => undefined);
  };
};

const lerDoc = <T,>(projeto: Projeto, documento: string) => projeto.lerJson<T>(projeto.arquivoDoDocumento(documento)).doc;

// ---------- ferramentas ----------
export const registrarExportacaoFinal = (servidor: McpServer, projeto: Projeto, _autor: string, _origem: string) => {
  const naTela = () => projeto.estado()?.documento;

  servidor.registerTool('exportar_video', {
    description: 'Exporta o vídeo (vídeo de cenas, carrossel narrado ou animação) para saidas/, como o botão Exportar do app: o mesmo render, com som mixado no alvo de loudness, '
      + 'legendas e marca d\'água de cada destino. Um arquivo por destino (só o vídeo de cenas muda de proporção; carrossel narrado e animação saem no tamanho deles). '
      + 'Pede a permissão da pessoa. Leva de segundos a minutos: espera o arquivo até 4 min; se passar disso, devolve "exportacao" com a situação "renderizando" e o render segue — '
      + 'consulte com situacao_exportacao. Uma exportação por vez (a da tela conta). Funciona com o app aberto ou fechado.',
    inputSchema: {
      documento: z.string().optional().describe('id do vídeo ou animação; sem ele, o que a pessoa está vendo, ou o primeiro vídeo do projeto'),
      destinos: z.array(z.string()).optional().describe(`um arquivo por destino: ${FORMATOS_VIDEO.map((f) => `${f.id} (${f.proporcao})`).join(', ')} ou LARGURAxALTURA; sem ele, o formato do documento`),
      codec: z.enum(CODECS.map((c) => c.id) as [string, ...string[]]).optional().describe(CODECS.map((c) => `${c.id}: ${c.nome}, ${c.nota}`).join('; ') + ' (padrão h264)'),
      qualidade: z.enum(QUALIDADES.map((q) => q.id) as [string, ...string[]]).optional().describe(QUALIDADES.map((q) => `${q.id}: ${q.nota}`).join('; ') + ' (padrão alta)'),
      escala: z.number().optional().describe(`${ESCALAS_VIDEO.join(', ')} (padrão 1)`),
      trecho: z.object({de_ms: z.number().min(0), ate_ms: z.number().min(0)}).optional().describe('só este trecho, em ms do vídeo; sem ele, o vídeo inteiro'),
      nome: z.string().optional().describe('base do nome do arquivo; sem ele, o título do documento (com o sufixo da proporção quando sai mais de um)'),
      legendas: z.enum(OPCOES_LEGENDA_EXPORTACAO.map((x) => x.valor) as [string, ...string[]]).optional()
        .describe(OPCOES_LEGENDA_EXPORTACAO.map((x) => `${x.valor}: ${x.nota}`).join('; ') + ' (padrão video; só no vídeo de cenas com legendas)'),
      marca_dagua: z.boolean().optional().describe('false sai sem marca d\'água; sem ele, cada destino leva a marca que está guardada para ele (veja marca_dagua)'),
    },
    annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: false},
  }, async (a: {documento?: string; destinos?: string[]; codec?: string; qualidade?: string; escala?: number; trecho?: {de_ms: number; ate_ms: number}; nome?: string;
    legendas?: string; marca_dagua?: boolean}, extra?: Extra) => {
    try {
      const s = exigirServico();
      const documento = documentoPara(projeto.manifesto(), MODULOS_DE_VIDEO, a.documento, naTela(), 'exportar_video exporta vídeo e animação; para imagem use exportar_imagem');
      const emCurso = [...exportacoes.values()].find((x) => x.situacao === 'renderizando');
      if (emCurso) throw new ErroProjeto(`já há uma exportação em andamento (${emCurso.exportacao}, de ${emCurso.documento}); acompanhe ou cancele com situacao_exportacao`, 'patch');
      if (a.escala !== undefined && !ESCALAS_VIDEO.includes(a.escala)) throw new ErroProjeto(`escala ${a.escala}: use ${ESCALAS_VIDEO.join(', ')}`, 'patch');
      const doc = lerDoc<unknown>(projeto, documento);
      const modulo = projeto.manifesto().documentos.find((d) => d.id === documento)!.modulo;
      const fixo = modulo === 'animacao' || !ehDocCenas(doc);
      const destinos = a.destinos?.length ? destinosDoPedido(a.destinos) : [];
      const avisos: string[] = [];
      if (fixo && destinos.length) avisos.push(`${modulo === 'animacao' ? 'a animação' : 'o carrossel narrado'} tem tamanho fixo: sai um arquivo só, no tamanho dele (destinos ignorados)`);
      if (a.legendas && fixo) avisos.push('legendas por destino só valem no vídeo de cenas (ignorado)');
      const prefs = a.marca_dagua === false ? {} : lerPrefsExportacao(projeto).marca_dagua ?? {};
      const opcoes: Partial<OpcoesExportarVideo> = {
        ...(destinos.length && !fixo ? {destinos} : {}),
        ...(a.codec ? {codec: a.codec as OpcoesExportarVideo['codec']} : {}),
        ...(a.qualidade ? {qualidade: a.qualidade as OpcoesExportarVideo['qualidade']} : {}),
        ...(a.escala !== undefined ? {escala: a.escala} : {}),
        ...(a.trecho ? {trecho: a.trecho} : {}),
        ...(a.nome?.trim() ? {nome: a.nome.trim()} : {}),
        marca_dagua: prefs,
        // a escolha da legenda vale para todos os destinos (o diálogo deixa escolher um por um)
        ...(a.legendas && !fixo ? {legendas: Object.fromEntries([...FORMATOS_VIDEO.map((f) => f.id), 'personalizado'].map((id) => [id, a.legendas as LegendaNaExportacao]))} : {}),
      };
      const situacao: SituacaoVideo = {exportacao: randomUUID().slice(0, 8), documento, situacao: 'renderizando', iniciada_em: new Date().toISOString()};
      guardar(situacao);
      let aberta = true;
      const avisar = avisoDoMcp(extra, () => aberta);
      const render = s.video(projeto, documento, opcoes, (x) => {
        situacao.andamento = {
          ...(x.arquivo ? {arquivo: x.arquivo} : {}), ...(x.indice ? {indice: x.indice, total: x.total} : {}),
          ...(x.etapa ? {etapa: x.etapa} : {}), ...(x.progresso !== undefined ? {porcento: Math.round(x.progresso)} : {}),
          ...(x.geral !== undefined ? {geral_porcento: Math.round(x.geral * 100)} : situacao.andamento?.geral_porcento !== undefined ? {geral_porcento: situacao.andamento.geral_porcento} : {}),
          ...(x.mensagem ? {mensagem: x.mensagem} : {}),
        };
        avisar(x.mensagem ?? `${x.arquivo ? `${x.arquivo}: ` : ''}${x.etapa ?? 'renderizando'} ${Math.round(x.progresso ?? 0)}%`, x.geral);
      }).then((r) => {
        situacao.terminada_em = new Date().toISOString();
        situacao.situacao = r.ok ? 'pronta' : r.cancelado ? 'cancelada' : 'falhou';
        situacao.arquivos = r.arquivos ?? [];
        situacao.pasta = r.pasta;
        if (r.mensagem) situacao.mensagem = r.mensagem;
        if (r.avisos?.length || avisos.length) situacao.avisos = [...avisos, ...(r.avisos ?? [])];
        return situacao;
      }, (e: unknown) => {
        situacao.terminada_em = new Date().toISOString();
        situacao.situacao = 'falhou';
        situacao.mensagem = String((e as Error)?.message ?? e);
        return situacao;
      });
      let relogio: ReturnType<typeof setTimeout> | undefined;
      const pronta = await Promise.race([render, new Promise<null>((ok) => (relogio = setTimeout(() => ok(null), esperaDaChamada)))]);
      clearTimeout(relogio);
      aberta = false;
      if (!pronta) {
        return texto({exportacao: situacao.exportacao, situacao: 'renderizando', documento, andamento: situacao.andamento, ...(avisos.length ? {avisos} : {}),
          proximo_passo: `o render segue; consulte com situacao_exportacao {exportacao: "${situacao.exportacao}"} daqui a um ou dois minutos`});
      }
      return resultadoDoVideo(projeto, pronta);
    } catch (e) {
      return erro(e);
    }
  });

  servidor.registerTool('situacao_exportacao', {
    description: 'Andamento de um vídeo que exportar_video começou e devolveu antes do fim ("exportacao"): renderizando, pronta (com os arquivos), falhou ou cancelada. '
      + 'Sem exportacao, a mais recente. Com cancelar: true, para o render (o arquivo pela metade sai de saidas/). Não muda nada no projeto.',
    inputSchema: {
      exportacao: z.string().optional().describe('o id que exportar_video devolveu; sem ele, a mais recente'),
      cancelar: z.boolean().optional().describe('true para parar o render em andamento'),
    },
    annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: false},
  }, async (a: {exportacao?: string; cancelar?: boolean}) => {
    try {
      const lista = [...exportacoes.values()];
      const s = a.exportacao ? exportacoes.get(a.exportacao) : lista[lista.length - 1];
      if (!s) {
        throw new ErroProjeto(a.exportacao
          ? `exportação não achada: ${a.exportacao} (este processo não a começou, ou o app fechou e o render parou; veja saidas/)`
          : 'nenhuma exportação de vídeo começou por aqui', 'nao_achado');
      }
      if (a.cancelar && s.situacao === 'renderizando') {
        exigirServico().cancelarVideo();
        return texto({exportacao: s.exportacao, situacao: 'cancelando', documento: s.documento, proximo_passo: 'consulte de novo em alguns segundos'});
      }
      return resultadoDoVideo(projeto, s);
    } catch (e) {
      return erro(e);
    }
  });

  servidor.registerTool('exportar_imagem', {
    description: 'Exporta a imagem (fundo, camadas e a pilha de efeitos) para saidas/ em PNG, JPG ou WebP, como o botão Exportar do app. Pede a permissão da pessoa. '
      + 'Só com o projeto aberto no Estúdio: a imagem é desenhada pela janela do app; com o app fechado, a ferramenta pede para abrir o projeto. '
      + 'Carrossel (imagem com páginas) sai por exportar_carrossel.',
    inputSchema: {
      documento: z.string().optional().describe('id da imagem; sem ele, a que a pessoa está vendo, ou a primeira do projeto'),
      formato: z.enum(FORMATOS_IMAGEM_SAIDA.map((f) => f.id) as [string, ...string[]]).optional().describe(FORMATOS_IMAGEM_SAIDA.map((f) => `${f.id}: ${f.nota}`).join('; ') + ' (padrão png)'),
      qualidade: z.number().int().min(5).max(100).optional().describe('5 a 100, só JPG e WebP (padrão 90)'),
      escala: z.number().min(0.1).max(4).optional().describe('1 = tamanho do documento; o diálogo oferece 0,5, 1 e 2 (padrão 1)'),
      nome: z.string().optional().describe('nome do arquivo sem extensão; sem ele, o título do documento'),
    },
    annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: false},
  }, async (a: {documento?: string; formato?: string; qualidade?: number; escala?: number; nome?: string}) => {
    try {
      const s = exigirServico();
      const documento = documentoPara(projeto.manifesto(), ['imagem'], a.documento, naTela(), 'exportar_imagem exporta imagem; para vídeo use exportar_video');
      if (temPaginas(lerDoc<DocImagem>(projeto, documento))) throw new ErroProjeto(`${documento} é um carrossel (tem páginas): use exportar_carrossel`, 'patch');
      if (!s.imagem) throw new Error(ABRA_NO_APP);
      const r = await s.imagem(projeto, {documento, formato: (a.formato ?? 'png') as FormatoImagem, qualidade: a.qualidade ?? 90, escala: a.escala ?? 1, ...(a.nome?.trim() ? {nome: a.nome.trim()} : {})});
      if (!r.ok || !r.arquivo) throw new Error(r.mensagem ?? 'a exportação da imagem falhou');
      return texto({ok: true, arquivo: r.arquivo, em_saidas: relativo(projeto, r.arquivo), markdown: markdownDaPrevia(documento, r.arquivo),
        ...(r.faltaram?.length ? {avisos: [`saiu sem estas imagens (não carregaram): ${r.faltaram.join(', ')}`]} : {}), como_mostrar: COMO_MOSTRAR});
    } catch (e) {
      return erro(e);
    }
  });

  servidor.registerTool('exportar_carrossel', {
    description: 'Exporta o carrossel (imagem com páginas) para saidas/: um PNG por página em saidas/<nome>/01.png… e, com pdf (padrão), o PDF <nome>.pdf com uma página por imagem, sem margem '
      + '(o carrossel do LinkedIn). Pede a permissão da pessoa. Só com o projeto aberto no Estúdio: as páginas são desenhadas pela janela do app; com o app fechado, a ferramenta pede para abrir o projeto.',
    inputSchema: {
      documento: z.string().optional().describe('id do carrossel; sem ele, o que a pessoa está vendo, ou o primeiro carrossel do projeto'),
      pdf: z.boolean().optional().describe('false para sair só os PNG (padrão true)'),
      nome: z.string().optional().describe('nome da pasta e do PDF; sem ele, o título do documento'),
    },
    annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: false},
  }, async (a: {documento?: string; pdf?: boolean; nome?: string}) => {
    try {
      const s = exigirServico();
      const m = projeto.manifesto();
      // sem documento: o carrossel que a pessoa vê, ou o primeiro carrossel (não a primeira imagem, que pode ser simples)
      const carrosseis = m.documentos.filter((d) => d.modulo === 'imagem' && (() => {
        try {
          return temPaginas(lerDoc<DocImagem>(projeto, d.id));
        } catch {
          return false;
        }
      })());
      const documento = a.documento ?? (carrosseis.find((d) => d.id === naTela()) ?? carrosseis[0])?.id;
      if (!documento) throw new ErroProjeto('este projeto não tem carrossel (imagem com páginas)', 'nao_achado');
      documentoPara(m, ['imagem'], documento, undefined, 'exportar_carrossel exporta o carrossel da imagem; para vídeo use exportar_video');
      if (!temPaginas(lerDoc<DocImagem>(projeto, documento))) throw new ErroProjeto(`${documento} não tem páginas: use exportar_imagem`, 'patch');
      if (!s.carrossel) throw new Error(ABRA_NO_APP);
      const r = await s.carrossel(projeto, {documento, pdf: a.pdf ?? true, ...(a.nome?.trim() ? {nome: a.nome.trim()} : {})});
      if (!r.ok) throw new Error(r.mensagem ?? 'a exportação do carrossel falhou');
      return texto({ok: true, ...(r.pdf ? {pdf: r.pdf} : {}), pasta: r.pasta, arquivos: r.arquivos ?? [], em_saidas: (r.arquivos ?? []).map((x) => relativo(projeto, x)),
        ...(r.faltaram?.length ? {avisos: [`saiu sem estas imagens (não carregaram): ${r.faltaram.join(', ')}`]} : {}), como_mostrar: COMO_MOSTRAR});
    } catch (e) {
      return erro(e);
    }
  });
};

/** A resposta de um vídeo: pronto (os arquivos e o markdown do primeiro), em andamento ou o motivo de não ter saído. */
const resultadoDoVideo = (projeto: Projeto, s: SituacaoVideo) => {
  const comum = {exportacao: s.exportacao, situacao: s.situacao, documento: s.documento, iniciada_em: s.iniciada_em, ...(s.terminada_em ? {terminada_em: s.terminada_em} : {})};
  if (s.situacao === 'renderizando') return texto({...comum, andamento: s.andamento, proximo_passo: 'o render segue; consulte de novo daqui a um ou dois minutos'});
  if (s.situacao !== 'pronta') {
    return {isError: s.situacao === 'falhou', content: [{type: 'text' as const, text: JSON.stringify({...comum, mensagem: s.mensagem ?? (s.situacao === 'cancelada' ? 'Exportação cancelada' : 'sem detalhes'),
      ...(s.arquivos?.length ? {arquivos: s.arquivos} : {}), ...(s.avisos?.length ? {avisos: s.avisos} : {})}, null, 2)}]};
  }
  const arquivos = s.arquivos ?? [];
  const video = arquivos.find((a) => /\.(mp4|webm)$/i.test(a));
  return texto({...comum, ok: true, arquivos, em_saidas: arquivos.map((a) => relativo(projeto, a)), pasta: s.pasta,
    ...(video ? {markdown: markdownDaPrevia(s.documento, video)} : {}), ...(s.avisos?.length ? {avisos: s.avisos} : {}), como_mostrar: COMO_MOSTRAR});
};
