// Limpeza de voz no processo principal: decodifica o arquivo do clipe com o ffmpeg do Remotion, limpa com
// src/nucleo/limpeza-voz.ts e grava midia/<arquivo>.limpo.wav, com o envelope dele ao lado (a linha do tempo e o ducking
// já veem o arquivo limpo, sem medir de novo). O arquivo da pessoa nunca é tocado; limpar de novo parte sempre do
// original e regrava o .limpo.wav. Uma limpeza por vez, com andamento na interface e Cancelar. Registrado no main.ts com
// uma linha (registrarIpcLimpeza).
// As versões limpas ficam fora do git do projeto (o commit automático faz git add -A, e cada uma tem dezenas de MB): a
// primeira limpeza acrescenta as regras ao .gitignore, em projeto novo ou antigo. Na abertura do projeto, a versão que
// nem os documentos nem o diário (o Ctrl+Z) citam é apagada: na prática, a que sobrou de uma limpeza que não chegou ao
// documento.
import {createHash} from 'node:crypto';
import {mkdirSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {CANAL, type ResultadoLimpezaVoz} from '../compartilhado/api';
import type {IntensidadeLimpeza} from '../nucleo/audio';
import {INTENSIDADES, LimpezaCancelada, limparVoz, type ControleLimpeza} from '../nucleo/limpeza-voz';
import {ErroProjeto, PASTA_INTERNA, type Projeto} from '../nucleo/projeto';
import {decodificarAudio, gravarWav} from './ffmpeg-som';
import {arquivoDoEnvelope, gravarEnvelope} from './ipc-audio';

/** midia/narracao.wav → midia/narracao.wav.limpo.wav (média, o padrão); leve e forte levam o nome no fim, para cada
 *  intensidade ser um arquivo seu e a prévia nunca tocar a versão de antes com o mesmo endereço. */
export const arquivoLimpo = (arquivo: string, intensidade: IntensidadeLimpeza = 'media') => `${arquivo}.limpo${intensidade === 'media' ? '' : `-${intensidade}`}.wav`;

const SUFIXOS = (Object.keys(INTENSIDADES) as IntensidadeLimpeza[]).map((i) => arquivoLimpo('', i));

/** As linhas do .gitignore: cada versão limpa e o envelope dela, em qualquer pasta. */
export const REGRAS_GIT = SUFIXOS.flatMap((s) => [`*${s}`, `*${s}.envelope.json`]);
const TITULO_GIT = '# Estúdio · Limpeza de voz: as versões limpas se refazem a partir do original e ficam fora do histórico';

/** Acrescenta ao .gitignore do projeto as regras que faltarem (cria o arquivo se não houver); devolve se mudou. */
export const garantirForaDoGit = (p: Projeto) => {
  const atual = p.existe('.gitignore') ? p.lerTexto('.gitignore') : '';
  const linhas = new Set(atual.split(/\r?\n/).map((l) => l.trim()));
  const faltam = REGRAS_GIT.filter((r) => !linhas.has(r));
  if (!faltam.length) return false;
  const bloco = [...(linhas.has(TITULO_GIT) ? [] : [TITULO_GIT]), ...faltam].join('\n');
  p.gravarTexto('.gitignore', `${atual}${atual && !atual.endsWith('\n') ? '\n' : ''}${bloco}\n`);
  return true;
};

// só o nome que a limpeza dá: <arquivo com extensão>.limpo[-intensidade].wav (um "voz.limpo.wav" da pessoa não entra)
const DERIVADO = new RegExp(`\\.[a-z0-9]{1,5}(${SUFIXOS.map((s) => s.replace(/\./g, '\\.')).join('|')})$`, 'i');
const NAO_ANDAR = new Set(['.git', 'node_modules', 'saidas', PASTA_INTERNA]);

/** Versões limpas gravadas no projeto (até quatro pastas abaixo da raiz, como o observador). */
export const versoesLimpas = (p: Projeto) => {
  const out: string[] = [];
  const andar = (dir: string, rel: string, nivel: number) => {
    let entradas;
    try {
      entradas = readdirSync(dir, {withFileTypes: true});
    } catch {
      return;
    }
    for (const e of entradas) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (nivel < 4 && !NAO_ANDAR.has(e.name)) andar(path.join(dir, e.name), r, nivel + 1);
      } else if (DERIVADO.test(e.name)) out.push(r);
    }
  };
  andar(p.raiz, '', 0);
  return out.sort();
};

