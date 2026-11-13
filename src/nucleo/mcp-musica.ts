// Ferramentas MCP da música e da ida e volta entre módulos (docs/musica.md). Registradas por uma linha no fim de
// registrarFerramentas (ferramentas-mcp.ts), por stdio e por HTTP. Servem a qualquer IA (Claude, Gemini, DeepSeek,
// OpenAI, modelos locais): esquema Zod sem z.any() nem união solta, descrição curta, resultado curto. Toda escrita passa
// pelo diário e devolve {seq, documento, caminho}; depois de mudar uma música, os clipes do vídeo ligados a ela trocam
// de render (musica-projeto.ts). A classe de cada ferramenta (para o portão de permissão da frente IA) fica em
// CLASSES_MUSICA: "livre" grava no diário e tem Reverter; "cartao" exporta ou traz arquivo de fora do projeto.
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import type {OperacaoPatch} from './documentos';
import {ehDocCenas, type DocCenas} from './cenas';
import {ehDocMusica, NOME_PECA, PECAS, posicaoEmCompasso, PRESETS, resolverMusica, type DocMusica, type PecaBateria, type PresetSintetizador} from './musica';
import {aplicarProgressao, criarPadrao, editarArranjo, editarNotas, escreverNotas, ESTILOS_GERADOS, gerarNotas, trocarKit, type PedidoEditarNotas, type Edicao, type EstiloGerado, type PedidoArranjo, type PedidoGerar,
  type PedidoNotas, type PedidoPadrao, type PedidoProgressao} from './musica-acoes';
import {acordeDe, escalaDe, NOMES} from './musica-teoria';
import {KITS, notasDoClipe} from './musica-som';
import {cortesDoVideo, renderDaMusica} from './musica-video';
import {assinaturaDe, baseDoProjeto, depoisDeMudarMusica, ligacoesDe, porNoVideo, servicoMusica} from './musica-projeto';
import {cancelarTransicao, concluirTransicao, levarPara, transicaoEmCurso} from './transicoes';
import {ErroProjeto, type Projeto} from './projeto';
import {ESTILOS} from './musica-estilos';
import {encaixarNoVideo, type ModoEncaixe} from './musica-encaixe';
import type {ModeloMusica} from './musica-modelos';
import {licencasDaMusica} from './musica-licencas';
import {creditosDoVideo, licencasDoDocumento} from './musica-projeto';
import {importarMidi} from './musica-midi';
import {readFileSync} from 'node:fs';
import path from 'node:path';

/** Classe de cada ferramenta para o portão de permissão (frente IA): "livre" grava no diário com Reverter ou só lê;
 *  "cartao" grava fora do diário (exportar em saidas/) ou lê arquivo de fora do projeto (importar_midi). */
export const CLASSES_MUSICA: Record<string, 'livre' | 'cartao'> = {
  ler_musica: 'livre', arranjar: 'livre', medir_musica: 'livre', por_no_video: 'livre', levar_para: 'livre', concluir_transicao: 'livre',
  cancelar_transicao: 'livre', trocar_kit: 'livre', escrever_notas: 'livre', criar_padrao: 'livre', aplicar_progressao: 'livre', gerar_notas: 'livre', editar_notas: 'livre',
  encaixar_no_video: 'livre', exportar_musica: 'cartao', importar_midi: 'cartao', licencas_do_projeto: 'livre',
};

const texto = (x: unknown) => ({content: [{type: 'text' as const, text: typeof x === 'string' ? x : JSON.stringify(x)}]});
const erro = (e: unknown) => ({isError: true, content: [{type: 'text' as const, text: e instanceof ErroProjeto ? `${e.codigo}: ${e.message}` : String((e as Error)?.message ?? e)}]});
const seguro = <A,>(f: (a: A) => unknown) => async (a: A) => {
  try {
    return texto(await f(a));
  } catch (e) {
    return erro(e);
  }
};
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** O documento de música: o pedido, o da transição aberta, o que a pessoa vê, ou o único do projeto. */
const musicaDe = (p: Projeto, documento?: string) => {
  const musicas = p.manifesto().documentos.filter((d) => d.modulo === 'musica');
  let id = documento;
  if (!id) {
    const t = transicaoEmCurso(baseDoProjeto(p, 'agente', 'mcp').registro());
    const e = p.estado();
    id = t?.destino.modulo === 'musica' ? t.destino.documento : e?.area === 'musica' && e.documento ? e.documento : musicas.length === 1 ? musicas[0].id : undefined;
  }
  if (!id) throw new ErroProjeto(musicas.length ? `diga o documento de música (${musicas.map((d) => d.id).join(', ')})` : 'o projeto não tem música: crie com criar_documento {modulo: "musica"} ou levar_para', 'nao_achado');
  const rel = p.arquivoDoDocumento(id);
  const lido = p.lerJson<unknown>(rel);
  if (!ehDocMusica(lido.doc)) throw new ErroProjeto(`${id} não é um documento de música`, 'patch');
  const entrada = p.manifesto().documentos.find((d) => d.caminho === rel)!;
  return {id: entrada.id, rel, doc: lido.doc as DocMusica, versao: lido.versao};
};

