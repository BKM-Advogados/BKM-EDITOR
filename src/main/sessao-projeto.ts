// O projeto aberto: observa a pasta (o que o agente grava pelo terminal chega à tela), guarda versões no git com calma
// e monta as props do vídeo para a prévia. A pesquisa (pesquisa/pesquisa.json e os textos em pesquisa/fontes/) passa
// pelo mesmo aviso: a interface relê a pesquisa quando o arquivo mudado começa com "pesquisa/".
import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import chokidar, {type FSWatcher} from 'chokidar';
import {PASTA_INTERNA, Projeto} from '../nucleo/projeto';
import {ErroRoteiro, resolverRoteiro, type Palavra, type Roteiro} from '../nucleo/roteiro/resolver';
import {ehDocCenas, resolverCenas} from '../nucleo/cenas';
import {ehDocAnimacao, resolverAnimacao} from '../nucleo/animacao';
import {FORMATO_PADRAO} from '../nucleo/formatos';
import type {DocVideo} from '../nucleo/documentos';
import type {PropsVideo} from '../compartilhado/api';
import {lerEnvelopes} from './ipc-audio';

const exec = promisify(execFile);
const IGNORAR = /(^|[\\/])(\.git|node_modules)([\\/]|$)|\.tmp$|estado\.json$|mcp\.json$/;

export class SessaoProjeto {
  readonly projeto: Projeto;
  private observador: FSWatcher | null = null;
  private pendentes = new Map<string, NodeJS.Timeout>();
  private relogioGit: NodeJS.Timeout | null = null;
  private _temGit = false;

  constructor(raiz: string, private readonly aoMudar: (arquivo: string) => void) {
    this.projeto = new Projeto(raiz);
  }

  async abrir() {
    this._temGit = await this.prepararGit();
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
    if (this._temGit && !rel.startsWith(PASTA_INTERNA)) {
      if (this.relogioGit) clearTimeout(this.relogioGit);
      this.relogioGit = setTimeout(() => void this.salvarVersao(), 8000);
    }
  }

  get temGit() {
    return this._temGit;
  }

  /** Ctrl+S: ponto de restauração agora, sem esperar a calma de 8 s. */
  async marcarVersao(mensagem = 'estúdio: ponto de restauração') {
    if (!this._temGit) return false;
    if (this.relogioGit) clearTimeout(this.relogioGit);
    await this.salvarVersao(mensagem);
    return true;
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

  /** Props da composição do vídeo (VideoCenas ou CarrosselTema) para a prévia e a exportação, com a mídia em `base`. */
  propsVideo(documento: string, base: string): PropsVideo {
    try {
      const rel = this.projeto.arquivoDoDocumento(documento);
      const {doc} = this.projeto.lerJson<DocVideo>(rel);
      if (ehDocAnimacao(doc)) {
        const {props, avisos} = resolverAnimacao(doc, `${base}/midia`);
        return {props, avisos};
      }
      if (ehDocCenas(doc)) {
        // os envelopes medidos (midia/*.envelope.json) entram nas props: prévia e exportação veem o mesmo ducking
        const {props, avisos} = resolverCenas(doc, {envelopes: lerEnvelopes(this.projeto, doc)});
        return {props: {...props, base_midia: base}, avisos};
      }
      // o carrossel da Cliente: 1080×1920 a 30 qps até a animação dele aceitar outro formato
      const r = doc as Roteiro & DocVideo;
      if (typeof r.palavras !== 'string') return {erro: 'este vídeo não tem "tipo" nem narração (palavras); não sei montá-lo'};
      const lido = this.projeto.lerJson<unknown>(r.palavras).doc;
      const palavras = (Array.isArray(lido) ? lido : (lido as {palavras?: unknown} | null)?.palavras) as Palavra[]; // frente Fala: a transcrição na versão 2 traz a lista em `palavras`
      if (!Array.isArray(palavras) || !palavras.length) return {erro: `a transcrição da narração (${r.palavras}) está vazia`};
      const {props, trechos, avisos} = resolverRoteiro(r, palavras);
      return {
        props: {...props, ...FORMATO_PADRAO, base_midia: `${base}/midia`, narracao: {src: `${base}/${r.fonte}`, trechos}, efeitos: r.efeitos ?? []},
        avisos,
      };
    } catch (e) {
      return {erro: e instanceof ErroRoteiro ? e.message : `não deu para montar o vídeo: ${(e as Error).message}`};
    }
  }
}
