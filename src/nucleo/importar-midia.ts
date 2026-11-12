// Trazer um arquivo de fora do projeto para midia/ (frente 2 do MCP): a mesma regra para o botão da tela (o diálogo do
// sistema, src/main/main.ts) e para a ferramenta importar_midia do MCP (src/nucleo/mcp-projeto.ts). O que já está dentro
// do projeto é usado no lugar; o que vem de fora é copiado para midia/ (ou uma subpasta dela) com um nome livre
// ("foto.png", "foto (2).png"), e nada se grava por um link de midia/ para fora (Projeto.caminhoParaGravar). Só entram as
// extensões do filtro do diálogo: imagem, áudio e vídeo que a prévia e a exportação tocam.
import {constants, copyFileSync, existsSync, mkdirSync, statSync} from 'node:fs';
import path from 'node:path';
import {nomeDePasta} from './criar-projeto';
import {dentroDe, ErroProjeto, type Projeto} from './projeto';

export type TipoImportavel = 'imagem' | 'audio' | 'video';

/** As extensões que entram, por tipo (sem o ponto): as mesmas do filtro do diálogo da tela. */
export const EXTENSOES_IMPORTAVEIS: Record<TipoImportavel, string[]> = {
  imagem: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'],
  audio: ['wav', 'mp3', 'm4a', 'ogg', 'aac'],
  video: ['mp4', 'webm', 'mov'],
};

/** O nome de cada tipo no filtro do diálogo do sistema. */
export const NOME_DO_TIPO: Record<TipoImportavel, string> = {imagem: 'Imagens', audio: 'Áudio', video: 'Vídeo'};

const extensaoDe = (arquivo: string) => path.extname(arquivo).slice(1).toLowerCase();

/** O tipo pela extensão do arquivo, ou null quando ela não entra no projeto. */
export const tipoDaExtensao = (arquivo: string): TipoImportavel | null => {
  const ext = extensaoDe(arquivo);
  return (Object.keys(EXTENSOES_IMPORTAVEIS) as TipoImportavel[]).find((t) => EXTENSOES_IMPORTAVEIS[t].includes(ext)) ?? null;
};

/** A pasta de destino, relativa ao projeto: midia/ ou uma subpasta dela ("tomadas" e "midia/tomadas" dão o mesmo). */
export const pastaDeImportacao = (pasta?: string) => {
  const limpa = (pasta ?? '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/^midia(\/|$)/, '');
  if (!limpa) return 'midia';
  const partes = limpa.split('/').filter(Boolean);
  if (partes.some((p) => p === '.' || p === '..' || /[<>:"|?*\u0000-\u001f]/.test(p))) {
    throw new ErroProjeto(`pasta inválida: ${pasta} (use uma subpasta de midia/, ex.: "tomadas")`, 'caminho');
  }
  return ['midia', ...partes].join('/');
};

/** Arquivo que ainda não existe em `pasta`: "Nome.png", "Nome (2).png"… */
const arquivoLivre = (pasta: string, nome: string, ext: string) => {
  const base = nomeDePasta(nome) || 'midia';
  let p = path.join(pasta, `${base}.${ext}`);
  for (let n = 2; existsSync(p); n++) p = path.join(pasta, `${base} (${n}).${ext}`);
  return p;
};

export type MidiaImportada = {caminho: string; tipo: TipoImportavel; copiado: boolean};

/** Põe `origem` (caminho absoluto no computador, ou relativo ao projeto) em midia/. Recusa o que não é arquivo, a extensão
 *  fora do filtro (do `tipo`, quando dito) e a gravação por um link de midia/ para fora. Devolve o caminho no projeto. */
export const importarMidia = (p: Projeto, origem: string, o: {tipo?: TipoImportavel; pasta?: string; nome?: string} = {}): MidiaImportada => {
  if (typeof origem !== 'string' || !origem.trim()) throw new ErroProjeto('diga o caminho do arquivo', 'caminho');
  const abs = path.isAbsolute(origem) ? path.resolve(origem) : path.resolve(p.raiz, origem);
  const ext = extensaoDe(abs);
  const tipo = o.tipo ?? tipoDaExtensao(abs);
  if (!tipo || !EXTENSOES_IMPORTAVEIS[tipo].includes(ext)) {
    const vale = o.tipo ? EXTENSOES_IMPORTAVEIS[o.tipo] : Object.values(EXTENSOES_IMPORTAVEIS).flat();
    throw new ErroProjeto(`formato ${ext ? `.${ext}` : 'sem extensão'} não entra${o.tipo ? ` como ${o.tipo}` : ''} (vale ${vale.join(', ')})`, 'caminho');
  }
  let ehArquivo = false;
  try {
    ehArquivo = statSync(abs).isFile();
  } catch {
    ehArquivo = false;
  }
  if (!ehArquivo) throw new ErroProjeto(`arquivo não achado: ${origem}`, 'nao_achado');
  // o que já está dentro do projeto é usado no lugar (a pasta pedida não vale: nada é copiado)
  if (abs !== path.resolve(p.raiz) && dentroDe(path.resolve(p.raiz), abs)) {
    return {caminho: path.relative(p.raiz, abs).split(path.sep).join('/'), tipo, copiado: false};
  }
  const pasta = pastaDeImportacao(o.pasta);
  const nome = o.nome?.trim() ? o.nome.trim().replace(new RegExp(`\\.${ext}$`, 'i'), '') : path.basename(abs, path.extname(abs));
  return p.comTrava(() => {
    const destino = arquivoLivre(p.caminho(pasta), nome, ext);
    const rel = path.relative(p.raiz, destino);
    const gravar = p.caminhoParaGravar(rel); // midia/ ligada para fora por link: só leitura, não copia para lá
    mkdirSync(path.dirname(gravar), {recursive: true});
    copyFileSync(abs, gravar, constants.COPYFILE_EXCL);
    return {caminho: rel.split(path.sep).join('/'), tipo, copiado: true};
  });
};
