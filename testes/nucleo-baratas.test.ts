// Correções baratas do núcleo (auditoria, fase F4): N4 (kit de marca fora da pasta do kit), N5 (BOM), N9 (.gitignore com
// caracteres especiais), N10 (link simbólico em midia/ só para leitura), N13 (validação) e N16
// (CLAUDE.md gravado de forma atômica, no fim de linha dele). N15 ficou de fora: contestado pela verificação.
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {novoDocCenas} from '../src/nucleo/cenas';
import {gravarPlano, planoDoProjeto, regerarClaudeMd} from '../src/nucleo/criar-projeto';
import {gravarAtomico} from '../src/nucleo/gravar-seguro';
import {indiceDaMidia} from '../src/nucleo/midia-disco';
import {gitignoreComMidiaPesada} from '../src/nucleo/midia-git';
import {PastaMarcas} from '../src/nucleo/pasta-marcas';
import {ErroProjeto, Projeto, serializar} from '../src/nucleo/projeto';

const pastas: string[] = [];
afterAll(() => pastas.forEach((p) => rmSync(p, {recursive: true, force: true})));
const pastaNova = (nome: string) => {
  const p = mkdtempSync(path.join(tmpdir(), `estudio-${nome}-`));
  pastas.push(p);
  return p;
};

const projetoMinimo = (conteudo: unknown = {itens: [], cor: 'a'}) => {
  const pasta = pastaNova('baratas');
  writeFileSync(path.join(pasta, 'estudio.json'), serializar({formato: 1, nome: 't', documentos: [{id: 'd', modulo: '3d', caminho: 'd.json', titulo: 'D'}]}));
  writeFileSync(path.join(pasta, 'd.json'), serializar(conteudo));
  mkdirSync(path.join(pasta, '.estudio'), {recursive: true});
  return {pasta, p: new Projeto(pasta)};
};

describe('N5 BOM do UTF-8', () => {
  it('estudio.json e documento com BOM abrem; a gravação seguinte tira o BOM; o CLAUDE.md se refaz', () => {
    const {pasta, p} = projetoMinimo();
    for (const f of ['estudio.json', 'd.json']) writeFileSync(path.join(pasta, f), `\uFEFF${readFileSync(path.join(pasta, f), 'utf-8')}`);
    expect(p.manifesto().documentos).toHaveLength(1);
    p.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/cor', value: 'b'}], autor: 'pessoa', origem: 'interface'});
    expect(readFileSync(path.join(pasta, 'd.json'), 'utf-8').charCodeAt(0)).not.toBe(0xfeff);
    expect(regerarClaudeMd(pasta)).toBe(true);
  });

  it('marca.json com BOM abre', () => {
    const base = pastaNova('marcas-bom');
    mkdirSync(path.join(base, 'kit'));
    writeFileSync(path.join(base, 'kit', 'marca.json'), `\uFEFF${JSON.stringify({nome: 'Kit BOM'})}`);
    expect(new PastaMarcas({pasta: () => base}).ler('kit').nome).toBe('Kit BOM');
  });
});

