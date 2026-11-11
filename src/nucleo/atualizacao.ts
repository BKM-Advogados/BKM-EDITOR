// Atualização do Estúdio (docs/atualizacao.md): o que é decisão e não depende do Electron. Comparar versões, escolher o
// arquivo da release pelo sistema e pela arquitetura, decidir se a release vira aviso (versão de teste e versão pulada
// ficam de fora), conferir que o endereço a abrir no navegador é deste repositório e ler o SHA256SUMS.txt.
//
// A tag da release segue a numeração do produto (v4.0.1) e o pacote tem a sua (2.0.1): a versão comparada com
// app.getVersion() sai do nome dos arquivos da release (Estudio-Setup-2.0.1.exe, Estudio-2.0.1-arm64.dmg,
// Estudio-linux-x64-2.0.1.zip), nunca da tag.
import path from 'node:path';

export const REPOSITORIO = {dono: 'BKM-Advogados', nome: 'BKM-EDITOR'} as const;
export const URL_ULTIMA_RELEASE = `https://api.github.com/repos/${REPOSITORIO.dono}/${REPOSITORIO.nome}/releases/latest`;
/** Só com o modo de teste (ESTUDIO_ATUALIZACAO_TESTE=1): as últimas releases, pre-releases incluídas. */
export const URL_RELEASES = `https://api.github.com/repos/${REPOSITORIO.dono}/${REPOSITORIO.nome}/releases?per_page=10`;
export const PAGINA_RELEASES = `https://github.com/${REPOSITORIO.dono}/${REPOSITORIO.nome}/releases`;

/** Primeira procura depois de abrir (o app termina de subir antes) e o intervalo entre as procuras. */
export const ATRASO_INICIAL_MS = 15_000;
export const INTERVALO_MS = 6 * 60 * 60 * 1000;
/** Pasta do cache do electron-updater (a mesma que o electron-builder poria no app-update.yml: nome do app + "-updater"). */
export const PASTA_CACHE_ATUALIZADOR = 'estudio-updater';

// ---------- versões ----------

export type Versao = {numeros: [number, number, number]; previa: (string | number)[]};

/** "2.0.1", "v2.0.1", "2.0.2-teste.1" e "2.0.1+build" (o "+…" não conta). Fora disso, null. */
export const lerVersao = (texto: string): Versao | null => {
  const m = /^[vV]?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(texto.trim());
  if (!m) return null;
  const previa = m[4] ? m[4].split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [];
  if (previa.some((p) => p === '')) return null;
  return {numeros: [Number(m[1]), Number(m[2]), Number(m[3])], previa};
};

