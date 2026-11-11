// A mídia do projeto (frente Casca, rodada 3): tipo, derivados sob o original, busca em menos de 100 ms com 500 arquivos,
// marcação de tomadas com diário e duração/dimensões lidas do cabeçalho.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import jsonpatch from 'fast-json-patch';
import {gravarPlano, planoDoProjeto} from '../src/nucleo/criar-projeto';
import {
  ARQUIVO_MARCAS_MIDIA, buscarMidia, classificarDerivado, comMarca, duracaoCurta, filtrarMidia, lerMarcasDeMidia, marcasVazias, montarIndice, paraBusca,
  pastasDaMidia, tamanhoCurto, tipoDaMidia, type ArquivoBruto,
} from '../src/nucleo/midia';
import {dimensoesDaImagem, duracaoDeMp4, duracaoDeWav} from '../src/nucleo/midia-cabecalho';
import {documentosQueUsam, indiceDaMidia, marcarMidia} from '../src/nucleo/midia-disco';
import {Projeto} from '../src/nucleo/projeto';
import {caminhoSemFundo} from '../src/nucleo/remover-fundo';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-midia-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

// ---------- arquivos sintéticos ----------
const wav = (segundos: number, taxa = 8000) => {
  const dados = taxa * 2 * segundos;
  const b = Buffer.alloc(44 + dados);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + dados, 4);
  b.write('WAVE', 8, 'latin1');
  b.write('fmt ', 12, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(taxa, 24);
  b.writeUInt32LE(taxa * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(dados, 40);
  return b;
};
const caixa = (tipo: string, ...filhos: Buffer[]) => {
  const corpo = Buffer.concat(filhos);
  const h = Buffer.alloc(8);
  h.writeUInt32BE(8 + corpo.length, 0);
  h.write(tipo, 4, 'latin1');
  return Buffer.concat([h, corpo]);
};
const mvhd0 = (escala: number, duracao: number) => {
  const c = Buffer.alloc(100);
  c.writeUInt32BE(escala, 12);
  c.writeUInt32BE(duracao, 16);
  return caixa('mvhd', c);
};
const mvhd1 = (escala: number, duracao: number) => {
  const c = Buffer.alloc(112);
  c[0] = 1;
  c.writeUInt32BE(escala, 20);
  c.writeUInt32BE(Math.floor(duracao / 2 ** 32), 24);
  c.writeUInt32BE(duracao % 2 ** 32, 28);
  return caixa('mvhd', c);
};
const mp4 = (mvhd: Buffer, moovNoFim = true) => {
  const ftyp = caixa('ftyp', Buffer.from('isom0000isomiso2', 'latin1'));
  const mdat = caixa('mdat', Buffer.alloc(5000, 7));
  const moov = caixa('moov', mvhd);
  return Buffer.concat(moovNoFim ? [ftyp, mdat, moov] : [ftyp, moov, mdat]);
};
const png = (l: number, a: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(l, 16);
  b.writeUInt32BE(a, 20);
  return b;
};
const jpeg = (l: number, a: number) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(14), Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, a >> 8, a & 255, l >> 8, l & 255, 0x03]), Buffer.alloc(12)]);
const gif = (l: number, a: number) => {
  const b = Buffer.alloc(14);
  b.write('GIF89a', 0, 'latin1');
  b.writeUInt16LE(l, 6);
  b.writeUInt16LE(a, 8);
  return b;
};
const webpLossless = (l: number, a: number) => {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1');
  b.write('WEBP', 8, 'latin1');
  b.write('VP8L', 12, 'latin1');
  b[20] = 0x2f;
  b.writeUInt32LE(((l - 1) | ((a - 1) << 14)) >>> 0, 21);
  return b;
};
const webpExtendido = (l: number, a: number) => {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1');
  b.write('WEBP', 8, 'latin1');
  b.write('VP8X', 12, 'latin1');
  b.writeUIntLE(l - 1, 24, 3);
  b.writeUIntLE(a - 1, 27, 3);
  return b;
};
const webpComPerda = (l: number, a: number) => {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1');
  b.write('WEBP', 8, 'latin1');
  b.write('VP8 ', 12, 'latin1');
  b[23] = 0x9d;
  b[24] = 0x01;
  b[25] = 0x2a;
  b.writeUInt16LE(l, 26);
  b.writeUInt16LE(a, 28);
  return b;
};

