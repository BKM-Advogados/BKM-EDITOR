// Ferramentas MCP da música e da ida e volta entre módulos (docs/musica.md). Registradas por uma linha no fim de
// registrarFerramentas (ferramentas-mcp.ts), por stdio e por HTTP. Servem a qualquer IA (Claude, Gemini, DeepSeek,
// OpenAI, modelos locais): esquema Zod sem z.any() nem união solta, descrição curta, resultado curto. Toda escrita passa
// pelo diário e devolve {seq, documento, caminho}; depois de mudar uma música, os clipes do vídeo ligados a ela trocam
// de render (musica-projeto.ts). A classe de cada ferramenta (para o portão de permissão da frente IA) fica em
// CLASSES_MUSICA: "livre" grava no diário e tem Reverter.
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import type {OperacaoPatch} from './documentos';
import {ehDocCenas, type DocCenas} from './cenas';
import {
  arredondarBatida, batidasPorCompasso, ehDocMusica, idLivre, NOME_PECA, novaFaixaMixer, PECAS, posicaoEmCompasso, resolverMusica, segPorBatida,
  type ClipeMusica, type DocMusica, type NotaMusica, type PadraoMusica, type PecaBateria,
} from './musica';
import {KITS, notasDoClipe} from './musica-som';
import {caminhoPorId, cortesDoVideo, acharClipePorId, patchClipeNovo, patchLigarClipe, renderDaMusica} from './musica-video';
import {assinaturaDe, baseDoProjeto, depoisDeMudarMusica, ligacoesDe, servicoMusica} from './musica-projeto';
import {cancelarTransicao, concluirTransicao, levarPara, transicaoEmCurso} from './transicoes';
import {ErroProjeto, type Projeto} from './projeto';
import {ESTILOS, padraoDoEstilo} from './musica-estilos';

