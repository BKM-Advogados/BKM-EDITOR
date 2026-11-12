// Ferramentas MCP de medida do som (frente 3 do MCP): medir_loudness, medir_envelope e limpar_voz. Fazem o que o medidor
// do inspetor, a linha do tempo e o botão "Limpar voz" fazem na tela, com as mesmas funções do processo principal,
// injetadas por definirServicoMedidas (src/nucleo/medidas-som.ts): rodam com o app aberto (MCP por HTTP) e com ele fechado
// (MCP por stdio, com o ffmpeg do node_modules ou do app instalado). Classe "livre" no portão: medir só lê (o envelope é
// um arquivo de cache ao lado do áudio, como o que a tela grava), e a limpeza grava um WAV novo sem tocar no original e
// muda o clipe por aplicarPatch, com Reverter no histórico. Descrições curtas e esquema sem união solta: valem para o
// Claude, o Gemini, o DeepSeek e o OpenAI. Chamado por uma linha no fim de registrarFerramentas (ferramentas-mcp.ts).
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {nivelDeReferencia, nomeDoClipe, type IntensidadeLimpeza} from './audio';
import {ehDocCenas, type DocCenas} from './cenas';
import {acharClipe} from './clipes-audio';
import {INTENSIDADE_PADRAO, INTENSIDADES} from './limpeza-voz';
import type {MedidaLoudness, MedidasLoudness} from './loudness';
import {exigirServicoMedidas, origemDaLimpeza, patchLimpezaDoClipe, patchVoltarAoOriginalDoClipe} from './medidas-som';
import {ErroProjeto, type Projeto} from './projeto';

const texto = (x: unknown) => ({content: [{type: 'text' as const, text: typeof x === 'string' ? x : JSON.stringify(x, null, 2)}]});
const erro = (e: unknown) => ({
  isError: true,
  content: [{type: 'text' as const, text: e instanceof ErroProjeto ? `${e.codigo}: ${e.message}` : String((e as Error)?.message ?? e)}],
});

/** Progresso para o cliente que pediu (progressToken), um aviso por segundo no máximo; quem não entrega notificação ignora. */
type Extra = {_meta?: {progressToken?: string | number}; sendNotification?: (n: {method: 'notifications/progress'; params: {progressToken: string | number; progress: number; total?: number; message?: string}}) => Promise<void>};
const progressoDoMcp = (extra: Extra | undefined, rotulo: string) => {
  const token = extra?._meta?.progressToken;
  let ultimo = 0;
  return (fracao: number) => {
    if (token === undefined || !extra?.sendNotification) return;
    const agora = Date.now();
    if (agora - ultimo < 1000 && fracao < 1) return;
    ultimo = agora;
    void extra.sendNotification({method: 'notifications/progress', params: {progressToken: token, progress: Math.round(fracao * 100), total: 100, message: rotulo}}).catch(() => undefined);
  };
};

/** O vídeo de cenas pedido, ou o que a pessoa está vendo, ou o primeiro vídeo do projeto. */
const videoDe = (projeto: Projeto, documento?: string) => {
  const visto = projeto.estado()?.documento;
  const manifesto = projeto.manifesto();
  const alvo = documento ?? (manifesto.documentos.some((d) => d.id === visto && d.modulo === 'video') ? visto : undefined)
    ?? manifesto.documentos.find((d) => d.modulo === 'video')?.id;
  if (!alvo) throw new ErroProjeto('o projeto não tem vídeo de cenas', 'nao_achado');
  const rel = projeto.arquivoDoDocumento(alvo);
  const lido = projeto.lerJson<unknown>(rel);
  if (!ehDocCenas(lido.doc)) throw new ErroProjeto(`${alvo} não é um vídeo de cenas`, 'patch');
  return {alvo, rel, doc: lido.doc as DocCenas, versao: lido.versao};
};

// ---------- loudness: o que o agente lê ----------
const r1 = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const NO_ALVO_LU = 1; // o medidor da tela pinta o integrado de verde a ±1 LU do alvo

