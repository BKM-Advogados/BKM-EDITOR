// Atualização do Estúdio (docs/atualizacao.md): os motores. Windows: o motorWindows sobre um NsisUpdater falso e sobre o
// NsisUpdater de verdade (com app e HTTP de mentira, sem rede), e o app-update.yml contra o publish do
// electron-builder.yml. Linux: o motorLinux com fetch falso numa pasta temporária (SHA errado recusa; troca e limpeza).
import {createHash} from 'node:crypto';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {NsisUpdater} from 'electron-updater';
import {decidir, nomeDoArquivo, PASTA_CACHE_ATUALIZADOR, REPOSITORIO, type AssetGitHub, type Novidade, type ReleaseGitHub} from '../src/nucleo/atualizacao';
import {configDoAtualizador, motorWindows, type UpdaterNsis, yamlDoAtualizador} from '../src/main/atualizacao-windows';
import {acharPastaDoApp, type BuscarArquivo, type Extrair, limparSobras, motorLinux, pastasDaTroca, trocarPastas} from '../src/main/atualizacao-linux';

const raiz = path.resolve(__dirname, '..');
// o js-yaml vem com o electron-updater (o mesmo leitor que ele usa para o app-update.yml)
const requerer = createRequire(import.meta.url);
const yaml = requerer(requerer.resolve('js-yaml', {paths: [path.dirname(requerer.resolve('electron-updater'))]})) as {load: (s: string) => unknown};
const lerYaml = (arquivo: string) => yaml.load(readFileSync(arquivo, 'utf-8')) as Record<string, unknown>;

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-atualizacao-'));
});
afterEach(() => rmSync(tmp, {recursive: true, force: true}));

// ---------- electron-builder.yml ----------

describe('electron-builder.yml', () => {
  const builder = lerYaml(path.join(raiz, 'electron-builder.yml'));
  const pacote = JSON.parse(readFileSync(path.join(raiz, 'package.json'), 'utf-8')) as {name: string; version: string};

  it('o publish aponta para o repositório que o app procura', () => {
    expect(builder.publish).toEqual({provider: 'github', owner: REPOSITORIO.dono, repo: REPOSITORIO.nome});
  });

  it('o app-update.yml que o app escreve é o que o electron-builder gravaria', () => {
    // o electron-builder grava o publish com updaterCacheDirName = nome do package.json em minúsculas + "-updater"
    const esperado = {...(builder.publish as object), updaterCacheDirName: `${pacote.name.toLowerCase()}-updater`};
    expect(configDoAtualizador()).toEqual(esperado);
    expect(PASTA_CACHE_ATUALIZADOR).toBe(esperado.updaterCacheDirName);
    expect(yaml.load(yamlDoAtualizador())).toEqual(esperado);
    expect(yamlDoAtualizador()).not.toMatch(/token|publisherName/i); // repositório público, instalador sem assinatura
  });

  it('os nomes do instalador e dos DMGs batem com os que o app procura', () => {
    const nsis = builder.nsis as {artifactName: string; perMachine: boolean};
    const dmg = builder.dmg as {artifactName: string};
    const nome = (modelo: string, ext: string, arch = 'x64') => modelo.replace('${version}', '2.0.1').replace('${arch}', arch).replace('${ext}', ext);
    expect(nome(nsis.artifactName, 'exe')).toBe(nomeDoArquivo('win32', 'x64', '2.0.1'));
    expect(nome(dmg.artifactName, 'dmg', 'arm64')).toBe(nomeDoArquivo('darwin', 'arm64', '2.0.1'));
    expect(nome(dmg.artifactName, 'dmg', 'x64')).toBe(nomeDoArquivo('darwin', 'x64', '2.0.1'));
    expect(nsis.perMachine).toBe(false); // sem administrador: o latest.yml sai sem isAdminRightsRequired
  });
});

// ---------- Windows: NsisUpdater falso ----------

