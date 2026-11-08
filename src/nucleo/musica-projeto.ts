// A música no disco (Node): a BaseProjeto das transições sobre o Projeto, as regras do .gitignore (registro das
// transições e renders fora do git) e a ligação viva, que troca o render dos clipes do vídeo ligados a uma música
// quando ela muda (autor "sistema": não entra no Ctrl+Z da pessoa). Quem renderiza o WAV é o processo principal ou o MCP
// por stdio (src/main/musica-render.ts), registrado por definirServicoMusica; sem ele, a ligação e o caminho do render
// ficam certos e o arquivo sai quando o app abrir o projeto. Ver docs/musica.md.
import {readFileSync, rmSync, statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import type {DocCenas} from './cenas';
import {ehDocCenas} from './cenas';
import {ehDocMusica, type DocMusica} from './musica';
import type {MedidaEntrega} from './musica-entrega';
import {audiosDaMusica} from './musica';
import {licencasDaMusica, type LicencasDaMusica} from './musica-licencas';
import {acharClipePorId, caminhoPorId, ehRenderDeMusica, medidaDoRender, patchAtualizarLigados, patchClipeNovo, patchLigarClipe, renderDaMusica} from './musica-video';
import type {OperacaoPatch} from './documentos';
import {ErroProjeto, serializar, type Projeto} from './projeto';
import {ARQUIVO_TRANSICOES, lerRegistro, type BaseProjeto} from './transicoes';

// ---------- .gitignore ----------
const TITULO_GIT = '# Estúdio · Música: o registro das transições e os renders se refazem e ficam fora do histórico';
export const REGRAS_GIT_MUSICA = [ARQUIVO_TRANSICOES, 'midia/musica/'];

export const garantirMusicaForaDoGit = (p: Projeto) => {
  const atual = p.existe('.gitignore') ? p.lerTexto('.gitignore') : '';
  const linhas = new Set(atual.split(/\r?\n/).map((l) => l.trim()));
  const faltam = REGRAS_GIT_MUSICA.filter((r) => !linhas.has(r));
  if (!faltam.length) return false;
  const bloco = [...(linhas.has(TITULO_GIT) ? [] : [TITULO_GIT]), ...faltam].join('\n');
  p.gravarTexto('.gitignore', `${atual}${atual && !atual.endsWith('\n') ? '\n' : ''}${bloco}\n`);
  return true;
};

/** O tamanho do arquivo: regravar a tomada com o mesmo nome muda o código do render. */
export const assinaturaDe = (p: Projeto) => (arquivo: string) => {
  try {
    return String(statSync(p.caminho(arquivo)).size);
  } catch {
    return 'falta';
  }
};

// ---------- base das transições ----------
export const baseDoProjeto = (p: Projeto, autor: string, origem: string): BaseProjeto => ({
  autor,
  manifesto: () => p.manifesto(),
  ler: <T,>(documento: string) => {
    const arquivo = p.arquivoDoDocumento(documento);
    return {...p.lerJson<T>(arquivo), arquivo};
  },
  aplicar: (x) => {
    const r = p.aplicarPatch({documento: x.documento, versao_base: x.versao_base, patch: x.patch, rotulo: x.rotulo, transicao: x.transicao, autor: x.autor ?? autor, origem});
    return {versao: r.versao, seq: r.entrada.seq};
  },
  adicionarDocumento: (e, c) => void p.adicionarDocumento(e, c),
  registro: () => (p.existe(ARQUIVO_TRANSICOES) ? lerRegistro(p.lerJson<unknown>(ARQUIVO_TRANSICOES).doc) : lerRegistro(null)),
  gravarRegistro: (r) => {
    garantirMusicaForaDoGit(p);
    p.gravarTexto(ARQUIVO_TRANSICOES, serializar(r));
  },
  estado: () => p.estado(),
  diario: () => p.diario(),
  assinatura: assinaturaDe(p),
});

// ---------- render: quem faz ----------
/** Medida gravada ao lado do render (midia/musica/x.<código>.json). */
export type MedidaRender = {formato: 1; musica: string; duracao_ms: number; integrado_lufs: number | null; pico_dbtp: number | null; avisos: string[]; faltando: string[]; feito_em: string;
  feito_por?: 'janela' | 'processo'};
export type MedidaMusica = {integrado_lufs: number | null; pico_dbtp: number | null; duracao_ms: number; faixas?: Record<string, {integrado_lufs: number | null; pico_dbtp: number | null}>; avisos: string[]};

export type ServicoMusica = {
  /** Grava o WAV do documento como ele está (ou reaproveita, pelo código) e a medida ao lado. */
  renderizar: (p: Projeto, id: string) => Promise<{arquivo: string; duracao_ms: number; novo: boolean; medida: MedidaRender}>;
  /** LUFS e pico da mistura e, com porFaixa, de cada faixa do mixer. */
  medir: (p: Projeto, id: string, o?: {porFaixa?: boolean}) => Promise<MedidaMusica>;
  /** A música em arquivo em saidas/ (item 23): WAV de 24 bits, M4A ou Opus no alvo de loudness, stems em WAV, ou MIDI. */
  exportar?: (p: Projeto, id: string, pedido: PedidoExportarMusica) => Promise<ResultadoExportarMusica>;
};
export type FormatoMusica = 'wav' | 'm4a' | 'opus' | 'mid';
export type PedidoExportarMusica = {formato: FormatoMusica; stems?: boolean; alvo_lufs?: number; nome?: string};
/** `medida` é a da mistura no alvo (antes do codificador); `arquivo_lufs` e `arquivo_dbtp`, as do arquivo codificado. */
export type ResultadoExportarMusica = {arquivos: string[]; avisos: string[]; feito_por: 'janela' | 'processo'; duracao_s?: number; medida?: MedidaEntrega;
  arquivo_lufs?: number; arquivo_dbtp?: number; trilhas?: number; notas?: number; pode_publicar?: boolean; creditos?: string[]};
let servico: ServicoMusica | null = null;
export const definirServicoMusica = (s: ServicoMusica | null) => {
  servico = s;
};
export const servicoMusica = () => servico;

/** A duração do render, pela medida ao lado (undefined: render que não é de música ou sem medida). */
export const duracaoDoRender = (p: Projeto, arquivo: string): number | undefined => {
  try {
    const rel = medidaDoRender(arquivo);
    if (rel === arquivo || !p.existe(rel)) return undefined;
    const m = p.lerJson<Partial<MedidaRender>>(rel).doc;
    return typeof m.duracao_ms === 'number' ? m.duracao_ms : undefined;
  } catch {
    return undefined;
  }
};

const lerMusica = (p: Projeto, id: string) => {
  const {doc} = p.lerJson<unknown>(p.arquivoDoDocumento(id));
  if (!ehDocMusica(doc)) throw new Error(`${id} não é um documento de música`);
  return doc as DocMusica;
};

/** Ligação viva: os clipes dos vídeos ligados a `idMusica` passam a tocar o render de agora (o render em si é de
 *  quem chama, antes ou depois). Devolve o render esperado e os clipes trocados. */
export const atualizarLigados = (p: Projeto, idMusica: string) => {
  const render = renderDaMusica(idMusica, lerMusica(p, idMusica), assinaturaDe(p));
  const trocados: {video: string; clipe: string; seq: number}[] = [];
  const antigos = new Set<string>();
  for (const d of p.manifesto().documentos.filter((x) => x.modulo === 'video')) {
    let lido;
    try {
      lido = p.lerJson<unknown>(d.caminho);
    } catch {
      continue;
    }
    if (!ehDocCenas(lido.doc)) continue;
    const {patch, clipes, antigos: deste} = patchAtualizarLigados(lido.doc as DocCenas, idMusica, render, (arq) => duracaoDoRender(p, arq));
    if (!patch.length) continue;
    deste.forEach((a) => antigos.add(a));
    const r = p.aplicarPatch({documento: d.caminho, versao_base: lido.versao, patch, autor: 'sistema', origem: 'musica', rotulo: `trilha atualizada (${idMusica})`});
    trocados.push(...clipes.map((clipe) => ({video: d.id, clipe, seq: r.entrada.seq})));
  }
  // o render que nenhum vídeo toca mais sai na hora (o mesmo documento refaz o mesmo arquivo: o Ctrl+Z não precisa dele)
  const tocados = new Set(ligacoesTodas(p).map((l) => l.arquivo));
  for (const a of antigos) {
    if (!ehRenderDeMusica(a) || tocados.has(a) || a === render.arquivo) continue;
    for (const rel of [a, medidaDoRender(a), `${a}.envelope.json`]) {
      try {
        rmSync(p.caminho(rel), {force: true});
      } catch {
        /* preso por outro programa: a faxina da abertura tira depois */
      }
    }
  }
  return {render, trocados};
};

/** Todos os clipes ligados a alguma música, em todos os vídeos. */
const ligacoesTodas = (p: Projeto) => {
  const out: {video: string; musica: string; arquivo: string}[] = [];
  for (const d of p.manifesto().documentos.filter((x) => x.modulo === 'video')) {
    try {
      const {doc} = p.lerJson<unknown>(d.caminho);
      if (!ehDocCenas(doc)) continue;
      for (const f of doc.audio?.faixas ?? []) for (const c of f.clipes ?? []) if (c.musica) out.push({video: d.id, musica: c.musica, arquivo: c.arquivo});
    } catch {
      /* segue */
    }
  }
  return out;
};

/** Os vídeos que tocam uma música (para o ler_musica dizer onde ela está). */
export const ligacoesDe = (p: Projeto, idMusica: string) => {
  const out: {video: string; faixa: string; clipe: string; arquivo: string}[] = [];
  for (const d of p.manifesto().documentos.filter((x) => x.modulo === 'video')) {
    try {
      const {doc} = p.lerJson<unknown>(d.caminho);
      if (!ehDocCenas(doc)) continue;
      for (const f of doc.audio?.faixas ?? []) for (const c of f.clipes ?? []) if (c.musica === idMusica) out.push({video: d.id, faixa: f.id, clipe: c.id, arquivo: c.arquivo});
    } catch {
      /* vídeo ilegível não esconde os outros */
    }
  }
  return out;
};

// ---------- licenças e créditos (item 24) ----------
/** SHA-256 de cada áudio que a música usa (o que não está no disco fica sem). */
export const hashesDaMusica = (p: Projeto, doc: DocMusica) => {
  const out: Record<string, string> = {};
  for (const a of audiosDaMusica(doc)) {
    try {
      out[a] = createHash('sha256').update(readFileSync(p.caminho(a))).digest('hex');
    } catch {
      /* o áudio que falta já é aviso do render */
    }
  }
  return out;
};

/** As licenças de uma música, com o SHA-256 dos áudios. */
export const licencasDoDocumento = (p: Projeto, id: string): LicencasDaMusica => {
  const doc = lerMusica(p, id);
  return licencasDaMusica(doc, {hashes: hashesDaMusica(p, doc)});
};

/** Os créditos de um vídeo: os das músicas ligadas a clipes dele, juntos e sem repetir (para a exportação do vídeo pôr
 *  ao lado do MP4 ou na descrição; frente Vídeo, na integração). */
export const creditosDoVideo = (p: Projeto, idVideo: string) => {
  const musicas = p.manifesto().documentos.filter((d) => d.modulo === 'musica' && ligacoesDe(p, d.id).some((l) => l.video === idVideo)).map((d) => d.id);
  const porMusica = musicas.map((id) => ({musica: id, ...licencasDoDocumento(p, id)}));
  return {musicas, creditos: [...new Set(porMusica.flatMap((x) => x.creditos))], impede: porMusica.flatMap((x) => x.impede.map((i) => `${x.musica}: ${i}`)),
    pode_publicar: porMusica.every((x) => x.pode_publicar)};
};

/** Depois de mudar uma música: troca os clipes ligados e, com o serviço, grava o render. Nunca lança por causa do
 *  render: ele volta como aviso, e o app refaz ao abrir. */
export const depoisDeMudarMusica = async (p: Projeto, idMusica: string) => {
  const {render, trocados} = atualizarLigados(p, idMusica);
  const s = servicoMusica();
  const ligados = ligacoesDe(p, idMusica).length;
  if (!ligados) return {render, trocados, renderizado: false as const};
  if (!s) return {render, trocados, renderizado: false as const, aviso: 'render pendente: o app grava o arquivo ao abrir o projeto'};
  try {
    const r = await s.renderizar(p, idMusica);
    return {render, trocados, renderizado: true as const, medida: r.medida};
  } catch (e) {
    return {render, trocados, renderizado: false as const, aviso: `o render não saiu: ${(e as Error).message}`};
  }
};

/** "Pôr no vídeo": um clipe novo ligado à música (na faixa dada ou na de música do vídeo), ou um clipe existente que
 *  passa a tocá-la (`substituir`). A tela e a ferramenta por_no_video usam esta mesma função. */
export const porNoVideo = (p: Projeto, o: {musica: string; video?: string; faixa?: string; em_ms?: number; substituir?: string}, quem: {autor: string; origem: string}) => {
  let doc = lerMusica(p, o.musica);
  const idMusica = p.manifesto().documentos.find((d) => d.id === o.musica || d.caminho === o.musica)!.id;
  const idVideo = o.video ?? doc.video?.documento ?? p.manifesto().documentos.find((d) => d.modulo === 'video')?.id;
  if (!idVideo) throw new ErroProjeto('o projeto não tem vídeo', 'nao_achado');
  const relVideo = p.arquivoDoDocumento(idVideo);
  const lido = p.lerJson<unknown>(relVideo);
  if (!ehDocCenas(lido.doc)) throw new ErroProjeto(`${idVideo} não é um vídeo de cenas`, 'patch');
  const v = lido.doc as DocCenas;
  if (!doc.video) {
    // a música sem vídeo passa a ser a trilha deste: a voz guia, os cortes e o encaixe (item 25) vêm dele. Antes do
    // clipe, para o render já sair com o código da música ligada
    const em_ms = o.substituir ? acharClipePorId(v, o.substituir)?.clipe?.em ?? 0 : o.em_ms ?? 0;
    const relM = p.arquivoDoDocumento(idMusica);
    p.aplicarPatch({documento: relM, versao_base: p.lerJson<unknown>(relM).versao, patch: [{op: 'add', path: '/video', value: {documento: idVideo, em_ms: Math.max(0, Math.round(em_ms)), voz_guia: true}}],
      autor: quem.autor, origem: quem.origem, rotulo: `música ligada ao vídeo ${idVideo}`});
    doc = lerMusica(p, idMusica);
  }
  const render = renderDaMusica(idMusica, doc, assinaturaDe(p));
  let patch: OperacaoPatch[];
  let caminho: string;
  if (o.substituir) {
    const alvo = acharClipePorId(v, o.substituir);
    if (!alvo?.clipe || alvo.ci === undefined) throw new ErroProjeto(`clipe não achado no vídeo: ${o.substituir}`, 'nao_achado');
    patch = patchLigarClipe({...alvo, clipe: alvo.clipe, ci: alvo.ci}, idMusica, render);
    caminho = caminhoPorId(alvo.faixa.id, alvo.clipe.id);
  } else {
    const titulo = p.manifesto().documentos.find((d) => d.id === idMusica)?.titulo;
    const novo = patchClipeNovo(v, {idMusica, nome: titulo, faixa: o.faixa, em_ms: o.em_ms ?? doc.video?.em_ms ?? 0, render});
    patch = novo.patch;
    caminho = novo.caminho;
  }
  const r = p.aplicarPatch({documento: relVideo, versao_base: lido.versao, patch, autor: quem.autor, origem: quem.origem, rotulo: `música ${idMusica} no vídeo`});
  return {seq: r.entrada.seq, documento: idVideo, caminho, render, musica: idMusica};
};
