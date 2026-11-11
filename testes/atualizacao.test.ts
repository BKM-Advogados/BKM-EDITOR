// Atualização do Estúdio (docs/atualizacao.md): a decisão (src/nucleo/atualizacao.ts) e o atualizador com relógio falso
// (src/main/atualizacao.ts). Os motores do Windows e do Linux estão em atualizacao-motores.test.ts.
import {describe, expect, it, vi} from 'vitest';
import {archDoSistema, ATRASO_INICIAL_MS, type AssetGitHub, compararVersoes, decidir, ehVersaoDeTeste, escolherArquivo, escreverSomas,
  instaladoPeloScript, INTERVALO_MS, lerSomas, lerVersao, maisNova, nomeDoArquivo, PAGINA_RELEASES, pastaDoScriptLinux, procurar,
  type ReleaseGitHub, URL_RELEASES, URL_ULTIMA_RELEASE, urlPermitida, versaoDaRelease, type Buscar, type Novidade} from '../src/nucleo/atualizacao';
import {criarAtualizador, type DepsAtualizador, modoDe, type MotorLinux, type MotorWindows, type Relogio, textoDasNotas} from '../src/main/atualizacao';
import type {EstadoAtualizacao} from '../src/compartilhado/atualizacao';

const BASE = 'https://github.com/BKM-Advogados/BKM-EDITOR/releases/download';
const asset = (tag: string, name: string, size = 1000): AssetGitHub => ({name, browser_download_url: `${BASE}/${tag}/${name}`, size});
/** Os arquivos de uma release como a v4.0.0 (nomes reais de `gh release view v4.0.0`), com a versão do pacote trocada. */
const arquivosDe = (tag: string, v: string): AssetGitHub[] => [
  asset(tag, `Estudio-${v}-arm64.dmg`), asset(tag, `Estudio-${v}-x64.dmg`), asset(tag, `Estudio-linux-x64-${v}.zip`),
  asset(tag, `Estudio-Setup-${v}.exe`), asset(tag, `Estudio-Setup-${v}.exe.blockmap`), asset(tag, 'latest.yml'), asset(tag, 'SHA256SUMS.txt', 362),
];
const release = (tag: string, v: string, extra: Partial<ReleaseGitHub> = {}): ReleaseGitHub => ({tag_name: tag, name: `Estúdio (${v})`,
  body: '## Novidades\n\n- uma coisa', draft: false, prerelease: false, html_url: `https://github.com/BKM-Advogados/BKM-EDITOR/releases/tag/${tag}`,
  published_at: '2026-11-11T13:30:52Z', assets: arquivosDe(tag, v), ...extra});

// ---------- versões ----------

describe('versões', () => {
  it('lê o semver com e sem v, prévia e build; recusa o resto', () => {
    expect(lerVersao('2.0.1')).toEqual({numeros: [2, 0, 1], previa: []});
    expect(lerVersao('v4.0.1')).toEqual({numeros: [4, 0, 1], previa: []});
    expect(lerVersao('2.0.2-teste.1')).toEqual({numeros: [2, 0, 2], previa: ['teste', 1]});
    expect(lerVersao('2.0.1+abc')).toEqual({numeros: [2, 0, 1], previa: []});
    for (const ruim of ['4', '4.0', '2.0.01', '2.0.1-', '2.0.1-a..b', 'versão 2', '']) expect(lerVersao(ruim), ruim).toBeNull();
  });

  it('compara como o semver: números, prévia antes da final, número antes de texto', () => {
    const ordem = ['1.9.9', '2.0.0', '2.0.1-rc.1', '2.0.1-teste.1', '2.0.1-teste.2', '2.0.1-teste.10', '2.0.1', '2.0.2', '2.10.0', '4.0.0'];
    for (let i = 0; i < ordem.length - 1; i++) {
      expect(compararVersoes(ordem[i], ordem[i + 1]), `${ordem[i]} < ${ordem[i + 1]}`).toBeLessThan(0);
      expect(compararVersoes(ordem[i + 1], ordem[i]), `${ordem[i + 1]} > ${ordem[i]}`).toBeGreaterThan(0);
    }
    expect(compararVersoes('v2.0.1', '2.0.1')).toBe(0);
    expect(compararVersoes('2.0.1-1', '2.0.1-a')).toBeLessThan(0);
    expect(compararVersoes('2.0.1-a', '2.0.1-a.1')).toBeLessThan(0);
    expect(() => compararVersoes('2.0', '2.0.1')).toThrow(/inválida/);
  });

  it('versão de teste é a que tem hífen, na tag ou no pacote', () => {
    expect(ehVersaoDeTeste('v4.0.2-teste.1')).toBe(true);
    expect(ehVersaoDeTeste('2.0.2-rc.1')).toBe(true);
    expect(ehVersaoDeTeste('v4.0.2')).toBe(false);
    expect(ehVersaoDeTeste('2.0.2')).toBe(false);
  });
});

// ---------- arquivos ----------