/** Uma medida sem a curva de curto prazo (um número a cada 100 ms, grande demais para a resposta). */
const resumo = (m: MedidaLoudness, pico?: number) => ({
  integrado_lufs: r1(m.integrado_lufs), curto_max_lufs: r1(m.curto_max_lufs), momentaneo_max_lufs: r1(m.momentaneo_max_lufs),
  ...(m.pico_dbtp !== null ? {pico_dbtp: r1(m.pico_dbtp), ...(pico !== undefined ? {pico_alto: m.pico_dbtp > pico} : {})} : {}),
  duracao_ms: m.duracao_ms,
});

/** O curto prazo (3 s) a cada `passo_ms`, para o agente achar o trecho alto ou baixo. */
export const curvaDoCurtoPrazo = (m: MedidaLoudness, passo_ms = 1000) => {
  const pulo = Math.max(1, Math.round(passo_ms / 100));
  const pontos: {t_ms: number; lufs: number | null}[] = [];
  for (let k = pulo - 1; k < m.curto_prazo.length; k += pulo) {
    const v = m.curto_prazo[k];
    pontos.push({t_ms: (k + 1) * 100, lufs: v <= -70 ? null : r1(v)});
  }
  return pontos;
};

/** A resposta do medir_loudness: a mistura contra o alvo, a voz e cada faixa (com o quanto fica abaixo da voz). */
export const leituraDoLoudness = (r: MedidasLoudness, doc: DocCenas, o: {curva?: boolean} = {}) => {
  const i = r.mistura.integrado_lufs;
  const dif = i === null ? null : r1(i - r.alvo_lufs);
  const faixas = (doc.audio?.faixas ?? []).flatMap((f, n) => {
    const m = r.faixas[`/audio/faixas/${n}`];
    if (!m) return [];
    return [{id: f.id, nome: f.nome, papel: f.papel, ...resumo(m),
      ...(m.sob_voz_lufs !== undefined ? {sob_voz_lufs: r1(m.sob_voz_lufs), abaixo_da_voz_lu: r1(m.abaixo_da_voz_lu)} : {})}];
  });
  const notas: string[] = [];
  if (i === null) notas.push('a mistura é só silêncio');
  else if (dif !== null && Math.abs(dif) > NO_ALVO_LU) {
    notas.push(`a mistura está ${Math.abs(dif).toString().replace('.', ',')} LU ${dif < 0 ? 'abaixo' : 'acima'} do alvo; a exportação corrige o ganho do arquivo final, mas o equilíbrio entre as faixas é seu`);
  }
  if (r.mistura.pico_dbtp !== null && r.mistura.pico_dbtp > r.pico_dbtp) notas.push(`o pico verdadeiro passa de ${r.pico_dbtp} dBTP; a exportação limita, mas abaixe o que estoura`);
  if (r.faltando.length) notas.push(`fora da medida (arquivo que não abriu): ${r.faltando.join(', ')}`);
  return {
    alvo_lufs: r.alvo_lufs, pico_max_dbtp: r.pico_dbtp,
    mistura: {...resumo(r.mistura, r.pico_dbtp), diferenca_do_alvo_lu: dif, no_alvo: dif !== null && Math.abs(dif) <= NO_ALVO_LU},
    voz: r.voz ? resumo(r.voz) : null,
    faixas,
    ...(o.curva ? {curto_prazo_mistura: curvaDoCurtoPrazo(r.mistura)} : {}),
    ...(r.faltando.length ? {faltando: r.faltando} : {}),
    ...(notas.length ? {notas} : {}),
  };
};

/** A forma de onda em `n` pontos (o mais alto de cada pedaço, em dB, uma casa): o agente vê onde há som e onde há pausa. */
export const formaDaOnda = (db: number[], n = 48) => {
  if (!db.length) return [];
  const k = Math.min(n, db.length);
  return Array.from({length: k}, (_, i) => {
    const de = Math.floor((i * db.length) / k);
    const ate = Math.max(de + 1, Math.floor(((i + 1) * db.length) / k));
    let max = -Infinity;
    for (let j = de; j < ate; j++) if (db[j] > max) max = db[j];
    return Math.round(Math.max(-100, max) * 10) / 10;
  });
};