/** Ordem do semver: negativo se a < b, zero se iguais, positivo se a > b. Versão inválida lança. */
export const compararVersoes = (a: string, b: string): number => {
  const va = lerVersao(a);
  const vb = lerVersao(b);
  if (!va || !vb) throw new Error(`versão inválida: ${!va ? a : b}`);
  for (let i = 0; i < 3; i++) if (va.numeros[i] !== vb.numeros[i]) return va.numeros[i] - vb.numeros[i];
  // sem prévia vem depois de com prévia (2.0.1-teste.1 < 2.0.1)
  if (!va.previa.length || !vb.previa.length) return vb.previa.length - va.previa.length;
  for (let i = 0; i < Math.max(va.previa.length, vb.previa.length); i++) {
    const x = va.previa[i];
    const y = vb.previa[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    if (typeof x === 'number') return -1; // número vem antes de texto
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }
  return 0;
};

/** Versão de teste: tag ou versão com hífen (v4.0.2-teste.1, 2.0.2-rc.1). */
export const ehVersaoDeTeste = (versaoOuTag: string) => versaoOuTag.includes('-');

// ---------- arquivos da release ----------

export type AssetGitHub = {name: string; browser_download_url: string; size?: number};
export type ReleaseGitHub = {tag_name: string; name?: string | null; body?: string | null; draft?: boolean; prerelease?: boolean; html_url?: string;
  published_at?: string | null; assets?: AssetGitHub[]};

/** O arquivo que a pessoa baixa: o DMG da arquitetura do Mac, o zip do Linux, o instalador do Windows. */
export type ArquivoDaRelease = {nome: string; url: string; tamanho?: number; versao: string};

/** O que cada sistema baixa, com a versão do pacote no nome (electron-builder.yml e maker-zip do Forge). */
export const nomeDoArquivo = (plataforma: string, arch: string, versao: string): string | null => {
  if (plataforma === 'win32') return `Estudio-Setup-${versao}.exe`; // só há x64; o Windows ARM roda o x64 emulado
  if (plataforma === 'darwin' && (arch === 'arm64' || arch === 'x64')) return `Estudio-${versao}-${arch}.dmg`;
  if (plataforma === 'linux' && arch === 'x64') return `Estudio-linux-x64-${versao}.zip`;
  return null;
};

const PADROES: {plataforma: string; re: RegExp; arch?: (m: RegExpExecArray) => string; versao: (m: RegExpExecArray) => string}[] = [
  {plataforma: 'win32', re: /^Estudio-Setup-(.+)\.exe$/, versao: (m) => m[1]},
  {plataforma: 'darwin', re: /^Estudio-(.+)-(arm64|x64)\.dmg$/, arch: (m) => m[2], versao: (m) => m[1]},
  {plataforma: 'linux', re: /^Estudio-linux-(x64|arm64)-(.+)\.zip$/, arch: (m) => m[1], versao: (m) => m[2]},
];

/** A versão do pacote que esta release traz, lida do nome de qualquer arquivo conhecido (o mesmo em todos). */
export const versaoDaRelease = (assets: AssetGitHub[]): string | null => {
  for (const a of assets) {
    for (const p of PADROES) {
      const m = p.re.exec(a.name);
      if (m && lerVersao(p.versao(m))) return p.versao(m);
    }
  }
  return null;
};

/** O arquivo deste sistema e desta arquitetura, ou null (Linux ARM, release sem o arquivo: o aviso leva à página da release). */
export const escolherArquivo = (assets: AssetGitHub[], plataforma: string, arch: string): ArquivoDaRelease | null => {
  const efetiva = plataforma === 'win32' ? 'x64' : arch;
  for (const p of PADROES.filter((x) => x.plataforma === plataforma)) {
    for (const a of assets) {
      const m = p.re.exec(a.name);
      if (!m || (p.arch && p.arch(m) !== efetiva) || !lerVersao(p.versao(m))) continue;
      if (!urlPermitida(a.browser_download_url)) continue;
      return {nome: a.name, url: a.browser_download_url, tamanho: a.size, versao: p.versao(m)};
    }
  }
  return null;
};

/** Mac: o app x64 aberto pelo Rosetta num Apple Silicon recebe o DMG arm64 (o nativo). */
export const archDoSistema = (plataforma: string, arch: string, traduzidoDeArm64: boolean) =>
  plataforma === 'darwin' && traduzidoDeArm64 ? 'arm64' : arch;

// ---------- endereços ----------

/** O navegador só abre páginas e downloads deste repositório no github.com (https, sem usuário, sem porta). */
export const urlPermitida = (url: string): boolean => {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.port || u.username || u.password) return false;
  const [vazio, dono, nome] = u.pathname.split('/');
  return vazio === '' && dono?.toLowerCase() === REPOSITORIO.dono.toLowerCase() && nome?.toLowerCase() === REPOSITORIO.nome.toLowerCase();
};

// ---------- decisão ----------

export type Novidade = {
  versao: string;
  tag: string;
  titulo: string;
  /** Corpo da release (Markdown do GitHub), mostrado como texto; cortado em 4.000 caracteres. */
  notas: string;
  /** Página da release no GitHub. */
  pagina: string;
  /** O arquivo deste sistema; null quando a release não tem (o "Baixar" abre a página). */
  arquivo: ArquivoDaRelease | null;
  /** O SHA256SUMS.txt da release, que confere o zip do Linux. */
  somas?: string;
  publicada_em?: string;
};

export type Decisao =
  | {tipo: 'nova'; novidade: Novidade}
  | {tipo: 'em_dia'; versao?: string}
  | {tipo: 'ignorada'; motivo: 'rascunho' | 'teste' | 'pulada' | 'sem_versao'; versao?: string};

export type OpcoesDecisao = {versaoAtual: string; plataforma: string; arch: string; pulada?: string; aceitarTestes?: boolean};

const LIMITE_NOTAS = 4000;

export const decidir = (r: ReleaseGitHub, o: OpcoesDecisao): Decisao => {
  if (r.draft) return {tipo: 'ignorada', motivo: 'rascunho'};
  const assets = Array.isArray(r.assets) ? r.assets.filter((a) => a && typeof a.name === 'string' && typeof a.browser_download_url === 'string') : [];
  const arquivo = escolherArquivo(assets, o.plataforma, o.arch);
  const versao = arquivo?.versao ?? versaoDaRelease(assets);
  if (!versao) return {tipo: 'ignorada', motivo: 'sem_versao'};
  // versão de teste: marcada como pre-release no GitHub, ou com hífen na tag ou na versão
  if (!o.aceitarTestes && (r.prerelease || ehVersaoDeTeste(r.tag_name ?? '') || ehVersaoDeTeste(versao))) return {tipo: 'ignorada', motivo: 'teste', versao};
  if (!lerVersao(o.versaoAtual) || compararVersoes(versao, o.versaoAtual) <= 0) return {tipo: 'em_dia', versao};
  if (o.pulada && o.pulada === versao) return {tipo: 'ignorada', motivo: 'pulada', versao};
  const pagina = r.html_url && urlPermitida(r.html_url) ? r.html_url : PAGINA_RELEASES;
  const somas = assets.find((a) => a.name === 'SHA256SUMS.txt' && urlPermitida(a.browser_download_url))?.browser_download_url;
  const notas = (r.body ?? '').trim();
  return {tipo: 'nova', novidade: {versao, tag: r.tag_name, titulo: r.name?.trim() || `Estúdio ${versao}`,
    notas: notas.length > LIMITE_NOTAS ? `${notas.slice(0, LIMITE_NOTAS)}…` : notas, pagina, arquivo, ...(somas ? {somas} : {}),
    ...(r.published_at ? {publicada_em: r.published_at} : {})}};
};