describe('arquivos da release', () => {
  const v4 = arquivosDe('v4.0.0', '2.0.0');

  it('os nomes que o app procura são os da release v4.0.0', () => {
    const nomes = new Set(v4.map((a) => a.name));
    for (const [p, a] of [['win32', 'x64'], ['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'x64']]) expect(nomes.has(nomeDoArquivo(p, a, '2.0.0')!), `${p} ${a}`).toBe(true);
    expect(nomeDoArquivo('linux', 'arm64', '2.0.0')).toBeNull();
    expect(nomeDoArquivo('freebsd', 'x64', '2.0.0')).toBeNull();
  });

  it('escolhe o arquivo do sistema e da arquitetura', () => {
    expect(escolherArquivo(v4, 'win32', 'x64')?.nome).toBe('Estudio-Setup-2.0.0.exe');
    expect(escolherArquivo(v4, 'win32', 'arm64')?.nome).toBe('Estudio-Setup-2.0.0.exe'); // o Windows ARM roda o x64
    expect(escolherArquivo(v4, 'darwin', 'arm64')).toEqual({nome: 'Estudio-2.0.0-arm64.dmg', url: `${BASE}/v4.0.0/Estudio-2.0.0-arm64.dmg`, tamanho: 1000,
      versao: '2.0.0'});
    expect(escolherArquivo(v4, 'darwin', 'x64')?.nome).toBe('Estudio-2.0.0-x64.dmg');
    expect(escolherArquivo(v4, 'linux', 'x64')?.nome).toBe('Estudio-linux-x64-2.0.0.zip');
    expect(escolherArquivo(v4, 'linux', 'arm64')).toBeNull();
    expect(escolherArquivo(v4.filter((a) => !a.name.endsWith('.dmg')), 'darwin', 'arm64')).toBeNull();
    // o .blockmap e o latest.yml não passam por instalador
    expect(escolherArquivo([asset('v4.0.0', 'Estudio-Setup-2.0.0.exe.blockmap')], 'win32', 'x64')).toBeNull();
  });

  it('ignora arquivo com endereço fora do repositório', () => {
    const fora = [{name: 'Estudio-linux-x64-2.0.1.zip', browser_download_url: 'https://exemplo.invalid/Estudio-linux-x64-2.0.1.zip'}];
    expect(escolherArquivo(fora, 'linux', 'x64')).toBeNull();
  });

  it('a versão da release sai do nome dos arquivos, não da tag', () => {
    expect(versaoDaRelease(arquivosDe('v4.0.1', '2.0.1'))).toBe('2.0.1');
    expect(versaoDaRelease([asset('v4.0.1', 'SHA256SUMS.txt'), asset('v4.0.1', 'notas.md')])).toBeNull();
  });

  it('Mac x64 no Rosetta recebe o DMG arm64', () => {
    expect(archDoSistema('darwin', 'x64', true)).toBe('arm64');
    expect(archDoSistema('darwin', 'x64', false)).toBe('x64');
    expect(archDoSistema('win32', 'x64', true)).toBe('x64');
  });
});

// ---------- endereços ----------

describe('urlPermitida', () => {
  it('só https no github.com, deste repositório', () => {
    expect(urlPermitida(`${BASE}/v4.0.0/Estudio-2.0.0-arm64.dmg`)).toBe(true);
    expect(urlPermitida('https://github.com/BKM-Advogados/BKM-EDITOR/releases')).toBe(true);
    expect(urlPermitida('https://github.com/bkm-advogados/bkm-editor/releases/tag/v4.0.0')).toBe(true);
    for (const ruim of [
      'http://github.com/BKM-Advogados/BKM-EDITOR/releases',
      'https://github.com.exemplo.invalid/BKM-Advogados/BKM-EDITOR/releases',
      'https://github.com@exemplo.invalid/BKM-Advogados/BKM-EDITOR/releases',
      'https://alguem@github.com/BKM-Advogados/BKM-EDITOR/releases',
      'https://github.com:8443/BKM-Advogados/BKM-EDITOR/releases',
      'https://api.github.com/repos/BKM-Advogados/BKM-EDITOR/releases/latest',
      'https://objects.githubusercontent.com/BKM-Advogados/BKM-EDITOR/x',
      'https://github.com/outro/BKM-EDITOR/releases',
      'https://github.com/BKM-Advogados/outro/releases',
      'https://github.com/BKM-Advogados',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'não é endereço',
    ]) expect(urlPermitida(ruim), ruim).toBe(false);
  });
});

// ---------- SHA256SUMS.txt ----------

describe('SHA256SUMS.txt', () => {
  const a = 'a285f390571f52736df7513735e170ba80baf57a89ea65a68a80a340677978f0';
  const b = 'BA29B9FDE68A23027EE84839CB82DA1F428290DD8E267A6A104342009FA64920';

  it('lê as linhas do sha256sum (texto e binário, CRLF) e ignora o resto', () => {
    const somas = lerSomas(`${a}  Estudio-2.0.0-arm64.dmg\r\n${b} *Estudio-linux-x64-2.0.0.zip\n\nlixo\nabc  curto.zip\n`);
    expect([...somas]).toEqual([['Estudio-2.0.0-arm64.dmg', a], ['Estudio-linux-x64-2.0.0.zip', b.toLowerCase()]]);
  });

  it('escreve em ordem de nome, minúsculo, e volta igual', () => {
    const texto = escreverSomas([['Estudio-linux-x64-2.0.0.zip', b], ['Estudio-2.0.0-arm64.dmg', a]]);
    expect(texto).toBe(`${a}  Estudio-2.0.0-arm64.dmg\n${b.toLowerCase()}  Estudio-linux-x64-2.0.0.zip\n`);
    expect(lerSomas(texto).get('Estudio-linux-x64-2.0.0.zip')).toBe(b.toLowerCase());
  });
});

// ---------- decisão ----------

describe('decidir', () => {
  const mac = {plataforma: 'darwin', arch: 'arm64'};

  it('tag v4.x e pacote 2.x: compara a versão do pacote', () => {
    const r = release('v4.0.1', '2.0.1');
    const d = decidir(r, {...mac, versaoAtual: '2.0.0'});
    expect(d.tipo).toBe('nova');
    if (d.tipo !== 'nova') return;
    expect(d.novidade).toMatchObject({versao: '2.0.1', tag: 'v4.0.1', titulo: 'Estúdio (2.0.1)', pagina: r.html_url, somas: `${BASE}/v4.0.1/SHA256SUMS.txt`,
      publicada_em: '2026-11-11T13:30:52Z', arquivo: {nome: 'Estudio-2.0.1-arm64.dmg'}});
    // a tag 4.0.1 é maior que 2.0.1, mas não conta: quem já tem a 2.0.1 está em dia
    expect(decidir(r, {...mac, versaoAtual: '2.0.1'})).toEqual({tipo: 'em_dia', versao: '2.0.1'});
    expect(decidir(r, {...mac, versaoAtual: '2.0.2'}).tipo).toBe('em_dia');
  });

  it('rascunho e release sem arquivo conhecido ficam de fora', () => {
    expect(decidir(release('v4.0.1', '2.0.1', {draft: true}), {...mac, versaoAtual: '2.0.0'})).toEqual({tipo: 'ignorada', motivo: 'rascunho'});
    expect(decidir(release('v4.0.1', '2.0.1', {assets: [asset('v4.0.1', 'SHA256SUMS.txt')]}), {...mac, versaoAtual: '2.0.0'}))
      .toEqual({tipo: 'ignorada', motivo: 'sem_versao'});
  });

  it('versão de teste (pre-release, hífen na tag ou no pacote) só entra no modo de teste', () => {
    const casos = [release('v4.0.2', '2.0.2', {prerelease: true}), release('v4.0.2-teste.1', '2.0.2'), release('v4.0.2', '2.0.2-teste.1')];
    for (const r of casos) {
      expect(decidir(r, {...mac, versaoAtual: '2.0.1'})).toMatchObject({tipo: 'ignorada', motivo: 'teste'});
      expect(decidir(r, {...mac, versaoAtual: '2.0.1', aceitarTestes: true}).tipo).toBe('nova');
    }
    // a 2.0.2-teste.1 é anterior à 2.0.2: quem já tem a final não "volta" para o teste
    expect(decidir(release('v4.0.2-teste.1', '2.0.2-teste.1'), {...mac, versaoAtual: '2.0.2', aceitarTestes: true}).tipo).toBe('em_dia');
  });

  it('a versão pulada não avisa, mas uma mais nova sim', () => {
    expect(decidir(release('v4.0.1', '2.0.1'), {...mac, versaoAtual: '2.0.0', pulada: '2.0.1'})).toEqual({tipo: 'ignorada', motivo: 'pulada', versao: '2.0.1'});
    expect(decidir(release('v4.0.2', '2.0.2'), {...mac, versaoAtual: '2.0.0', pulada: '2.0.1'}).tipo).toBe('nova');
  });

  it('sem o arquivo deste sistema, o aviso leva à página da release', () => {
    const d = decidir(release('v4.0.1', '2.0.1'), {plataforma: 'linux', arch: 'arm64', versaoAtual: '2.0.0'});
    expect(d).toMatchObject({tipo: 'nova', novidade: {versao: '2.0.1', arquivo: null}});
  });

  it('página fora do repositório vira a página das releases; notas longas são cortadas', () => {
    const d = decidir(release('v4.0.1', '2.0.1', {html_url: 'https://exemplo.invalid/x', body: 'x'.repeat(5000), name: '  '}), {...mac, versaoAtual: '2.0.0'});
    if (d.tipo !== 'nova') throw new Error(d.tipo);
    expect(d.novidade.pagina).toBe(PAGINA_RELEASES);
    expect(d.novidade.notas).toHaveLength(4001);
    expect(d.novidade.titulo).toBe('Estúdio 2.0.1');
  });

  it('modo de teste: das últimas releases, a de versão mais alta (rascunho fora)', () => {
    const lista = [release('v4.0.1', '2.0.1'), release('v4.0.3-teste.1', '2.0.3-teste.1', {prerelease: true}), release('v4.0.9', '2.0.9', {draft: true}),
      release('v4.0.2', '2.0.2'), {tag_name: 'v0', assets: []}];
    expect(maisNova(lista)?.tag_name).toBe('v4.0.3-teste.1');
    expect(maisNova([])).toBeNull();
  });
});

// ---------- procura no GitHub ----------

const resposta = (status: number, corpo: unknown) => ({ok: status >= 200 && status < 300, status, json: async () => corpo});

describe('procurar', () => {
  it('pede a última release com o User-Agent do app e nada da pessoa', async () => {
    const buscar = vi.fn<Buscar>(async () => resposta(200, release('v4.0.1', '2.0.1')));
    const r = await procurar(buscar, {versaoAtual: '2.0.0', versaoApp: '2.0.0', plataforma: 'linux', arch: 'x64'});
    expect(r).toMatchObject({tipo: 'nova', novidade: {versao: '2.0.1', arquivo: {nome: 'Estudio-linux-x64-2.0.1.zip'}}});
    const [url, init] = buscar.mock.calls[0];
    expect(url).toBe(URL_ULTIMA_RELEASE);
    expect(init?.headers).toEqual({Accept: 'application/vnd.github+json', 'User-Agent': 'Estudio/2.0.0', 'X-GitHub-Api-Version': '2022-11-28'});
  });

  it('sem release (404) está em dia; erro do GitHub e falta de rede viram "falhou" sem lançar', async () => {
    const o = {versaoAtual: '2.0.0', versaoApp: '2.0.0', plataforma: 'linux', arch: 'x64'};
    expect(await procurar(async () => resposta(404, {}), o)).toEqual({tipo: 'em_dia'});
    expect(await procurar(async () => resposta(403, {}), o)).toEqual({tipo: 'falhou', detalhe: 'GitHub respondeu 403'});
    expect(await procurar(async () => Promise.reject(new Error('getaddrinfo ENOTFOUND api.github.com')), o))
      .toEqual({tipo: 'falhou', detalhe: 'getaddrinfo ENOTFOUND api.github.com'});
    expect(await procurar(async () => resposta(200, 'html de erro'), o)).toEqual({tipo: 'em_dia'});
  });

  it('o modo de teste lê a lista e pega a mais nova', async () => {
    const buscar = vi.fn<Buscar>(async () => resposta(200, [release('v4.0.1', '2.0.1'), release('v4.0.2-teste.1', '2.0.2-teste.1', {prerelease: true})]));
    const r = await procurar(buscar, {versaoAtual: '2.0.1', versaoApp: '2.0.1', plataforma: 'win32', arch: 'x64', aceitarTestes: true});
    expect(buscar.mock.calls[0][0]).toBe(URL_RELEASES);
    expect(r).toMatchObject({tipo: 'nova', novidade: {versao: '2.0.2-teste.1', arquivo: {nome: 'Estudio-Setup-2.0.2-teste.1.exe'}}});
  });
});

// ---------- Linux instalado pelo script ----------

describe('Linux do scripts/instalar-linux.sh', () => {
  it('reconhece o executável em ~/.local/opt/Estudio (caminho do Linux)', () => {
    expect(pastaDoScriptLinux('/home/fulano')).toBe('/home/fulano/.local/opt/Estudio');
    expect(instaladoPeloScript('linux', '/home/fulano/.local/opt/Estudio/Estudio', '/home/fulano')).toBe(true);
    expect(instaladoPeloScript('linux', '/home/fulano/.local/opt/Estudio/./Estudio', '/home/fulano')).toBe(true);
    expect(instaladoPeloScript('linux', '/home/fulano/Downloads/Estudio-linux-x64/Estudio', '/home/fulano')).toBe(false);
    expect(instaladoPeloScript('darwin', '/home/fulano/.local/opt/Estudio/Estudio', '/home/fulano')).toBe(false);
  });
});

// ---------- atualizador ----------

/** Relógio de mentira: os timers só correm em avancar(), e as promessas assentam entre um e outro. */
const relogioFalso = () => {
  let agora = Date.parse('2026-11-11T12:00:00Z');
  let seq = 0;
  let timers: {id: number; quando: number; f: () => void}[] = [];
  const r: Relogio & {avancar: (ms: number) => Promise<void>; pendentes: () => number[]} = {
    setTimeout: (f, ms) => {
      timers.push({id: ++seq, quando: agora + ms, f});
      return seq;
    },
    clearTimeout: (id) => void (timers = timers.filter((t) => t.id !== id)),
    agora: () => agora,
    pendentes: () => timers.map((t) => t.quando - agora),
    async avancar(ms) {
      const fim = agora + ms;
      for (;;) {
        await assentar();
        timers.sort((a, b) => a.quando - b.quando);
        const t = timers[0];
        if (!t || t.quando > fim) break;
        timers.shift();
        agora = t.quando;
        t.f();
      }
      agora = fim;
      await assentar();
    },
  };
  return r;
};
const assentar = async () => {
  for (let i = 0; i < 5; i++) await new Promise((ok) => setImmediate(ok));
};

type Montagem = {deps: DepsAtualizador; relogio: ReturnType<typeof relogioFalso>; telas: EstadoAtualizacao[]; prefs: {procurar_atualizacoes?: boolean; versao_pulada?: string};
  buscar: ReturnType<typeof vi.fn<Buscar>>; abertos: string[]; ocupado: {principal: string | null}; ordem: string[]};

const montar = (o: Partial<DepsAtualizador> & {releases?: () => ReleaseGitHub | Promise<ReleaseGitHub>} = {}): Montagem => {
  const relogio = relogioFalso();
  const telas: EstadoAtualizacao[] = [];
  const prefs: Montagem['prefs'] = {};
  const abertos: string[] = [];
  const ocupado = {principal: null as string | null};
  const ordem: string[] = [];
  const buscar = vi.fn<Buscar>(async () => resposta(200, await (o.releases ?? (() => release('v4.0.1', '2.0.1')))()));
  const deps: DepsAtualizador = {empacotado: true, plataforma: 'darwin', arch: 'arm64', versao: '2.0.0', home: '/home/fulano', executavel: '/Applications/Estudio.app',
    prefs: () => prefs, gravarPrefs: (p) => Object.assign(prefs, p), buscar, abrirNoNavegador: (u) => abertos.push(u), avisarTela: (e) => telas.push(e),
    ocupadoNoPrincipal: () => ocupado.principal, encerrar: async () => void ordem.push('encerrar'), relogio, ...o};
  return {deps, relogio, telas, prefs, buscar, abertos, ocupado, ordem};
};

describe('atualizador: quando procura', () => {
  it('procura 15 s depois de abrir e a cada 6 horas', async () => {
    const m = montar();
    const a = criarAtualizador(m.deps);
    a.iniciar();
    a.iniciar(); // a segunda chamada não agenda outra procura
    expect(m.relogio.pendentes()).toEqual([ATRASO_INICIAL_MS]);
    await m.relogio.avancar(ATRASO_INICIAL_MS - 1);
    expect(m.buscar).not.toHaveBeenCalled();
    await m.relogio.avancar(1);
    expect(m.buscar).toHaveBeenCalledTimes(1);
    expect(a.estado()).toMatchObject({fase: 'disponivel', novidade: {versao: '2.0.1'}, procurando: false, ultima_procura: '2026-11-11T12:00:15.000Z'});
    expect(m.relogio.pendentes()).toEqual([INTERVALO_MS]);
    await m.relogio.avancar(INTERVALO_MS - 1);
    expect(m.buscar).toHaveBeenCalledTimes(1);
    await m.relogio.avancar(1);
    expect(m.buscar).toHaveBeenCalledTimes(2);
    await m.relogio.avancar(INTERVALO_MS);
    expect(m.buscar).toHaveBeenCalledTimes(3);
    a.parar();
    expect(m.relogio.pendentes()).toEqual([]);
  });

  it('com a preferência desligada não procura sozinho, mas o "Procurar agora" procura', async () => {
    const m = montar();
    m.prefs.procurar_atualizacoes = false;
    const a = criarAtualizador(m.deps);
    a.iniciar();
    await m.relogio.avancar(ATRASO_INICIAL_MS + 2 * INTERVALO_MS);
    expect(m.buscar).not.toHaveBeenCalled();
    expect(a.estado().automatico).toBe(false);
    expect(m.relogio.pendentes()).toEqual([INTERVALO_MS]); // continua agendado: ligar a preferência volta a procurar
    const e = await a.procurarAgora();
    expect(m.buscar).toHaveBeenCalledTimes(1);
    expect(e).toMatchObject({fase: 'disponivel', mensagem: 'Há uma versão nova: 2.0.1.'});
    m.prefs.procurar_atualizacoes = true;
    await m.relogio.avancar(INTERVALO_MS);
    expect(m.buscar).toHaveBeenCalledTimes(2);
  });

  it('sem rede fica em silêncio; o "Procurar agora" diz o erro', async () => {
    const registrar = vi.fn();
    const m = montar({registrar, buscar: async () => Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED'))});
    const a = criarAtualizador(m.deps);
    a.iniciar();
    await m.relogio.avancar(ATRASO_INICIAL_MS);
    expect(a.estado()).toMatchObject({fase: 'nada', procurando: false});
    expect(a.estado().mensagem).toBeUndefined();
    expect(a.estado().erro).toBeUndefined();
    expect(registrar).toHaveBeenCalledWith(expect.stringContaining('ERR_INTERNET_DISCONNECTED'));
    expect(m.relogio.pendentes()).toEqual([INTERVALO_MS]); // tenta de novo daqui a 6 horas
    const e = await a.procurarAgora();
    expect(e.mensagem).toBe('Não deu para procurar agora: sem conexão, ou o GitHub não respondeu.');
  });

  it('em desenvolvimento não procura nada', async () => {
    const m = montar({empacotado: false});
    const a = criarAtualizador(m.deps);
    a.iniciar();
    expect(m.relogio.pendentes()).toEqual([]);
    expect(a.estado().modo).toBe('desligado');
    expect((await a.procurarAgora()).mensagem).toBe('Em desenvolvimento o Estúdio não procura atualizações.');
    expect(m.buscar).not.toHaveBeenCalled();
  });

  it('"Procurar agora" sem novidade diz que está em dia', async () => {
    const m = montar({versao: '2.0.1'});
    const a = criarAtualizador(m.deps);
    expect((await a.procurarAgora())).toMatchObject({fase: 'nada', mensagem: 'Você já está na versão mais nova (2.0.1).'});
  });
});

describe('atualizador: o aviso (Mac e Linux)', () => {
  it('"Baixar" abre o DMG certo; "Lembrar depois" esconde até a próxima procura', async () => {
    const m = montar();
    const a = criarAtualizador(m.deps);
    a.iniciar();
    await m.relogio.avancar(ATRASO_INICIAL_MS);
    await a.acao('baixar');
    expect(m.abertos).toEqual([`${BASE}/v4.0.1/Estudio-2.0.1-arm64.dmg`]);
    expect((await a.acao('depois')).adiada).toBe(true);
    expect((await a.acao('mostrar')).adiada).toBe(false);
    await a.acao('depois');
    await m.relogio.avancar(INTERVALO_MS);
    expect(a.estado()).toMatchObject({adiada: false, fase: 'disponivel'});
    expect(m.telas.at(-1)).toEqual(a.estado());
  });

  it('sem o arquivo do sistema, "Baixar" abre a página da release', async () => {
    const m = montar({plataforma: 'linux', arch: 'arm64', executavel: '/opt/Estudio/Estudio'});
    const a = criarAtualizador(m.deps);
    await a.procurarAgora();
    await a.acao('baixar');
    expect(m.abertos).toEqual(['https://github.com/BKM-Advogados/BKM-EDITOR/releases/tag/v4.0.1']);
  });

  it('"Pular esta versão" grava a preferência; a procura automática respeita, a manual mostra', async () => {
    const m = montar();
    const a = criarAtualizador(m.deps);
    a.iniciar();
    await m.relogio.avancar(ATRASO_INICIAL_MS);
    const e = await a.acao('pular');
    expect(m.prefs.versao_pulada).toBe('2.0.1');
    expect(e.fase).toBe('nada');
    expect(e.novidade).toBeUndefined();
    await m.relogio.avancar(INTERVALO_MS);
    expect(a.estado().fase).toBe('nada');
    expect((await a.procurarAgora()).fase).toBe('disponivel');
  });

  it('versão de teste fica de fora, a não ser no modo de teste', async () => {
    const teste = () => release('v4.0.2-teste.1', '2.0.2-teste.1', {prerelease: true});
    const m = montar({releases: teste});
    const a = criarAtualizador(m.deps);
    expect((await a.procurarAgora())).toMatchObject({fase: 'nada', mensagem: 'Você já está na versão mais nova (2.0.0).'});
    const t = montar({aceitarTestes: true, buscar: async () => resposta(200, [teste()])});
    expect((await criarAtualizador(t.deps).procurarAgora())).toMatchObject({fase: 'disponivel', novidade: {versao: '2.0.2-teste.1'}});
  });

  it('as ações que não cabem no Mac não fazem nada', async () => {
    const m = montar();
    const a = criarAtualizador(m.deps);
    await a.procurarAgora();
    for (const x of ['reiniciar', 'atualizar_linux', 'cancelar_reinicio'] as const) expect((await a.acao(x)).fase).toBe('disponivel');
    expect(m.ordem).toEqual([]);
  });
});

/** Motor do Windows de mentira: a versão anunciada e um download que se controla. */
const windowsFalso = (o: {versao?: string | null; falhaDownload?: boolean} = {}) => {
  const chamadas: string[] = [];
  const motor: MotorWindows = {
    procurar: async () => (chamadas.push('procurar'), o.versao === null ? null : {versao: o.versao ?? '2.0.1', titulo: 'Estúdio V4 (2.0.1)',
      notas: '<h2>Novidades</h2><ul><li>Atualização &amp; aviso</li></ul>'}),
    baixar: async (aoProgresso) => {
      chamadas.push('baixar');
      aoProgresso(0.5);
      if (o.falhaDownload) throw new Error('net::ERR_CONNECTION_RESET');
      aoProgresso(1);
    },
    instalarAgora: () => void chamadas.push('instalarAgora'),
  };
  return {motor, chamadas};
};

describe('atualizador: Windows', () => {
  const montarWin = (w: ReturnType<typeof windowsFalso>, o: Partial<DepsAtualizador> = {}) => {
    const carregar = vi.fn(async () => w.motor);
    const m = montar({plataforma: 'win32', arch: 'x64', executavel: 'C:\\Users\\fulano\\AppData\\Local\\Programs\\Estudio\\Estudio.exe', windows: carregar, ...o});
    return {...m, carregar, a: criarAtualizador(m.deps)};
  };

  it('procura, baixa sozinho e fica pronta para instalar ao fechar', async () => {
    const w = windowsFalso();
    const m = montarWin(w);
    expect(m.a.estado().modo).toBe('windows');
    m.a.iniciar();
    await m.relogio.avancar(ATRASO_INICIAL_MS);
    expect(w.chamadas).toEqual(['procurar', 'baixar']);
    expect(m.buscar).not.toHaveBeenCalled(); // no Windows quem procura é o electron-updater (latest.yml)
    expect(m.a.estado()).toMatchObject({fase: 'pronta', novidade: {versao: '2.0.1', titulo: 'Estúdio V4 (2.0.1)', notas: 'Novidades\n• Atualização & aviso'}});
    expect(m.a.estado().progresso).toBeUndefined();
    expect(m.telas.map((t) => t.progresso).filter((p) => p !== undefined)).toEqual([0, 0.5, 1]);
    // pronta: as próximas procuras não baixam de novo
    await m.relogio.avancar(INTERVALO_MS);
    expect(w.chamadas).toEqual(['procurar', 'baixar']);
    expect(m.carregar).toHaveBeenCalledTimes(1);
  });

  it('"Pular esta versão" não vale no Windows (a versão já baixou e instala ao fechar)', async () => {
    const m = montarWin(windowsFalso());
    await m.a.procurarAgora();
    expect((await m.a.acao('pular')).fase).toBe('pronta');
    expect(m.prefs.versao_pulada).toBeUndefined();
  });

  it('em dia, ou só versão de teste: nada a baixar', async () => {
    const em = windowsFalso({versao: null});
    expect((await montarWin(em).a.procurarAgora())).toMatchObject({fase: 'nada', mensagem: 'Você já está na versão mais nova (2.0.0).'});
    const teste = windowsFalso({versao: '2.0.2-teste.1'});
    expect((await montarWin(teste).a.procurarAgora()).fase).toBe('nada');
    expect(teste.chamadas).toEqual(['procurar']);
    expect((await montarWin(windowsFalso({versao: '2.0.2-teste.1'}), {aceitarTestes: true}).a.procurarAgora()).fase).toBe('pronta');
  });

  it('download que falha: some em silêncio na procura automática, avisa na manual', async () => {
    const auto = montarWin(windowsFalso({falhaDownload: true}));
    auto.a.iniciar();
    await auto.relogio.avancar(ATRASO_INICIAL_MS);
    expect(auto.a.estado()).toMatchObject({fase: 'nada'});
    expect(auto.a.estado().novidade).toBeUndefined();
    const manual = montarWin(windowsFalso({falhaDownload: true}));
    expect(await manual.a.procurarAgora()).toMatchObject({fase: 'falhou', erro: 'O download da versão nova falhou. Tente de novo mais tarde.'});
  });

  it('o electron-updater que não carrega conta como falha e tenta carregar de novo', async () => {
    const w = windowsFalso();
    const carregar = vi.fn<() => Promise<MotorWindows>>().mockRejectedValueOnce(new Error('sem módulo')).mockResolvedValue(w.motor);
    const m = montar({plataforma: 'win32', arch: 'x64', windows: carregar});
    const a = criarAtualizador(m.deps);
    expect((await a.procurarAgora()).mensagem).toMatch(/Não deu para procurar agora/);
    expect((await a.procurarAgora()).fase).toBe('pronta');
    expect(carregar).toHaveBeenCalledTimes(2);
  });

  it('"Reiniciar e atualizar" fecha tudo e então instala', async () => {
    const w = windowsFalso();
    const m = montarWin(w, {encerrar: async () => void w.chamadas.push('encerrar')});
    await m.a.procurarAgora();
    expect((await m.a.acao('reiniciar')).fase).toBe('instalando');
    expect(w.chamadas).toEqual(['procurar', 'baixar', 'encerrar', 'instalarAgora']);
  });

  it('o reinício espera a gravação da narração e a exportação', async () => {
    const w = windowsFalso();
    const m = montarWin(w, {encerrar: async () => void w.chamadas.push('encerrar')});
    await m.a.procurarAgora();
    m.a.ocupadoNaTela({gravando_narracao: true});
    m.ocupado.principal = 'a exportação';
    expect(await m.a.acao('reiniciar')).toMatchObject({fase: 'aguardando', esperando: 'a exportação'});
    m.ocupado.principal = null;
    m.a.livre(); // a exportação terminou, mas a gravação continua
    await assentar();
    expect(m.a.estado()).toMatchObject({fase: 'aguardando', esperando: 'a gravação da narração'});
    expect(w.chamadas).not.toContain('instalarAgora');
    m.a.ocupadoNaTela({gravando_narracao: false, salvando: true});
    await assentar();
    expect(m.a.estado()).toMatchObject({fase: 'aguardando', esperando: 'a gravação do documento'});
    m.a.ocupadoNaTela({});
    await assentar();
    expect(m.a.estado().fase).toBe('instalando');
    expect(m.a.estado().esperando).toBeUndefined();
    expect(w.chamadas.slice(-2)).toEqual(['encerrar', 'instalarAgora']);
  });

  it('"Cancelar o reinício" volta a "pronta" e o fim da exportação não reinicia mais', async () => {
    const w = windowsFalso();
    const m = montarWin(w);
    await m.a.procurarAgora();
    m.a.ocupadoNaTela({exportando: true});
    expect((await m.a.acao('reiniciar')).fase).toBe('aguardando');
    expect((await m.a.acao('cancelar_reinicio')).fase).toBe('pronta');
    m.a.ocupadoNaTela({});
    await assentar();
    expect(m.a.estado().fase).toBe('pronta');
    expect(w.chamadas).not.toContain('instalarAgora');
  });

  it('o reinício que falha diz o erro', async () => {
    const w = windowsFalso();
    const m = montarWin(w, {encerrar: async () => Promise.reject(new Error('o projeto não fechou'))});
    await m.a.procurarAgora();
    expect(await m.a.acao('reiniciar')).toMatchObject({fase: 'falhou', erro: 'Não deu para reiniciar e atualizar: o projeto não fechou'});
    expect(w.chamadas).not.toContain('instalarAgora');
  });
});

describe('atualizador: Linux instalado pelo script', () => {
  const home = '/home/fulano';
  const linuxFalso = (falha?: string) => {
    const chamadas: string[] = [];
    const motor: MotorLinux = {
      preparar: async (n: Novidade, aoProgresso) => {
        chamadas.push(`preparar ${n.arquivo?.nome}`);
        aoProgresso(0.4);
        if (falha) throw new Error(falha);
      },
      trocarEReabrir: async () => void chamadas.push('trocar'),
    };
    return {motor, chamadas};
  };

  it('só o executável de ~/.local/opt/Estudio oferece atualizar sozinho', () => {
    const l = linuxFalso();
    const doScript = criarAtualizador(montar({plataforma: 'linux', arch: 'x64', home, executavel: `${home}/.local/opt/Estudio/Estudio`, linux: l.motor}).deps);
    expect(doScript.estado()).toMatchObject({modo: 'aviso', linux_script: true});
    expect(doScript.estado().comando_linux).toMatch(/git pull && bash scripts\/instalar-linux\.sh$/);
    const zip = criarAtualizador(montar({plataforma: 'linux', arch: 'x64', home, executavel: `${home}/Downloads/Estudio/Estudio`, linux: l.motor}).deps);
    expect(zip.estado()).toMatchObject({modo: 'aviso', linux_script: false});
  });

  it('"Atualizar agora" prepara (zip conferido) e o reinício troca a pasta', async () => {
    const l = linuxFalso();
    const m = montar({plataforma: 'linux', arch: 'x64', home, executavel: `${home}/.local/opt/Estudio/Estudio`, linux: l.motor,
      encerrar: async () => void l.chamadas.push('encerrar')});
    const a = criarAtualizador(m.deps);
    await a.procurarAgora();
    expect(a.estado().novidade?.somas).toBe(`${BASE}/v4.0.1/SHA256SUMS.txt`);
    expect((await a.acao('atualizar_linux')).fase).toBe('pronta');
    expect(m.telas.some((t) => t.fase === 'baixando' && t.progresso === 0.4)).toBe(true);
    expect((await a.acao('reiniciar')).fase).toBe('instalando');
    expect(l.chamadas).toEqual(['preparar Estudio-linux-x64-2.0.1.zip', 'encerrar', 'trocar']);
  });

  it('download recusado vira "falhou" com o motivo, e dá para tentar de novo', async () => {
    const l = linuxFalso('o SHA-256 do zip não confere com o SHA256SUMS.txt');
    const m = montar({plataforma: 'linux', arch: 'x64', home, executavel: `${home}/.local/opt/Estudio/Estudio`, linux: l.motor});
    const a = criarAtualizador(m.deps);
    await a.procurarAgora();
    expect(await a.acao('atualizar_linux')).toMatchObject({fase: 'falhou', erro: 'Não deu para atualizar: o SHA-256 do zip não confere com o SHA256SUMS.txt'});
    await a.acao('atualizar_linux');
    expect(l.chamadas).toHaveLength(2);
  });

  it('release sem SHA256SUMS.txt não atualiza sozinha (só o download no navegador)', async () => {
    const l = linuxFalso();
    const sem = () => release('v4.0.1', '2.0.1', {assets: arquivosDe('v4.0.1', '2.0.1').filter((x) => x.name !== 'SHA256SUMS.txt')});
    const m = montar({plataforma: 'linux', arch: 'x64', home, executavel: `${home}/.local/opt/Estudio/Estudio`, linux: l.motor, releases: sem});
    const a = criarAtualizador(m.deps);
    await a.procurarAgora();
    expect((await a.acao('atualizar_linux')).fase).toBe('disponivel');
    expect(l.chamadas).toEqual([]);
  });
});

describe('peças do atualizador', () => {
  it('modo por sistema', () => {
    expect(modoDe(false, 'win32')).toBe('desligado');
    expect(modoDe(true, 'win32')).toBe('windows');
    expect(modoDe(true, 'win32', false)).toBe('desligado');
    expect(modoDe(true, 'darwin')).toBe('aviso');
    expect(modoDe(true, 'linux')).toBe('aviso');
  });

  it('as notas do feed (HTML ou lista) viram texto', () => {
    expect(textoDasNotas('<p>Linha 1<br>Linha 2</p><ul><li>a &lt;b&gt;</li><li>&quot;c&quot; &#39;d&#39;</li></ul>'))
      .toBe('Linha 1\nLinha 2\n• a <b>\n• "c" \'d\'');
    expect(textoDasNotas([{version: '2.0.1', note: '<p>um</p>'}, {version: '2.0.0', note: null}])).toBe('um');
    expect(textoDasNotas(null)).toBe('');
  });
});