/** Classe de cada ferramenta para o portão de permissão (frente IA): todas gravam no diário com Reverter ou só leem. */
export const CLASSES_MUSICA: Record<string, 'livre' | 'cartao'> = {
  ler_musica: 'livre', arranjar: 'livre', medir_musica: 'livre', por_no_video: 'livre', levar_para: 'livre', concluir_transicao: 'livre',
  cancelar_transicao: 'livre', trocar_kit: 'livre', escrever_notas: 'livre', criar_padrao: 'livre',
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

const indiceDoClipe = (doc: DocMusica, id: string) => {
  const i = doc.arranjo.clipes.findIndex((c) => c.id === id);
  if (i < 0) throw new ErroProjeto(`clipe não achado: ${id} (clipes: ${doc.arranjo.clipes.map((c) => c.id).join(', ') || 'nenhum'})`, 'nao_achado');
  return i;
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
      canais: r.canais.map((c) => ({id: c.id, nome: c.nome, tipo: c.tipo, ...(c.tipo === 'bateria' ? {kit: c.kit} : {}), faixa_mixer: c.faixa_mixer, ...(c.mudo ? {mudo: true} : {}), ...(c.solo ? {solo: true} : {})})),
      padroes: Object.values(r.padroes).map((p) => ({id: p.id, nome: p.nome, canal: p.canal, dur: p.dur, passos: p.passos, notas: p.notas.length})),
      clipes: r.clipes.map((c) => ({id: c.id, canal: c.canal, em: c.em, dur: c.dur, onde: posicaoEmCompasso(c.em, r.compasso), em_s: r3(c.em_s), dur_s: r3(c.dur_s),
        ...(c.audio ? {audio: c.audio, corte_s: c.corte_s} : {}), ...(c.padrao ? {padrao: c.padrao, ...(c.inicio ? {inicio: c.inicio} : {})} : {}),
        ...(c.ganho_db ? {ganho_db: c.ganho_db} : {}), ...(c.mudo ? {mudo: true} : {})})),
      mixer: r.faixas.map((f) => ({id: f.id, volume_db: f.volume_db, pan: f.pan, ...(f.mudo ? {mudo: true} : {}), ...(f.solo ? {solo: true} : {}),
        ...(f.eq.graves_db || f.eq.medios_db || f.eq.agudos_db ? {eq: f.eq} : {}), ...(f.compressor.ativo ? {compressor: f.compressor} : {}), ...(f.reverb ? {reverb: f.reverb} : {})})),
      master: r.master,
      ...(video ? {video} : {}),
      ...(ligacoes.length ? {no_video: ligacoes} : {}),
      ...(eventos ? {notas: notas.slice(0, 300).map((e) => ({s: r3(e.s), ...(e.nota.peca ? {peca: e.nota.peca} : {nota: e.nota.nota}), forca: e.nota.forca ?? 100, clipe: e.clipe})),
        ...(notas.length > 300 ? {notas_cortadas: notas.length} : {})} : {}),
      ...(avisos.length ? {avisos} : {}),
    };
  }));

  // ---------- arranjo ----------
  servidor.registerTool('arranjar', {
    description: 'Mexe nos clipes do arranjo (em batidas): por (canal + audio ou padrao), mover, aparar (novo em e/ou dur), dividir (em = batida do corte), apagar, ajustar (ganho_db, fades em batidas, mudo).',
    inputSchema: {
      documento: z.string().optional(),
      acao: z.enum(['por', 'mover', 'aparar', 'dividir', 'apagar', 'ajustar']),
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
    },
  }, seguro(async (a: {documento?: string; acao: 'por' | 'mover' | 'aparar' | 'dividir' | 'apagar' | 'ajustar'; clipe?: string; canal?: string; audio?: string; padrao?: string;
    em?: number; dur?: number; corte_s?: number; ganho_db?: number; fade_in?: number; fade_out?: number; mudo?: boolean}) => {
    const m = musicaDe(projeto, a.documento);
    const doc = m.doc;
    const spb = segPorBatida(doc.bpm);
    const bpc = batidasPorCompasso(doc.compasso);
    if (a.acao === 'por') {
      const canal = doc.canais.find((c) => c.id === a.canal);
      if (!canal) throw new ErroProjeto(`diga o canal (${doc.canais.map((c) => c.id).join(', ') || 'a música não tem canais'})`, 'nao_achado');
      const doCanal = doc.arranjo.clipes.filter((c) => c.canal === canal.id);
      const em = arredondarBatida(a.em ?? doCanal.reduce((x, c) => Math.max(x, c.em + c.dur), 0));
      const avisos: string[] = [];
      let novo: ClipeMusica;
      const id = idLivre('c', doc.arranjo.clipes.map((c) => c.id));
      if (canal.tipo === 'audio') {
        if (!a.audio) throw new ErroProjeto('canal de áudio: diga o "audio" (caminho no projeto)', 'patch');
        if (!projeto.existe(a.audio)) avisos.push(`${a.audio} não está no projeto: o clipe fica calado até o arquivo chegar`);
        if (a.dur === undefined) avisos.push('sem "dur": o clipe ficou com 4 compassos; confira com a duração do arquivo');
        novo = {id, canal: canal.id, em, dur: arredondarBatida(a.dur ?? 4 * bpc), audio: a.audio, corte_s: a.corte_s ?? 0, ganho_db: a.ganho_db ?? 0,
          ...(a.fade_in ? {fade_in: a.fade_in} : {}), ...(a.fade_out ? {fade_out: a.fade_out} : {})};
      } else {
        const padrao = a.padrao ?? doc.padroes.find((p) => p.canal === canal.id)?.id;
        const p = doc.padroes.find((x) => x.id === padrao);
        if (!p) throw new ErroProjeto(`canal de bateria: diga o "padrao" (${doc.padroes.filter((x) => x.canal === canal.id).map((x) => x.id).join(', ') || 'crie com criar_padrao'})`, 'patch');
        novo = {id, canal: canal.id, em, dur: arredondarBatida(a.dur ?? p.dur ?? bpc), padrao: p.id};
      }
      const r = await gravar(m, [{op: 'add', path: '/arranjo/clipes/-', value: novo}], `clipe ${id} em ${posicaoEmCompasso(em, doc.compasso)}`, `/arranjo/clipes/${doc.arranjo.clipes.length}`, {clipe: id});
      return avisos.length ? {...r, avisos: [...avisos, ...((r.avisos as string[] | undefined) ?? [])]} : r;
    }
    if (!a.clipe) throw new ErroProjeto('diga o "clipe"', 'patch');
    const i = indiceDoClipe(doc, a.clipe);
    const c = doc.arranjo.clipes[i];
    const base = `/arranjo/clipes/${i}`;
    const teste: OperacaoPatch = {op: 'test', path: `${base}/id`, value: c.id};
    const campo = (k: keyof ClipeMusica, v: unknown): OperacaoPatch[] => (v === undefined ? [] : [{op: c[k] === undefined ? 'add' : 'replace', path: `${base}/${k}`, value: v}]);
    switch (a.acao) {
      case 'mover': {
        if (a.em === undefined && !a.canal) throw new ErroProjeto('diga o "em" novo e/ou o "canal"', 'patch');
        if (a.canal) {
          const destino = doc.canais.find((k) => k.id === a.canal);
          const atual = doc.canais.find((k) => k.id === c.canal);
          if (!destino) throw new ErroProjeto(`canal não achado: ${a.canal}`, 'nao_achado');
          if (atual && destino.tipo !== atual.tipo) throw new ErroProjeto(`o clipe é de ${atual.tipo} e o canal ${destino.id} é de ${destino.tipo}`, 'patch');
        }
        return gravar(m, [teste, ...campo('em', a.em === undefined ? undefined : arredondarBatida(a.em)), ...campo('canal', a.canal)], `move ${c.id}`, base, {clipe: c.id});
      }
      case 'aparar': {
        if (a.em === undefined && a.dur === undefined) throw new ErroProjeto('diga o "em" novo (o fim fica) e/ou a "dur"', 'patch');
        const fim = c.em + c.dur;
        const em = a.em === undefined ? c.em : arredondarBatida(Math.min(a.em, fim - 1 / 16));
        const desloc = em - c.em;
        const dur = arredondarBatida(a.dur ?? fim - em);
        const patch = [teste, ...campo('em', em !== c.em ? em : undefined), ...campo('dur', dur)];
        if (desloc && c.audio) patch.push(...campo('corte_s', r3(Math.max(0, (c.corte_s ?? 0) + desloc * spb))));
        if (desloc && c.padrao) patch.push(...campo('inicio', arredondarBatida(Math.max(0, (c.inicio ?? 0) + desloc))));
        return gravar(m, patch, `apara ${c.id}`, base, {clipe: c.id});
      }
      case 'dividir': {
        if (a.em === undefined || a.em <= c.em || a.em >= c.em + c.dur) throw new ErroProjeto(`diga o "em" do corte, entre ${c.em} e ${c.em + c.dur}`, 'patch');
        const corte = arredondarBatida(a.em);
        const id = idLivre('c', doc.arranjo.clipes.map((x) => x.id));
        const desloc = corte - c.em;
        const {fade_in: _fi, ...semFadeIn} = c;
        const segundo: ClipeMusica = {...semFadeIn, id, em: corte, dur: arredondarBatida(c.dur - desloc), ...(c.audio ? {corte_s: r3((c.corte_s ?? 0) + desloc * spb)} : {}),
          ...(c.padrao ? {inicio: arredondarBatida((c.inicio ?? 0) + desloc)} : {})};
        delete segundo.origem;
        const patch: OperacaoPatch[] = [teste, ...campo('dur', arredondarBatida(desloc)), ...(c.fade_out !== undefined ? [{op: 'remove' as const, path: `${base}/fade_out`}] : []),
          {op: 'add', path: `/arranjo/clipes/${i + 1}`, value: segundo}];
        return gravar(m, patch, `divide ${c.id} em ${posicaoEmCompasso(corte, doc.compasso)}`, `/arranjo/clipes/${i + 1}`, {clipes: [c.id, id]});
      }
      case 'apagar':
        return gravar(m, [teste, {op: 'remove', path: base}], `apaga ${c.id}`, base, {clipe: c.id});
      case 'ajustar': {
        const patch = [teste, ...campo('ganho_db', a.ganho_db), ...campo('fade_in', a.fade_in), ...campo('fade_out', a.fade_out), ...campo('mudo', a.mudo)];
        if (patch.length === 1) throw new ErroProjeto('diga ganho_db, fade_in, fade_out ou mudo', 'patch');
        return gravar(m, patch, `ajusta ${c.id}`, base, {clipe: c.id});
      }
    }
    throw new ErroProjeto(`ação desconhecida: ${String(a.acao)}`, 'patch');
  }));

  // ---------- medir ----------
  servidor.registerTool('medir_musica', {
    description: 'Loudness integrado (LUFS) e pico (dBTP) da música renderizada e, com por_faixa, de cada faixa do mixer. O vídeo leva a mistura final a −14 LUFS; aqui se vê o equilíbrio. Precisa do app ou do MCP por stdio.',
    inputSchema: {documento: z.string().optional(), por_faixa: z.boolean().optional()},
  }, seguro(async ({documento, por_faixa}: {documento?: string; por_faixa?: boolean}) => {
    const m = musicaDe(projeto, documento);
    const s = servicoMusica();
    if (!s) throw new ErroProjeto('medir precisa do render: abra o projeto no Estúdio ou use o MCP por stdio (mcp/nucleo.ts)', 'patch');
    return {documento: m.id, ...(await s.medir(projeto, m.id, {porFaixa: por_faixa}))};
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
  }, seguro(async ({musica, video, faixa, em_ms, substituir}: {musica?: string; video?: string; faixa?: string; em_ms?: number; substituir?: string}) => {
    const m = musicaDe(projeto, musica);
    const idVideo = video ?? m.doc.video?.documento ?? projeto.manifesto().documentos.find((d) => d.modulo === 'video')?.id;
    if (!idVideo) throw new ErroProjeto('o projeto não tem vídeo', 'nao_achado');
    const relVideo = projeto.arquivoDoDocumento(idVideo);
    const lido = projeto.lerJson<unknown>(relVideo);
    if (!ehDocCenas(lido.doc)) throw new ErroProjeto(`${idVideo} não é um vídeo de cenas`, 'patch');
    const v = lido.doc as DocCenas;
    const render = renderDaMusica(m.id, m.doc, assinaturaDe(projeto));
    let patch: OperacaoPatch[];
    let caminho: string;
    if (substituir) {
      const alvo = acharClipePorId(v, substituir);
      if (!alvo?.clipe || alvo.ci === undefined) throw new ErroProjeto(`clipe não achado no vídeo: ${substituir}`, 'nao_achado');
      patch = patchLigarClipe({...alvo, clipe: alvo.clipe, ci: alvo.ci}, m.id, render);
      caminho = caminhoPorId(alvo.faixa.id, alvo.clipe.id);
    } else {
      const titulo = projeto.manifesto().documentos.find((d) => d.id === m.id)?.titulo;
      const novo = patchClipeNovo(v, {idMusica: m.id, nome: titulo, faixa, em_ms: em_ms ?? m.doc.video?.em_ms ?? 0, render});
      patch = novo.patch;
      caminho = novo.caminho;
    }
    const r = projeto.aplicarPatch({documento: relVideo, versao_base: lido.versao, patch, autor, origem, rotulo: `música ${m.id} no vídeo`});
    const depois = await depoisDeMudarMusica(projeto, m.id);
    return {ok: true, seq: r.entrada.seq, documento: idVideo, caminho, render: render.arquivo, duracao_ms: render.duracao_ms, ...('aviso' in depois && depois.aviso ? {aviso_render: depois.aviso} : {})};
  }));

  // ---------- ida e volta entre módulos ----------
  servidor.registerTool('levar_para', {
    description: 'Abre outro módulo com um alvo, guardando de onde veio (a tela troca sozinha). Hoje: da faixa ou do clipe de áudio do vídeo para a Música. Volte com concluir_transicao ou cancelar_transicao.',
    inputSchema: {
      modulo: z.enum(['musica', 'video', 'imagem', '3d', 'efeitos']),
      alvo: z.object({documento: z.string().describe('id do vídeo'), caminho: z.string().describe('/audio/faixas/@<faixa>/clipes/@<clipe>, ou só a faixa para criar')}),
      intencao: z.enum(['editar', 'criar', 'substituir']).optional().describe('padrão: editar num clipe, criar numa faixa'),
      tempo: z.object({em_ms: z.number().min(0).optional(), dur_ms: z.number().positive().optional()}).optional().describe('criar: onde entra no vídeo e quanto dura'),
    },
  }, seguro((p: {modulo: 'musica' | 'video' | 'imagem' | '3d' | 'efeitos'; alvo: {documento: string; caminho: string}; intencao?: 'editar' | 'criar' | 'substituir'; tempo?: {em_ms?: number; dur_ms?: number}}) =>
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
    return {...r, ...('aviso' in depois && depois.aviso ? {aviso_render: depois.aviso} : {})};
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
    const i = m.doc.canais.findIndex((c) => c.id === canal);
    if (i < 0) throw new ErroProjeto(`canal não achado: ${canal}`, 'nao_achado');
    if (m.doc.canais[i].tipo !== 'bateria') throw new ErroProjeto(`${canal} não é um canal de bateria`, 'patch');
    if (!KITS.some((k) => k.id === kit)) throw new ErroProjeto(`kit desconhecido: ${kit} (kits: ${KITS.map((k) => k.id).join(', ')})`, 'nao_achado');
    return gravar(m, [{op: 'test', path: `/canais/${i}/id`, value: canal}, {op: m.doc.canais[i].kit === undefined ? 'add' : 'replace', path: `/canais/${i}/kit`, value: kit}],
      `kit ${kit} em ${canal}`, `/canais/${i}`, {sem_som: []});
  }));

  servidor.registerTool('criar_padrao', {
    description: `Cria um padrão num canal (e um canal de bateria novo, se ele não existir): vazio, clonado de outro, ou de um estilo da casa (${ESTILOS.map((e) => e.id).join(', ')}). Com no_arranjo, já põe um clipe dele.`,
    inputSchema: {
      documento: z.string().optional(),
      canal: z.string().describe('id do canal; se não existir, nasce um canal de bateria com ele'),
      nome: z.string().optional(),
      dur: z.number().positive().optional().describe('batidas (padrão: um compasso)'),
      passos: z.number().int().min(1).max(64).optional().describe('grade do sequenciador (padrão: 16 por compasso)'),
      clonar: z.string().optional().describe('id do padrão a copiar'),
      estilo: z.enum(ESTILOS.map((e) => e.id) as [string, ...string[]]).optional(),
      no_arranjo: z.object({em: z.number().min(0).optional(), dur: z.number().positive().optional()}).optional().describe('batidas; o clipe repete o padrão até dur'),
    },
  }, seguro(async (a: {documento?: string; canal: string; nome?: string; dur?: number; passos?: number; clonar?: string; estilo?: string; no_arranjo?: {em?: number; dur?: number}}) => {
    const m = musicaDe(projeto, a.documento);
    const doc = m.doc;
    const bpc = batidasPorCompasso(doc.compasso);
    const patch: OperacaoPatch[] = [];
    let canal = doc.canais.find((c) => c.id === a.canal);
    if (!canal) {
      canal = {id: a.canal, nome: a.canal.charAt(0).toUpperCase() + a.canal.slice(1), tipo: 'bateria', faixa_mixer: a.canal, kit: 'eletronico'};
      patch.push({op: 'add', path: '/canais/-', value: canal});
      if (!doc.mixer.faixas.some((f) => f.id === a.canal)) patch.push({op: 'add', path: '/mixer/faixas/-', value: novaFaixaMixer(a.canal, canal.nome)});
    } else if (canal.tipo !== 'bateria') {
      throw new ErroProjeto(`${a.canal} é um canal de áudio; padrões são de canais de bateria`, 'patch');
    }
    const id = idLivre('p', doc.padroes.map((p) => p.id));
    let notas: NotaMusica[] = [];
    let dur = a.dur ?? bpc;
    if (a.clonar) {
      const fonte = doc.padroes.find((p) => p.id === a.clonar);
      if (!fonte) throw new ErroProjeto(`padrão não achado: ${a.clonar}`, 'nao_achado');
      notas = structuredClone(fonte.notas);
      dur = a.dur ?? fonte.dur ?? bpc;
    } else if (a.estilo) {
      const e = padraoDoEstilo(a.estilo, bpc);
      notas = e.notas;
      dur = a.dur ?? e.dur;
    }
    const novo: PadraoMusica = {id, nome: a.nome ?? (a.estilo ? ESTILOS.find((e) => e.id === a.estilo)!.nome : `Padrão ${doc.padroes.length + 1}`), canal: canal.id, dur,
      passos: a.passos ?? Math.max(1, Math.round(dur * 4)), notas};
    patch.push({op: 'add', path: '/padroes/-', value: novo});
    let clipe: string | undefined;
    if (a.no_arranjo) {
      clipe = idLivre('c', doc.arranjo.clipes.map((c) => c.id));
      const doCanal = doc.arranjo.clipes.filter((c) => c.canal === canal!.id);
      const em = arredondarBatida(a.no_arranjo.em ?? doCanal.reduce((x, c) => Math.max(x, c.em + c.dur), 0));
      patch.push({op: 'add', path: '/arranjo/clipes/-', value: {id: clipe, canal: canal.id, em, dur: arredondarBatida(a.no_arranjo.dur ?? dur), padrao: id} satisfies ClipeMusica});
    }
    return gravar(m, patch, `padrão ${novo.nome}`, `/padroes/${doc.padroes.length}`, {padrao: id, notas: notas.length, ...(clipe ? {clipe} : {})});
  }));

  const notaSchema = z.object({
    peca: z.enum(PECAS as [PecaBateria, ...PecaBateria[]]).optional(),
    nota: z.number().int().min(0).max(127).optional().describe('MIDI, 60 = Dó central (instrumentos, depois)'),
    em: z.number().min(0).describe('batida dentro do padrão'),
    dur: z.number().positive().optional().describe('batidas (padrão 0,25)'),
    forca: z.number().int().min(1).max(127).optional().describe('padrão 100'),
  });
  servidor.registerTool('escrever_notas', {
    description: `Escreve notas num padrão (bateria: peça ${PECAS.join(', ')}). modo somar (padrão) ou trocar (apaga as do trecho de..ate antes). quantizar encaixa na grade. Nota igual (mesma peça e tempo) não duplica: troca a força.`,
    inputSchema: {
      documento: z.string().optional(),
      padrao: z.string(),
      notas: z.array(notaSchema).max(512),
      modo: z.enum(['somar', 'trocar']).optional(),
      de: z.number().min(0).optional().describe('trocar: batida inicial do trecho (padrão 0)'),
      ate: z.number().min(0).optional().describe('trocar: batida final (padrão: fim do padrão)'),
      quantizar: z.enum(['1/4', '1/8', '1/16', '1/32']).optional().describe('fração de compasso 4/4: 1/16 = semicolcheia'),
    },
  }, seguro(async (a: {documento?: string; padrao: string; notas: NotaMusica[]; modo?: 'somar' | 'trocar'; de?: number; ate?: number; quantizar?: '1/4' | '1/8' | '1/16' | '1/32'}) => {
    const m = musicaDe(projeto, a.documento);
    const i = m.doc.padroes.findIndex((p) => p.id === a.padrao);
    if (i < 0) throw new ErroProjeto(`padrão não achado: ${a.padrao} (${m.doc.padroes.map((p) => p.id).join(', ') || 'crie com criar_padrao'})`, 'nao_achado');
    const p = m.doc.padroes[i];
    const dur = p.dur ?? batidasPorCompasso(m.doc.compasso);
    const grade = a.quantizar ? 4 / Number(a.quantizar.split('/')[1]) : 0;
    const avisos: string[] = [];
    const de = a.de ?? 0;
    const ate = a.ate ?? dur;
    let notas = a.modo === 'trocar' ? p.notas.filter((n) => n.em < de || n.em >= ate) : [...p.notas];
    let fora = 0;
    for (const n0 of a.notas) {
      if (!n0.peca && n0.nota === undefined) {
        avisos.push('nota sem peca nem nota: ignorada');
        continue;
      }
      const em = arredondarBatida(grade ? Math.round(n0.em / grade) * grade : n0.em);
      if (em >= dur) {
        fora++;
        continue;
      }
      const n: NotaMusica = {...(n0.peca ? {peca: n0.peca} : {nota: n0.nota}), em, ...(n0.dur ? {dur: n0.dur} : {}), ...(n0.forca ? {forca: n0.forca} : {})};
      notas = notas.filter((x) => !(x.em === n.em && (n.peca ? x.peca === n.peca : x.nota === n.nota)));
      notas.push(n);
    }
    if (fora) avisos.push(`${fora} nota(s) depois do fim do padrão (${dur} batidas) ficaram de fora`);
    notas.sort((x, y) => x.em - y.em || String(x.peca ?? x.nota).localeCompare(String(y.peca ?? y.nota)));
    const r = await gravar(m, [{op: 'test', path: `/padroes/${i}/id`, value: p.id}, {op: 'replace', path: `/padroes/${i}/notas`, value: notas}],
      `${a.notas.length} nota(s) em ${p.nome ?? p.id}`, `/padroes/${i}/notas`, {padrao: p.id, notas: notas.length});
    return avisos.length ? {...r, avisos: [...avisos, ...((r.avisos as string[] | undefined) ?? [])]} : r;
  }));
};

/** Para o guia: o nome de cada peça. */
export const PECAS_COM_NOME = PECAS.map((p) => `${p} (${NOME_PECA[p]})`).join(', ');