const INTENSIDADES_TEXTO = (Object.keys(INTENSIDADES) as IntensidadeLimpeza[]).join(', ');

export const registrarMedidas = (servidor: McpServer, projeto: Projeto, autor: string, origem: string) => {
  servidor.registerTool('medir_loudness', {
    description: 'Mede o loudness (ITU-R BS.1770, o da EBU R128 e das redes) do som do vídeo de cenas como o render vai soar, o mesmo número do medidor do inspetor: '
      + 'a mistura (integrado em LUFS contra o alvo audio.alvo_lufs, curto prazo máximo, momentâneo máximo e pico verdadeiro em dBTP), a voz e cada faixa; nas faixas que não são voz, '
      + 'sob_voz_lufs e abaixo_da_voz_lu dizem quanto a música ou o efeito fica abaixo da narração enquanto ela fala (a casa mixa a música de 18 a 23 LU abaixo). '
      + 'Com curva: true, o curto prazo da mistura a cada segundo. Só lê; leva alguns segundos num vídeo longo.',
    inputSchema: {
      documento: z.string().optional().describe('id do vídeo de cenas; sem ele, o que a pessoa está vendo'),
      curva: z.boolean().optional().describe('true: devolve também o curto prazo da mistura a cada segundo'),
    },
    annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
  }, async ({documento, curva}: {documento?: string; curva?: boolean}) => {
    try {
      const s = exigirServicoMedidas();
      const {alvo, doc} = videoDe(projeto, documento);
      const r = await s.loudness(projeto, alvo);
      if ('erro' in r) throw new ErroProjeto(`${alvo}: ${r.erro}`, 'patch');
      return texto({documento: alvo, ...leituraDoLoudness(r, doc, {curva})});
    } catch (e) {
      return erro(e);
    }
  });

  servidor.registerTool('medir_envelope', {
    description: 'Mede um áudio do projeto (duração e forma de onda em janelas de 50 ms, ponderação K) e grava <arquivo>.envelope.json ao lado, o mesmo que a linha do tempo grava ao ver o arquivo. '
      + 'Sem o envelope, o clipe fica sem duração medida, sem forma de onda e sem ducking: chame depois de pôr no projeto um áudio novo com o app fechado (com ele aberto, a tela mede sozinha). '
      + 'Devolve a duração, o nível da fala e a forma da onda resumida. O áudio não muda.',
    inputSchema: {
      arquivo: z.string().describe('caminho do áudio no projeto, ex.: midia/narracao.wav (wav, mp3, m4a, ogg ou aac; também o som de um vídeo)'),
    },
    annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: false},
  }, async ({arquivo}: {arquivo: string}) => {
    try {
      const s = exigirServicoMedidas();
      if (!projeto.existe(arquivo)) throw new ErroProjeto(`o arquivo não está no projeto: ${arquivo}`, 'nao_achado');
      const env = await s.envelope(projeto, arquivo);
      const nivel = nivelDeReferencia(env);
      return texto({arquivo, envelope: `${arquivo}.envelope.json`, duracao_ms: env.duracao_ms, janela_ms: env.janela_ms, janelas: env.db.length,
        nivel_db: r1(nivel), forma_db: formaDaOnda(env.db)});
    } catch (e) {
      return erro(e);
    }
  });

  servidor.registerTool('limpar_voz', {
    description: `Limpa a voz (ruído de fundo nas pausas, rumor grave, chiado e sibilância) sem tocar no original, como o botão "Limpar voz" da tela. Intensidades: ${INTENSIDADES_TEXTO} (padrão media). `
      + 'Com clipe: grava midia/<original>.limpo*.wav a partir do arquivo da pessoa (nunca do já limpo) e o clipe passa a tocar o limpo, guardando o original em "original" e as medidas em "limpeza"; '
      + 'com voltar: true, o clipe volta ao original. Com arquivo (sem clipe): só grava o limpo ao lado e devolve o caminho. '
      + 'Até 20 min de estéreo por vez; leva alguns segundos por minuto de áudio.',
    inputSchema: {
      clipe: z.string().optional().describe('id do clipe de áudio do vídeo de cenas'),
      arquivo: z.string().optional().describe('em vez de clipe: caminho do áudio no projeto, ex.: midia/narracao.wav'),
      intensidade: z.enum(['leve', 'media', 'forte']).optional().describe('padrão media'),
      voltar: z.boolean().optional().describe('true: o clipe volta ao arquivo original'),
      documento: z.string().optional().describe('id do vídeo do clipe; sem ele, o que a pessoa está vendo'),
    },
    annotations: {readOnlyHint: false, destructiveHint: false, openWorldHint: false},
  }, async (a: {clipe?: string; arquivo?: string; intensidade?: IntensidadeLimpeza; voltar?: boolean; documento?: string}, extra?: Extra) => {
    try {
      if ((a.clipe === undefined) === (a.arquivo === undefined)) throw new ErroProjeto('diga clipe (o clipe do vídeo) ou arquivo (um áudio do projeto), um dos dois', 'patch');
      const intensidade = a.intensidade ?? INTENSIDADE_PADRAO;
      if (a.arquivo !== undefined) {
        if (a.voltar) throw new ErroProjeto('o arquivo original nunca muda: para um clipe voltar a ele, use clipe com voltar: true', 'patch');
        if (!projeto.existe(a.arquivo)) throw new ErroProjeto(`o arquivo não está no projeto: ${a.arquivo}`, 'nao_achado');
        const r = await exigirServicoMedidas().limparVoz(projeto, a.arquivo, intensidade, progressoDoMcp(extra, 'limpando a voz'));
        return texto({ok: true, original: a.arquivo, arquivo: r.arquivo, intensidade, duracao_ms: r.duracao_ms, medidas: r.medidas});
      }
      const clipe = a.clipe!;
      const lido = videoDe(projeto, a.documento);
      const achado = acharClipe(lido.doc, clipe);
      if (!achado) throw new ErroProjeto(`clipe não achado: ${clipe}`, 'nao_achado');
      if (a.voltar) {
        const patch = patchVoltarAoOriginalDoClipe(lido.doc, achado.caminho, achado.c);
        if (!patch.length) throw new ErroProjeto(`${clipe} já toca o arquivo original`, 'patch');
        const g = projeto.aplicarPatch({documento: lido.rel, versao_base: lido.versao, patch, autor, origem, rotulo: `voltar ao original: ${nomeDoClipe(achado.c)}`});
        return texto({ok: true, documento: lido.alvo, clipe, arquivo: achado.c.original, versao: g.versao});
      }
      const fonte = origemDaLimpeza(achado.c);
      const r = await exigirServicoMedidas().limparVoz(projeto, fonte, intensidade, progressoDoMcp(extra, 'limpando a voz'));
      // a limpeza leva segundos: o clipe é achado de novo pelo id e tem de partir do mesmo original; se mudou, nada é gravado
      const agora = videoDe(projeto, lido.alvo);
      const depois = acharClipe(agora.doc, clipe);
      if (!depois || origemDaLimpeza(depois.c) !== fonte) {
        throw new ErroProjeto(`o clipe ${clipe} mudou enquanto a voz era limpa; o documento não mudou e a voz limpa ficou em ${r.arquivo}: chame de novo`, 'conflito');
      }
      const patch = patchLimpezaDoClipe(agora.doc, depois.caminho, depois.c, r);
      const g = projeto.aplicarPatch({documento: agora.rel, versao_base: agora.versao, patch, autor, origem, rotulo: `limpar voz (${intensidade}): ${nomeDoClipe(depois.c)}`});
      return texto({ok: true, documento: agora.alvo, clipe, arquivo: r.arquivo, original: fonte, intensidade, medidas: r.medidas, versao: g.versao,
        como_voltar: 'limpar_voz {clipe, voltar: true} ou desfazer'});
    } catch (e) {
      return erro(e);
    }
  });
};
