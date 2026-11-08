// IPC do som do vídeo de cenas: grava o envelope que a interface mediu (midia/<arquivo>.envelope.json), lista a pasta de
// trilhas das preferências e copia uma trilha de lá para midia/. Também lê os envelopes do disco para as props da
// composição (sessao-projeto.ts), para a prévia e a exportação verem o mesmo ducking. Registrado no main.ts com uma linha.
// O envelope leva o carimbo do arquivo medido (tamanho, data e sha256): a tomada nova gravada com o mesmo nome, ou o
// envelope de outra versão da conta, conta como não medido, e a linha do tempo mede de novo.
import {statSync, type Stats} from 'node:fs';
import {CANAL, type Preferencias} from '../compartilhado/api';
import {conferirEnvelope, ehEnvelope, type Envelope} from '../nucleo/audio';
import type {DocCenas} from '../nucleo/cenas';
import {EXTENSOES_AUDIO, importarTrilha, listarTrilhas, sha256DoArquivo} from '../nucleo/pasta-trilhas';
import {ErroProjeto, type Projeto} from '../nucleo/projeto';

export const arquivoDoEnvelope = (arquivo: string) => `${arquivo}.envelope.json`;

// sha256DoArquivo, listarTrilhas e importarTrilha moraram aqui; foram para src/nucleo/pasta-trilhas.ts (o MCP também os usa)
export {EXTENSOES_AUDIO, importarTrilha, listarTrilhas, sha256DoArquivo};

// por caminho + tamanho + data: o arquivo de mesmo tamanho e outra data (cópia, git clone) é lido uma vez por sessão
const shas = new Map<string, string>();
const shaGuardado = (abs: string, st: Stats) => {
  const chave = `${abs}|${st.size}|${st.mtimeMs}`;
  let s = shas.get(chave);
  if (!s) {
    s = sha256DoArquivo(abs);
    if (shas.size >= 256) shas.delete(shas.keys().next().value!);
    shas.set(chave, s);
  }
  return s;
};

/** Envelope gravado ao lado do arquivo, se houver, estiver inteiro, for da versão atual e ainda for do arquivo como ele
 *  está (o carimbo confere); senão undefined, e a interface mede de novo. */
export const lerEnvelope = (p: Projeto, arquivo: string): Envelope | undefined => {
  try {
    const rel = arquivoDoEnvelope(arquivo);
    if (!p.existe(rel)) return undefined;
    const {doc} = p.lerJson<unknown>(rel);
    if (!ehEnvelope(doc)) return undefined;
    const abs = p.caminho(arquivo);
    const st = statSync(abs);
    const estado = conferirEnvelope(doc, {tamanho: st.size, modificado_ms: st.mtimeMs});
    return estado === 'em_dia' || (estado === 'conferir' && doc.fonte?.sha256 === shaGuardado(abs, st)) ? doc : undefined;
  } catch {
    return undefined;
  }
};

/** Grava o envelope de `arquivo` com o carimbo do arquivo como ele está agora (tamanho, data, sha256). Se o envelope
 *  trouxer `fonte` (o tamanho e o sha256 dos bytes que a interface mediu) e o arquivo tiver mudado no meio, recusa.
 *  `sha256`: o de quem acabou de gravar o arquivo (a limpeza), para não ler de novo. */
export const gravarEnvelope = (p: Projeto, arquivo: string, envelope: Envelope, sha256?: string) => {
  const abs = p.caminho(arquivo);
  const st = statSync(abs);
  const sha = sha256 ?? sha256DoArquivo(abs);
  const medido = envelope.fonte;
  if (medido && (medido.tamanho !== st.size || (medido.sha256 && medido.sha256 !== sha))) {
    throw new ErroProjeto(`${arquivo} mudou enquanto era medido; a linha do tempo mede de novo`, 'conflito');
  }
  const rel = arquivoDoEnvelope(arquivo);
  p.gravarTexto(rel, `${JSON.stringify({...envelope, fonte: {tamanho: st.size, modificado_ms: st.mtimeMs, sha256: sha}})}\n`);
  return rel;
};

/** Envelopes de todos os clipes do documento, por arquivo (o resolvedor recebe isto em `opcoes.envelopes`). */
export const lerEnvelopes = (p: Projeto, doc: DocCenas): Record<string, Envelope | undefined> => {
  const out: Record<string, Envelope | undefined> = {};
  for (const f of doc.audio?.faixas ?? []) {
    for (const c of f.clipes ?? []) {
      if (typeof c.arquivo === 'string' && !(c.arquivo in out)) out[c.arquivo] = lerEnvelope(p, c.arquivo);
    }
  }
  return out;
};

type Lidar = <A extends unknown[], R>(canal: string, f: (...a: A) => R | Promise<R>) => void;

export const registrarIpcAudio = (lidar: Lidar, projeto: () => Projeto, prefs: () => Preferencias) => {
  // a interface mediu o arquivo (Web Audio); o envelope fica ao lado dele, e o observador da pasta avisa a tela
  lidar(CANAL.audioGravarEnvelope, (arquivo: string, envelope: unknown) => {
    const p = projeto();
    if (typeof arquivo !== 'string' || !p.existe(arquivo)) throw new ErroProjeto(`o arquivo de áudio não está no projeto: ${String(arquivo)}`, 'nao_achado');
    if (!ehEnvelope(envelope) || envelope.db.length > 2_000_000 || !envelope.db.every((v) => typeof v === 'number' && Number.isFinite(v))) throw new ErroProjeto('envelope inválido');
    // som-N8: pelo gravarEnvelope, como a limpeza: carimba tamanho, data e sha256 do arquivo como está e recusa se ele mudou
    // no meio da medida. Sem a data, todo envelope da tela caía em 'conferir' e cada sessão lia o áudio inteiro para o sha256.
    return gravarEnvelope(p, arquivo, envelope);
  });
  lidar(CANAL.audioListarTrilhas, () => ({pasta: prefs().pasta_trilhas, trilhas: listarTrilhas(prefs().pasta_trilhas)}));
  lidar(CANAL.audioImportarTrilha, (caminho: string) => importarTrilha(projeto(), prefs().pasta_trilhas, caminho));
};
