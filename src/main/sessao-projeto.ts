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
import {lerEnvelope, lerEnvelopes} from './ipc-audio';
import {arquivosDaMidia, gitignoreComMidiaPesada} from '../nucleo/midia-git'; // frente Casca (transversal-D7)
import {gitignoreComRegrasInternas} from '../nucleo/criar-projeto';
import {publicarMcpApp, retirarMcpApp} from '../nucleo/mcp-app';
import {gitDoApp} from './git'; // portes: no Mac o git sem as ferramentas do Xcode abre o instalador da Apple

const exec = promisify(execFile);
// a trava de escrita (.estudio/escrita.lock) entra e sai a cada gravação: avisar a tela por ela seria um aviso por edição
const IGNORAR = /(^|[\\/])(\.git|node_modules)([\\/]|$)|\.tmp$|estado\.json$|mcp\.json$|[\\/]\.estudio[\\/](escrita\.lock|mcp-app\.json)/;

export class SessaoProjeto {
  readonly projeto: Projeto;
  private observador: FSWatcher | null = null;
  private pendentes = new Map<string, NodeJS.Timeout>();
  private relogioGit: NodeJS.Timeout | null = null;
  private _temGit = false;
  private fechada = false;
  // um git por vez: o Ctrl+S que cai no meio do commit automático espera em vez de bater no index.lock
  private filaGit: Promise<boolean> = Promise.resolve(true);
  private tokenMcp: string | null = null;
  private exeGit = 'git';

  constructor(raiz: string, private readonly aoMudar: (arquivo: string) => void) {
    this.projeto = new Projeto(raiz);
  }

  async abrir() {
    this._temGit = await this.prepararGit();
    if (this.fechada) return; // fechada enquanto o git preparava: não nasce observador órfão
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
    if (!c || !token || this.fechada) return; // fechando: o arquivo já saiu e não volta
    try {
      publicarMcpApp(this.projeto.raiz, {url: c.url, token});
      this.tokenMcp = token;
    } catch {
      /* pasta sem escrita: o MCP da IDE segue gravando direto, com a trava */
    }
  }

  async fechar() {
    this.fechada = true;
    for (const t of this.pendentes.values()) clearTimeout(t);
    this.pendentes.clear();
    if (this.tokenMcp) retirarMcpApp(this.projeto.raiz, this.tokenMcp);
    this.tokenMcp = null;
    await this.observador?.close();
    this.observador = null;
    if (this.relogioGit) {
      clearTimeout(this.relogioGit);
      void this.salvarVersao();
    }
    await this.filaGit; // inclusive o commit automático que já estava rodando
  }

  private avisar(rel: string) {
    if (this.fechada) return;
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
    return this.salvarVersao(mensagem);
  }

  /** O ponto de restauração com o app fechado (o marcar_ponto_de_restauracao pelo MCP da IDE e do Claude Desktop): o
   *  mesmo commit do Ctrl+S, com o .gitignore da mídia pesada, sem observar a pasta. Sem git (ou sem permissão), false. */
  static async pontoSemApp(raiz: string, mensagem?: string): Promise<{ok: boolean; temGit: boolean}> {
    const s = new SessaoProjeto(raiz, () => undefined);
    s._temGit = await s.prepararGit();
    return {ok: s._temGit ? await s.marcarVersao(mensagem) : false, temGit: s._temGit};
  }

  private async git(...args: string[]) {
    return exec(this.exeGit, args, {cwd: this.projeto.raiz, windowsHide: true});
  }

  private async prepararGit(): Promise<boolean> {
    const git = await gitDoApp();
    if (!git) return false;
    this.exeGit = git;
    if (!existsSync(path.join(this.projeto.raiz, '.git'))) {
      try {
        await this.git('init', '-q');
      } catch {
        return false; // pasta só de leitura, sem permissão: abre sem pontos de restauração
      }
      await this.salvarVersao('estúdio: projeto aberto pela primeira vez');
    }
    return true;
  }

  /** transversal-D7: vídeo bruto e o que passa de 25 MB em midia/ ficam fora do git (midia-git.ts). Antes de cada commit,
   *  porque a mídia chega a qualquer hora (gravação, importação, o agente copiando). O diário e a trava de escrita
   *  também ficam fora (REGRAS_GIT_INTERNAS), inclusive nos projetos criados antes dessa regra. */
  private ignorarMidiaPesada() {
    try {
      const midia = arquivosDaMidia(this.projeto.raiz); // fora da trava: andar por midia/ (às vezes um disco de fora) demora
      this.projeto.comTrava(() => {
        const atual = this.projeto.existe('.gitignore') ? this.projeto.lerTexto('.gitignore') : '';
        const novo = gitignoreComRegrasInternas(gitignoreComMidiaPesada(atual, midia));
        if (novo !== atual) this.projeto.gravarTexto('.gitignore', novo);
      });
    } catch {
      /* sem permissão para o .gitignore: o commit segue como antes */
    }
  }

