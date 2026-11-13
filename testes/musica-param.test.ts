// Endereço único de parâmetro da música (M-02): a notação (ler e escrever), a tabela (padrões e faixas iguais aos do
// resolverMusica), a resolução para JSON Patch, a leitura do valor e o mapeamento 0..1. Nada disso muda o som: gravar
// em cada endereço o valor que ele já tem deixa o PCM igual.
import {createHash} from 'node:crypto';
import jsonpatch from 'fast-json-patch';
import {describe, expect, it} from 'vitest';
import {novaMusica, PECAS, resolverMusica, type DocMusica} from '../src/nucleo/musica';
import {
  PARAMETROS, deNormalizado, definicaoDe, enderecoDaAutomacao, enderecosDoDocumento, escreverEndereco, lerEndereco, lerParametro, modeloDoEndereco,
  paraNormalizado, patchDoParametro, resolverParametro, type EnderecoParam,
} from '../src/nucleo/musica-param';
import {GRUPO_PADRAO, renderizarMusica} from '../src/nucleo/musica-som';

const musica = (): DocMusica => {
  const d = novaMusica({bpm: 100});
  d.canais.push({id: 'bat', nome: 'Bateria', tipo: 'bateria', kit: 'eletronico', pecas: {caixa: {afinacao: 3}}});
  d.canais.push({id: 'sin', nome: 'Lead', tipo: 'sintetizador', preset: 'lead', faixa_mixer: 'leads', macros: {brilho: 2}});
  d.padroes.push({id: 'p1', canal: 'bat', dur: 4, notas: [{peca: 'bumbo', em: 0}, {peca: 'caixa', em: 1}, {peca: 'chimbal_fechado', em: 1.5}, {peca: 'chimbal_aberto', em: 2.5}]});
  d.padroes.push({id: 'p2', canal: 'sin', dur: 4, notas: [{nota: 64, em: 0, dur: 1}, {nota: 67, em: 2, dur: 1}]});
  d.arranjo.clipes.push({id: 'c1', canal: 'bat', em: 0, dur: 8, padrao: 'p1'}, {id: 'c2', canal: 'sin', em: 0, dur: 8, padrao: 'p2'});
  // a faixa "leads" só existe pelo canal; a "bat" está no mixer com um EQ fora da faixa
  d.mixer.faixas.push({id: 'bat', volume_db: -3, eq: {graves_db: 40}, reverb: 0.25});
  return d;
};

const ok = <T,>(r: {ok: true; valor: T} | {ok: false; erro: string}): T => {
  if (!r.ok) throw new Error(r.erro);
  return r.valor;
};

describe('a notação', () => {
  it('lê e escreve os exemplos do roadmap', () => {
    for (const t of ['faixa:bat/eq/graves_db', 'faixa:bat/efeito:2/mix', 'master/limitador/teto_db', 'canal:sin/macro/brilho', 'musica/bpm', 'canal:bat/peca:bumbo/afinacao']) {
      expect(escreverEndereco(ok(lerEndereco(t)))).toBe(t);
    }
    expect(ok(lerEndereco('faixa:bat/efeito:2/mix'))).toEqual({alvo: 'faixa', id: 'bat', segmentos: [{nome: 'efeito', chave: '2'}, {nome: 'mix'}]});
    expect(ok(lerEndereco('master/limitador/teto_db'))).toEqual({alvo: 'master', segmentos: [{nome: 'limitador'}, {nome: 'teto_db'}]});
  });

  it('ids com "/", ":" e "%" vão e voltam escapados', () => {
    const e: EnderecoParam = {alvo: 'faixa', id: 'voz/1:a%b', segmentos: [{nome: 'efeito', chave: 'eq:2/x'}, {nome: 'mix'}]};
    const t = escreverEndereco(e);
    expect(t).toBe('faixa:voz%2F1%3Aa%25b/efeito:eq%3A2%2Fx/mix');
    expect(ok(lerEndereco(t))).toEqual(e);
    expect(ok(lerEndereco('faixa:a%252F/volume_db')).id).toBe('a%2F');
    expect(ok(lerEndereco('faixa:Ça va/volume_db')).id).toBe('Ça va');
  });

  it('recusa o que não fecha, com erro claro', () => {
    for (const [t, msg] of [
      ['', /vazio/], ['faixa/volume_db', /pede um id/], ['faixa:/volume_db', /pede um id/], ['master:x/volume_db', /não leva id/],
      ['bus:a/volume_db', /não existe/], ['master', /falta o parâmetro/], ['faixa:a//eq', /não é um nome/], ['faixa:a/EQ/x', /não é um nome/],
      ['faixa:a/efeito:/mix', /chave vazia/], ['faixa:a%2/volume_db', /pede um id/],
    ] as const) {
      const r = lerEndereco(t);
      expect(r.ok, t).toBe(false);
      if (!r.ok) expect(r.erro).toMatch(msg);
    }
  });

  it('o modelo troca id e chaves por *', () => {
    expect(modeloDoEndereco(ok(lerEndereco('canal:bat/peca:caixa/afinacao')))).toBe('canal:*/peca:*/afinacao');
    expect(modeloDoEndereco(ok(lerEndereco('master/delay/tempo')))).toBe('master/delay/tempo');
  });
});

