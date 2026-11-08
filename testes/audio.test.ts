// Som do vídeo de cenas: envelope com ponderação K, ducking medido, resolução das faixas (fades, limites, avisos) e o
// IPC de áudio (envelope ao lado do arquivo, biblioteca de trilhas).
import {mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {
  calcularDucking, conferirEnvelope, DUCKING_PADRAO, ehEnvelope, envelopeDeAmostras, fatorFades, ganhoDeDb, JANELA_MS, nivelDeReferencia, novaFaixaAudio, novoAudioCenas, papelDe, referenciaDeJanelas,
  resolverAudio, SILENCIO_DB, volumeDoClipe, type Envelope,
} from '../src/nucleo/audio';
import {novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {gravarPlano, planoDoProjeto} from '../src/nucleo/criar-projeto';
import {Projeto} from '../src/nucleo/projeto';
import {arquivoDoEnvelope, gravarEnvelope, importarTrilha, lerEnvelope, lerEnvelopes, listarTrilhas, registrarIpcAudio, sha256DoArquivo} from '../src/main/ipc-audio';
import {CANAL} from '../src/compartilhado/api';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-audio-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

const seno = (hz: number, segundos: number, taxa: number, amplitude = 1) => {
  const out = new Float32Array(Math.round(segundos * taxa));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / taxa);
  return out;
};

/** Envelope sintético: `db` constante, com trechos [de, até) em outro nível. */
const envelope = (duracao_ms: number, base: number, trechos: [number, number, number][] = []): Envelope => {
  const db: number[] = [];
  for (let t = 0; t < duracao_ms; t += JANELA_MS) {
    const tr = trechos.find(([a, b]) => t >= a && t < b);
    db.push(tr ? tr[2] : base);
  }
  return {versao: 2, janela_ms: JANELA_MS, duracao_ms, db};
};

describe('envelope', () => {
  it('seno a 300 Hz com amplitude 1 dá −3,7 dB por janela (a ponderação K é plana entre 38 Hz e a prateleira de 1,5 kHz)', () => {
    const env = envelopeDeAmostras([seno(300, 1, 48000)], 48000);
    expect(env.duracao_ms).toBe(1000);
    expect(env.db).toHaveLength(20);
    for (const v of env.db.slice(1)) expect(Math.abs(v - -3.7)).toBeLessThan(0.4);
    // em 1 kHz a prateleira já sobe um pouco; em 3 kHz dá os +4 dB da ponderação
    expect(envelopeDeAmostras([seno(3000, 0.5, 48000)], 48000).db[5]).toBeGreaterThan(-0.5);
  });
  it('silêncio é SILENCIO_DB e graves abaixo de 38 Hz somem', () => {
    const env = envelopeDeAmostras([new Float32Array(4800)], 48000);
    expect(env.db.every((v) => v === SILENCIO_DB)).toBe(true);
    const grave = envelopeDeAmostras([seno(20, 1, 48000)], 48000);
    expect(grave.db[10]).toBeLessThan(-10);
  });
  it('dois canais somam a potência (+3 dB)', () => {
    const mono = envelopeDeAmostras([seno(300, 0.5, 44100)], 44100).db[5];
    const estereo = envelopeDeAmostras([seno(300, 0.5, 44100), seno(300, 0.5, 44100)], 44100).db[5];
    expect(Math.abs(estereo - mono - 3)).toBeLessThan(0.2);
  });
  it('referência é a mediana do que passa pelas portas', () => {
    expect(referenciaDeJanelas([])).toBeNull();
    expect(referenciaDeJanelas([-100, -100])).toBeNull();
    expect(referenciaDeJanelas([-20, -21, -19, -100, -100, -60])).toBe(-20); // −60 cai na porta relativa, −100 na absoluta
    const env = envelope(2000, -30, [[0, 500, -10]]);
    expect(nivelDeReferencia(env, 0, 500)).toBe(-10);
    expect(nivelDeReferencia(env, 500, 2000)).toBe(-30);
  });
});

describe('ducking', () => {
  const voz = envelope(5000, SILENCIO_DB, [[1000, 3000, -20]]);
  const musica = envelope(10000, -14);

  it('baixa a música o que falta para ficar o alvo abaixo da voz, com ataque e soltura', () => {
    const r = calcularDucking({musica: {em: 0, duracao_ms: 5000, corte_ms: 0, ganho_db: 0, env: musica}, vozes: [{em: 0, duracao_ms: 5000, corte_ms: 0, ganho_db: 0, env: voz}],
      alvo_lu: 20, ataque_ms: 100, soltura_ms: 500});
    expect(r.medido).toBe(true);
    expect(r.voz_db).toBe(-20);
    expect(r.musica_db).toBe(-14);
    expect(r.reducao_db).toBe(26); // −14 − (−20 − 20)
    expect(r.ganho).toHaveLength(100);
    expect(r.ganho[10]).toBe(1); // 0,5 s: sem voz
    expect(r.ganho[20]).toBeCloseTo(ganhoDeDb(-13), 2); // primeira janela com voz: meio do ataque de 100 ms
    expect(r.ganho[21]).toBeCloseTo(ganhoDeDb(-26), 3); // ataque completo
    expect(r.ganho[50]).toBeCloseTo(ganhoDeDb(-26), 3); // 2,5 s: sob a voz
    expect(r.ganho[65]).toBeCloseTo(ganhoDeDb(-26 * 0.4), 2); // 3,25 s: metade da soltura de 500 ms, mais ou menos
    expect(r.ganho[75]).toBe(1); // 3,75 s: soltou
  });
  it('conta o ganho da faixa e do clipe nos dois lados e respeita o corte da música', () => {
    const r = calcularDucking({musica: {em: 1000, duracao_ms: 2000, corte_ms: 4000, ganho_db: -6, env: musica}, vozes: [{em: 0, duracao_ms: 5000, corte_ms: 0, ganho_db: 3, env: voz}], alvo_lu: 23});
    expect(r.musica_db).toBe(-20);
    expect(r.voz_db).toBe(-17);
    expect(r.reducao_db).toBe(20); // −20 − (−17 − 23)
    expect(r.ganho[0]).toBeLessThan(1); // o clipe começa em 1 s, já sob a voz
  });
  it('não baixa quando a música já está abaixo do alvo; sem envelope supõe níveis típicos', () => {
    const baixa = calcularDucking({musica: {em: 0, duracao_ms: 5000, corte_ms: 0, ganho_db: 0, env: envelope(5000, -45)}, vozes: [{em: 0, duracao_ms: 5000, corte_ms: 0, ganho_db: 0, env: voz}]});
    expect(baixa.reducao_db).toBe(0);
    expect(baixa.ganho.every((g) => g === 1)).toBe(true);
    const semMedida = calcularDucking({musica: {em: 0, duracao_ms: 2000, corte_ms: 0, ganho_db: 0}, vozes: [{em: 0, duracao_ms: 2000, corte_ms: 0, ganho_db: 0}]});
    expect(semMedida.medido).toBe(false);
    expect(semMedida.reducao_db).toBe(26); // −14 − (−20 − 20) com os níveis supostos
    expect(semMedida.ganho[semMedida.ganho.length - 1]).toBeLessThan(1); // voz sem envelope conta o tempo todo
  });
  it('sem voz nenhuma o ganho é 1', () => {
    const r = calcularDucking({musica: {em: 0, duracao_ms: 1000, corte_ms: 0, ganho_db: 0, env: musica}, vozes: []});
    expect(r.reducao_db).toBe(0);
    expect(r.ganho.every((g) => g === 1)).toBe(true);
  });
});

describe('resolver com áudio', () => {
  const base = novoDocCenas({largura: 1080, altura: 1920, fps: 30});
  const comCenas = (ms: number[]): DocCenas => ({...base, cenas: ms.map((d, i) => ({id: `c${i}`, duracao_ms: d, blocos: []}))});
  const voz = envelope(6000, -22);
  const musica = envelope(30000, -12);

  it('documento sem áudio continua válido e sem props de áudio', () => {
    const {props, avisos} = resolverCenas(comCenas([4000]));
    expect(props.audio).toBeUndefined();
    expect(avisos).toEqual([]);
    expect(resolverAudio(undefined, 4000).audio).toBeUndefined();
  });

  it('leva faixas e clipes às props, com envelope, nível e ducking na música', () => {
    const doc: DocCenas = {...comCenas([5000, 5000]), audio: {faixas: [
      {id: 'narracao', nome: 'Narração', papel: 'voz', clipes: [{id: 'n1', arquivo: 'midia/narracao.wav', em: 500, duracao_ms: 6000}]},
      {id: 'musica', nome: 'Música', papel: 'musica', volume: 0.5, ducking: {ativo: true, alvo_lu: 20}, clipes: [{id: 'm1', arquivo: 'midia/musica.mp3', em: 0, duracao_ms: 10000, fade_out_ms: 1500}]},
      {id: 'fx', nome: 'Efeitos', clipes: []},
    ]}};
    const {props, avisos} = resolverCenas(doc, {envelopes: {'midia/narracao.wav': voz, 'midia/musica.mp3': musica}});
    expect(avisos).toEqual([]);
    const [n, m, fx] = props.audio!.faixas;
    expect(n).toMatchObject({origem: '/audio/faixas/0', papel: 'voz', volume: 1, mudo: false});
    expect(n.clipes[0]).toMatchObject({origem: '/audio/faixas/0/clipes/0', nome: 'narracao.wav', em: 500, duracao_ms: 6000, corte_ms: 0, nivel_db: -22, fora: false});
    expect(fx.papel).toBe('efeitos');
    expect(m.ducking).toEqual({ativo: true, alvo_lu: 20, ataque_ms: DUCKING_PADRAO.ataque_ms, soltura_ms: DUCKING_PADRAO.soltura_ms});
    const d = m.clipes[0].ducking!;
    expect(d.medido).toBe(true);
    expect(d.musica_db).toBeCloseTo(-12 - 6.02, 1); // volume 0,5 da faixa
    expect(d.reducao_db).toBeCloseTo(-18 - (-22 - 20), 0);
    expect(d.ganho[0]).toBe(1); // antes da narração
    expect(d.ganho[40]).toBeLessThan(0.1); // 2 s: sob a voz
    // volume por quadro: faixa × clipe × fade × ducking
    expect(volumeDoClipe(m, m.clipes[0], 9999)).toBeCloseTo(0, 2); // fade de saída chegando ao fim
    expect(volumeDoClipe(m, m.clipes[0], 100)).toBeCloseTo(0.5, 2);
    expect(volumeDoClipe({...m, mudo: true}, m.clipes[0], 100)).toBe(0);
  });

  it('avisa o que está fora do lugar sem errar: antes do zero, depois do fim, além do arquivo, volume alto', () => {
    const doc: DocCenas = {...comCenas([4000]), audio: {faixas: [
      {id: 'f', nome: 'Narração', volume: 3, clipes: [
        {id: 'a', arquivo: 'midia/a.wav', em: -200, duracao_ms: 1000},
        {id: 'b', arquivo: 'midia/a.wav', em: 5000, duracao_ms: 1000},
        {id: 'c', arquivo: 'midia/a.wav', em: 3000, duracao_ms: 5000, corte_ms: 2000},
        {id: 'd', arquivo: 'midia/a.wav', em: 0, duracao_ms: 1000, corte_ms: 9000},
      ]},
    ]}};
    const {props, avisos} = resolverCenas(doc, {envelopes: {'midia/a.wav': envelope(6000, -20)}});
    const [f] = props.audio!.faixas;
    expect(f.volume).toBe(1);
    expect(f.clipes[0].em).toBe(0);
    expect(f.clipes[1].fora).toBe(true);
    expect(f.clipes[2].duracao_ms).toBe(4000); // 6 s de arquivo − 2 s de corte
    expect(f.clipes[3].corte_ms).toBe(0);
    expect(avisos.map((a) => a.split(' ')[0])).toEqual(['a', 'o', 'o', 'o', 'o', 'o']);
    expect(avisos.join('\n')).toMatch(/antes do zero/);
    expect(avisos.join('\n')).toMatch(/depois do fim do vídeo/);
    expect(avisos.join('\n')).toMatch(/mais do que o arquivo tem/);
    expect(avisos.join('\n')).toMatch(/passa do fim do arquivo/);
    expect(avisos.join('\n')).toMatch(/volume 3/);
  });

  it('música sem envelope e narração sem envelope viram aviso e ducking estimado', () => {
    const doc: DocCenas = {...comCenas([5000]), audio: {faixas: [
      {id: 'v', nome: 'Voz', clipes: [{id: 'n', arquivo: 'midia/n.wav', em: 0, duracao_ms: 3000}]},
      {id: 'm', nome: 'Trilha', clipes: [{id: 'm', arquivo: 'midia/m.mp3', em: 0, duracao_ms: 5000}]},
    ]}};
    const {props, avisos} = resolverCenas(doc);
    expect(props.audio!.faixas.map((f) => f.papel)).toEqual(['voz', 'musica']);
    const d = props.audio!.faixas[1].clipes[0].ducking!;
    expect(d.medido).toBe(false);
    expect(d.ganho[10]).toBeLessThan(1);
    expect(avisos.join('\n')).toMatch(/ainda não foi medida/);
    expect(avisos.join('\n')).toMatch(/narração ainda não foi medido/);
  });

  it('fades, papéis e faixas novas', () => {
    const c = {duracao_ms: 4000, fade_in_ms: 1000, fade_out_ms: 500};
    expect(fatorFades(c, 0)).toBe(0);
    expect(fatorFades(c, 500)).toBe(0.5);
    expect(fatorFades(c, 2000)).toBe(1);
    expect(fatorFades(c, 3750)).toBe(0.5);
    expect(fatorFades({duracao_ms: 1000, fade_in_ms: 0, fade_out_ms: 0}, 0)).toBe(1);
    expect(papelDe({nome: 'Locução'})).toBe('voz');
    expect(papelDe({nome: 'Cama de fundo'})).toBe('musica');
    expect(papelDe({nome: 'Qualquer', papel: 'voz'})).toBe('voz');
    expect(papelDe({papel: 'errado', nome: 'x'})).toBe('efeitos');
    expect(novoAudioCenas().faixas.map((f) => f.id)).toEqual(['narracao', 'musica', 'efeitos']);
    expect(novaFaixaAudio('musica', 'm2').ducking).toMatchObject({ativo: true, alvo_lu: 20});
    expect(novaFaixaAudio('voz', 'v2').ducking).toBeUndefined();
  });
});

describe('ipc de áudio', () => {
  it('lê os envelopes gravados ao lado dos arquivos do projeto', () => {
    const raiz = gravarPlano(path.join(tmp, 'proj'), planoDoProjeto({nome: 'Som', modelo: 'video-branco'}));
    const p = new Projeto(raiz);
    writeFileSync(path.join(raiz, 'midia', 'voz.wav'), 'x');
    gravarEnvelope(p, 'midia/voz.wav', envelope(1000, -20));
    p.gravarTexto(arquivoDoEnvelope('midia/quebrado.wav'), '{"versao": 2}');
    const doc = {...novoDocCenas({largura: 1080, altura: 1920, fps: 30}), audio: {faixas: [{id: 'f', nome: 'Narração', clipes: [
      {id: 'a', arquivo: 'midia/voz.wav', em: 0, duracao_ms: 1000}, {id: 'b', arquivo: 'midia/quebrado.wav', em: 0, duracao_ms: 1000}, {id: 'c', arquivo: 'midia/nada.wav', em: 0, duracao_ms: 1000},
    ]}]}};
    const envs = lerEnvelopes(p, doc);
    expect(envs['midia/voz.wav']?.db).toHaveLength(20);
    expect(envs['midia/quebrado.wav']).toBeUndefined();
    expect(envs['midia/nada.wav']).toBeUndefined();
  });

  it('som-D14: o envelope sai na versão 2, e o da 0.3.0 (versão 1, ponderação K antiga) conta como não medido', () => {
    expect(envelopeDeAmostras([seno(300, 0.2, 48000)], 48000).versao).toBe(2);
    expect(ehEnvelope({...envelope(1000, -20), versao: 1})).toBe(false);
    expect(ehEnvelope({...envelope(1000, -20), fonte: {tamanho: 'x'}})).toBe(false);
    const raiz = gravarPlano(path.join(tmp, 'proj-v1'), planoDoProjeto({nome: 'Som v1', modelo: 'video-branco'}));
    const p = new Projeto(raiz);
    writeFileSync(path.join(raiz, 'midia', 'voz.wav'), 'tomada');
    p.gravarTexto(arquivoDoEnvelope('midia/voz.wav'), JSON.stringify({...envelope(1000, -20), versao: 1}));
    expect(lerEnvelope(p, 'midia/voz.wav')).toBeUndefined(); // a interface mede de novo
    gravarEnvelope(p, 'midia/voz.wav', envelope(1000, -20));
    expect(lerEnvelope(p, 'midia/voz.wav')?.versao).toBe(2);
  });

  it('som-D2: o envelope guarda tamanho, data e sha256; tomada regravada com o mesmo nome deixa de valer, a mesma copiada vale', () => {
    const raiz = gravarPlano(path.join(tmp, 'proj-tomada'), planoDoProjeto({nome: 'Tomada', modelo: 'video-branco'}));
    const p = new Projeto(raiz);
    const abs = path.join(raiz, 'midia', 'narracao.wav');
    const regravar = (texto: string, quando: Date) => {
      writeFileSync(abs, texto);
      utimesSync(abs, quando, quando);
    };
    regravar('tomada um', new Date('2026-11-01T10:00:00Z'));
    gravarEnvelope(p, 'midia/narracao.wav', envelope(30000, -20));
    const gravado = lerEnvelope(p, 'midia/narracao.wav');
    expect(gravado?.fonte).toEqual({tamanho: 9, modificado_ms: statSync(abs).mtimeMs, sha256: sha256DoArquivo(abs)});
    // a mesma tomada com outra data (cópia, git clone em outro PC): o sha256 confere e o envelope vale
    regravar('tomada um', new Date('2026-11-03T10:00:00Z'));
    expect(lerEnvelope(p, 'midia/narracao.wav')).toBeDefined();
    // outra tomada do mesmo tamanho: o sha256 não confere
    regravar('tomada 2!', new Date('2026-11-04T10:00:00Z'));
    expect(lerEnvelope(p, 'midia/narracao.wav')).toBeUndefined();
    // outra tomada mais longa: o tamanho não confere; o clipe de 40 s não é mais encolhido aos 30 s do envelope velho
    regravar('a tomada nova, mais longa', new Date('2026-11-05T10:00:00Z'));
    expect(lerEnvelope(p, 'midia/narracao.wav')).toBeUndefined();
    const doc = {...novoDocCenas({largura: 1080, altura: 1920, fps: 30}), audio: {faixas: [{id: 'f', nome: 'Narração', papel: 'voz' as const, clipes: [
      {id: 'a', arquivo: 'midia/narracao.wav', em: 0, duracao_ms: 40000}]}]}};
    const {props, avisos} = resolverCenas(doc, {envelopes: lerEnvelopes(p, doc)});
    expect(props.audio?.faixas[0].clipes[0].duracao_ms).toBe(40000);
    expect(avisos.join(' ')).toMatch(/ainda não foi medido/);
    // com o envelope velho, o mesmo documento encolhia o clipe (o defeito)
    expect(resolverCenas(doc, {envelopes: {'midia/narracao.wav': envelope(30000, -20)}}).props.audio?.faixas[0].clipes[0].duracao_ms).toBe(30000);
    // a interface manda o tamanho e o sha256 do que mediu: se o arquivo mudou no meio, o processo principal recusa
    expect(() => gravarEnvelope(p, 'midia/narracao.wav', {...envelope(30000, -20), fonte: {tamanho: 9, sha256: gravado!.fonte!.sha256}})).toThrow(/mudou enquanto era medido/);
    gravarEnvelope(p, 'midia/narracao.wav', {...envelope(40000, -20), fonte: {tamanho: 25, sha256: sha256DoArquivo(abs)}});
    expect(lerEnvelope(p, 'midia/narracao.wav')?.duracao_ms).toBe(40000);
  });

  it('som-N8: o canal que a tela usa grava pelo gravarEnvelope: carimba a data e recusa o arquivo que mudou no meio da medida', () => {
    const raiz = gravarPlano(path.join(tmp, 'proj-ipc'), planoDoProjeto({nome: 'IPC', modelo: 'video-branco'}));
    const p = new Projeto(raiz);
    const abs = path.join(raiz, 'midia', 'voz.wav');
    writeFileSync(abs, 'tomada do ipc');
    const canais = new Map<string, (...a: any[]) => unknown>();
    registrarIpcAudio((canal, f) => void canais.set(canal, f as (...a: any[]) => unknown), () => p, () => ({pasta_trilhas: path.join(tmp, 'trilhas-ipc')} as never));
    const gravar = canais.get(CANAL.audioGravarEnvelope)!;
    // a tela manda o que mediu: tamanho e sha256 dos bytes (como medirArquivo, no envelope.ts)
    gravar('midia/voz.wav', {...envelope(1000, -20), fonte: {tamanho: 13, sha256: sha256DoArquivo(abs)}});
    const gravado = JSON.parse(readFileSync(path.join(raiz, 'midia', 'voz.wav.envelope.json'), 'utf-8'));
    expect(gravado.fonte).toEqual({tamanho: 13, modificado_ms: statSync(abs).mtimeMs, sha256: sha256DoArquivo(abs)}); // a data entra
    // com a data, a próxima sessão confere sem ler o áudio: em_dia, sem sha256
    expect(conferirEnvelope(gravado, {tamanho: 13, modificado_ms: statSync(abs).mtimeMs})).toBe('em_dia');
    // a tomada foi regravada enquanto a tela media: recusa, e o envelope de antes não é trocado
    writeFileSync(abs, 'outra tomada, maior');
    expect(() => gravar('midia/voz.wav', {...envelope(1000, -10), fonte: {tamanho: 13, sha256: gravado.fonte.sha256}})).toThrow(/mudou enquanto era medido/);
    expect(JSON.parse(readFileSync(path.join(raiz, 'midia', 'voz.wav.envelope.json'), 'utf-8')).db[0]).toBe(-20);
    // envelope inválido e arquivo que não existe continuam recusados
    expect(() => gravar('midia/voz.wav', {versao: 2})).toThrow(/inválido/);
    expect(() => gravar('midia/nada.wav', envelope(1000, -20))).toThrow(/não está no projeto/);
  });

  it('confere o envelope pelo carimbo: tamanho, depois data, depois o sha256', () => {
    const env = envelope(1000, -20);
    const agora = {tamanho: 100, modificado_ms: 1_700_000_000_000.25};
    expect(conferirEnvelope(env, agora)).toBe('velho'); // sem carimbo
    expect(conferirEnvelope({...env, fonte: {tamanho: 100, modificado_ms: 1_700_000_000_000.9, sha256: 'a'}}, agora)).toBe('em_dia');
    expect(conferirEnvelope({...env, fonte: {tamanho: 100, modificado_ms: 1_600_000_000_000, sha256: 'a'}}, agora)).toBe('conferir');
    expect(conferirEnvelope({...env, fonte: {tamanho: 100, modificado_ms: 1_600_000_000_000}}, agora)).toBe('velho');
    expect(conferirEnvelope({...env, fonte: {tamanho: 99, modificado_ms: agora.modificado_ms, sha256: 'a'}}, agora)).toBe('velho');
  });

  it('lista a pasta de trilhas (dois níveis, só áudio) e importa só de lá', () => {
    const pasta = path.join(tmp, 'trilhas');
    mkdirSync(path.join(pasta, 'calmas'), {recursive: true});
    writeFileSync(path.join(pasta, 'b.mp3'), 'b');
    writeFileSync(path.join(pasta, 'a.wav'), 'a');
    writeFileSync(path.join(pasta, 'capa.jpg'), 'nao');
    writeFileSync(path.join(pasta, 'calmas', 'piano.ogg'), 'p');
    const lista = listarTrilhas(pasta);
    expect(lista.map((t) => `${t.pasta}/${t.nome}`)).toEqual(['/a', '/b', 'calmas/piano']);
    expect(listarTrilhas(path.join(tmp, 'nova-pasta'))).toEqual([]); // cria e devolve vazia
    const raiz = gravarPlano(path.join(tmp, 'proj2'), planoDoProjeto({nome: 'Som 2', modelo: 'video-branco'}));
    const p = new Projeto(raiz);
    expect(importarTrilha(p, pasta, lista[2].caminho)).toBe('midia/piano.ogg');
    expect(importarTrilha(p, pasta, lista[2].caminho)).toBe('midia/piano (2).ogg');
    expect(() => importarTrilha(p, pasta, path.join(tmp, 'proj', 'midia', 'voz.wav'))).toThrow(/pasta de trilhas/);
    expect(() => importarTrilha(p, pasta, path.join(pasta, 'capa.jpg'))).toThrow(/formato/);
  });
});