  /** Commit de tudo o que mudou, com os autores tirados do diário. */
  salvarVersao(mensagem?: string): Promise<boolean> {
    this.relogioGit = null;
    const vez = this.filaGit.then(() => this.commitAgora(mensagem));
    this.filaGit = vez;
    return vez;
  }

  /** true: commitou ou não havia o que commitar; false: o git falhou (index.lock, dubious ownership, disco cheio). */
  private async commitAgora(mensagem?: string): Promise<boolean> {
    try {
      this.ignorarMidiaPesada();
      // o diário saiu do commit automático: no projeto que já o versionava, sai do índice e fica no disco (e o endereço
      // do MCP, com token, nunca entra)
      await this.git('rm', '--cached', '-q', '--ignore-unmatch', '--', `${PASTA_INTERNA}/diario.jsonl`, `${PASTA_INTERNA}/mcp-app.json`);
      await this.git('add', '-A');
      const {stdout} = await this.git('status', '--porcelain');
      if (!stdout.trim()) return true;
      const msg = mensagem ?? `estúdio: ${stdout.trim().split('\n').length} arquivo(s) alterado(s)`;
      await this.git('-c', 'user.name=Estudio', '-c', 'user.email=estudio@local', 'commit', '-q', '-m', msg);
      return true;
    } catch {
      return false; /* sem git utilizável: o diário continua sendo o histórico */
    }
  }

  /** Props da composição do vídeo para a prévia e a exportação, com a mídia em `base` (propsDoVideo, abaixo). */
  propsVideo(documento: string, base: string): PropsVideo {
    return propsDoVideo(this.projeto, documento, base);
  }
}

/** Props da composição do vídeo (VideoCenas, CarrosselTema ou Animacao) para a prévia e a exportação, com a mídia em `base`.
 *  Solta da sessão: as prévias do MCP por stdio (src/main/previa.ts) montam as mesmas props sem o app aberto. */
export const propsDoVideo = (projeto: Projeto, documento: string, base: string): PropsVideo => {
  try {
    const rel = projeto.arquivoDoDocumento(documento);
    const {doc} = projeto.lerJson<DocVideo>(rel);
    if (ehDocAnimacao(doc)) {
      // as camadas são relativas a midia/; o tema do kit (fontes/…, midia/logo-…) e a marca d'água, à raiz do projeto
      const {props, avisos} = resolverAnimacao(doc, `${base}/midia`);
      return {props: {...props, base_projeto: base}, avisos};
    }
    if (ehDocCenas(doc)) {
      // os envelopes medidos (midia/*.envelope.json) entram nas props: prévia e exportação veem o mesmo ducking; os efeitos
      // de midia/sfx/ que o projeto tem servem aos efeitos sonoros do acabamento (acabamento-video.ts)
      const sfx = arquivosDaPasta(projeto.raiz, 'midia/sfx');
      const envelopes = {...lerEnvelopes(projeto, doc), ...Object.fromEntries(sfx.map((n) => [`midia/sfx/${n}`, lerEnvelope(projeto, `midia/sfx/${n}`)]))};
      const {props, avisos} = resolverCenas(doc, {envelopes, sfx});
      return {props: {...props, base_midia: base}, avisos};
    }
    // o carrossel narrado: 1080×1920 a 30 qps até a animação dele aceitar outro formato
    const r = doc as Roteiro & DocVideo;
    if (typeof r.palavras !== 'string') return {erro: 'este vídeo não tem "tipo" nem narração (palavras); não sei montá-lo'};
    const lido = projeto.lerJson<unknown>(r.palavras).doc;
    const palavras = (Array.isArray(lido) ? lido : (lido as {palavras?: unknown} | null)?.palavras) as Palavra[]; // frente Fala: a transcrição na versão 2 traz a lista em `palavras`
    if (!Array.isArray(palavras) || !palavras.length) return {erro: `a transcrição da narração (${r.palavras}) está vazia`};
    const {props, trechos, avisos} = resolverRoteiro(r, palavras, padroesDaMidia(arquivosDaRaizDaMidia(projeto.raiz)));
    return {
      props: {...props, ...FORMATO_PADRAO, base_midia: `${base}/midia`, narracao: {src: `${base}/${r.fonte}`, trechos}, efeitos: r.efeitos ?? []},
      avisos,
    };
  } catch (e) {
    return {erro: e instanceof ErroRoteiro ? e.message : `não deu para montar o vídeo: ${(e as Error).message}`};
  }
};

/** Os arquivos (só o nome) de uma pasta do projeto, sem descer nas subpastas; pasta que não há, lista vazia. */
const arquivosDaPasta = (raiz: string, rel: string): string[] => {
  try {
    return readdirSync(path.join(raiz, rel), {withFileTypes: true}).filter((d) => d.isFile()).map((d) => d.name);
  } catch {
    return [];
  }
};

/** Os arquivos da raiz de midia/ (o logo e a foto padrão do carrossel narrado saem daí). */
const arquivosDaRaizDaMidia = (raiz: string): string[] => arquivosDaPasta(raiz, 'midia');
