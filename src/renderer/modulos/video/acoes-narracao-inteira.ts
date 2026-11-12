// Narração gravada inteira na tela (docs/narracao.md): a pessoa escolhe a gravação já importada, o app transcreve se
// preciso, mostra a proposta de cortes e, com o OK dela, divide a gravação nas cenas como edição da pessoa (Ctrl+Z
// desfaz). A conta é a do núcleo (narracao-inteira.ts), a mesma do MCP `dividir_narracao`.
import type {DocCenas} from '../../../nucleo/cenas';
import {arquivoDaFala, arquivoDasPalavras, clipesDeVoz, fonteDaFala, palavrasValidas, termosDoDicionario, type PalavraLegenda} from '../../../nucleo/legendas';
import {gravacaoDe, patchDaDivisao, proporDivisao, type PropostaDivisao} from '../../../nucleo/narracao-inteira';
import {aplicar, avisar, loja, mensagemDe} from '../../estado/loja';

const docDe = (documento: string) => loja.get().docs[documento]?.doc as DocCenas | undefined;
const nomeCurto = (arquivo: string) => arquivo.split('/').pop() ?? arquivo;
const s1 = (ms: number) => (ms / 1000).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1});

export type GravacaoEscolhivel = {arquivo: string; nome: string; duracao_ms?: number; no_video: boolean};

/** As gravações que dá para dividir: os áudios (e vídeos) de midia/ e as falas dos clipes de voz do vídeo, sem a fala por
 *  IA nem os derivados (voz limpa, transcrição). As que já estão no vídeo vêm primeiro. */
export const gravacoesDoProjeto = async (doc: DocCenas): Promise<GravacaoEscolhivel[]> => {
  const noVideo = new Set(clipesDeVoz(doc).filter(({clipe}) => !clipe.narracao_ia).map(({clipe}) => arquivoDaFala(clipe)));
  const lista = new Map<string, GravacaoEscolhivel>();
  for (const a of noVideo) lista.set(a, {arquivo: a, nome: nomeCurto(a), no_video: true});
  try {
    const indice = await window.estudio.midia.indice();
    for (const e of indice.entradas) {
      if ((e.tipo !== 'audio' && e.tipo !== 'video') || e.caminho.startsWith('midia/narracao/')) continue;
      const ja = lista.get(e.caminho);
      lista.set(e.caminho, {arquivo: e.caminho, nome: e.nome, duracao_ms: e.duracao_ms, no_video: Boolean(ja)});
    }
  } catch {
    /* sem o índice da mídia (prévia web antiga): só as do vídeo */
  }
  return [...lista.values()].sort((a, b) => Number(b.no_video) - Number(a.no_video) || a.nome.localeCompare(b.nome, 'pt-BR'));
};

/** A transcrição da gravação (o palavras.json ao lado); sem ela, transcreve no PC (pode baixar o modelo no primeiro uso). */
const palavrasDa = async (documento: string, arquivo: string, aoTranscrever: () => void): Promise<{palavras: PalavraLegenda[]; sha256?: string} | null> => {
  const caminho = arquivoDasPalavras(arquivo);
  let lido: unknown = await window.estudio.lerJson(caminho).catch(() => null);
  if (!palavrasValidas(lido).length) {
    aoTranscrever();
    const termos = termosDoDicionario(docDe(documento)?.legendas);
    const r = await window.estudio.fala.transcrever({arquivo, ...(termos.length ? {termos} : {})});
    if (!r.ok) {
      avisar(r.cancelado ? 'Transcrição cancelada.' : r.mensagem ?? 'A transcrição não terminou.', r.cancelado ? 'info' : 'erro');
      return null;
    }
    lido = await window.estudio.lerJson(caminho).catch(() => null);
  }
  const palavras = palavrasValidas(lido);
  if (!palavras.length) {
    avisar(`A transcrição de ${nomeCurto(arquivo)} não tem palavras.`, 'erro');
    return null;
  }
  return {palavras, sha256: fonteDaFala(lido)?.sha256};
};

export type PropostaNaTela = {arquivo: string; clipe?: string; proposta: PropostaDivisao; palavras: PalavraLegenda[]; sha256?: string};

/** Propõe a divisão da gravação nas cenas (sem gravar nada); null se não deu (o motivo vai no aviso). */
export const proporNaTela = async (documento: string, g: GravacaoEscolhivel, aoTranscrever: () => void): Promise<PropostaNaTela | null> => {
  const doc = docDe(documento);
  if (!doc) return null;
  try {
    const qual = gravacaoDe(doc, {arquivo: g.arquivo});
    const t = await palavrasDa(documento, qual.arquivo, aoTranscrever);
    if (!t) return null;
    const atual = docDe(documento) ?? doc;
    const proposta = proporDivisao(t.palavras, atual.cenas.map((c) => ({id: c.id, texto: c.narracao?.texto})), {duracao_ms: g.duracao_ms});
    return {arquivo: qual.arquivo, ...(qual.clipe ? {clipe: qual.clipe} : {}), proposta, palavras: t.palavras, sha256: t.sha256};
  } catch (e) {
    avisar(`Não deu para dividir: ${mensagemDe(e)}`, 'erro');
    return null;
  }
};

/** Aplica a proposta: um clipe com o trecho da mesma gravação em cada cena, a duração ajustada e as legendas. */
export const aplicarNaTela = async (documento: string, p: PropostaNaTela) => {
  const doc = docDe(documento);
  if (!doc) return false;
  try {
    const r = patchDaDivisao(doc, {arquivo: p.arquivo, proposta: p.proposta, palavras: p.palavras, caminhoPalavras: arquivoDasPalavras(p.arquivo), sha256: p.sha256, clipe: p.clipe});
    const ok = await aplicar(documento, r.patch, `narração gravada dividida em ${r.clipes.length} ${r.clipes.length === 1 ? 'cena' : 'cenas'}`);
    if (ok) {
      const avisos = [...p.proposta.avisos, ...r.avisos];
      avisar(`${nomeCurto(p.arquivo)} dividida em ${r.clipes.length} ${r.clipes.length === 1 ? 'cena' : 'cenas'}: cada uma toca o trecho dela, com a duração ajustada`
        + ` e as legendas.${avisos.length ? ` ${avisos[0]}.` : ''} Ctrl+Z desfaz.`, avisos.length ? 'info' : 'ok');
    }
    return ok;
  } catch (e) {
    avisar(`Não deu para dividir: ${mensagemDe(e)}`, 'erro');
    return false;
  }
};

/** O trecho de uma cena para a lista da proposta: "0,2–2,9 s". */
export const textoDoTrecho = (t: PropostaDivisao['trechos'][number]) => (t.de_ms === null || t.ate_ms === null ? 'sem fala' : `${s1(t.de_ms)}–${s1(t.ate_ms)} s`);