describe('a tabela', () => {
  it('modelos únicos, faixa coerente, padrão dentro da faixa, escolhas com o padrão na lista', () => {
    expect(new Set(PARAMETROS.map((p) => p.modelo)).size).toBe(PARAMETROS.length);
    for (const p of PARAMETROS) {
      expect(ok(lerEndereco(p.modelo.replace(/:\*/g, ':x')))).toBeTruthy();
      const padrao = typeof p.padrao === 'function' ? p.padrao('bumbo') : p.padrao;
      if (p.tipo === 'numero' || p.tipo === 'inteiro') {
        expect(p.min, p.modelo).toBeLessThan(p.max!);
        expect(padrao as number).toBeGreaterThanOrEqual(p.min!);
        expect(padrao as number).toBeLessThanOrEqual(p.max!);
        if (p.curva === 'log') expect(p.min!, p.modelo).toBeGreaterThan(0);
      }
      if (p.tipo === 'escolha') expect(p.opcoes).toContain(padrao);
      if (p.tipo === 'booleano') expect(typeof padrao).toBe('boolean');
    }
  });

  it('os padrões e os limites são os do resolverMusica (campo ausente e campo fora da faixa)', () => {
    // documento com tudo ausente: uma faixa só com id, um canal de sintetizador sem macros, master vazio
    const vazio = novaMusica();
    vazio.canais.push({id: 's', nome: 'S', tipo: 'sintetizador'}, {id: 'b', nome: 'B', tipo: 'bateria'});
    vazio.mixer = {faixas: [{id: 's'}]};
    delete vazio.swing;
    // e um com tudo fora da faixa para cima
    const alto = structuredClone(vazio);
    alto.bpm = 9999;
    alto.swing = 5;
    alto.canais[0].macros = {brilho: 9, ataque: 9, soltura: 9, cor: 9};
    alto.mixer = {faixas: [{id: 's', volume_db: 99, pan: 9, eq: {graves_db: 99, medios_db: 99, agudos_db: 99}, reverb: 9, delay: 9,
      compressor: {limiar_db: 99, razao: 99, ataque_ms: 9999, soltura_ms: 99999, ganho_db: 99}, sidechain: {de: 'b', quanto_db: 99, ataque_ms: 999, soltura_ms: 99999}}],
    master: {volume_db: 99, reverb: {tamanho: 9, amortecimento: 9, volume_db: 99}, delay: {realimentacao: 9, brilho: 9, volume_db: 99}, limitador: {teto_db: 9, soltura_ms: 99999}}};
    for (const doc of [vazio, alto]) {
      const {musica: m} = resolverMusica(doc);
      const f = m.faixas.find((x) => x.id === 's')!;
      const c = m.canais.find((x) => x.id === 's')!;
      const esperado: Record<string, unknown> = {
        'faixa:s/volume_db': f.volume_db, 'faixa:s/pan': f.pan, 'faixa:s/mudo': f.mudo, 'faixa:s/solo': f.solo,
        'faixa:s/eq/graves_db': f.eq.graves_db, 'faixa:s/eq/medios_db': f.eq.medios_db, 'faixa:s/eq/agudos_db': f.eq.agudos_db,
        'faixa:s/compressor/ativo': f.compressor.ativo, 'faixa:s/compressor/limiar_db': f.compressor.limiar_db, 'faixa:s/compressor/razao': f.compressor.razao,
        'faixa:s/compressor/ataque_ms': f.compressor.ataque_ms, 'faixa:s/compressor/soltura_ms': f.compressor.soltura_ms, 'faixa:s/compressor/ganho_db': f.compressor.ganho_db,
        'faixa:s/envio/reverb': f.reverb, 'faixa:s/envio/delay': f.delay,
        'canal:s/mudo': c.mudo, 'canal:s/solo': c.solo, 'canal:s/macro/brilho': c.macros.brilho, 'canal:s/macro/ataque': c.macros.ataque,
        'canal:s/macro/soltura': c.macros.soltura, 'canal:s/macro/cor': c.macros.cor,
        'master/volume_db': m.master.volume_db, 'master/reverb/tamanho': m.master.reverb.tamanho, 'master/reverb/amortecimento': m.master.reverb.amortecimento,
        'master/reverb/volume_db': m.master.reverb.volume_db, 'master/delay/tempo': m.master.delay.tempo, 'master/delay/realimentacao': m.master.delay.realimentacao,
        'master/delay/brilho': m.master.delay.brilho, 'master/delay/pingue_pongue': m.master.delay.pingue_pongue, 'master/delay/volume_db': m.master.delay.volume_db,
        'master/limitador/ativo': m.master.limitador.ativo, 'master/limitador/teto_db': m.master.limitador.teto_db, 'master/limitador/soltura_ms': m.master.limitador.soltura_ms,
        'musica/bpm': m.bpm, 'musica/swing': m.swing,
      };
      if (f.sidechain) Object.assign(esperado, {'faixa:s/sidechain/quanto_db': f.sidechain.quanto_db, 'faixa:s/sidechain/ataque_ms': f.sidechain.ataque_ms,
        'faixa:s/sidechain/soltura_ms': f.sidechain.soltura_ms, 'faixa:s/sidechain/peca': f.sidechain.peca});
      for (const [end, v] of Object.entries(esperado)) expect(ok(lerParametro(doc, end)).valor, end).toBe(v);
    }
    // os padrões da tabela são os valores do documento vazio
    for (const p of PARAMETROS) {
      if (p.modelo.startsWith('canal:*/peca') || p.modelo.includes('sidechain')) continue;
      const end = p.modelo.replace('faixa:*', 'faixa:s').replace('canal:*', 'canal:s');
      const l = ok(lerParametro({...vazio, bpm: undefined} as unknown as DocMusica, end));
      expect(l.valor, end).toBe(l.padrao);
    }
  });

  it('peças: o grupo de corte padrão é o do motor (os chimbais no grupo 1)', () => {
    const d = musica();
    for (const pc of PECAS) expect(ok(lerParametro(d, `canal:bat/peca:${pc}/grupo`)).valor).toBe(GRUPO_PADRAO[pc] ?? 0);
    expect(ok(lerParametro(d, 'canal:bat/peca:caixa/afinacao'))).toMatchObject({valor: 3, no_documento: true, caminho: '/canais/0/pecas/caixa/afinacao'});
    expect(resolverParametro(d, 'canal:bat/peca:surdo/volume_db')).toMatchObject({ok: false});
  });
});