class NsisFalso implements UpdaterNsis {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  autoRunAppAfterInstall = false;
  allowPrerelease = false;
  allowDowngrade = true;
  updateConfigPath: string | null = null;
  logger: unknown = null;
  ouvintes = new Map<string, Set<(...a: never[]) => void>>();
  resultado: Awaited<ReturnType<UpdaterNsis['checkForUpdates']>> = null;
  instalou: unknown[] = [];
  on(evento: string, f: (...a: never[]) => void) {
    if (!this.ouvintes.has(evento)) this.ouvintes.set(evento, new Set());
    this.ouvintes.get(evento)!.add(f);
    return this;
  }
  removeListener(evento: string, f: (...a: never[]) => void) {
    this.ouvintes.get(evento)?.delete(f);
    return this;
  }
  emitir(evento: string, ...a: unknown[]) {
    for (const f of this.ouvintes.get(evento) ?? []) (f as (...x: unknown[]) => void)(...a);
  }
  checkForUpdates = async () => this.resultado;
  downloadUpdate = async () => {
    this.emitir('download-progress', {percent: 25});
    this.emitir('download-progress', {percent: 100});
    return ['instalador.exe'];
  };
  quitAndInstall(silencioso?: boolean, reabrir?: boolean) {
    this.instalou.push([silencioso, reabrir]);
  }
}

describe('motor do Windows (NsisUpdater falso)', () => {
  it('escreve o app-update.yml em userData e configura o updater', () => {
    const u = new NsisFalso();
    motorWindows({updater: u, pastaDados: tmp, aceitarTestes: false, registrar: () => undefined});
    const arquivo = path.join(tmp, 'atualizacao', 'app-update.yml');
    expect(u.updateConfigPath).toBe(arquivo);
    expect(readFileSync(arquivo, 'utf-8')).toBe(yamlDoAtualizador());
    expect(u).toMatchObject({autoDownload: false, autoInstallOnAppQuit: true, autoRunAppAfterInstall: true, allowPrerelease: false, allowDowngrade: false});
    expect(u.ouvintes.get('error')?.size).toBe(1); // sem ouvinte, o "error" derrubaria o processo principal
    motorWindows({updater: u, pastaDados: tmp, aceitarTestes: true, registrar: () => undefined});
    expect(u.allowPrerelease).toBe(true);
  });

  it('erros e avisos do updater vão para o registro', () => {
    const registrar = vi.fn();
    const u = new NsisFalso();
    motorWindows({updater: u, pastaDados: tmp, aceitarTestes: false, registrar});
    u.emitir('error', new Error('net::ERR_NAME_NOT_RESOLVED'));
    (u.logger as {warn: (m: string) => void}).warn('cuidado');
    expect(registrar.mock.calls.map((c) => c[0])).toEqual(['atualização: net::ERR_NAME_NOT_RESOLVED', 'atualização: cuidado']);
  });

  it('procurar: em dia é null; versão nova traz título e notas', async () => {
    const u = new NsisFalso();
    const w = motorWindows({updater: u, pastaDados: tmp, aceitarTestes: false, registrar: () => undefined});
    expect(await w.procurar()).toBeNull();
    u.resultado = {isUpdateAvailable: false, updateInfo: {version: '2.0.0'}};
    expect(await w.procurar()).toBeNull();
    u.resultado = {isUpdateAvailable: true, updateInfo: {version: '2.0.1', releaseName: 'Estúdio V4 (2.0.1)', releaseNotes: '<p>novo</p>'}};
    expect(await w.procurar()).toEqual({versao: '2.0.1', titulo: 'Estúdio V4 (2.0.1)', notas: '<p>novo</p>'});
  });

  it('baixar repassa o progresso e solta o ouvinte; instalar é silencioso e reabre', async () => {
    const u = new NsisFalso();
    const w = motorWindows({updater: u, pastaDados: tmp, aceitarTestes: false, registrar: () => undefined});
    const progresso: number[] = [];
    await w.baixar((p) => progresso.push(p));
    expect(progresso).toEqual([0.25, 1]);
    expect(u.ouvintes.get('download-progress')?.size).toBe(0);
    u.downloadUpdate = async () => Promise.reject(new Error('sha512 checksum mismatch'));
    await expect(w.baixar(() => undefined)).rejects.toThrow('sha512');
    expect(u.ouvintes.get('download-progress')?.size).toBe(0);
    w.instalarAgora();
    expect(u.instalou).toEqual([[true, true]]);
  });
});

