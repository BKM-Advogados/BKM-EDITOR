// Suíte de aceitação sonora, parte automática (F-13, docs/aceitacao-som.md): cada documento de referência da M0 é
// renderizado pelo grafo (o render canônico) e analisado (espectro em 1/3 de oitava, crest, LUFS, pico, correlação
// estéreo). Os números ficam em valores.json e a comparação tem tolerância, para pegar o que o hash não diz: o hash só
// fala "mudou"; aqui se vê o quanto e onde (o graves sumiu? ficou 3 dB mais alto? virou mono?).
// Regravar os valores (só quando a mudança de som foi decidida e ouvida): ESTUDIO_GRAVAR_ACEITACAO=1 npx vitest run testes/aceitacao-som
import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {audiosDaMusica, type DocMusica} from '../../src/nucleo/musica';
import {renderizarMusica, type ResultadoSom} from '../../src/nucleo/musica-som';
import {renderizarMusicaGrafo} from '../../src/nucleo/audio-grafo/musica';
import {hashDoPcm} from '../../src/nucleo/musica-hash';
import {lerWav} from '../../src/main/ffmpeg-som';
import type {FonteAudio} from '../../src/nucleo/loudness';
import {analisarSom, CENTROS_HZ, type AnaliseSom} from './analise';

const PASTA = path.join(__dirname, '..', 'fixtures', 'musica-referencia');
const VALORES = path.join(__dirname, 'valores.json');
const nomes = readdirSync(PASTA).filter((f) => f.endsWith('.json') && f !== 'hashes.json').map((f) => f.replace(/\.json$/, '')).sort();
const hashes = (JSON.parse(readFileSync(path.join(PASTA, 'hashes.json'), 'utf8')) as {musicas: Record<string, {pcm_sha256: string}>}).musicas;
const gravar = process.env.ESTUDIO_GRAVAR_ACEITACAO === '1';

/** Tolerâncias. Folgadas o bastante para uma mudança de implementação que não deveria soar diferente (limitador causal com
 *  latência, compressor reescrito), apertadas o bastante para pegar uma banda sumindo ou um ganho trocado. */
export const TOLERANCIA = {
  banda_db: 1.5, // por banda de 1/3 de oitava
  banda_piso_db: -70, // bandas gravadas abaixo disto (quase silêncio) só precisam continuar abaixo de piso + banda_db
  lufs_lu: 0.5,
  pico_db: 0.7,
  crest_db: 1,
  correlacao: 0.05,
  lado_meio_db: 1.5,
  duracao_s: 0.05,
};

const render = (nome: string): ResultadoSom => {
  const doc = JSON.parse(readFileSync(path.join(PASTA, `${nome}.json`), 'utf8')) as DocMusica;
  const fontes: Record<string, FonteAudio> = Object.fromEntries(audiosDaMusica(doc).map((a) => [a, lerWav(readFileSync(path.join(PASTA, a)))]));
  return renderizarMusicaGrafo(doc, fontes);
};

const atuais: Record<string, AnaliseSom & {pcm_sha256: string}> = {};
const gravados: Record<string, AnaliseSom> = (() => { try { return JSON.parse(readFileSync(VALORES, 'utf8')); } catch { return {}; } })();

describe('aceitação sonora: documentos de referência pelo grafo', () => {
  it('o render canônico é o do grafo e há seis documentos de referência', () => {
    expect(renderizarMusica).toBe(renderizarMusicaGrafo);
    expect(nomes.length).toBe(6);
  });

  for (const nome of nomes) {
    it(`${nome}: espectro, nível, pico e estéreo dentro das tolerâncias`, () => {
      const r = render(nome);
      const a = analisarSom(r.canais, r.taxa);
      atuais[nome] = {...a, pcm_sha256: hashDoPcm(r.canais)};

      // sanidade que vale sempre, sem valores gravados: nada de NaN, nada acima de 0 dBFS, o limitador segurou o pico
      for (const x of r.canais) for (let i = 0; i < x.length; i += 97) expect(Number.isFinite(x[i])).toBe(true);
      expect(a.pico_amostra_db, 'pico de amostra').toBeLessThanOrEqual(0);
      expect(a.lufs, 'tem som').not.toBeNull();
      expect(a.bandas_db.length).toBe(CENTROS_HZ.length);
      if (gravar) return;

      const g = gravados[nome];
      expect(g, `sem valores gravados para ${nome}: rode com ESTUDIO_GRAVAR_ACEITACAO=1`).toBeDefined();
      expect(a.canais).toBe(g.canais);
      expect(Math.abs(a.duracao_s - g.duracao_s), 'duração').toBeLessThanOrEqual(TOLERANCIA.duracao_s);
      expect(Math.abs(a.lufs! - g.lufs!), `LUFS ${a.lufs} contra ${g.lufs}`).toBeLessThanOrEqual(TOLERANCIA.lufs_lu);
      expect(Math.abs(a.pico_amostra_db - g.pico_amostra_db), 'pico de amostra').toBeLessThanOrEqual(TOLERANCIA.pico_db);
      expect(Math.abs(a.pico_dbtp! - g.pico_dbtp!), 'pico verdadeiro').toBeLessThanOrEqual(TOLERANCIA.pico_db);
      expect(Math.abs(a.crest_db - g.crest_db), `crest ${a.crest_db} contra ${g.crest_db}`).toBeLessThanOrEqual(TOLERANCIA.crest_db);
      if (g.correlacao !== null) expect(Math.abs(a.correlacao! - g.correlacao), `correlação ${a.correlacao} contra ${g.correlacao}`).toBeLessThanOrEqual(TOLERANCIA.correlacao);
      if (g.lado_meio_db !== null) expect(Math.abs(a.lado_meio_db! - g.lado_meio_db), 'lado/meio').toBeLessThanOrEqual(TOLERANCIA.lado_meio_db);
      const ruins: string[] = [];
      g.bandas_db.forEach((v, i) => {
        const dif = a.bandas_db[i] - v;
        const fora = v < TOLERANCIA.banda_piso_db ? a.bandas_db[i] > TOLERANCIA.banda_piso_db + TOLERANCIA.banda_db : Math.abs(dif) > TOLERANCIA.banda_db;
        if (fora) ruins.push(`${CENTROS_HZ[i]} Hz: ${a.bandas_db[i]} dB contra ${v} dB`);
      });
      expect(ruins, 'bandas de 1/3 de oitava fora da tolerância').toEqual([]);
    });
  }

  it('o PCM analisado é o do hash de referência (a análise vale para o som que o oráculo guarda)', () => {
    for (const nome of nomes) {
      if (!atuais[nome]) continue;
      // se o hash mudou de propósito (limitador causal, por exemplo), os valores acima é que dizem o quanto soa diferente
      if (atuais[nome].pcm_sha256 !== hashes[nome].pcm_sha256) console.warn(`aceitação: ${nome} não tem mais o hash de referência da M0`);
    }
    if (gravar) writeFileSync(VALORES, JSON.stringify(Object.fromEntries(nomes.map((n) => [n, (({pcm_sha256: _h, ...resto}) => resto)(atuais[n])])), null, 2) + '\n');
  });
});