describe('resolução e leitura', () => {
  it('faixa do mixer: o caminho pelo índice de agora, o valor efetivo e o gravado', () => {
    const d = musica();
    expect(ok(lerParametro(d, 'faixa:bat/eq/graves_db'))).toMatchObject({valor: 18, bruto: 40, no_documento: true, caminho: '/mixer/faixas/0/eq/graves_db'});
    expect(ok(lerParametro(d, 'faixa:bat/eq/agudos_db'))).toMatchObject({valor: 0, bruto: undefined, no_documento: false});
    expect(ok(lerParametro(d, 'faixa:bat/envio/reverb')).valor).toBe(0.25);
    expect(ok(lerParametro(d, 'canal:sin/macro/brilho')).valor).toBe(1);
    expect(ok(lerParametro(d, 'master/limitador/teto_db')).valor).toBe(-1);
    expect(ok(lerParametro(d, 'master/limitador/ativo')).valor).toBe(true);
    expect(ok(lerParametro(d, 'musica/bpm')).caminho).toBe('/bpm');
  });

  it('faixa que só o canal pede: lê os padrões e o patch a cria no mixer', () => {
    const d = musica();
    const r = ok(resolverParametro(d, 'faixa:leads/eq/medios_db'));
    expect(r.caminho).toBe('/mixer/faixas/1/eq/medios_db');
    expect(r.criar).toEqual([{op: 'add', path: '/mixer/faixas/-', value: {id: 'leads', nome: 'Lead'}}, {op: 'add', path: '/mixer/faixas/1/eq', value: {}}]);
    const p = ok(patchDoParametro(d, 'faixa:leads/eq/medios_db', -4));
    const novo = jsonpatch.applyPatch(structuredClone(d), p.patch, true, false).newDocument;
    expect(resolverMusica(novo).musica.faixas.find((f) => f.id === 'leads')!.eq.medios_db).toBe(-4);
    expect(ok(lerParametro(novo, 'faixa:leads/eq/medios_db')).valor).toBe(-4);
  });

  it('alvo que não existe, parâmetro desconhecido e efeito ainda sem esquema são erro', () => {
    const d = musica();
    expect(resolverParametro(d, 'faixa:nada/volume_db')).toMatchObject({ok: false});
    expect(resolverParametro(d, 'canal:nada/mudo')).toMatchObject({ok: false});
    expect(resolverParametro(d, 'faixa:bat/eq/presenca_db')).toMatchObject({ok: false});
    const ef = resolverParametro(d, 'faixa:bat/efeito:1/mix');
    expect(ef.ok).toBe(false);
    if (!ef.ok) expect(ef.erro).toMatch(/X-01/);
  });

  it('master sem objeto e sem retornos: o patch cria os pais', () => {
    const d = musica();
    d.mixer = {faixas: []};
    const p = ok(patchDoParametro(d, 'master/delay/brilho', 0.8));
    expect(p.patch).toEqual([
      {op: 'add', path: '/mixer/master', value: {}}, {op: 'add', path: '/mixer/master/delay', value: {}}, {op: 'add', path: '/mixer/master/delay/brilho', value: 0.8},
    ]);
    const novo = jsonpatch.applyPatch(structuredClone(d), p.patch, true, false).newDocument;
    expect(resolverMusica(novo).musica.master.delay.brilho).toBe(0.8);
  });

  it('peça sem ajuste: o patch cria pecas e a peça', () => {
    const d = musica();
    const p = ok(patchDoParametro(d, 'canal:bat/peca:bumbo/volume_db', -6));
    expect(p.patch.map((o) => o.path)).toEqual(['/canais/0/pecas/bumbo', '/canais/0/pecas/bumbo/volume_db']);
  });

  it('sidechain: lê o padrão sem ele, mas não nasce sem o canal que dispara', () => {
    const d = musica();
    expect(ok(lerParametro(d, 'faixa:bat/sidechain/quanto_db')).valor).toBe(6);
    const p = patchDoParametro(d, 'faixa:bat/sidechain/quanto_db', 10);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.erro).toMatch(/canal que dispara/);
    d.mixer.faixas[0].sidechain = {de: 'bat'};
    expect(ok(patchDoParametro(d, 'faixa:bat/sidechain/quanto_db', 10)).patch).toEqual([{op: 'add', path: '/mixer/faixas/0/sidechain/quanto_db', value: 10}]);
  });

  it('patch: número fora da faixa volta para dentro com aviso; tipo errado e opção que não existe são erro', () => {
    const d = musica();
    const p = ok(patchDoParametro(d, 'master/limitador/teto_db', 3));
    expect(p.valor).toBe(0);
    expect(p.avisos[0]).toMatch(/fora de -12 a 0/);
    expect(patchDoParametro(d, 'master/limitador/teto_db', '3').ok).toBe(false);
    expect(patchDoParametro(d, 'master/limitador/ativo', 1).ok).toBe(false);
    expect(patchDoParametro(d, 'master/delay/tempo', '1/3').ok).toBe(false);
    expect(ok(patchDoParametro(d, 'master/delay/tempo', '1/4')).patch.at(-1)).toEqual({op: 'add', path: '/mixer/master/delay/tempo', value: '1/4'});
    expect(ok(patchDoParametro(d, 'canal:bat/peca:caixa/grupo', 2.6)).valor).toBe(3);
  });

  it('o endereço segue o id, não a posição: mover a faixa no mixer muda o caminho, não o endereço', () => {
    const d = musica();
    d.mixer.faixas.unshift({id: 'outra'});
    expect(ok(resolverParametro(d, 'faixa:bat/eq/graves_db')).caminho).toBe('/mixer/faixas/1/eq/graves_db');
  });
});