describe('cabeçalhos', () => {
  it('dimensões de PNG, JPEG, GIF e WebP', () => {
    expect(dimensoesDaImagem(png(1080, 1920))).toEqual({largura: 1080, altura: 1920});
    expect(dimensoesDaImagem(jpeg(4000, 3000))).toEqual({largura: 4000, altura: 3000});
    expect(dimensoesDaImagem(gif(320, 200))).toEqual({largura: 320, altura: 200});
    expect(dimensoesDaImagem(webpLossless(800, 600))).toEqual({largura: 800, altura: 600});
    expect(dimensoesDaImagem(webpExtendido(1920, 1080))).toEqual({largura: 1920, altura: 1080});
    expect(dimensoesDaImagem(webpComPerda(640, 480))).toEqual({largura: 640, altura: 480});
    expect(dimensoesDaImagem(Buffer.from('não é imagem nenhuma, só texto de enchimento aqui'))).toBeNull();
    expect(dimensoesDaImagem(Buffer.alloc(0))).toBeNull();
  });

  it('duração do WAV pelo tamanho do chunk de dados, e pelo arquivo quando o cabeçalho de gravação está em branco', () => {
    const b = wav(3);
    expect(duracaoDeWav(b, b.length)).toBe(3000);
    const emGravacao = Buffer.from(b);
    emGravacao.writeUInt32LE(0xffffffff, 40);
    expect(duracaoDeWav(emGravacao, b.length)).toBe(3000);
    expect(duracaoDeWav(Buffer.from('RIFFxxxxWAVEnada'), 16)).toBeNull();
  });

  it('duração do MP4 com o moov no fim e no começo, versões 0 e 1 do mvhd', () => {
    const ler = (b: Buffer) => (pos: number, n: number) => new Uint8Array(b.subarray(pos, pos + n));
    const fim = mp4(mvhd0(1000, 12500));
    expect(duracaoDeMp4(ler(fim), fim.length)).toBe(12500);
    const comeco = mp4(mvhd0(600, 3000), false);
    expect(duracaoDeMp4(ler(comeco), comeco.length)).toBe(5000);
    const v1 = mp4(mvhd1(1000, 90_000));
    expect(duracaoDeMp4(ler(v1), v1.length)).toBe(90_000);
    expect(duracaoDeMp4(ler(wav(1)), wav(1).length)).toBeNull();
  });
});

describe('tipo e derivados', () => {
  it('tipo pela extensão', () => {
    expect(tipoDaMidia('midia/a.MP4')).toBe('video');
    expect(tipoDaMidia('midia/a.wav')).toBe('audio');
    expect(tipoDaMidia('midia/a.webp')).toBe('imagem');
    expect(tipoDaMidia('midia/a.json')).toBe('outro');
    expect(tipoDaMidia('midia/semextensao')).toBe('outro');
  });

  it('reconhece só os nomes que o app dá aos arquivos gerados', () => {
    expect(classificarDerivado('midia/n.wav.palavras.json')).toEqual({derivado: 'transcricao', origem: 'midia/n.wav'});
    expect(classificarDerivado('midia/n.wav.envelope.json')).toEqual({derivado: 'envelope', origem: 'midia/n.wav'});
    expect(classificarDerivado('midia/n.wav.limpo.wav')).toEqual({derivado: 'voz_limpa', origem: 'midia/n.wav', detalhe: 'media'});
    expect(classificarDerivado('midia/n.wav.limpo-forte.wav')).toEqual({derivado: 'voz_limpa', origem: 'midia/n.wav', detalhe: 'forte'});
    expect(classificarDerivado('midia/foto.0a1b2c3d.sem-fundo.png')).toEqual({derivado: 'sem_fundo', origem: 'midia/foto'});
    expect(classificarDerivado('midia/foto.0a1b2c3d-2.sem-fundo.png')).toEqual({derivado: 'sem_fundo', origem: 'midia/foto'});
    // da pessoa, não do app
    expect(classificarDerivado('midia/voz.limpo.wav')).toBeNull();
    expect(classificarDerivado('midia/foto.sem-fundo.png')).toBeNull();
    expect(classificarDerivado('midia/n.wav')).toBeNull();
  });
});

