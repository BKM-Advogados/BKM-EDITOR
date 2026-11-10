// A pasta de trilhas no disco (%USERPROFILE%\Estudio\trilhas, trocável nas preferências): lista os áudios com a ficha de
// licença de cada um (biblioteca-musicas.ts) e traz uma trilha para midia/ do projeto. Serve ao processo principal (IPC) e às
// ferramentas do MCP, dentro e fora do app, como a pasta de marcas (pasta-marcas.ts).
import {createHash} from 'node:crypto';
import {closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {Trilha} from '../compartilhado/api';
import {arquivoDaFicha, validarFicha} from './biblioteca-musicas';
import {ErroProjeto, type Projeto} from './projeto';

export const EXTENSOES_AUDIO = ['wav', 'mp3', 'm4a', 'ogg', 'aac'];
const MAX_TRILHAS = 500;

/** Pasta padrão, ao lado dos projetos. ESTUDIO_TRILHAS aponta outra (o MCP fora do app e os testes usam). */
export const pastaPadraoTrilhas = () => process.env.ESTUDIO_TRILHAS || path.join(os.homedir(), 'Estudio', 'trilhas');
let configurada: (() => string) | null = null;
/** O app diz onde fica a pasta (preferências); sem isso, a padrão. */
export const definirPastaTrilhas = (f: (() => string) | null) => {
  configurada = f;
};
export const pastaTrilhas = () => configurada?.() || pastaPadraoTrilhas();

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

/** A ficha ao lado do arquivo: a que serve, a que foi recusada (com o motivo) ou nada (faixa sem ficha). */
export const lerFicha = (abs: string): Pick<Trilha, 'ficha' | 'recusa'> => {
  const f = arquivoDaFicha(abs);
  if (!existsSync(f)) return {};
  try {
    const r = validarFicha(JSON.parse(readFileSync(f, 'utf-8')));
    return r.ficha ? {ficha: r.ficha} : {recusa: r.erros.join('; ')};
  } catch (e) {
    return {recusa: `ficha ilegível: ${(e as Error).message}`};
  }
};

/** Arquivos de áudio da pasta de trilhas (até dois níveis), em ordem de nome, com a ficha de cada um; cria a pasta se não existir. */
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
        out.push({nome: path.basename(nome, path.extname(nome)), caminho: abs, pasta: path.relative(pasta, dir).split(path.sep).join('/'), tamanho_kb: Math.round(st.size / 1024), ...lerFicha(abs)});
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

export const dentroDe = (pasta: string, arquivo: string) => {
  const rel = path.relative(path.resolve(pasta), path.resolve(arquivo));
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** Cópia que midia/ já tem desta trilha (mesmo tamanho, mesma extensão, mesmo sha256), ou null. Procura só no primeiro nível. */
const copiaExistente = (midia: string, origem: string, ext: string): string | null => {
  if (!existsSync(midia)) return null;
  const tamanho = statSync(origem).size;
  let sha: string | undefined;
  for (const nome of readdirSync(midia)) {
    if (path.extname(nome).slice(1).toLowerCase() !== ext) continue;
    const abs = path.join(midia, nome);
    try {
      if (!statSync(abs).isFile() || statSync(abs).size !== tamanho) continue;
      sha ??= sha256DoArquivo(origem);
      if (sha256DoArquivo(abs) === sha) return abs;
    } catch {
      /* arquivo preso ou sumido: a próxima */
    }
  }
  return null;
};

/** Traz uma trilha da biblioteca para midia/ do projeto; devolve o caminho no projeto ("midia/trilha.mp3"). A mesma trilha já
 *  copiada antes (mesmos bytes) é reaproveitada, em vez de virar uma cópia nova a cada uso (som-D12); a ficha vem junto. */
export const importarTrilha = (p: Projeto, pastaDasTrilhas: string, caminho: string) => {
  if (!dentroDe(pastaDasTrilhas, caminho)) throw new ErroProjeto('só entram arquivos da pasta de trilhas das preferências', 'caminho');
  const ext = path.extname(caminho).slice(1).toLowerCase();
  if (!EXTENSOES_AUDIO.includes(ext)) throw new ErroProjeto(`formato não tocável: .${ext} (vale ${EXTENSOES_AUDIO.join(', ')})`, 'caminho');
  if (!existsSync(caminho)) throw new ErroProjeto(`a trilha não existe mais: ${caminho}`, 'nao_achado');
  const ficha = lerFicha(caminho);
  if (ficha.recusa) throw new ErroProjeto(`a ficha de ${path.basename(caminho)} foi recusada: ${ficha.recusa}`, 'caminho');
  const midia = p.caminho('midia');
  const destino = copiaExistente(midia, caminho, ext) ?? arquivoLivre(midia, path.basename(caminho, path.extname(caminho)), ext);
  if (!existsSync(destino)) {
    mkdirSync(path.dirname(destino), {recursive: true});
    copyFileSync(caminho, destino);
  }
  const fichaOrigem = arquivoDaFicha(caminho);
  if (ficha.ficha && !existsSync(arquivoDaFicha(destino))) copyFileSync(fichaOrigem, arquivoDaFicha(destino));
  return path.relative(p.raiz, destino).split(path.sep).join('/');
};
