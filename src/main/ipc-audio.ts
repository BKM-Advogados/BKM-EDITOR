// IPC do som do vídeo de cenas: grava o envelope que a interface mediu (midia/<arquivo>.envelope.json), lista a pasta de
// trilhas das preferências e copia uma trilha de lá para midia/. Também lê os envelopes do disco para as props da
// composição (sessao-projeto.ts), para a prévia e a exportação verem o mesmo ducking. Registrado no main.ts com uma linha.
// O envelope leva o carimbo do arquivo medido (tamanho, data e sha256): a tomada nova gravada com o mesmo nome, ou o
// envelope de outra versão da conta, conta como não medido, e a linha do tempo mede de novo.
import {createHash} from 'node:crypto';
import {closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readSync, statSync, type Stats} from 'node:fs';
import path from 'node:path';
import {CANAL, type Preferencias, type Trilha} from '../compartilhado/api';
import {conferirEnvelope, ehEnvelope, type Envelope} from '../nucleo/audio';
import type {DocCenas} from '../nucleo/cenas';
import {ErroProjeto, type Projeto} from '../nucleo/projeto';

export const EXTENSOES_AUDIO = ['wav', 'mp3', 'm4a', 'ogg', 'aac'];
const MAX_TRILHAS = 500;

export const arquivoDoEnvelope = (arquivo: string) => `${arquivo}.envelope.json`;

/** sha256 de um arquivo, lido em pedaços de 1 MB (a narração inteira não precisa caber na memória). */
export const sha256DoArquivo = (abs: string) => {
  const h = createHash('sha256');
  const fd = openSync(abs, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    for (let n = readSync(fd, buf, 0, buf.length, null); n > 0; n = readSync(fd, buf, 0, buf.length, null)) h.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return h.digest('hex');
};

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

/** Arquivos de áudio da pasta de trilhas (até dois níveis), em ordem de nome; cria a pasta se não existir. */
export const listarTrilhas = (pasta: string, profundidade = 2): Trilha[] => {
  mkdirSync(pasta, {recursive: true});
  const out: Trilha[] = [];
  const andar = (dir: string, nivel: number) => {
    let entradas: string[];
    try {
      entradas = readdirSync(dir).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    } catch {
      return;
    }
    for (const nome of entradas) {
      if (out.length >= MAX_TRILHAS) return;
      const abs = path.join(dir, nome);
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (nivel < profundidade && !nome.startsWith('.')) andar(abs, nivel + 1);
      } else if (EXTENSOES_AUDIO.includes(path.extname(nome).slice(1).toLowerCase())) {
        out.push({nome: path.basename(nome, path.extname(nome)), caminho: abs, pasta: path.relative(pasta, dir).split(path.sep).join('/'), tamanho_kb: Math.round(st.size / 1024)});
      }
    }
  };
  andar(pasta, 0);
  return out;
};

/** Arquivo que ainda não existe em `pasta`: "Nome.mp3", "Nome (2).mp3"... */
const arquivoLivre = (pasta: string, base: string, ext: string) => {
  let p = path.join(pasta, `${base}.${ext}`);
  for (let n = 2; existsSync(p); n++) p = path.join(pasta, `${base} (${n}).${ext}`);
  return p;
};

const dentroDe = (pasta: string, arquivo: string) => {
  const rel = path.relative(path.resolve(pasta), path.resolve(arquivo));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** Copia uma trilha da biblioteca para midia/ do projeto; devolve o caminho no projeto ("midia/trilha.mp3"). */
export const importarTrilha = (p: Projeto, pastaTrilhas: string, caminho: string) => {
  if (!dentroDe(pastaTrilhas, caminho)) throw new ErroProjeto('só entram arquivos da pasta de trilhas das preferências', 'caminho');
  const ext = path.extname(caminho).slice(1).toLowerCase();
  if (!EXTENSOES_AUDIO.includes(ext)) throw new ErroProjeto(`formato não tocável: .${ext} (vale ${EXTENSOES_AUDIO.join(', ')})`, 'caminho');
  if (!existsSync(caminho)) throw new ErroProjeto(`a trilha não existe mais: ${caminho}`, 'nao_achado');
  const destino = arquivoLivre(p.caminho('midia'), path.basename(caminho, path.extname(caminho)), ext);
  mkdirSync(path.dirname(destino), {recursive: true});
  copyFileSync(caminho, destino);
  return path.relative(p.raiz, destino).split(path.sep).join('/');
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
