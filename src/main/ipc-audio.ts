// IPC do som do vídeo de cenas: grava o envelope que a interface mediu (midia/<arquivo>.envelope.json), lista a pasta de
// trilhas das preferências e copia uma trilha de lá para midia/. Também lê os envelopes do disco para as props da
// composição (sessao-projeto.ts), para a prévia e a exportação verem o mesmo ducking. Registrado no main.ts com uma linha.
import {copyFileSync, existsSync, mkdirSync, readdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {CANAL, type Preferencias, type Trilha} from '../compartilhado/api';
import {ehEnvelope, type Envelope} from '../nucleo/audio';
import type {DocCenas} from '../nucleo/cenas';
import {ErroProjeto, type Projeto} from '../nucleo/projeto';

export const EXTENSOES_AUDIO = ['wav', 'mp3', 'm4a', 'ogg', 'aac'];
const MAX_TRILHAS = 500;

export const arquivoDoEnvelope = (arquivo: string) => `${arquivo}.envelope.json`;

/** Envelope gravado ao lado do arquivo, se houver e estiver inteiro. */
export const lerEnvelope = (p: Projeto, arquivo: string): Envelope | undefined => {
  try {
    const rel = arquivoDoEnvelope(arquivo);
    if (!p.existe(rel)) return undefined;
    const {doc} = p.lerJson<unknown>(rel);
    return ehEnvelope(doc) ? doc : undefined;
  } catch {
    return undefined;
  }
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
    p.gravarTexto(arquivoDoEnvelope(arquivo), `${JSON.stringify(envelope)}\n`);
    return arquivoDoEnvelope(arquivo);
  });
  lidar(CANAL.audioListarTrilhas, () => ({pasta: prefs().pasta_trilhas, trilhas: listarTrilhas(prefs().pasta_trilhas)}));
  lidar(CANAL.audioImportarTrilha, (caminho: string) => importarTrilha(projeto(), prefs().pasta_trilhas, caminho));
};