describe('N4 kit de marca fica na pasta do kit', () => {
  const kitMalicioso = () => {
    const base = pastaNova('marcas');
    writeFileSync(path.join(base, 'segredo.txt'), 'CHAVE-PRIVADA');
    const pastaMarcas = path.join(base, 'Estudio', 'marcas');
    mkdirSync(path.join(pastaMarcas, 'kit'), {recursive: true});
    return {base, pastaMarcas, marcas: new PastaMarcas({pasta: () => pastaMarcas})};
  };

  it('logo "../../../segredo.txt" não copia nada de fora do kit', () => {
    const {pastaMarcas, marcas} = kitMalicioso();
    writeFileSync(path.join(pastaMarcas, 'kit', 'marca.json'), JSON.stringify({formato: 1, id: 'kit', nome: 'Kit', logo: '../../../segredo.txt', cores: {}, fontes: {}}));
    const {pasta} = projetoMinimo(novoDocCenas({largura: 1080, altura: 1920, fps: 30}));
    const r = marcas.aplicar(new Projeto(pasta), 'kit', 'd', {autor: 'agente', origem: 'mcp'});
    expect(r.copiados).toEqual([]);
    expect(existsSync(path.join(pasta, 'midia', 'logo-kit.txt'))).toBe(false);
  });

  it('fonte com "../" no caminho não sai da pasta do kit; fonte em fontes/ continua copiada', () => {
    const {pastaMarcas, marcas} = kitMalicioso();
    mkdirSync(path.join(pastaMarcas, 'kit', 'fontes'));
    writeFileSync(path.join(pastaMarcas, 'kit', 'fontes', 'Boa-Regular.ttf'), 'fonte');
    writeFileSync(path.join(pastaMarcas, 'kit', 'marca.json'), JSON.stringify({formato: 1, nome: 'Kit', cores: {},
      fontes: {titulo: 'Boa', arquivos: [{familia: 'Boa', arquivo: 'fontes/Boa-Regular.ttf', peso: 400}, {familia: 'Ruim', arquivo: '../../../segredo.txt', peso: 400}]}}));
    const {pasta} = projetoMinimo(novoDocCenas({largura: 1080, altura: 1920, fps: 30}));
    const r = marcas.aplicar(new Projeto(pasta), 'kit', 'd', {autor: 'agente', origem: 'mcp'});
    expect(r.copiados).toEqual(['fontes/Boa-Regular.ttf']);
    expect(existsSync(path.join(pasta, 'fontes', 'segredo.txt'))).toBe(false);
  });

  it('id "../fora" é recusado; a pasta criada à mão ("Minha Marca") continua na lista', () => {
    const base = pastaNova('marcas2');
    const pastaMarcas = path.join(base, 'marcas');
    mkdirSync(path.join(pastaMarcas, 'Minha Marca'), {recursive: true});
    writeFileSync(path.join(pastaMarcas, 'Minha Marca', 'marca.json'), JSON.stringify({nome: 'Minha'}));
    mkdirSync(path.join(base, 'fora'));
    writeFileSync(path.join(base, 'fora', 'marca.json'), JSON.stringify({nome: 'De fora'}));
    const marcas = new PastaMarcas({pasta: () => pastaMarcas});
    expect(() => marcas.ler('../fora')).toThrow(ErroProjeto);
    expect(() => marcas.ler('..')).toThrow(/id de kit inválido/);
    expect(marcas.listar().map((m) => m.nome)).toContain('Minha');
  });

  it('documento que não recebe kit (3D) recusa antes de copiar o logo', () => {
    const {pastaMarcas, marcas} = kitMalicioso();
    writeFileSync(path.join(pastaMarcas, 'kit', 'logo.png'), 'png');
    writeFileSync(path.join(pastaMarcas, 'kit', 'marca.json'), JSON.stringify({nome: 'Kit', logo: 'logo.png'}));
    const {pasta, p} = projetoMinimo({objetos: []});
    expect(() => marcas.aplicar(p, 'kit', 'd', {autor: 'agente', origem: 'mcp'})).toThrow(/não recebe kit/);
    expect(existsSync(path.join(pasta, 'midia'))).toBe(false);
  });
});

describe('N9 .gitignore com caracteres especiais no nome', () => {
  it('"take [1].wav", "a*b.wav" e "#x.wav" de 30 MB ficam fora do commit', () => {
    const raiz = pastaNova('git');
    execFileSync('git', ['init', '-q'], {cwd: raiz});
    mkdirSync(path.join(raiz, 'midia'));
    const nomes = ['midia/take [1].wav', 'midia/a*b.wav', 'midia/#x.wav', 'midia/q?.wav'];
    for (const n of nomes) writeFileSync(path.join(raiz, n), 'x');
    writeFileSync(path.join(raiz, 'midia', 'take 1.wav'), 'x');
    writeFileSync(path.join(raiz, '.gitignore'), gitignoreComMidiaPesada('', nomes.map((rel) => ({rel, tamanho: 30 * 1024 * 1024}))));
    const ignorado = (rel: string) => {
      try {
        execFileSync('git', ['check-ignore', '-q', rel], {cwd: raiz});
        return true;
      } catch {
        return false;
      }
    };
    for (const n of nomes) expect(ignorado(n), n).toBe(true);
    expect(ignorado('midia/take 1.wav')).toBe(false); // a regra não vira coringa
  });
});