/** Modo de teste: das últimas releases (pre-releases incluídas), a de versão mais alta. */
export const maisNova = (releases: ReleaseGitHub[]): ReleaseGitHub | null => {
  let melhor: {r: ReleaseGitHub; v: string} | null = null;
  for (const r of releases) {
    if (!r || r.draft) continue;
    const v = versaoDaRelease(Array.isArray(r.assets) ? r.assets : []);
    if (v && (!melhor || compararVersoes(v, melhor.v) > 0)) melhor = {r, v};
  }
  return melhor?.r ?? null;
};

// ---------- procura (GitHub) ----------

/** O pedaço do fetch que a procura usa (o net.fetch do Electron no app; um falso nos testes). */
export type Buscar = (url: string, init?: {headers?: Record<string, string>; signal?: AbortSignal}) => Promise<{ok: boolean; status: number; json: () => Promise<unknown>}>;

export type Procura = Decisao | {tipo: 'falhou'; detalhe: string};

/** Lê a última release do GitHub e decide. Sem rede, GitHub fora ou limite da API: {tipo: 'falhou'}, sem lançar. */
export const procurar = async (buscar: Buscar, o: OpcoesDecisao & {versaoApp: string; tempoMs?: number}): Promise<Procura> => {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), o.tempoMs ?? 20_000);
  try {
    // o User-Agent é exigido pela API do GitHub; nada da pessoa vai junto
    const resposta = await buscar(o.aceitarTestes ? URL_RELEASES : URL_ULTIMA_RELEASE,
      {headers: {Accept: 'application/vnd.github+json', 'User-Agent': `Estudio/${o.versaoApp}`, 'X-GitHub-Api-Version': '2022-11-28'}, signal: controle.signal});
    if (resposta.status === 404) return {tipo: 'em_dia'}; // nenhuma release publicada ainda
    if (!resposta.ok) return {tipo: 'falhou', detalhe: `GitHub respondeu ${resposta.status}`};
    const corpo = await resposta.json();
    const release = o.aceitarTestes ? maisNova(Array.isArray(corpo) ? (corpo as ReleaseGitHub[]) : []) : (corpo as ReleaseGitHub);
    if (!release || typeof release !== 'object' || typeof release.tag_name !== 'string') return {tipo: 'em_dia'};
    return decidir(release, o);
  } catch (e) {
    return {tipo: 'falhou', detalhe: (e as Error)?.message ?? String(e)};
  } finally {
    clearTimeout(relogio);
  }
};

// ---------- SHA256SUMS.txt ----------

/** Linhas do sha256sum ("<hex>  <arquivo>" ou "<hex> *<arquivo>"); o resto é ignorado. Nome do arquivo → hash minúsculo. */
export const lerSomas = (texto: string): Map<string, string> => {
  const somas = new Map<string, string>();
  for (const linha of texto.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(linha.trim());
    if (m) somas.set(m[2].trim(), m[1].toLowerCase());
  }
  return somas;
};

/** O SHA256SUMS.txt no formato do sha256sum, em ordem de nome. */
export const escreverSomas = (somas: Iterable<[string, string]>) =>
  `${[...somas].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([nome, hash]) => `${hash.toLowerCase()}  ${nome}`).join('\n')}\n`;

// ---------- Linux instalado pelo scripts/instalar-linux.sh ----------

/** Onde o scripts/instalar-linux.sh põe o app (caminho do Linux, montado com path.posix). */
export const pastaDoScriptLinux = (home: string) => path.posix.join(home, '.local', 'opt', 'Estudio');

/** Este app é o que o script instalou: Linux, rodando de ~/.local/opt/Estudio/Estudio. */
export const instaladoPeloScript = (plataforma: string, executavel: string, home: string) =>
  plataforma === 'linux' && path.posix.normalize(executavel) === path.posix.join(pastaDoScriptLinux(home), 'Estudio');

/** O comando que atualiza à mão quem instalou pelo script (a partir do clone do repositório). */
export const COMANDO_LINUX = 'cd <pasta do repositório do Estúdio> && git pull && bash scripts/instalar-linux.sh';
