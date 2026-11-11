// Publica uma release do Estúdio no GitHub com os arquivos que o CI gerou (docs/atualizacao.md).
//
//   node scripts/publicar-release.mjs --execucao <id da execução do CI> --tag v4.0.1 --notas notas.md [--seco]
//   node scripts/publicar-release.mjs --pasta <artifacts já baixados> --tag v4.0.1 --notas notas.md [--seco]
//
// Junta os arquivos com os nomes que o app procura (src/nucleo/atualizacao.ts), confere o latest.yml do Windows, gera o
// SHA256SUMS.txt e roda o gh release create. Usa o gh já logado: nenhum token passa por aqui.
//
// Opções:
//   --seco       só mostra o que faria: baixa e monta a pasta, mas não fala com o GitHub para publicar
//   --titulo     padrão "Estúdio V<maior da tag> (<versão>)", como a v4.0.0
//   --pre        marca como pre-release (tag ou versão com hífen já marcam; o app só a vê com ESTUDIO_ATUALIZACAO_TESTE=1)
//   --parcial    aceita faltar o arquivo de algum sistema (uma versão de teste só do Windows, por exemplo)
//   --saida      onde montar os arquivos (padrão out/release/<tag>; os artifacts baixados ficam em <saida>-artifacts)
//   --repo       padrão BKM-Advogados/BKM-EDITOR
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {conferirLatest} from './conferir-latest-yml.mjs';

const REPO_PADRAO = 'BKM-Advogados/BKM-EDITOR';

// os mesmos nomes de src/nucleo/atualizacao.ts (nomeDoArquivo) e do electron-builder.yml; o teste confere
const PADROES = [/^Estudio-Setup-(.+)\.exe$/, /^Estudio-(.+)-(?:arm64|x64)\.dmg$/, /^Estudio-linux-x64-(.+)\.zip$/];
export const arquivosDaVersao = (v) => ({
  obrigatorios: [`Estudio-Setup-${v}.exe`, `Estudio-Setup-${v}.exe.blockmap`, 'latest.yml', `Estudio-${v}-arm64.dmg`, `Estudio-${v}-x64.dmg`,
    `Estudio-linux-x64-${v}.zip`],
  opcionais: [`Estudio-${v}.mcpb`], // a extensão do Claude Desktop (artifact estudio-claude-desktop), quando o CI a gera
});

const listar = (pasta) => readdirSync(pasta, {withFileTypes: true}).flatMap((e) => {
  const p = path.join(pasta, e.name);
  return e.isDirectory() ? listar(p) : e.isFile() ? [p] : [];
});

const sha256 = (arquivo) => new Promise((ok, falha) => {
  const h = createHash('sha256');
  createReadStream(arquivo).on('error', falha).on('data', (d) => h.update(d)).on('end', () => ok(h.digest('hex')));
});

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const gh = (args, o = {}) => execFileSync('gh', args, {encoding: 'utf-8', stdio: o.mostrar ? 'inherit' : ['ignore', 'pipe', 'pipe']});
const aspas = (a) => (/^[\w./:=@-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);

/** Monta a release em `saida` a partir dos arquivos de `origem` (qualquer profundidade). Lança com o motivo. */
export const montar = async ({origem, tag, saida, parcial = false}) => {
  const porNome = new Map();
  for (const arquivo of listar(origem)) {
    const nome = path.basename(arquivo);
    const ja = porNome.get(nome);
    if (ja && statSync(ja).size !== statSync(arquivo).size) throw new Error(`dois ${nome} diferentes nos artifacts: ${ja} e ${arquivo}`);
    porNome.set(nome, arquivo);
  }
  const versoes = new Set();
  for (const nome of porNome.keys()) for (const re of PADROES) {
    const m = re.exec(nome);
    if (m) versoes.add(m[1]);
  }
  if (versoes.size === 0) throw new Error(`nenhum instalador do Estúdio em ${origem}`);
  if (versoes.size > 1) throw new Error(`os artifacts misturam versões: ${[...versoes].join(', ')}`);
  const [versao] = versoes;
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(versao)) throw new Error(`versão estranha nos nomes: ${versao}`);

  const {obrigatorios, opcionais} = arquivosDaVersao(versao);
  const faltam = obrigatorios.filter((n) => !porNome.has(n));
  // o instalador do Windows só serve à atualização com o .blockmap e o latest.yml juntos
  const windows = obrigatorios.slice(0, 3);
  if (windows.some((n) => porNome.has(n)) && windows.some((n) => !porNome.has(n))) {
    throw new Error(`o instalador do Windows veio sem ${windows.filter((n) => !porNome.has(n)).join(' e ')}`);
  }
  if (faltam.length && !parcial) throw new Error(`faltam ${faltam.join(', ')} (use --parcial para publicar mesmo assim)`);
  const nomes = [...obrigatorios, ...opcionais].filter((n) => porNome.has(n));

  rmSync(saida, {recursive: true, force: true});
  mkdirSync(saida, {recursive: true});
  for (const n of nomes) copyFileSync(porNome.get(n), path.join(saida, n));
  if (porNome.has('latest.yml')) await conferirLatest(saida, versao);

  const somas = [];
  for (const n of [...nomes].sort()) somas.push(`${await sha256(path.join(saida, n))}  ${n}`);
  writeFileSync(path.join(saida, 'SHA256SUMS.txt'), `${somas.join('\n')}\n`);

  const teste = tag.includes('-') || versao.includes('-');
  const maior = /^v(\d+)\./.exec(tag)?.[1];
  return {versao, teste, faltam, maior, arquivos: [...nomes, 'SHA256SUMS.txt'], ignorados: [...porNome.keys()].filter((n) => !nomes.includes(n)).sort()};
};