describe('N10 link simbólico em midia/ para fora do projeto: só leitura', () => {
  const comLink = () => {
    const {pasta, p} = projetoMinimo();
    const fora = pastaNova('fora');
    writeFileSync(path.join(fora, 'bruto.wav'), 'RIFF');
    mkdirSync(path.join(pasta, 'midia'));
    symlinkSync(fora, path.join(pasta, 'midia', 'externo'));
    return {pasta, p, fora};
  };

  it('ler pelo link funciona, e a mídia de lá aparece no painel', () => {
    const {p} = comLink();
    expect(p.existe('midia/externo/bruto.wav')).toBe(true);
    expect(p.lerTexto('midia/externo/bruto.wav')).toBe('RIFF');
    expect(indiceDaMidia(p).entradas.map((e) => e.caminho)).toContain('midia/externo/bruto.wav');
  });

  it('gravar pelo link é recusado e nada aparece fora', () => {
    const {p, fora} = comLink();
    expect(() => p.gravarTexto('midia/externo/escapou.json', '{}')).toThrow(/link simbólico/);
    expect(existsSync(path.join(fora, 'escapou.json'))).toBe(false);
    expect(() => p.caminhoParaGravar('midia/externo/bruto.wav')).toThrow(/link simbólico/);
    p.gravarTexto('midia/dentro.json', '{}'); // fora do link, grava normalmente
    expect(p.existe('midia/dentro.json')).toBe(true);
  });

  it('o kit de marca não copia o logo para um midia/ que é link para fora', () => {
    const {pasta: base} = {pasta: pastaNova('marcas-link')};
    mkdirSync(path.join(base, 'kit'));
    writeFileSync(path.join(base, 'kit', 'logo.png'), 'png');
    writeFileSync(path.join(base, 'kit', 'marca.json'), JSON.stringify({nome: 'Kit', logo: 'logo.png'}));
    const {pasta, p} = projetoMinimo(novoDocCenas({largura: 1080, altura: 1920, fps: 30}));
    const fora = pastaNova('fora-midia');
    symlinkSync(fora, path.join(pasta, 'midia'));
    expect(() => new PastaMarcas({pasta: () => base}).aplicar(p, 'kit', 'd', {autor: 'agente', origem: 'mcp'})).toThrow(/link simbólico/);
    expect(existsSync(path.join(fora, 'logo-kit.png'))).toBe(false);
  });

  it('um projeto aberto por um caminho com link (a pasta Estudio em outro disco) grava normalmente', () => {
    const {pasta} = projetoMinimo();
    const atalho = path.join(pastaNova('atalho'), 'projeto');
    symlinkSync(pasta, atalho);
    const p = new Projeto(atalho);
    p.aplicarPatch({documento: 'd', patch: [{op: 'replace', path: '/cor', value: 'b'}], autor: 'pessoa', origem: 'interface'});
    expect(p.lerJson<{cor: string}>('d.json').doc.cor).toBe('b');
  });
});

describe('N13 validação', () => {
  it('comentarios.json sem a lista dá ErroProjeto (não TypeError) e não grava por cima', () => {
    const {pasta, p} = projetoMinimo();
    writeFileSync(path.join(pasta, 'comentarios.json'), '{"formato": 1, "outra": 1}');
    expect(() => p.comentarios()).toThrow(ErroProjeto);
    expect(() => p.novoComentario({documento: 'd', texto: 'oi', autor: 'pessoa', alvo: {}})).toThrow(ErroProjeto);
    expect(readFileSync(path.join(pasta, 'comentarios.json'), 'utf-8')).toContain('"outra"');
  });

  it('versao_base "" não desliga a conferência de versão', () => {
    const {p} = projetoMinimo();
    expect(() => p.aplicarPatch({documento: 'd', versao_base: '', patch: [{op: 'replace', path: '/cor', value: 'agente'}], autor: 'agente', origem: 'A'}))
      .toThrow(expect.objectContaining({codigo: 'conflito'}));
    expect(p.lerJson<{cor: string}>('d.json').doc.cor).toBe('a');
  });
});

describe('N16 CLAUDE.md', () => {
  it('em CRLF continua CRLF depois de refeito, e a segunda vez não muda nada', () => {
    const destino = gravarPlano(path.join(pastaNova('claude'), 'p'), planoDoProjeto({nome: 'C', modelo: 'video-branco'}));
    const arq = path.join(destino, 'CLAUDE.md');
    const crlf = (t: string) => t.replace(/\r?\n/g, '\r\n');
    // o texto que a 0.3.0 gravava (desatualizado), com uma linha da pessoa, no fim de linha do Git para Windows
    const antigo = readFileSync(path.join(__dirname, 'fixtures', 'claude-md-030-video.md'), 'utf-8').replace('## Arquivos\n', '## Arquivos\n\n- usar a foto da Ana\n');
    writeFileSync(arq, crlf(antigo));
    expect(regerarClaudeMd(destino)).toBe(true);
    const md = readFileSync(arq, 'utf-8');
    expect(md).toContain('usar a foto da Ana');
    expect(md).toContain('`legendas`');
    expect(md.replace(/\r\n/g, '')).not.toContain('\n');
    expect(regerarClaudeMd(destino)).toBe(false);
  });

  it('uma gravação que falha no meio deixa o CLAUDE.md antigo inteiro', () => {
    const arq = path.join(pastaNova('claude-falha'), 'CLAUDE.md');
    writeFileSync(arq, 'texto da pessoa');
    const escrever = ((tmp: string) => {
      writeFileSync(tmp, 'meio');
      throw Object.assign(new Error('ENOSPC'), {code: 'ENOSPC'});
    }) as typeof writeFileSync;
    expect(() => gravarAtomico(arq, 'novo', undefined, escrever)).toThrow(/ENOSPC/);
    expect(readFileSync(arq, 'utf-8')).toBe('texto da pessoa');
  });
});
