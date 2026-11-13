// Mede memória e tempo do render da música (M-04, docs/desempenho.md, seção "Música: memória do render"). Monta um
// documento sintético de N faixas (bateria e sintetizadores, com EQ, compressor, envios ao reverb e ao delay,
// sidechain, automação de volume e limitador) com a duração pedida, renderiza num processo novo e diz o tempo, o pico de
// memória residente (maxRSS) e o hash do PCM.
//
// Uso (Node 20+, com o tsx do projeto):
//   node --import tsx scripts/medir-memoria-musica.mts --tudo                 # a tabela do docs/desempenho.md
//   node --import tsx scripts/medir-memoria-musica.mts --segundos 60 --faixas 24 --motor grafo [--disco] [--stems]
//   node --import tsx scripts/medir-memoria-musica.mts --tudo --raiz <outra cópia do repositório>   # o "antes"
// --motor: "grafo" (renderizarMusica, o canônico) ou "antigo" (renderizarMusicaAntigo, o oráculo de buffer inteiro).
// --disco: usa o cache em disco (numa pasta temporária) e renderiza duas vezes; a segunda lê as faixas guardadas.
import {spawnSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const aqui = fileURLToPath(import.meta.url);
const arg = (nome: string) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const tem = (nome: string) => process.argv.includes(nome);
const raiz = path.resolve(arg('--raiz') ?? path.join(path.dirname(aqui), '..'));

/** Documento sintético: `faixas` canais, um por faixa do mixer; 120 BPM, então `segundos` × 2 batidas. */
export const docSintetico = (faixas: number, segundos: number) => {
  const batidas = Math.round(segundos * 2);
  const presets = ['baixo', 'pad', 'pluck', 'lead'] as const;
  const canais: unknown[] = [], padroes: unknown[] = [], clipes: unknown[] = [], mixer: unknown[] = [], automacoes: unknown[] = [];
  let primeiraBateria: string | null = null;
  for (let i = 0; i < faixas; i++) {
    const id = `f${i}`;
    const bateria = i % 4 === 0;
    if (bateria) {
      primeiraBateria ??= id;
      canais.push({id, nome: `Bateria ${i}`, tipo: 'bateria', faixa_mixer: id, kit: 'eletronico', pecas: {caixa: {afinacao: i % 5}, chimbal_fechado: {pan: 0.3, volume_db: -4}}});
      const notas = [];
      for (let p = 0; p < 16; p++) {
        if (p % 4 === 0) notas.push({peca: 'bumbo', em: p / 4, forca: 120});
        if (p % 8 === 4) notas.push({peca: 'caixa', em: p / 4, forca: 110});
        notas.push({peca: p % 7 === 3 ? 'chimbal_aberto' : 'chimbal_fechado', em: p / 4, forca: 60 + ((p * 13) % 50)});
      }
      padroes.push({id: `p${i}`, nome: `Ritmo ${i}`, canal: id, dur: 4, passos: 16, notas});
    } else {
      const preset = presets[i % 4];
      canais.push({id, nome: `Sint ${i}`, tipo: 'sintetizador', faixa_mixer: id, preset, macros: {brilho: (i % 7) / 7, cor: (i % 3) / 3}});
      const base = preset === 'baixo' ? 33 : preset === 'pad' ? 57 : 64;
      const passo = preset === 'pad' ? 4 : preset === 'baixo' ? 2 : 1;
      const notas = [];
      for (let p = 0; p < 16; p += passo) notas.push({nota: base + ((p * 5 + i) % 12), em: p / 4, dur: (passo / 4) * 0.9, forca: 90 + (p % 30)});
      padroes.push({id: `p${i}`, nome: `Frase ${i}`, canal: id, dur: 4, passos: 16, notas});
    }
    clipes.push({id: `c${i}`, canal: id, em: 0, dur: batidas, padrao: `p${i}`});
    mixer.push({id, nome: `Faixa ${i}`, volume_db: -6 - (i % 5), pan: ((i % 9) - 4) / 5,
      ...(i % 2 === 0 ? {eq: {graves_db: 2 - (i % 4), medios_db: -1, agudos_db: (i % 3) - 1}} : {}),
      ...(i % 3 === 0 ? {compressor: {ativo: true, limiar_db: -18, razao: 3, ataque_ms: 6, soltura_ms: 120, ganho_db: 2}} : {}),
      ...(i % 2 === 1 ? {reverb: 0.2} : {}), ...(i % 4 === 1 ? {delay: 0.15} : {}),
      ...(!bateria && i % 6 === 2 && primeiraBateria ? {sidechain: {de: primeiraBateria, peca: 'bumbo', quanto_db: 8, ataque_ms: 4, soltura_ms: 200}} : {})});
    if (i % 8 === 3) automacoes.push({alvo: id, parametro: 'volume', pontos: [{em: 0, db: -20}, {em: batidas / 2, db: 0}, {em: batidas, db: -10}]});
  }
  automacoes.push({alvo: 'master', parametro: 'volume', pontos: [{em: 0, db: 0}, {em: batidas - 8, db: 0}, {em: batidas, db: -12}]});
  return {formato: 1, tipo: 'musica', titulo: `Sintética ${faixas} faixas, ${segundos} s`, bpm: 120, compasso: [4, 4], tom: 'C', escala: 'menor', swing: 0, semente: 3,
    canais, padroes, arranjo: {clipes}, mixer: {faixas: mixer, master: {volume_db: 0, reverb: {tamanho: 0.7, amortecimento: 0.4, volume_db: -3},
      delay: {tempo: '1/8.', realimentacao: 0.4, brilho: 0.5, pingue_pongue: true, volume_db: -4}, limitador: {ativo: true, teto_db: -1}}}, marcadores: [], automacoes};
};

type Medida = {motor: string; segundos: number; faixas: number; disco: boolean; stems: boolean; tempo_ms: number; tempo2_ms?: number; pico_mb: number; hash: string};

const medirAqui = async (): Promise<Medida> => {
  const motor = arg('--motor') ?? 'grafo';
  const segundos = Number(arg('--segundos') ?? 60), faixas = Number(arg('--faixas') ?? 24);
  const stems = tem('--stems'), disco = tem('--disco');
  const som = await import(pathToFileURL(path.join(raiz, 'src/nucleo/musica-som.ts')).href);
  const {hashDoPcm} = await import(pathToFileURL(path.join(raiz, 'src/nucleo/musica-hash.ts')).href);
  const render = motor === 'antigo' ? som.renderizarMusicaAntigo : som.renderizarMusica;
  const doc = docSintetico(faixas, segundos);
  let pasta: string | null = null;
  let armazem: unknown;
  if (disco) {
    const {CacheAudioDisco} = await import(pathToFileURL(path.join(raiz, 'src/nucleo/cache-audio.ts')).href);
    pasta = mkdtempSync(path.join(tmpdir(), 'estudio-medir-'));
    armazem = new CacheAudioDisco(pasta, {teto_bytes: 64 * 1024 ** 3});
  }
  try {
    let t = performance.now();
    let r = render(doc, {}, {porFaixa: stems, ...(armazem ? {armazem} : {})});
    const tempo_ms = performance.now() - t;
    let tempo2_ms: number | undefined;
    const hash = hashDoPcm(r.canais);
    if (armazem) {
      r = null;
      t = performance.now();
      r = render(doc, {}, {porFaixa: stems, armazem});
      tempo2_ms = performance.now() - t;
      if (hashDoPcm(r.canais) !== hash) throw new Error('o render pelo cache em disco deu outro hash');
    }
    return {motor, segundos, faixas, disco, stems, tempo_ms: Math.round(tempo_ms), ...(tempo2_ms !== undefined ? {tempo2_ms: Math.round(tempo2_ms)} : {}),
      pico_mb: Math.round(process.resourceUsage().maxRSS / 1024), hash};
  } finally {
    if (pasta) rmSync(pasta, {recursive: true, force: true});
  }
};

if (tem('--tudo')) {
  // cada medida num processo novo (o pico de memória é do processo inteiro)
  const casos: string[][] = [];
  const motores = (arg('--motores') ?? 'antigo,grafo').split(',');
  for (const s of (arg('--duracoes') ?? '60,300').split(','))
    for (const m of motores) {
      casos.push(['--motor', m, '--segundos', s]);
      casos.push(['--motor', m, '--segundos', s, '--stems']);
      if (m === 'grafo' && tem('--com-disco')) casos.push(['--motor', m, '--segundos', s, '--disco']);
    }
  const linhas: Medida[] = [];
  for (const c of casos) {
    const r = spawnSync(process.execPath, ['--max-old-space-size=16384', '--import', 'tsx', aqui, '--raiz', raiz, '--faixas', arg('--faixas') ?? '24', ...c], {encoding: 'utf8',
      maxBuffer: 1 << 20});
    if (r.status !== 0) {
      console.error(c.join(' '), r.stderr.slice(-2000));
      continue;
    }
    const m = JSON.parse(r.stdout.trim().split('\n').pop()!) as Medida;
    linhas.push(m);
    console.error(JSON.stringify(m));
  }
  console.log('| motor | duração | stems | cache em disco | tempo | pico de RSS | hash (início) |');
  console.log('|---|---|---|---|---|---|---|');
  for (const m of linhas)
    console.log(`| ${m.motor} | ${m.segundos} s | ${m.stems ? 'sim' : 'não'} | ${m.disco ? `sim (2º render: ${(m.tempo2_ms! / 1000).toFixed(1)} s)` : 'não'} | ${(m.tempo_ms / 1000).toFixed(1)} s | ${m.pico_mb} MB | ${m.hash.slice(0, 12)} |`);
} else {
  console.log(JSON.stringify(await medirAqui()));
}