/** Na abertura do projeto: apaga a versão limpa (e o envelope dela) que nem os documentos nem o diário citam. O diário
 *  conta porque o Ctrl+Z lê o .estudio/diario.jsonl do disco e atravessa sessões: depois de reabrir, desfazer "Limpar de
 *  novo" volta o clipe para a versão de antes, que tem de estar lá. Procura o caminho no texto de cada documento e nos
 *  patches e inversos de cada entrada do diário, para valer qualquer campo que o cite. Na dúvida (documento ou diário que
 *  não abre), não apaga nada. Só na abertura, nunca no meio da sessão. Devolve o que apagou. */
export const apagarLimposSemUso = (p: Projeto): string[] => {
  try {
    const candidatos = versoesLimpas(p);
    if (!candidatos.length) return [];
    const textos = p.manifesto().documentos.map((d) => {
      const t = p.lerTexto(d.caminho);
      JSON.parse(t); // documento quebrado no meio de uma gravação: não apaga nada
      return t;
    });
    // o diário inteiro: o desfazer anda para trás até a primeira entrada (linha quebrada: diario() lança e nada se apaga)
    for (const e of p.diario()) textos.push(JSON.stringify(e.patch), JSON.stringify(e.inverso));
    const apagados: string[] = [];
    for (const rel of candidatos) {
      if (textos.some((t) => t.includes(JSON.stringify(rel)))) continue;
      try {
        rmSync(p.caminho(rel), {force: true});
        rmSync(p.caminho(arquivoDoEnvelope(rel)), {force: true});
        apagados.push(rel);
      } catch {
        /* arquivo preso (tocando em outro programa): fica para a próxima abertura */
      }
    }
    return apagados;
  } catch {
    return [];
  }
};

/** Limpa `arquivo` (caminho no projeto) e grava o .limpo.wav e o envelope dele; devolve o caminho no projeto. */
export const limparArquivo = async (p: Projeto, arquivo: string, intensidade: IntensidadeLimpeza, ctrl: ControleLimpeza & {binarios?: string | null} = {}) => {
  if (typeof arquivo !== 'string' || !p.existe(arquivo)) throw new ErroProjeto(`o arquivo de áudio não está no projeto: ${String(arquivo)}`, 'nao_achado');
  if (!(intensidade in INTENSIDADES)) throw new ErroProjeto(`intensidade de limpeza desconhecida: ${String(intensidade)} (vale leve, media ou forte)`);
  const fonte = await decodificarAudio(p.caminho(arquivo), {binarios: ctrl.binarios, cancelado: ctrl.cancelado});
  if (!fonte.canais[0]?.length) throw new ErroProjeto(`${arquivo} não tem som para limpar`);
  const r = await limparVoz(fonte.canais, fonte.taxa, intensidade, ctrl);
  const destino = arquivoLimpo(arquivo, intensidade);
  const abs = p.caminho(destino);
  garantirForaDoGit(p); // antes do WAV: o commit automático nunca chega a vê-lo
  mkdirSync(path.dirname(abs), {recursive: true});
  const tmp = `${abs}.${process.pid}.tmp`; // o observador da pasta ignora .tmp: a interface só vê o arquivo inteiro
  const wav = gravarWav(r.canais, fonte.taxa);
  writeFileSync(tmp, wav);
  renameSync(tmp, abs);
  gravarEnvelope(p, destino, r.envelope, createHash('sha256').update(wav).digest('hex'));
  return {arquivo: destino, medidas: r.medidas, duracao_ms: r.envelope.duracao_ms};
};

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;

export const registrarIpcLimpeza = (lidar: Lidar, projeto: () => Projeto, enviar: (canal: string, ...a: unknown[]) => void) => {
  let cancelar: (() => void) | null = null;
  lidar(CANAL.audioLimparVoz, async (arquivo: string, intensidade: IntensidadeLimpeza): Promise<ResultadoLimpezaVoz> => {
    if (cancelar) throw new ErroProjeto('já há uma limpeza de voz em andamento');
    let parar = false;
    cancelar = () => (parar = true);
    let ultimo = -1;
    try {
      return await limparArquivo(projeto(), arquivo, intensidade, {
        cancelado: () => parar,
        // devolve a vez ao laço de eventos entre pedaços: a janela e o resto do IPC seguem respondendo
        pausar: () => new Promise((ok) => setImmediate(ok)),
        aoProgresso: (f) => {
          const pct = Math.round(f * 100);
          if (pct !== ultimo) enviar(CANAL.audioLimpezaProgresso, {arquivo, progresso: (ultimo = pct)});
        },
      });
    } catch (e) {
      if (parar || e instanceof LimpezaCancelada) return {cancelado: true};
      throw e;
    } finally {
      cancelar = null;
    }
  });
  lidar(CANAL.audioLimpezaCancelar, () => {
    cancelar?.();
    return Boolean(cancelar);
  });
};