// ---------- Windows: NsisUpdater de verdade, sem rede ----------

const FEED = (tags: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">${tags.map((t) => `
  <entry>
    <id>tag:github.com,2008:Repository/1/${t}</id>
    <updated>2026-11-12T10:00:00Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/BKM-Advogados/BKM-EDITOR/releases/tag/${t}"/>
    <title>Estúdio ${t}</title>
    <content type="html">&lt;h2&gt;Novidades da ${t}&lt;/h2&gt;</content>
  </entry>`).join('')}
</feed>`;
// o formato do latest.yml que o electron-builder 26 gera para o NSIS (conferido gerando o instalador no Linux)
const LATEST = (v: string) => `version: ${v}
files:
  - url: Estudio-Setup-${v}.exe
    sha512: kFBO4tXSCo1KgaSnPmqnQmVTdgJTQRZqcq8AkebhwhFIThXU+TSfITAGv/2f7tJBB1lJgi1x8zVmXnaIr6DSkw==
    size: 242708489
path: Estudio-Setup-${v}.exe
sha512: kFBO4tXSCo1KgaSnPmqnQmVTdgJTQRZqcq8AkebhwhFIThXU+TSfITAGv/2f7tJBB1lJgi1x8zVmXnaIr6DSkw==
releaseDate: '2026-11-12T10:00:00.000Z'
`;

/** O NsisUpdater do electron-updater com um app de mentira (não carrega o Electron) e as respostas do GitHub na mão. */
const nsisDeVerdade = (o: {versaoApp: string; feed: string[]; ultima: string; ymls: Record<string, string>}) => {
  const app = {version: o.versaoApp, name: 'Estudio', isPackaged: true, appUpdateConfigPath: path.join(tmp, 'resources', 'app-update.yml'), userDataPath: tmp,
    baseCachePath: tmp, whenReady: async () => undefined, relaunch: () => undefined, quit: () => undefined, onQuit: () => undefined};
  const pedidos: string[] = [];
  const executor = {
    request: async (r: {protocol: string; hostname: string; path: string}) => {
      const url = `${r.protocol}//${r.hostname}${r.path}`;
      pedidos.push(url);
      const base = 'https://github.com/BKM-Advogados/BKM-EDITOR/releases';
      if (url === `${base}.atom`) return FEED(o.feed);
      if (url === `${base}/latest`) return JSON.stringify({tag_name: o.ultima});
      const m = /\/download\/([^/]+)\/([^/]+)$/.exec(url);
      if (m && o.ymls[`${m[1]}/${m[2]}`]) return o.ymls[`${m[1]}/${m[2]}`];
      throw new Error(`404 ${url}`);
    },
  };
  const u = new NsisUpdater(undefined, app as never);
  // o canal (latest.yml, latest-linux.yml, latest-mac.yml) segue o sistema; aqui, sempre o do Windows
  Object.assign(u as unknown as object, {httpExecutor: executor, _testOnlyOptions: {platform: 'win32'}});
  return {u, pedidos};
};

describe('motor do Windows (NsisUpdater de verdade)', () => {
  it('a tag v4.0.1 com o latest.yml da 2.0.1 chega a quem tem a 2.0.0', async () => {
    const {u, pedidos} = nsisDeVerdade({versaoApp: '2.0.0', feed: ['v4.0.1', 'v4.0.0'], ultima: 'v4.0.1', ymls: {'v4.0.1/latest.yml': LATEST('2.0.1')}});
    const w = motorWindows({updater: u as unknown as UpdaterNsis, pastaDados: tmp, aceitarTestes: false, registrar: () => undefined});
    expect(await w.procurar()).toEqual({versao: '2.0.1', titulo: 'Estúdio v4.0.1', notas: '<h2>Novidades da v4.0.1</h2>'});
    // leu o app-update.yml escrito em userData, não o de resources/ (que o --prepackaged não grava)
    expect(pedidos).toEqual(['https://github.com/BKM-Advogados/BKM-EDITOR/releases.atom', 'https://github.com/BKM-Advogados/BKM-EDITOR/releases/latest',
      'https://github.com/BKM-Advogados/BKM-EDITOR/releases/download/v4.0.1/latest.yml']);
    expect(existsSync(path.join(tmp, 'resources', 'app-update.yml'))).toBe(false);
  });

  it('quem já tem a 2.0.1 está em dia, mesmo com a tag 4.0.1', async () => {
    const {u} = nsisDeVerdade({versaoApp: '2.0.1', feed: ['v4.0.1'], ultima: 'v4.0.1', ymls: {'v4.0.1/latest.yml': LATEST('2.0.1')}});
    const w = motorWindows({updater: u as unknown as UpdaterNsis, pastaDados: tmp, aceitarTestes: false, registrar: () => undefined});
    expect(await w.procurar()).toBeNull();
  });

  it('sem o modo de teste, a pre-release mais recente não conta (vale a "latest" do GitHub)', async () => {
    const {u, pedidos} = nsisDeVerdade({versaoApp: '2.0.1', feed: ['v4.0.2-teste.1', 'v4.0.1'], ultima: 'v4.0.1',
      ymls: {'v4.0.1/latest.yml': LATEST('2.0.1'), 'v4.0.2-teste.1/latest.yml': LATEST('2.0.2-teste.1')}});
    const w = motorWindows({updater: u as unknown as UpdaterNsis, pastaDados: tmp, aceitarTestes: false, registrar: () => undefined});
    expect(await w.procurar()).toBeNull();
    expect(pedidos.some((p) => p.includes('teste'))).toBe(false);
  });

  it('no modo de teste, a pre-release chega pelo latest.yml dela (sem teste.yml)', async () => {
    const {u, pedidos} = nsisDeVerdade({versaoApp: '2.0.1', feed: ['v4.0.2-teste.1', 'v4.0.1'], ultima: 'v4.0.1',
      ymls: {'v4.0.2-teste.1/latest.yml': LATEST('2.0.2-teste.1')}});
    const w = motorWindows({updater: u as unknown as UpdaterNsis, pastaDados: tmp, aceitarTestes: true, registrar: () => undefined});
    expect(await w.procurar()).toMatchObject({versao: '2.0.2-teste.1'});
    expect(pedidos.slice(-2)).toEqual(['https://github.com/BKM-Advogados/BKM-EDITOR/releases/download/v4.0.2-teste.1/teste.yml',
      'https://github.com/BKM-Advogados/BKM-EDITOR/releases/download/v4.0.2-teste.1/latest.yml']);
  });

  it('release sem latest.yml é erro (o atualizador trata como procura que falhou)', async () => {
    const registrar = vi.fn();
    const {u} = nsisDeVerdade({versaoApp: '2.0.0', feed: ['v4.0.1'], ultima: 'v4.0.1', ymls: {}});
    const w = motorWindows({updater: u as unknown as UpdaterNsis, pastaDados: tmp, aceitarTestes: false, registrar});
    await expect(w.procurar()).rejects.toThrow(/latest\.yml/);
    expect(registrar).toHaveBeenCalled();
  });
});

// ---------- Linux ----------

const BASE = 'https://github.com/BKM-Advogados/BKM-EDITOR/releases/download/v4.0.1';
const ZIP = 'Estudio-linux-x64-2.0.1.zip';
const novidadeLinux = (assets?: AssetGitHub[]): Novidade => {
  const r: ReleaseGitHub = {tag_name: 'v4.0.1', assets: assets ?? [{name: ZIP, browser_download_url: `${BASE}/${ZIP}`, size: 26},
    {name: 'SHA256SUMS.txt', browser_download_url: `${BASE}/SHA256SUMS.txt`}]};
  const d = decidir(r, {plataforma: 'linux', arch: 'x64', versaoAtual: '2.0.0'});
  if (d.tipo !== 'nova') throw new Error(d.tipo);
  return d.novidade;
};
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

/** Uma pasta de app como o zip do Forge traz (Estudio-linux-x64/Estudio e resources/). */
const criarApp = (pasta: string, conteudo: string, executavel = true) => {
  mkdirSync(path.join(pasta, 'resources'), {recursive: true});
  writeFileSync(path.join(pasta, 'Estudio'), conteudo);
  writeFileSync(path.join(pasta, 'resources', 'app.asar'), conteudo);
  if (process.platform !== 'win32') chmodSync(path.join(pasta, 'Estudio'), executavel ? 0o755 : 0o644);
};

describe('motor do Linux (instalado pelo script)', () => {
  const zip = Buffer.from('zip de mentira da 2.0.1 ' + 'x'.repeat(64));
  let destino: string;
  let pedidos: string[];
  let somas: string;
  let extrair: ReturnType<typeof vi.fn<Extrair>>;
  const buscar: BuscarArquivo = async (url) => {
    pedidos.push(url);
    if (url === `${BASE}/SHA256SUMS.txt`) return new Response(somas);
    if (url === `${BASE}/${ZIP}`) return new Response(zip, {headers: {'content-length': String(zip.length)}});
    return new Response('não achou', {status: 404});
  };

  beforeEach(() => {
    destino = path.join(tmp, 'opt', 'Estudio');
    criarApp(destino, 'versão velha');
    pedidos = [];
    somas = `${'0'.repeat(64)}  Estudio-Setup-2.0.1.exe\n${sha256(zip)}  ${ZIP}\n`;
    // o zip de verdade passa pelo unzip; aqui, o "extrair" confere o arquivo baixado e monta a pasta do Forge
    extrair = vi.fn<Extrair>(async (arquivo, pasta) => {
      expect(readFileSync(arquivo)).toEqual(zip);
      criarApp(path.join(pasta, 'Estudio-linux-x64'), 'versão nova');
    });
  });

  it('baixa, confere o SHA-256, prepara ao lado, troca e reabre pelo executável novo', async () => {
    const reabrir = vi.fn();
    const m = motorLinux({destino, buscar, extrair, reabrir});
    const progresso: number[] = [];
    await m.preparar(novidadeLinux(), (p) => progresso.push(p));
    const {novo, baixando, antigo} = pastasDaTroca(destino);
    expect(pedidos).toEqual([`${BASE}/SHA256SUMS.txt`, `${BASE}/${ZIP}`]);
    expect(readFileSync(path.join(novo, 'Estudio'), 'utf-8')).toBe('versão nova');
    expect(existsSync(baixando)).toBe(false);
    expect(readFileSync(path.join(destino, 'Estudio'), 'utf-8')).toBe('versão velha'); // nada trocado antes do reinício
    expect(progresso.at(-1)).toBe(1);
    expect(progresso.every((p, i) => p >= 0 && p <= 1 && (i === 0 || p >= progresso[i - 1]))).toBe(true);

    await m.trocarEReabrir();
    expect(readFileSync(path.join(destino, 'Estudio'), 'utf-8')).toBe('versão nova');
    expect(readFileSync(path.join(antigo, 'Estudio'), 'utf-8')).toBe('versão velha');
    expect(existsSync(novo)).toBe(false);
    expect(reabrir).toHaveBeenCalledWith(path.join(destino, 'Estudio'));

    await limparSobras(destino); // na abertura seguinte
    expect(existsSync(antigo)).toBe(false);
    expect(readFileSync(path.join(destino, 'Estudio'), 'utf-8')).toBe('versão nova');
  });

  it('SHA-256 errado recusa, não extrai e não deixa nada no disco', async () => {
    somas = `${sha256('outro zip')}  ${ZIP}\n`;
    const m = motorLinux({destino, buscar, extrair, reabrir: () => undefined});
    await expect(m.preparar(novidadeLinux(), () => undefined)).rejects.toThrow(/SHA-256 do zip não confere/);
    const {novo, baixando} = pastasDaTroca(destino);
    expect(extrair).not.toHaveBeenCalled();
    expect(existsSync(baixando)).toBe(false);
    expect(existsSync(novo)).toBe(false);
    expect(readFileSync(path.join(destino, 'Estudio'), 'utf-8')).toBe('versão velha');
  });

  it('SHA256SUMS.txt sem o zip, ou que não baixa, recusa antes de baixar o zip', async () => {
    somas = `${sha256(zip)}  Estudio-2.0.1-arm64.dmg\n`;
    const m = motorLinux({destino, buscar, extrair, reabrir: () => undefined});
    await expect(m.preparar(novidadeLinux(), () => undefined)).rejects.toThrow(`o SHA256SUMS.txt não traz ${ZIP}`);
    const sem = motorLinux({destino, buscar: async () => new Response('', {status: 503}), extrair, reabrir: () => undefined});
    await expect(sem.preparar(novidadeLinux(), () => undefined)).rejects.toThrow('o SHA256SUMS.txt não baixou (503)');
    expect(pedidos).toEqual([`${BASE}/SHA256SUMS.txt`]);
  });

  it('endereço fora do repositório ou release sem SHA256SUMS.txt não baixa nada', async () => {
    const m = motorLinux({destino, buscar, extrair, reabrir: () => undefined});
    const fora = {...novidadeLinux(), arquivo: {nome: ZIP, url: `https://exemplo.invalid/${ZIP}`, versao: '2.0.1'}};
    await expect(m.preparar(fora, () => undefined)).rejects.toThrow('a release não tem o zip do Linux');
    const semSomas = novidadeLinux([{name: ZIP, browser_download_url: `${BASE}/${ZIP}`}]);
    await expect(m.preparar(semSomas, () => undefined)).rejects.toThrow('a release não tem o SHA256SUMS.txt');
    expect(pedidos).toEqual([]);
  });

  it('zip sem o app recusa e limpa o download', async () => {
    extrair.mockImplementation(async (_zip, pasta) => void writeFileSync(path.join(pasta, 'LEIA.txt'), 'nada aqui'));
    const m = motorLinux({destino, buscar, extrair, reabrir: () => undefined});
    await expect(m.preparar(novidadeLinux(), () => undefined)).rejects.toThrow('o zip não tem o Estudio e a pasta resources');
    expect(existsSync(pastasDaTroca(destino).baixando)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('executável sem permissão de execução recusa', async () => {
    extrair.mockImplementation(async (_zip, pasta) => criarApp(path.join(pasta, 'Estudio-linux-x64'), 'versão nova', false));
    const m = motorLinux({destino, buscar, extrair, reabrir: () => undefined});
    await expect(m.preparar(novidadeLinux(), () => undefined)).rejects.toThrow('sem permissão de execução');
  });

  it('a troca sem versão preparada não mexe na instalada', () => {
    expect(() => trocarPastas(destino)).toThrow('a versão nova não está pronta');
    expect(readFileSync(path.join(destino, 'Estudio'), 'utf-8')).toBe('versão velha');
  });

  it('a limpeza da abertura leva a pasta antiga, o download pela metade e a versão preparada sem troca', async () => {
    const {novo, baixando, antigo} = pastasDaTroca(destino);
    for (const p of [novo, baixando, antigo]) criarApp(p, 'sobra');
    await limparSobras(destino);
    for (const p of [novo, baixando, antigo]) expect(existsSync(p), p).toBe(false);
    expect(readFileSync(path.join(destino, 'Estudio'), 'utf-8')).toBe('versão velha');
    await limparSobras(path.join(tmp, 'nao-existe')); // sem nada para limpar, não lança
  });

  it('acha a pasta do app na raiz do zip ou um nível abaixo', () => {
    const solto = path.join(tmp, 'solto');
    criarApp(solto, 'x');
    expect(acharPastaDoApp(solto)).toBe(solto);
    const dentro = path.join(tmp, 'dentro');
    criarApp(path.join(dentro, 'Estudio-linux-x64'), 'x');
    expect(acharPastaDoApp(dentro)).toBe(path.join(dentro, 'Estudio-linux-x64'));
    mkdirSync(path.join(tmp, 'vazio'));
    expect(acharPastaDoApp(path.join(tmp, 'vazio'))).toBeNull();
  });
});
