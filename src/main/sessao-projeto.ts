// O projeto aberto: observa a pasta (o que o agente grava pelo terminal chega à tela), guarda versões no git com calma
// e monta as props do vídeo para a prévia. A pesquisa (pesquisa/pesquisa.json e os textos em pesquisa/fontes/) passa
// pelo mesmo aviso: a interface relê a pesquisa quando o arquivo mudado começa com "pesquisa/".
import {execFile} from 'node:child_process';
import {existsSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import chokidar, {type FSWatcher} from 'chokidar';
import {PASTA_INTERNA, Projeto} from '../nucleo/projeto';
import {ErroRoteiro, padroesDaMidia, resolverRoteiro, type Palavra, type Roteiro} from '../nucleo/roteiro/resolver';
import {ehDocCenas, resolverCenas} from '../nucleo/cenas';
import {ehDocAnimacao, resolverAnimacao} from '../nucleo/animacao';
import {FORMATO_PADRAO} from '../nucleo/formatos';
import type {DocVideo} from '../nucleo/documentos';
import type {PropsVideo} from '../compartilhado/api';
import {lerEnvelopes} from './ipc-audio';
import {arquivosDaMidia, gitignoreComMidiaPesada} from '../nucleo/midia-git'; // frente Casca (transversal-D7)
import {gitignoreComRegrasInternas} from '../nucleo/criar-projeto';
import {publicarMcpApp, retirarMcpApp} from '../nucleo/mcp-app';

const exec = promisify(execFile);
// a trava de escrita (.estudio/escrita.lock) entra e sai a cada gravação: avisar a tela por ela seria um aviso por edição
const IGNORAR = /(^|[\\/])(\.git|node_modules)([\\/]|$)|\.tmp$|estado\.json$|mcp\.json$|[\\/]\.estudio[\\/](escrita\.lock|mcp-app\.json)/;

export class SessaoProjeto {
  readonly projeto: Projeto;
  private observador: FSWatcher | null = null;
  private pendentes = new Map<string, NodeJS.Timeout>();
  private relogioGit: NodeJS.Timeout | null = null;
  private _temGit = false;
  private tokenMcp: string | null = null;

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

  /** O MCP da IDE (mcp/nucleo.ts, outro processo) passa a mandar as chamadas de ferramenta ao app enquanto o projeto
   *  está aberto aqui (src/nucleo/mcp-app.ts). `headers` traz o token que o McpHttp deu para isso. */
  publicarMcp(c: {url: string; headers: {Authorization: string}} | undefined) {
    const token = /^Bearer\s+(\S+)$/.exec(c?.headers.Authorization ?? '')?.[1];
    if (!c || !token) return;
    try {
      publicarMcpApp(this.projeto.raiz, {url: c.url, token});
      this.tokenMcp = token;
    } catch {
      /* pasta sem escrita: o MCP da IDE segue gravando direto, com a trava */
    }
  }

  async fechar() {
    if (this.tokenMcp) retirarMcpApp(this.projeto.raiz, this.tokenMcp);
    this.tokenMcp = null;
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

  /** transversal-D7: vídeo bruto e o que passa de 25 MB em midia/ ficam fora do git (midia-git.ts). Antes de cada commit,
   *  porque a mídia chega a qualquer hora (gravação, importação, o agente copiando). O diário e a trava de escrita
   *  também ficam fora (REGRAS_GIT_INTERNAS), inclusive nos projetos criados antes dessa regra. */
  private ignorarMidiaPesada() {
    try {
      this.projeto.comTrava(() => {
        const atual = this.projeto.existe('.gitignore') ? this.projeto.lerTexto('.gitignore') : '';
        const novo = gitignoreComRegrasInternas(gitignoreComMidiaPesada(atual, arquivosDaMidia(this.projeto.raiz)));
        if (novo !== atual) this.projeto.gravarTexto('.gitignore', novo);
      });
    } catch {
      /* sem permissão para o .gitignore: o commit segue como antes */
    }
  }

  /** Commit de tudo o que mudou, com os autores tirados do diário. */
  async salvarVersao(mensagem?: string) {
    this.relogioGit = null;
    try {
      this.ignorarMidiaPesada();
      // o diário saiu do commit automático: no projeto que já o versionava, sai do índice e fica no disco (e o endereço
      // do MCP, com token, nunca entra)
      await this.git('rm', '--cached', '-q', '--ignore-unmatch', '--', `${PASTA_INTERNA}/diario.jsonl`, `${PASTA_INTERNA}/mcp-app.json`);
      await this.git('add', '-A');
      const {stdout} = await this.git('status', '--porcelain');
      if (!stdout.trim()) return;
      const msg = mensagem ?? `estúdio: ${stdout.trim().split('\n').length} arquivo(s) alterado(s)`;
      await this.git('-c', 'user.name=Estudio', '-c', 'user.email=estudio@local', 'commit', '-q', '-m', msg);
    } catch {
      /* sem git utilizável: o diário continua sendo o histórico */
    }
  }

  /** Os arquivos da raiz de midia/ (o logo e a foto padrão do carrossel narrado saem daí). */
  private arquivosDaMidia(): string[] {
    try {
      return readdirSync(path.join(this.projeto.raiz, 'midia'), {withFileTypes: true}).filter((d) => d.isFile()).map((d) => d.name);
    } catch {
      return [];
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
      // o carrossel narrado: 1080×1920 a 30 qps até a animação dele aceitar outro formato
      const r = doc as Roteiro & DocVideo;
      if (typeof r.palavras !== 'string') return {erro: 'este vídeo não tem "tipo" nem narração (palavras); não sei montá-lo'};
      const lido = this.projeto.lerJson<unknown>(r.palavras).doc;
      const palavras = (Array.isArray(lido) ? lido : (lido as {palavras?: unknown} | null)?.palavras) as Palavra[]; // frente Fala: a transcrição na versão 2 traz a lista em `palavras`
      if (!Array.isArray(palavras) || !palavras.length) return {erro: `a transcrição da narração (${r.palavras}) está vazia`};
      const {props, trechos, avisos} = resolverRoteiro(r, palavras, padroesDaMidia(this.arquivosDaMidia()));
      return {
        props: {...props, ...FORMATO_PADRAO, base_midia: `${base}/midia`, narracao: {src: `${base}/${r.fonte}`, trechos}, efeitos: r.efeitos ?? []},
        avisos,
      };
    } catch (e) {
      return {erro: e instanceof ErroRoteiro ? e.message : `não deu para montar o vídeo: ${(e as Error).message}`};
    }
  }
}