const principal = async () => {
  const {values: o} = parseArgs({options: {
    execucao: {type: 'string'}, pasta: {type: 'string'}, tag: {type: 'string'}, titulo: {type: 'string'}, notas: {type: 'string'},
    seco: {type: 'boolean', default: false}, pre: {type: 'boolean', default: false}, parcial: {type: 'boolean', default: false},
    saida: {type: 'string'}, repo: {type: 'string', default: REPO_PADRAO},
  }});
  if (!o.tag || !/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(o.tag)) throw new Error('--tag v<maior>.<menor>.<correção> (ex.: --tag v4.0.1, ou v4.0.2-teste.1)');
  if (Boolean(o.execucao) === Boolean(o.pasta)) throw new Error('diga de onde vêm os arquivos: --execucao <id> ou --pasta <pasta>');
  if (!o.seco && !o.notas) throw new Error('--notas <arquivo.md> com as novidades (o app mostra este texto no aviso de versão nova)');
  if (o.notas && !existsSync(o.notas)) throw new Error(`não achei o arquivo de notas ${o.notas}`);

  const saida = path.resolve(o.saida ?? path.join('out', 'release', o.tag));
  let origem = o.pasta;
  let commit = null;
  if (o.execucao) {
    if (!/^\d+$/.test(o.execucao)) throw new Error('--execucao é o número da execução do CI (gh run list)');
    const run = JSON.parse(gh(['run', 'view', o.execucao, '--repo', o.repo, '--json', 'headSha,conclusion,status,headBranch,displayTitle']));
    console.log(`execução ${o.execucao}: ${run.displayTitle} (${run.headBranch}, ${run.headSha.slice(0, 7)}, ${run.status}/${run.conclusion || '-'})`);
    if (run.conclusion !== 'success') throw new Error('a execução do CI não terminou com sucesso: nada a publicar');
    commit = run.headSha;
    // no disco, ao lado da saída (são uns 2 GB; o /tmp pode ser memória)
    origem = `${saida}-artifacts`;
    rmSync(origem, {recursive: true, force: true});
    console.log(`baixando os artifacts em ${origem}…`);
    gh(['run', 'download', o.execucao, '--repo', o.repo, '--dir', origem], {mostrar: true});
  }

  const r = await montar({origem, tag: o.tag, saida, parcial: o.parcial});
  const titulo = o.titulo ?? `Estúdio V${r.maior} (${r.versao})`;
  const pre = o.pre || r.teste;

  console.log(`\nrelease ${o.tag}: "${titulo}"${pre ? ' (pre-release)' : ''}, versão do pacote ${r.versao}, em ${saida}`);
  for (const n of r.arquivos) console.log(`  ${n.padEnd(40)} ${mb(statSync(path.join(saida, n)).size).padStart(10)}`);
  if (r.faltam.length) console.log(`  faltando (--parcial): ${r.faltam.join(', ')}`);
  if (r.ignorados.length) console.log(`  fora da release: ${r.ignorados.join(', ')}`);

  const args = ['release', 'create', o.tag, ...r.arquivos.map((n) => path.join(saida, n)), '--repo', o.repo, '--title', titulo,
    '--notes-file', o.notas ?? '<notas.md>'];
  if (pre) args.push('--prerelease');
  // a tag sai do commit que o CI compilou; sem a execução, ela já tem de existir no GitHub
  if (commit) args.push('--target', commit);
  else args.push('--verify-tag');
  console.log(`\ngh ${args.map(aspas).join(' ')}`);
  if (o.seco) {
    console.log('\n--seco: nada foi publicado.');
    return;
  }

  // antes de publicar: a release não existe, e a tag (se já existe) é do commit que o CI compilou
  let existe = true;
  try {
    gh(['release', 'view', o.tag, '--repo', o.repo, '--json', 'tagName']);
  } catch (e) {
    if (!/not found/i.test(String(e.stderr ?? e.message))) throw new Error(`o gh não respondeu: ${String(e.stderr ?? e.message).trim()}`);
    existe = false;
  }
  if (existe) throw new Error(`a release ${o.tag} já existe (gh release delete ${o.tag} --repo ${o.repo}, se for para refazer)`);
  if (commit) {
    let daTag = null;
    try {
      daTag = gh(['api', `repos/${o.repo}/commits/${o.tag}`, '--jq', '.sha']).trim();
    } catch {
      /* a tag ainda não existe: o gh cria no commit da execução */
    }
    if (daTag && daTag !== commit) throw new Error(`a tag ${o.tag} aponta para ${daTag.slice(0, 7)}, e o CI compilou ${commit.slice(0, 7)}`);
  }
  gh(args, {mostrar: true});
  console.log(`\npublicada: https://github.com/${o.repo}/releases/tag/${o.tag}`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  principal().catch((e) => {
    console.error(`publicar-release: ${e.message}`);
    process.exit(1);
  });
}
