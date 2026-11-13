// Contrato de determinismo da música (M-03, ADR A4): cada documento de referência de testes/fixtures/musica-referencia/
// renderizado pelo motor de agora tem que dar o mesmo SHA-256 do PCM que está em hashes.json. Esses hashes são o oráculo
// da migração do motor por blocos (onda M1): um documento antigo tem que soar igual, bit a bit. O mesmo hash pelo MCP por
// stdio sai de scripts/hashes-musica.mjs. Regravar o hashes.json (só quando a mudança de som foi decidida e aprovada):
// ESTUDIO_GRAVAR_HASHES=1 npx vitest run testes/musica-determinismo.test.ts. Ver docs/musica.md, seção "Determinismo".
import {createHash} from 'node:crypto';
import {cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {Projeto, serializar} from '../src/nucleo/projeto';
import {definirServicoMusica} from '../src/nucleo/musica-projeto';
import {servicoDeRender} from '../src/main/musica-render';
import {hashDaMusica, hashDoPcm, sha256, Sha256, type HashMusica} from '../src/nucleo/musica-hash';
import {audiosDaMusica, type DocMusica} from '../src/nucleo/musica';
import {geradorDe, renderizarMusica, TAXA_MUSICA, type CacheSom} from '../src/nucleo/musica-som';
import {lerWav} from '../src/main/ffmpeg-som';
import type {FonteAudio} from '../src/nucleo/loudness';

const PASTA = path.join(__dirname, 'fixtures', 'musica-referencia');
const ARQUIVO_HASHES = path.join(PASTA, 'hashes.json');
type Hashes = {formato: 1; pcm: string; taxa: number; musicas: Record<string, Omit<HashMusica, 'taxa'>>};

const nomes = readdirSync(PASTA).filter((f) => f.endsWith('.json') && f !== 'hashes.json').map((f) => f.replace(/\.json$/, '')).sort();
const lerDoc = (nome: string) => JSON.parse(readFileSync(path.join(PASTA, `${nome}.json`), 'utf8')) as DocMusica;
/** Os áudios do documento, lidos como o render do processo lê um WAV a 48 kHz (decodificarParaMusica). */
const fontesDe = (doc: DocMusica): Record<string, FonteAudio> =>
  Object.fromEntries(audiosDaMusica(doc).map((a) => [a, lerWav(readFileSync(path.join(PASTA, a)))]));
const hashDe = (nome: string) => {
  const doc = lerDoc(nome);
  return hashDaMusica(doc, fontesDe(doc));
};

describe('SHA-256 puro', () => {
  it('bate com o node:crypto em tamanhos que cruzam a borda do bloco e em pedaços', () => {
    const g = geradorDe(9);
    for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 70_001]) {
      const b = Uint8Array.from({length: n}, () => Math.floor((g() + 1) * 128) & 255);
      const esperado = createHash('sha256').update(b).digest('hex');
      expect(sha256(b), `n=${n}`).toBe(esperado);
      const s = new Sha256();
      for (let i = 0; i < n; i += 37) s.somar(b.subarray(i, i + 37));
      expect(s.fim(), `n=${n} em pedaços`).toBe(esperado);
    }
    expect(sha256(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('o hash do PCM é o dos bytes float32 little-endian intercalados (L R L R), em mais de um pedaço', () => {
    const n = 20_000;
    const g = geradorDe(3);
    const L = Float32Array.from({length: n}, () => g());
    const R = Float32Array.from({length: n}, () => g() * 0.5);
    const bytes = Buffer.alloc(n * 8);
    for (let i = 0; i < n; i++) {
      bytes.writeFloatLE(L[i], i * 8);
      bytes.writeFloatLE(R[i], i * 8 + 4);
    }
    expect(hashDoPcm([L, R])).toBe(createHash('sha256').update(bytes).digest('hex'));
    // −0 e +0 contam diferente: o contrato é bit a bit
    expect(hashDoPcm([Float32Array.of(0)])).not.toBe(hashDoPcm([Float32Array.of(-0)]));
    expect(() => hashDoPcm([L, R.subarray(1)])).toThrow();
  });
});

describe('documentos de referência', () => {
  const esperados = JSON.parse(readFileSync(ARQUIVO_HASHES, 'utf8')) as Hashes;

  it('o hashes.json cobre exatamente os documentos da pasta, na taxa do vídeo', () => {
    expect(nomes.length).toBeGreaterThanOrEqual(6);
    expect(esperados.taxa).toBe(TAXA_MUSICA);
    expect(Object.keys(esperados.musicas).sort()).toEqual(nomes);
  });

  for (const nome of nomes) {
    it(`${nome}: o motor de agora dá o hash de referência`, () => {
      const doc = lerDoc(nome);
      const r = renderizarMusica(doc, fontesDe(doc), {taxa: TAXA_MUSICA});
      expect(r.faltando).toEqual([]);
      // nenhum documento de referência é silêncio: um hash de zeros não provaria nada
      expect(r.canais.some((c) => c.some((x) => x !== 0)), 'tem som').toBe(true);
      const h = hashDe(nome);
      expect({pcm_sha256: h.pcm_sha256, amostras: h.amostras, canais: h.canais}).toEqual(esperados.musicas[nome]);
    });
  }

  it('a prévia com cache (o worker da janela) dá o mesmo PCM que o render canônico, também depois de mexer e voltar', () => {
    for (const nome of ['batida', 'sidechain-automacao']) {
      const doc = lerDoc(nome);
      const fontes = fontesDe(doc);
      const cache: CacheSom = new Map();
      renderizarMusica(doc, fontes, {cache});
      const mexido = structuredClone(doc);
      mexido.mixer.faixas[0].volume_db = (mexido.mixer.faixas[0].volume_db ?? 0) - 3;
      renderizarMusica(mexido, fontes, {cache});
      const r = renderizarMusica(doc, fontes, {cache, porFaixa: true});
      expect(hashDoPcm(r.canais), nome).toBe(esperados.musicas[nome].pcm_sha256);
    }
  });
});

describe('pelo MCP (o mesmo registro do app e do stdio)', () => {
  it('medir_musica com hash devolve o SHA-256 do PCM feito pelo processo, igual ao de referência', async () => {
    const esperados = (JSON.parse(readFileSync(ARQUIVO_HASHES, 'utf8')) as Hashes).musicas;
    const pasta = mkdtempSync(path.join(tmpdir(), 'estudio-hashes-'));
    const docs = ['efeito-sonoro', 'sintetizadores-audio']; // o mais curto e o que tem áudio de fora
    mkdirSync(path.join(pasta, 'musica'));
    for (const n of docs) cpSync(path.join(PASTA, `${n}.json`), path.join(pasta, 'musica', `${n}.json`));
    cpSync(path.join(PASTA, 'midia'), path.join(pasta, 'midia'), {recursive: true});
    writeFileSync(path.join(pasta, 'estudio.json'), serializar({formato: 1, nome: 'Hashes', documentos: docs.map((n) => ({id: n, modulo: 'musica', caminho: `musica/${n}.json`, titulo: n}))}));
    definirServicoMusica(servicoDeRender());
    const servidor = new McpServer({name: 'estudio', version: '0'});
    registrarFerramentas(servidor, new Projeto(pasta), 'agente', 'teste');
    const cliente = new Client({name: 'teste', version: '0'});
    const [a, b] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([servidor.connect(a), cliente.connect(b)]);
      for (const n of docs) {
        const r = (await cliente.callTool({name: 'medir_musica', arguments: {documento: n, hash: true}})) as {isError?: boolean; content: {text: string}[]};
        expect(r.isError, r.content[0].text).toBeFalsy();
        const d = JSON.parse(r.content[0].text) as {pcm_sha256: string; amostras: number; feito_por: string};
        expect(d, n).toMatchObject({pcm_sha256: esperados[n].pcm_sha256, amostras: esperados[n].amostras, feito_por: 'processo'});
      }
      // sem hash, o resultado fica como era (curto)
      const sem = (await cliente.callTool({name: 'medir_musica', arguments: {documento: 'efeito-sonoro'}})) as {content: {text: string}[]};
      expect(JSON.parse(sem.content[0].text)).not.toHaveProperty('pcm_sha256');
    } finally {
      await cliente.close();
      definirServicoMusica(null);
      rmSync(pasta, {recursive: true, force: true});
    }
  });
});

// regravar o oráculo: só com a variável, e nunca no CI
if (process.env.ESTUDIO_GRAVAR_HASHES === '1') {
  it('regrava o hashes.json', () => {
    const musicas = Object.fromEntries(nomes.map((nome) => {
      const {pcm_sha256, amostras, canais} = hashDe(nome);
      return [nome, {pcm_sha256, amostras, canais}];
    }));
    const h: Hashes = {formato: 1, pcm: 'float32 little-endian, canais intercalados, mistura final a 48 kHz', taxa: TAXA_MUSICA, musicas};
    writeFileSync(ARQUIVO_HASHES, `${JSON.stringify(h, null, 2)}\n`);
  });
}
