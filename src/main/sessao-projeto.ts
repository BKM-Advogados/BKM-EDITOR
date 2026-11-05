// O projeto aberto: observa a pasta (o que o agente grava pelo terminal chega à tela), guarda versões no git com calma
// e monta as props do vídeo para a prévia.
import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import chokidar, {type FSWatcher} from 'chokidar';
import {PASTA_INTERNA, Projeto} from '../nucleo/projeto';
import {ErroRoteiro, resolverRoteiro, type Palavra} from '../nucleo/roteiro/resolver';
import type {DocVideo} from '../nucleo/documentos';
import type {PropsVideo} from '../compartilhado/api';

const exec = promisify(execFile);
const IGNORAR = /(^|[\\/])(\.git|node_modules)([\\/]|$)|\.tmp$|estado\.json$|mcp\.json$/;

export class SessaoProjeto {
  readonly projeto: Projeto;
  private observador: FSWatcher | null = null;
  private pendentes = new Map<string, NodeJS.Timeout>();
  private relogioGit: NodeJS.Timeout | null = null;
  private temGit = false;

  constructor(raiz: string, private readonly aoMudar: (arquivo: string) => void) {
    this.projeto = new Projeto(raiz);
  }

  async abrir() {
    this.temGit = await this.prepararGit();
    this.observador = chokidar.watch(this.projeto.raiz, {
      ignored: (p) => IGNORAR.test(p),
      ignoreInitial: true,
      awaitWriteFinish: {stabilityThreshold: 120, pollInterval: 40},
      depth: 4,
    });
    this.observador.on('all', (_ev, abs) => this.avisar(path.relative(this.projeto.raiz, abs).split(path.sep).join('/')));
  }

  async fechar() {
    await this.observador?.close();
    if (this.relogioGit) {
      clearTimeout(this.relogioGit);
      await this.salvarVersao();
    }
  }

  private avisar(rel: string) {
    // um arquivo gravado várias vezes em sequência vira um aviso só
    const t = this.pendentes.get(rel);
    if (t) clearTimeout(t);
    this.pendentes.set(rel, setTimeout(() => {
      this.pendentes.delete(rel);
      this.aoMudar(rel);
    }, 60));
    if (this.temGit && !rel.startsWith(PASTA_INTERNA)) {
      if (this.relogioGit) clearTimeout(this.relogioGit);
      this.relogioGit = setTimeout(() => void this.salvarVersao(), 8000);
    }
  }

  private async git(...args: string[]) {
    return exec('git', args, {cwd: this.projeto.raiz, windowsHide: true});
  }

  private async prepararGit(): Promise<boolean> {
    try {
      await exec('git', ['--version'], {windowsHide: true});
    } catch {
      return false;
    }
    if (!existsSync(path.join(this.projeto.raiz, '.git'))) {
      await this.git('init', '-q');
      await this.salvarVersao('estúdio: projeto aberto pela primeira vez');
    }
    return true;
  }

  /** Commit de tudo o que mudou, com os autores tirados do diário. */
  async salvarVersao(mensagem?: string) {
    this.relogioGit = null;
    try {
      await this.git('add', '-A');
      const {stdout} = await this.git('status', '--porcelain');
      if (!stdout.trim()) return;
      const msg = mensagem ?? `estúdio: ${stdout.trim().split('\n').length} arquivo(s) alterado(s)`;
      await this.git('-c', 'user.name=Estudio', '-c', 'user.email=estudio@local', 'commit', '-q', '-m', msg);
    } catch {
      /* sem git utilizável: o diário continua sendo o histórico */
    }
  }

  /** Props do CarrosselTema para a prévia e a exportação, com a mídia servida em `base`. */
  propsVideo(documento: string, base: string): PropsVideo {
    try {
      const rel = this.projeto.arquivoDoDocumento(documento);
      const {doc} = this.projeto.lerJson<DocVideo>(rel);
      const palavras = this.projeto.lerJson<Palavra[]>(doc.palavras).doc;
      const {props, trechos, avisos} = resolverRoteiro(doc, palavras);
      return {
        props: {...props, base_midia: `${base}/midia`, narracao: {src: `${base}/${doc.fonte}`, trechos}, efeitos: doc.efeitos ?? []},
        avisos,
      };
    } catch (e) {
      return {erro: e instanceof ErroRoteiro ? e.message : `não deu para montar o vídeo: ${(e as Error).message}`};
    }
  }
}