describe('0..1 para MIDI learn e knob', () => {
  it('ida e volta em todos os parâmetros, com a curva log nos tempos', () => {
    for (const p of PARAMETROS) {
      for (const x of [0, 0.25, 0.5, 1]) {
        const v = deNormalizado(p, x);
        if (p.tipo === 'numero') expect(paraNormalizado(p, v)).toBeCloseTo(x, 9);
        else expect(deNormalizado(p, paraNormalizado(p, v))).toEqual(v);
      }
    }
    const razao = definicaoDe(ok(lerEndereco('faixa:a/compressor/razao')))!;
    expect(deNormalizado(razao, 0.5)).toBeCloseTo(Math.sqrt(20), 9);
    const tempo = definicaoDe(ok(lerEndereco('master/delay/tempo')))!;
    expect(deNormalizado(tempo, 0)).toBe('1/16');
    expect(deNormalizado(tempo, 1)).toBe('1/2');
  });
});

describe('o que existe num documento', () => {
  it('lista faixas (inclusive as só do canal), macros só no sintetizador, peças só na bateria, master e música', () => {
    const lista = enderecosDoDocumento(musica());
    expect(new Set(lista).size).toBe(lista.length);
    expect(lista).toContain('faixa:bat/eq/graves_db');
    expect(lista).toContain('faixa:leads/volume_db');
    expect(lista).toContain('canal:sin/macro/brilho');
    expect(lista).not.toContain('canal:bat/macro/brilho');
    expect(lista).toContain('canal:bat/peca:chimbal_aberto/grupo');
    expect(lista.some((e) => e.startsWith('canal:sin/peca'))).toBe(false);
    expect(lista).toContain('master/limitador/teto_db');
    expect(lista).toContain('musica/swing');
    for (const e of lista) expect(lerParametro(musica(), e).ok, e).toBe(true);
  });

  it('a automação de volume de hoje aponta para o endereço do volume', () => {
    expect(enderecoDaAutomacao({alvo: 'master'})).toBe('master/volume_db');
    expect(enderecoDaAutomacao({alvo: 'bat', parametro: 'volume'})).toBe('faixa:bat/volume_db');
    expect(enderecoDaAutomacao({alvo: 'a/b'})).toBe('faixa:a%2Fb/volume_db');
    expect(enderecoDaAutomacao({alvo: 'bat', parametro: 'pan'})).toBeNull();
  });
});

describe('não muda o som', () => {
  it('gravar em cada endereço o valor que ele já tem deixa o PCM igual', () => {
    const hash = (doc: DocMusica) => {
      const h = createHash('sha256');
      for (const c of renderizarMusica(doc, {}).canais) h.update(Buffer.from(c.buffer, c.byteOffset, c.byteLength));
      return h.digest('hex');
    };
    const original = musica();
    original.mixer.faixas.push({id: 'sin', sidechain: {de: 'bat', quanto_db: 9}});
    let doc = structuredClone(original);
    let gravados = 0;
    for (const e of enderecosDoDocumento(original)) {
      const l = ok(lerParametro(doc, e));
      // fora da faixa, o valor efetivo é o que o motor usa: gravá-lo é o mesmo som
      const p = patchDoParametro(doc, e, l.valor);
      if (!p.ok) continue; // o sidechain sem canal
      doc = jsonpatch.applyPatch(doc, p.valor.patch, true, false).newDocument;
      gravados++;
    }
    expect(gravados).toBeGreaterThan(80);
    expect(hash(doc)).toBe(hash(original));
  });
});