/** O aviso de quando a música entra no vídeo (D3): som que pede crédito. O áudio sem licença informada fica para o
 *  licencas_do_projeto e o comprovante (se avisa aqui também é pergunta ao responsável, na nota da frente). */
const avisosDeLicenca = (doc: DocMusica) => {
  const l = licencasDaMusica(doc);
  return l.creditos.length ? [`a música tem ${l.creditos.length === 1 ? 'um som que pede' : `${l.creditos.length} sons que pedem`} crédito (CC BY): o texto sai na exportação e em licencas_do_projeto`] : [];
};

export const registrarMusica = (servidor: McpServer, projeto: Projeto, autor: string, origem: string) => {
  /** Grava na música e leva o render aos clipes ligados do vídeo. */
  const gravar = async (m: {id: string; rel: string; versao: string}, patch: OperacaoPatch[], rotulo: string, caminho: string, extra: Record<string, unknown> = {}) => {
    const r = projeto.aplicarPatch({documento: m.rel, versao_base: m.versao, patch, autor, origem, rotulo});
    const depois = await depoisDeMudarMusica(projeto, m.id);
    const {musica, avisos} = resolverMusica(projeto.lerJson<DocMusica>(m.rel).doc);
    return {ok: true, seq: r.entrada.seq, documento: m.id, caminho, ...extra, duracao_s: r3(musica.duracao_s),
      ...(depois.trocados.length ? {video_atualizado: depois.trocados.map((t) => `${t.video}/${t.clipe}`)} : {}), ...('aviso' in depois && depois.aviso ? {aviso_render: depois.aviso} : {}),
      ...(avisos.length ? {avisos: avisos.slice(0, 8)} : {})};
  };

  /** Uma edição de musica-acoes.ts no diário, com o render levado ao vídeo e os avisos dela somados. */
  const aplicarEdicao = async (m: {id: string; rel: string; versao: string}, e: Edicao) => {
    const r = await gravar(m, e.patch, e.rotulo, e.caminho, e.extra);
    return e.avisos?.length ? {...r, avisos: [...e.avisos, ...((r.avisos as string[] | undefined) ?? [])]} : r;
  };

  // ---------- ler ----------
  servidor.registerTool('ler_musica', {
    description: 'Resumo de uma música: BPM, compasso, duração, canais, padrões, clipes (em batidas e segundos), mixer, onde ela toca no vídeo e os cortes das cenas, e avisos. Com eventos, as notas de "de" a "ate" (batidas) em segundos.',
    inputSchema: {
      documento: z.string().optional().describe('id da música; sem ele, a da transição aberta ou a que a pessoa vê'),
      eventos: z.boolean().optional(),
      de: z.number().optional().describe('batida'),
      ate: z.number().optional().describe('batida'),
    },
  }, seguro(({documento, eventos, de, ate}: {documento?: string; eventos?: boolean; de?: number; ate?: number}) => {
    const m = musicaDe(projeto, documento);
    const {musica: r, avisos} = resolverMusica(m.doc);
    const video = r.video ? (() => {
      try {
        const v = projeto.lerJson<unknown>(projeto.arquivoDoDocumento(r.video.documento)).doc;
        return ehDocCenas(v) ? {documento: r.video.documento, em_ms: r.video.em_ms, cortes_ms: cortesDoVideo(v as DocCenas)} : undefined;
      } catch {
        return undefined;
      }
    })() : undefined;
    const render = renderDaMusica(m.id, m.doc, assinaturaDe(projeto));
    const ligacoes = ligacoesDe(projeto, m.id).map((l) => ({...l, em_dia: l.arquivo === render.arquivo}));
    const notas = eventos
      ? r.clipes.filter((c) => c.padrao).flatMap((c) => notasDoClipe(r, c)).filter((e) => (de === undefined || e.s >= de * r.seg_por_batida) && (ate === undefined || e.s < ate * r.seg_por_batida))
      : [];
    return {
      documento: m.id, versao: m.versao, titulo: m.doc.titulo, bpm: r.bpm, compasso: r.compasso, tom: m.doc.tom, escala: m.doc.escala, swing: r.swing,
      duracao: {batidas: r3(r.duracao_batidas), compassos: r3(r.duracao_batidas / r.batidas_por_compasso), s: r3(r.duracao_s)},
      canais: r.canais.map((c) => ({id: c.id, nome: c.nome, tipo: c.tipo, ...(c.tipo === 'bateria' ? {kit: c.kit} : {}), ...(c.tipo === 'sintetizador' ? {preset: c.preset, macros: c.macros} : {}),
        faixa_mixer: c.faixa_mixer, ...(c.mudo ? {mudo: true} : {}), ...(c.solo ? {solo: true} : {})})),
      escala_notas: escalaDe(m.doc.tom, m.doc.escala).map((pc) => NOMES[pc]),
      ...(m.doc.secoes?.length ? {secoes: m.doc.secoes.map((x) => ({...x, onde: posicaoEmCompasso(x.em, r.compasso)}))} : {}),
      ...(m.doc.acordes?.length ? {acordes: m.doc.acordes.map((x) => ({...x, nome: acordeDe(x.acorde, m.doc.tom, m.doc.escala)?.nome ?? '?'}))} : {}),
      padroes: Object.values(r.padroes).map((p) => ({id: p.id, nome: p.nome, canal: p.canal, dur: p.dur, passos: p.passos, notas: p.notas.length})),
      clipes: r.clipes.map((c) => ({id: c.id, canal: c.canal, em: c.em, dur: c.dur, onde: posicaoEmCompasso(c.em, r.compasso), em_s: r3(c.em_s), dur_s: r3(c.dur_s),
        ...(c.audio ? {audio: c.audio, corte_s: c.corte_s} : {}), ...(c.padrao ? {padrao: c.padrao, ...(c.inicio ? {inicio: c.inicio} : {})} : {}),
        ...(c.ganho_db ? {ganho_db: c.ganho_db} : {}), ...(c.mudo ? {mudo: true} : {})})),
      mixer: r.faixas.map((f) => ({id: f.id, volume_db: f.volume_db, pan: f.pan, ...(f.mudo ? {mudo: true} : {}), ...(f.solo ? {solo: true} : {}),
        ...(f.eq.graves_db || f.eq.medios_db || f.eq.agudos_db ? {eq: f.eq} : {}), ...(f.compressor.ativo ? {compressor: f.compressor} : {}), ...(f.reverb ? {reverb: f.reverb} : {}),
        ...(f.delay ? {delay: f.delay} : {}), ...(f.sidechain ? {sidechain: f.sidechain} : {}), ...(f.atraso_ms ? {atraso_ms: f.atraso_ms} : {})})),
      master: r.master,
      ...(m.doc.automacoes?.length ? {automacoes: m.doc.automacoes} : {}),
      licencas: (() => {
        const l = licencasDaMusica(m.doc);
        return {pode_publicar: l.pode_publicar, sons: l.sons.map((x) => `${x.nome}: ${x.licenca}`), ...(l.creditos.length ? {creditos: l.creditos.length} : {})};
      })(),
      ...(video ? {video} : {}),
      ...(ligacoes.length ? {no_video: ligacoes} : {}),
      ...(eventos ? {notas: notas.slice(0, 300).map((e) => ({s: r3(e.s), ...(e.nota.peca ? {peca: e.nota.peca} : {nota: e.nota.nota}), forca: e.nota.forca ?? 100, clipe: e.clipe})),
        ...(notas.length > 300 ? {notas_cortadas: notas.length} : {})} : {}),
      ...(avisos.length ? {avisos} : {}),
    };
  }));

  // ---------- arranjo ----------
  servidor.registerTool('arranjar', {
    description: 'Mexe no arranjo (em batidas): por (canal + audio ou padrao), mover, aparar (novo em e/ou dur), dividir (em = batida do corte), apagar, ajustar (ganho_db, fades, mudo), repetir (clipe, vezes), secao (nome, em, dur; com secao = id, muda a que existe) e mover_secao (secao, em: leva os clipes dela).',
    inputSchema: {
      documento: z.string().optional(),
      acao: z.enum(['por', 'mover', 'aparar', 'dividir', 'apagar', 'ajustar', 'repetir', 'secao', 'mover_secao']),
      clipe: z.string().optional().describe('id do clipe (todas menos por)'),
      canal: z.string().optional().describe('por: canal de destino; mover: outro canal do mesmo tipo'),
      audio: z.string().optional().describe('por, canal de áudio: caminho no projeto, ex.: midia/cama.mp3'),
      padrao: z.string().optional().describe('por, canal de bateria: id do padrão'),
      em: z.number().min(0).optional().describe('batida'),
      dur: z.number().positive().optional().describe('batidas'),
      corte_s: z.number().min(0).optional().describe('por, áudio: segundos do arquivo onde o clipe começa'),
      ganho_db: z.number().min(-60).max(12).optional(),
      fade_in: z.number().min(0).optional().describe('batidas'),
      fade_out: z.number().min(0).optional().describe('batidas'),
      mudo: z.boolean().optional(),
      vezes: z.number().int().min(1).max(64).optional().describe('repetir: quantas cópias'),
      secao: z.string().optional().describe('id da seção (s1, s2…)'),
      nome: z.string().optional().describe('secao: nome, ex.: Refrão'),
    },
  }, seguro(async (a: PedidoArranjo & {documento?: string}) => {
    const m = musicaDe(projeto, a.documento);
    return aplicarEdicao(m, editarArranjo(m.doc, a, {existe: (arq) => projeto.existe(arq)}));
  }));

  // ---------- medir ----------
  servidor.registerTool('medir_musica', {
    description: 'Loudness integrado (LUFS) e pico (dBTP) da música renderizada e, com por_faixa, de cada faixa do mixer. O vídeo leva a mistura final a −14 LUFS; aqui se vê o equilíbrio. Com hash, o SHA-256 do PCM (conferir que o render é o mesmo). Precisa do app ou do MCP por stdio.',
    inputSchema: {documento: z.string().optional(), por_faixa: z.boolean().optional(), hash: z.boolean().optional().describe('devolve pcm_sha256: o SHA-256 do PCM float32 da mistura')},
  }, seguro(async ({documento, por_faixa, hash}: {documento?: string; por_faixa?: boolean; hash?: boolean}) => {
    const m = musicaDe(projeto, documento);
    const s = servicoMusica();
    if (!s) throw new ErroProjeto('medir precisa do render: abra o projeto no Estúdio ou use o MCP por stdio (mcp/nucleo.ts)', 'patch');
    return {documento: m.id, ...(await s.medir(projeto, m.id, {porFaixa: por_faixa, hash}))};
  }));

  // ---------- pôr no vídeo ----------
  servidor.registerTool('por_no_video', {
    description: 'Põe a música no vídeo como um clipe ligado a ela (o clipe acompanha cada mudança da música), ou liga um clipe que já existe (substituir = id do clipe). Sem faixa, vai na faixa de música do vídeo.',
    inputSchema: {
      musica: z.string().optional().describe('id da música'),
      video: z.string().optional().describe('id do vídeo de cenas (padrão: o ligado à música, ou o primeiro)'),
      faixa: z.string().optional().describe('id da faixa de áudio do vídeo'),
      em_ms: z.number().min(0).optional().describe('onde entra no vídeo (padrão: video.em_ms da música)'),
      substituir: z.string().optional().describe('id de um clipe do vídeo que passa a tocar a música'),
    },
  }, seguro(async (o: {musica?: string; video?: string; faixa?: string; em_ms?: number; substituir?: string}) => {
    const m = musicaDe(projeto, o.musica);
    const r = porNoVideo(projeto, {...o, musica: m.id}, {autor, origem});
    const depois = await depoisDeMudarMusica(projeto, m.id);
    const lic = avisosDeLicenca(m.doc);
    return {ok: true, seq: r.seq, documento: r.documento, caminho: r.caminho, render: r.render.arquivo, duracao_ms: r.render.duracao_ms,
      ...('aviso' in depois && depois.aviso ? {aviso_render: depois.aviso} : {}), ...(lic.length ? {avisos: lic} : {})};
  }));

  // ---------- ida e volta entre módulos ----------
  servidor.registerTool('levar_para', {
    description: 'Abre outro módulo com um alvo, guardando de onde veio (a tela troca sozinha). Hoje: da faixa ou do clipe de áudio do vídeo para a Música. Volte com concluir_transicao ou cancelar_transicao.',
    inputSchema: {
      modulo: z.enum(['musica', 'video', 'imagem', '3d', 'efeitos']),
      alvo: z.object({documento: z.string().describe('id do vídeo'), caminho: z.string().describe('/audio/faixas/@<faixa>/clipes/@<clipe>, ou só a faixa para criar')}),
      intencao: z.enum(['editar', 'criar', 'substituir']).optional().describe('padrão: editar num clipe, criar numa faixa'),
      tempo: z.object({em_ms: z.number().min(0).optional(), dur_ms: z.number().positive().optional()}).optional().describe('criar: onde entra no vídeo e quanto dura'),
      modelo: z.enum(['vazio', 'batida', 'trilha_video', 'efeito_sonoro']).optional().describe('criar: modelo da música nova (padrão: bateria vazia)'),
    },
  }, seguro((p: {modulo: 'musica' | 'video' | 'imagem' | '3d' | 'efeitos'; alvo: {documento: string; caminho: string}; intencao?: 'editar' | 'criar' | 'substituir'; tempo?: {em_ms?: number; dur_ms?: number};
    modelo?: ModeloMusica}) =>
    levarPara(baseDoProjeto(projeto, autor, origem), p)));

  servidor.registerTool('concluir_transicao', {
    description: 'Volta ao módulo de origem com o resultado no lugar, por patch (com seq e Reverter): o clipe do vídeo passa a tocar a música, ou nasce um clipe novo na faixa. aplicar: false volta sem aplicar.',
    inputSchema: {
      transicao: z.string().describe('id devolvido por levar_para (t1, t2…)'),
      aplicar: z.boolean().optional(),
      resultado: z.object({documento: z.string().optional(), midia: z.string().optional()}).optional().describe('padrão: o documento aberto na transição'),
    },
  }, seguro(async (p: {transicao: string; aplicar?: boolean; resultado?: {documento?: string; midia?: string}}) => {
    const r = concluirTransicao(baseDoProjeto(projeto, autor, origem), p);
    if (!r.musica) return r;
    const depois = await depoisDeMudarMusica(projeto, r.musica);
    const lic = avisosDeLicenca(musicaDe(projeto, r.musica).doc);
    return {...r, ...('aviso' in depois && depois.aviso ? {aviso_render: depois.aviso} : {}), ...(lic.length ? {avisos: [...r.avisos, ...lic]} : {})};
  }));

  servidor.registerTool('cancelar_transicao', {
    description: 'Volta ao módulo de origem sem mudar nada lá. Com descartar, desfaz também o que se fez no destino durante a transição.',
    inputSchema: {transicao: z.string(), descartar: z.boolean().optional()},
  }, seguro((p: {transicao: string; descartar?: boolean}) => cancelarTransicao(baseDoProjeto(projeto, autor, origem), p)));

  // ---------- bateria: kit, padrões e notas ----------
  servidor.registerTool('trocar_kit', {
    description: `Troca o kit de um canal de bateria; o padrão fica (as peças são as mesmas). Kits: ${KITS.map((k) => `${k.id} (${k.nome})`).join(', ')}.`,
    inputSchema: {documento: z.string().optional(), canal: z.string(), kit: z.string()},
  }, seguro(async ({documento, canal, kit}: {documento?: string; canal: string; kit: string}) => {
    const m = musicaDe(projeto, documento);
    return aplicarEdicao(m, trocarKit(m.doc, canal, kit));
  }));

  servidor.registerTool('criar_padrao', {
    description: `Cria um padrão num canal (e o canal, se não existir: de bateria, ou de sintetizador com instrumento): vazio, clonado, ou de um estilo de bateria da casa (${ESTILOS.map((e) => e.id).join(', ')}). Com no_arranjo, já põe um clipe dele.`,
    inputSchema: {
      documento: z.string().optional(),
      canal: z.string().describe('id do canal; se não existir, nasce com ele'),
      instrumento: z.enum(['bateria', ...PRESETS] as ['bateria', ...PresetSintetizador[]]).optional().describe('canal novo: bateria (padrão) ou um sintetizador (baixo, pad, pluck, lead)'),
      nome: z.string().optional(),
      dur: z.number().positive().optional().describe('batidas (padrão: um compasso)'),
      passos: z.number().int().min(1).max(64).optional().describe('grade do sequenciador (padrão: 16 por compasso)'),
      clonar: z.string().optional().describe('id do padrão a copiar'),
      estilo: z.enum(ESTILOS.map((e) => e.id) as [string, ...string[]]).optional(),
      no_arranjo: z.object({em: z.number().min(0).optional(), dur: z.number().positive().optional()}).optional().describe('batidas; o clipe repete o padrão até dur'),
      variar: z.object({de: z.string(), quanto: z.number().min(0).max(1).optional(), semente: z.number().int().optional()}).optional()
        .describe('cópia com mudanças pequenas de um padrão (quanto: 0 a 1, padrão 0,3)'),
    },
  }, seguro(async (a: PedidoPadrao & {documento?: string}) => {
    const m = musicaDe(projeto, a.documento);
    return aplicarEdicao(m, criarPadrao(m.doc, a));
  }));

  const notaSchema = z.object({
    peca: z.enum(PECAS as [PecaBateria, ...PecaBateria[]]).optional(),
    nota: z.number().int().min(0).max(127).optional().describe('MIDI, 60 = Dó central (canal de sintetizador)'),
    em: z.number().min(0).describe('batida dentro do padrão'),
    dur: z.number().positive().optional().describe('batidas (padrão: um passo da grade)'),
    forca: z.number().int().min(1).max(127).optional().describe('padrão 100'),
  });
  servidor.registerTool('escrever_notas', {
    description: `Escreve notas num padrão (bateria: peca ${PECAS.join(', ')}; sintetizador: nota MIDI). modo somar (padrão) ou trocar (apaga as do trecho de..ate antes). quantizar encaixa na grade; na_escala leva cada nota para a escala do tom. Nota igual (mesma peça ou altura e tempo) não duplica.`,
    inputSchema: {
      documento: z.string().optional(),
      padrao: z.string(),
      notas: z.array(notaSchema).max(512),
      modo: z.enum(['somar', 'trocar']).optional(),
      de: z.number().min(0).optional().describe('trocar: batida inicial do trecho (padrão 0)'),
      ate: z.number().min(0).optional().describe('trocar: batida final (padrão: fim do padrão)'),
      quantizar: z.enum(['1/4', '1/8', '1/16', '1/32']).optional().describe('fração de compasso 4/4: 1/16 = semicolcheia'),
      na_escala: z.boolean().optional().describe('leva cada nota MIDI para a nota mais perto da escala (tom e escala da música)'),
    },
  }, seguro(async (a: PedidoNotas & {documento?: string}) => {
    const m = musicaDe(projeto, a.documento);
    return aplicarEdicao(m, escreverNotas(m.doc, a));
  }));

  // ---------- piano roll (item 17) ----------
  const refNota = z.object({em: z.number().min(0), nota: z.number().int().min(0).max(127).optional(), peca: z.enum(PECAS as [PecaBateria, ...PecaBateria[]]).optional()});
  servidor.registerTool('editar_notas', {
    description: 'Opera sobre notas de um padrão: as dadas em selecao.notas, as do trecho selecao.de..ate (batidas) ou todas. quantizar (grade), transpor (valor = semitons), duplicar (logo depois, ou valor batidas adiante), apagar, forca (valor 1 a 127), humanizar (valor = batidas, padrão 0,02; pela semente), esticar (valor = fator).',
    inputSchema: {
      documento: z.string().optional(),
      padrao: z.string(),
      acao: z.enum(['quantizar', 'transpor', 'duplicar', 'apagar', 'forca', 'humanizar', 'esticar']),
      selecao: z.object({de: z.number().min(0).optional(), ate: z.number().min(0).optional(), notas: z.array(refNota).max(512).optional()}).optional(),
      valor: z.number().optional(),
      grade: z.enum(['1/4', '1/8', '1/16', '1/32']).optional().describe('quantizar: padrão 1/16'),
      semente: z.number().int().optional(),
    },
  }, seguro(async (a: PedidoEditarNotas & {documento?: string}) => {
    const m = musicaDe(projeto, a.documento);
    return aplicarEdicao(m, editarNotas(m.doc, a));
  }));

  // ---------- tom, acordes e notas geradas (itens 18 e 19) ----------
  servidor.registerTool('aplicar_progressao', {
    description: 'Escreve a faixa de acordes no tom da música (tom e escala por patch em /tom e /escala): graus como I vi IV V, V7, ii7, bVII, ou cifras como Am7, F/C. Um depois do outro, a partir de em. Depois, gerar_notas faz baixo, arpejo ou acordes deles.',
    inputSchema: {
      documento: z.string().optional(),
      acordes: z.array(z.string()).min(1).max(64),
      em: z.number().min(0).optional().describe('batida do primeiro (padrão 0)'),
      dur_por_acorde: z.number().positive().optional().describe('batidas (padrão: um compasso)'),
    },
  }, seguro(async (a: PedidoProgressao & {documento?: string}) => {
    const m = musicaDe(projeto, a.documento);
    return aplicarEdicao(m, aplicarProgressao(m.doc, a));
  }));

  const estilos = [...new Set(Object.values(ESTILOS_GERADOS).flat())] as [EstiloGerado, ...EstiloGerado[]];
  servidor.registerTool('gerar_notas', {
    description: `Gera notas da faixa de acordes num canal de sintetizador (nasce com o som do tipo se faltar) e põe o clipe cobrindo os acordes. baixo: ${ESTILOS_GERADOS.baixo.join(', ')}; arpejo: ${ESTILOS_GERADOS.arpejo.join(', ')}; acordes: ${ESTILOS_GERADOS.acordes.join(', ')}. As notas ficam escritas.`,
    inputSchema: {
      documento: z.string().optional(),
      tipo: z.enum(['baixo', 'arpejo', 'acordes']),
      estilo: z.enum(estilos).optional(),
      canal: z.string().optional().describe('id do canal de sintetizador (padrão: o do som do tipo, ou um novo)'),
    },
  }, seguro(async (a: PedidoGerar & {documento?: string}) => {
    const m = musicaDe(projeto, a.documento);
    return aplicarEdicao(m, gerarNotas(m.doc, a));
  }));

  // ---------- encaixe no vídeo (item 25) ----------
  servidor.registerTool('encaixar_no_video', {
    description: 'Ajusta a música ao vídeo dela. duracao: fecha no último quadro em compassos inteiros (BPM muda até 8%; com áudio, só apara ou estende). cortes: uma seção por cena, no compasso do corte. tudo: os dois. viradas: virada de bateria antes de cada corte e prato nele.',
    inputSchema: {
      documento: z.string().optional().describe('id da música'),
      video: z.string().optional().describe('id do vídeo de cenas (padrão: o ligado à música)'),
      modo: z.enum(['duracao', 'cortes', 'tudo']).optional().describe('padrão: tudo'),
      viradas: z.boolean().optional(),
    },
  }, seguro(async (a: {documento?: string; video?: string; modo?: ModoEncaixe; viradas?: boolean}) => {
    const m = musicaDe(projeto, a.documento);
    const idVideo = a.video ?? m.doc.video?.documento ?? projeto.manifesto().documentos.find((d) => d.modulo === 'video')?.id;
    if (!idVideo) throw new ErroProjeto('a música não está ligada a um vídeo: diga o "video" ou ponha com por_no_video', 'nao_achado');
    const {doc: v} = projeto.lerJson<unknown>(projeto.arquivoDoDocumento(idVideo));
    if (!ehDocCenas(v)) throw new ErroProjeto(`${idVideo} não é um vídeo de cenas`, 'patch');
    return aplicarEdicao(m, encaixarNoVideo(m.doc, v as DocCenas, a));
  }));

  // ---------- exportar e importar (itens 23 e 26) ----------
  servidor.registerTool('exportar_musica', {
    description: 'Grava a música em saidas/: wav (24 bits), m4a ou opus no alvo de loudness (padrão −14 LUFS, até −1 dBTP), stems em WAV por faixa e retorno, ou mid (as notas, sem os áudios). Devolve os arquivos e a medida.',
    inputSchema: {
      documento: z.string().optional(),
      formato: z.enum(['wav', 'm4a', 'opus', 'mid']),
      stems: z.boolean().optional().describe('também um WAV por faixa do mixer'),
      alvo_lufs: z.number().min(-30).max(-6).optional(),
      nome: z.string().optional().describe('nome do arquivo sem extensão (padrão: o título)'),
    },
  }, seguro(async (a: {documento?: string; formato: 'wav' | 'm4a' | 'opus' | 'mid'; stems?: boolean; alvo_lufs?: number; nome?: string}) => {
    const m = musicaDe(projeto, a.documento);
    const s = servicoMusica();
    if (!s?.exportar) throw new ErroProjeto('exportar precisa do render: abra o projeto no Estúdio ou use o MCP por stdio (mcp/nucleo.ts)', 'patch');
    const r = await s.exportar(projeto, m.id, {formato: a.formato, stems: a.stems, alvo_lufs: a.alvo_lufs, nome: a.nome});
    const md = r.medida;
    return {ok: true, documento: m.id, arquivos: r.arquivos, ...(md ? {lufs: md.lufs, pico_dbtp: md.pico_dbtp, ganho_db: md.ganho_db, limitador_db: md.limitador_db} : {}),
      ...(r.arquivo_lufs !== undefined ? {arquivo_lufs: r.arquivo_lufs, arquivo_dbtp: r.arquivo_dbtp} : {}), ...(r.notas !== undefined ? {trilhas: r.trilhas, notas: r.notas} : {}),
      ...(r.pode_publicar !== undefined ? {pode_publicar: r.pode_publicar} : {}), ...(r.creditos?.length ? {creditos: r.creditos} : {}),
      ...(r.avisos.length ? {avisos: r.avisos} : {})};
  }));

  servidor.registerTool('importar_midi', {
    description: 'Lê um .mid (caminho no projeto ou no computador) e cria um canal por trilha (canal 10 = bateria; o resto, sintetizador pelo programa), com um padrão e um clipe em "em". Numa música sem clipes, o BPM e o compasso vêm do arquivo.',
    inputSchema: {
      arquivo: z.string().describe('ex.: midia/groove.mid'),
      documento: z.string().optional(),
      em: z.number().min(0).optional().describe('batida onde os clipes entram (padrão 0)'),
      usar_bpm: z.boolean().optional().describe('trocar BPM e compasso pelos do arquivo'),
      nome: z.string().optional().describe('prefixo do nome dos canais'),
    },
  }, seguro(async (a: {arquivo: string; documento?: string; em?: number; usar_bpm?: boolean; nome?: string}) => {
    const m = musicaDe(projeto, a.documento);
    const abs = path.isAbsolute(a.arquivo) ? a.arquivo : projeto.caminho(a.arquivo);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(abs));
    } catch {
      throw new ErroProjeto(`não achei o arquivo: ${a.arquivo}`, 'nao_achado');
    }
    return aplicarEdicao(m, importarMidi(m.doc, bytes, {em: a.em, usar_bpm: a.usar_bpm, nome: a.nome}));
  }));

  // ---------- licenças e créditos (item 24) ----------
  servidor.registerTool('licencas_do_projeto', {
    description: 'Cada som que a música toca (kit, sintetizador ou áudio), com licença, classe (livre, credito, declarado, sem_licenca), SHA-256 do áudio e o que impede publicar, e o texto dos créditos. Sem documento: todas as músicas e os créditos de cada vídeo. A licença de um áudio se diz por patch em /licencas.',
    inputSchema: {documento: z.string().optional().describe('id da música')},
  }, seguro(({documento}: {documento?: string}) => {
    const ids = documento ? [musicaDe(projeto, documento).id] : projeto.manifesto().documentos.filter((d) => d.modulo === 'musica').map((d) => d.id);
    const musicas = ids.map((id) => {
      const l = licencasDoDocumento(projeto, id);
      return {documento: id, pode_publicar: l.pode_publicar, creditos: l.creditos, ...(l.impede.length ? {impede: l.impede} : {}),
        sons: l.sons.map((x) => ({tipo: x.tipo, id: x.id, licenca: x.licenca, classe: x.classe, canais: x.canais, ...(x.credito ? {credito: x.credito} : {}),
          ...(x.autor ? {autor: x.autor} : {}), ...(x.link ? {link: x.link} : {}), ...(x.sha256 ? {sha256: x.sha256} : {})}))};
    });
    const videos = documento ? [] : projeto.manifesto().documentos.filter((d) => d.modulo === 'video').map((d) => ({video: d.id, ...creditosDoVideo(projeto, d.id)}))
      .filter((v) => v.musicas.length);
    return {musicas, ...(videos.length ? {videos} : {})};
  }));
};

/** Para o guia: o nome de cada peça. */
export const PECAS_COM_NOME = PECAS.map((p) => `${p} (${NOME_PECA[p]})`).join(', ');