const bruto = (rel: string, extra: Partial<ArquivoBruto> = {}): ArquivoBruto => ({rel, tamanho: 1000, modificado_ms: 1_700_000_000_000, ...extra});

describe('índice da mídia', () => {
  const recorteJpg = caminhoSemFundo('midia/foto.jpg');
  const recortePng = caminhoSemFundo('midia/foto.png');
  const arquivos: ArquivoBruto[] = [
    bruto('midia/narracao.wav', {duracao_ms: 61_000, tamanho: 5_000_000}),
    bruto('midia/narracao.wav.palavras.json'),
    bruto('midia/narracao.wav.envelope.json'),
    bruto('midia/narracao.wav.limpo.wav'),
    bruto('midia/narracao.wav.limpo.wav.envelope.json'),
    bruto('midia/narracao.wav.limpo-forte.wav'),
    bruto('midia/foto.jpg', {largura: 4000, altura: 3000}),
    bruto('midia/foto.png', {largura: 800, altura: 600}),
    bruto(recorteJpg),
    bruto(recortePng),
    bruto('midia/tomadas/c2.mp4', {duracao_ms: 15_000}),
    bruto('midia/voz.limpo.wav'),
    bruto('midia/logo-kit.png'),
    bruto('midia/solta.palavras.json'),
    bruto(ARQUIVO_MARCAS_MIDIA),
  ];
  const marcas = comMarca(comMarca(marcasVazias(), 'midia/tomadas/c2.mp4', {estado: 'boa', nota: 'Tomada com o gancho da Ana'}), 'midia/narracao.wav', {estado: 'descartada'});
  const indice = montarIndice(arquivos, marcas);
  const por = (c: string) => indice.find((e) => e.caminho === c)!;

  it('derivados ficam dentro do original; marcas.json e derivados não viram linha', () => {
    expect(indice.map((e) => e.caminho)).toEqual([
      'midia/foto.jpg', 'midia/foto.png', 'midia/logo-kit.png', 'midia/narracao.wav', 'midia/solta.palavras.json', 'midia/tomadas/c2.mp4', 'midia/voz.limpo.wav',
    ]);
    const n = por('midia/narracao.wav');
    expect(n.derivados.map((d) => `${d.tipo}:${d.detalhe ?? ''}:${d.caminho}`)).toEqual([
      'transcricao::midia/narracao.wav.palavras.json',
      'envelope::midia/narracao.wav.envelope.json',
      'envelope:voz limpa:midia/narracao.wav.limpo.wav.envelope.json', // o envelope da voz limpa sobe até o original
      'voz_limpa:media:midia/narracao.wav.limpo.wav',
      'voz_limpa:forte:midia/narracao.wav.limpo-forte.wav',
    ]);
    expect(n.duracao_ms).toBe(61_000);
  });

  it('o recorte sem fundo vai para o original de que veio, mesmo com foto.jpg e foto.png', () => {
    expect(por('midia/foto.jpg').derivados.map((d) => d.caminho)).toEqual([recorteJpg]);
    expect(por('midia/foto.png').derivados.map((d) => d.caminho)).toEqual([recortePng]);
    expect(por('midia/foto.jpg').largura).toBe(4000);
  });

  it('derivado sem o original em midia/ fica como entrada própria; arquivo da pessoa com nome parecido também', () => {
    expect(por('midia/solta.palavras.json').tipo).toBe('outro');
    expect(por('midia/voz.limpo.wav').tipo).toBe('audio');
  });

  it('a marca da tomada acompanha a entrada', () => {
    expect(por('midia/tomadas/c2.mp4').marca).toEqual({estado: 'boa', nota: 'Tomada com o gancho da Ana'});
    expect(por('midia/narracao.wav').marca).toEqual({estado: 'descartada'});
    expect(por('midia/foto.jpg').marca).toBeUndefined();
  });

  it('busca por palavras, sem acento nem caixa, em nome, nota e derivados', () => {
    const achar = (q: string) => buscarMidia(indice, q).map((e) => e.caminho);
    expect(achar('c2')).toEqual(['midia/tomadas/c2.mp4']);
    expect(achar('GANCHO ana')).toEqual(['midia/tomadas/c2.mp4']);
    expect(achar('transcrito')).toEqual(['midia/narracao.wav']);
    expect(achar('transcrição')).toEqual(['midia/narracao.wav']);
    expect(achar('sem fundo')).toEqual(['midia/foto.jpg', 'midia/foto.png']);
    expect(achar('boa')).toEqual(['midia/tomadas/c2.mp4']);
    expect(achar('descartada')).toEqual(['midia/narracao.wav']);
    expect(achar('inexistente')).toEqual([]);
    expect(achar('')).toHaveLength(indice.length);
    expect(paraBusca('  Transcrição   ÁUDIO ')).toBe('transcricao audio');
  });

  it('filtros de tipo, pasta (com subpastas), marca e ordem', () => {
    expect(filtrarMidia(indice, {tipo: 'video'}).map((e) => e.caminho)).toEqual(['midia/tomadas/c2.mp4']);
    expect(filtrarMidia(indice, {pasta: 'midia/tomadas'}).map((e) => e.caminho)).toEqual(['midia/tomadas/c2.mp4']);
    expect(filtrarMidia(indice, {pasta: 'midia'})).toHaveLength(indice.length);
    expect(filtrarMidia(indice, {marca: 'sem_marca'})).toHaveLength(indice.length - 2);
    expect(filtrarMidia(indice, {marca: 'boa'}).map((e) => e.caminho)).toEqual(['midia/tomadas/c2.mp4']);
    expect(filtrarMidia(indice, {ordem: 'tamanho'})[0].caminho).toBe('midia/narracao.wav');
    expect(filtrarMidia(indice, {tipo: 'imagem', busca: 'foto', marca: 'sem_marca'})).toHaveLength(2);
  });

  it('pastas com a quantidade, subpastas somadas às de cima', () => {
    expect(pastasDaMidia(indice)).toEqual([{pasta: 'midia', quantidade: 7}, {pasta: 'midia/tomadas', quantidade: 1}]);
  });

  it('apresentação curta', () => {
    expect(duracaoCurta(61_000)).toBe('1:01');
    expect(duracaoCurta(undefined)).toBe('');
    expect(tamanhoCurto(512)).toBe('1 KB');
    expect(tamanhoCurto(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(tamanhoCurto(1.5 * 1024 ** 3)).toBe('1.5 GB');
  });
});

describe('desempenho: busca em menos de 100 ms com 500 arquivos', () => {
  const muitos: ArquivoBruto[] = [];
  for (let i = 0; i < 500; i++) {
    const pasta = `midia/${['tomadas', 'trilhas', 'fotos', 'efeitos'][i % 4]}`;
    const ext = ['mp4', 'wav', 'jpg', 'mp3'][i % 4];
    muitos.push(bruto(`${pasta}/arquivo-${String(i).padStart(3, '0')}-${['gancho', 'parte', 'duvida', 'fecho'][i % 3]}.${ext}`, {duracao_ms: i * 1000}));
    if (i % 5 === 0 && ext === 'wav') muitos.push(bruto(`${pasta}/arquivo-${String(i).padStart(3, '0')}-${['gancho', 'parte', 'duvida', 'fecho'][i % 3]}.${ext}.palavras.json`));
  }
  const indice = montarIndice(muitos, marcasVazias());

  it('o índice tem os 500 arquivos (os derivados não contam)', () => {
    expect(indice).toHaveLength(500);
  });

  it('montar o índice e buscar cabem juntos na marca de 100 ms; só a busca fica muito abaixo', () => {
    // a melhor de várias medidas: com a máquina cheia (outras sessões, a suíte em paralelo) uma medida isolada pode pegar um
    // tropeço de agendamento que não é do código
    const melhor = (f: () => unknown, vezes = 7) => {
      let m = Infinity;
      for (let i = 0; i < vezes; i++) {
        const t = performance.now();
        f();
        m = Math.min(m, performance.now() - t);
      }
      return m;
    };
    expect(montarIndice(muitos, marcasVazias())).toHaveLength(500);
    const montar = melhor(() => montarIndice(muitos, marcasVazias()));
    const consultas = ['gancho', 'tomadas mp4', 'fecho 4', 'transcrito', 'arquivo 49', 'inexistente'];
    const busca = Math.max(...consultas.map((q) => melhor(() => buscarMidia(indice, q))));
    expect(montar + busca).toBeLessThan(100);
    expect(busca).toBeLessThan(50);
  });
});

describe('marcas das tomadas', () => {
  it('lê com calma o que está torto', () => {
    expect(lerMarcasDeMidia(null)).toEqual(marcasVazias());
    expect(lerMarcasDeMidia({marcas: []})).toEqual(marcasVazias());
    expect(lerMarcasDeMidia({marcas: {'midia/a.wav': {estado: 'ótima', nota: 3}, 'midia/b.wav': {estado: 'boa'}, 'midia/c.wav': {nota: '  oi  '}}})).toEqual({
      versao: 1,
      marcas: {'midia/b.wav': {estado: 'boa'}, 'midia/c.wav': {nota: 'oi'}},
    });
  });

  it('marcar, mudar só a nota, tirar o estado e limpar tudo', () => {
    let m = comMarca(marcasVazias(), 'midia/a.wav', {estado: 'boa'});
    expect(m.marcas['midia/a.wav']).toEqual({estado: 'boa'});
    m = comMarca(m, 'midia/a.wav', {nota: 'a melhor'});
    expect(m.marcas['midia/a.wav']).toEqual({estado: 'boa', nota: 'a melhor'});
    m = comMarca(m, 'midia/a.wav', {estado: null});
    expect(m.marcas['midia/a.wav']).toEqual({nota: 'a melhor'});
    m = comMarca(m, 'midia/a.wav', {nota: '   '});
    expect(m.marcas).toEqual({});
    expect(comMarca(marcasVazias(), 'midia/a.wav', {nota: 'x'.repeat(900)}).marcas['midia/a.wav'].nota).toHaveLength(500);
  });
});

describe('a mídia de um projeto de verdade', () => {
  const destino = gravarPlano(path.join(tmp, 'projeto'), planoDoProjeto({nome: 'Mídia', modelo: 'video-branco'}));
  const p = new Projeto(destino);
  const escrever = (rel: string, dados: Buffer | string) => {
    mkdirSync(path.dirname(path.join(destino, rel)), {recursive: true});
    writeFileSync(path.join(destino, rel), dados);
  };

  it('lê duração e dimensões do cabeçalho e agrupa os derivados', () => {
    escrever('midia/narracao.wav', wav(2));
    escrever('midia/narracao.wav.palavras.json', '{}');
    escrever('midia/c2.mp4', mp4(mvhd0(1000, 8000)));
    escrever('midia/foto.png', png(1080, 1350));
    escrever('midia/musica.mp3', Buffer.alloc(2000, 1));
    escrever('midia/musica.mp3.envelope.json', JSON.stringify({versao: 2, janela_ms: 50, duracao_ms: 183_400, db: []}));
    escrever('midia/quebrado.wav', Buffer.from('não é wav'));
    const indice = indiceDaMidia(p);
    const por = (c: string) => indice.entradas.find((e) => e.caminho === c)!;
    expect(indice.total).toBe(5);
    expect(por('midia/narracao.wav')).toMatchObject({tipo: 'audio', duracao_ms: 2000});
    expect(por('midia/narracao.wav').derivados.map((d) => d.tipo)).toEqual(['transcricao']);
    expect(por('midia/c2.mp4')).toMatchObject({tipo: 'video', duracao_ms: 8000});
    expect(por('midia/foto.png')).toMatchObject({tipo: 'imagem', largura: 1080, altura: 1350});
    expect(por('midia/musica.mp3').duracao_ms).toBe(183_400); // o MP3 não tem cabeçalho lido: vem do envelope medido
    expect(por('midia/quebrado.wav').duracao_ms).toBeUndefined();
    expect(indice.pastas).toEqual([{pasta: 'midia', quantidade: 5}]);
  });

  it('marcar grava em midia/marcas.json, entra no diário com o inverso e não aparece como arquivo', () => {
    const r = marcarMidia(p, 'midia/c2.mp4', {estado: 'boa', nota: 'a do gancho'}, {autor: 'agente', origem: 'mcp'});
    expect(r).toMatchObject({documento: ARQUIVO_MARCAS_MIDIA, caminho: 'midia/c2.mp4', marca: {estado: 'boa', nota: 'a do gancho'}});
    expect(JSON.parse(readFileSync(path.join(destino, ARQUIVO_MARCAS_MIDIA), 'utf-8')).marcas['midia/c2.mp4'].estado).toBe('boa');
    const entrada = p.diario().find((e) => e.seq === r.seq)!;
    expect(entrada).toMatchObject({documento: ARQUIVO_MARCAS_MIDIA, autor: 'agente', origem: 'mcp', rotulo: 'tomada boa: midia/c2.mp4'});
    // o inverso desfaz: aplicado ao depois, volta ao antes
    const depois = JSON.parse(readFileSync(path.join(destino, ARQUIVO_MARCAS_MIDIA), 'utf-8'));
    expect(jsonpatch.applyPatch(depois, entrada.inverso as never, false, false).newDocument).toEqual(marcasVazias());
    const indice = indiceDaMidia(p);
    expect(indice.entradas.find((e) => e.caminho === 'midia/c2.mp4')!.marca).toEqual({estado: 'boa', nota: 'a do gancho'});
    expect(indice.entradas.some((e) => e.caminho === ARQUIVO_MARCAS_MIDIA)).toBe(false);
    // tirar a marca
    const sem = marcarMidia(p, 'midia/c2.mp4', {estado: null, nota: ''}, {autor: 'pessoa', origem: 'interface'});
    expect(sem.marca).toBeNull();
    expect(sem.seq).toBeGreaterThan(r.seq);
  });

  it('recusa o que não é original de midia/', () => {
    expect(() => marcarMidia(p, 'midia/nao-existe.wav', {estado: 'boa'}, {autor: 'a', origem: 'o'})).toThrow(/não achado/);
    expect(() => marcarMidia(p, 'estudio.json', {estado: 'boa'}, {autor: 'a', origem: 'o'})).toThrow(/só se marca arquivo de midia/);
    expect(() => marcarMidia(p, 'midia/../estudio.json', {estado: 'boa'}, {autor: 'a', origem: 'o'})).toThrow();
    expect(() => marcarMidia(p, 'midia/narracao.wav.palavras.json', {estado: 'boa'}, {autor: 'a', origem: 'o'})).toThrow(/arquivo gerado a partir de midia\/narracao\.wav/);
  });

  it('diz quais documentos citam cada arquivo', () => {
    const doc = p.manifesto().documentos[0];
    const lido = p.lerJson<{cenas: {blocos: unknown[]}[]}>(doc.caminho);
    p.aplicarPatch({
      documento: doc.id,
      versao_base: lido.versao,
      autor: 'pessoa',
      origem: 'interface',
      patch: [{op: 'add', path: '/cenas/0/blocos/-', value: {id: 'foto', tipo: 'imagem', src: 'midia/foto.png', ajuste: 'cobrir', em: 0, sai: 1000, x: 0, y: 0, largura: 1, altura: 1}}],
    });
    expect(documentosQueUsam(p, ['midia/foto.png', 'midia/c2.mp4', 'midia/foto.png.x'])).toEqual({'midia/foto.png': [doc.id]});
  });
});
