// Música, marco 5 (itens 22, 24 e 27), parte pura: o sidechain e a automação de volume, as licenças e os créditos (com
// kits e áudios de exemplo: nenhum kit de terceiros foi baixado) e os modelos feitos só com som gerado.
import jsonpatch, {type Operation} from 'fast-json-patch';
import {describe, expect, it} from 'vitest';
import {novaMusica, resolverMusica, type DocMusica} from '../src/nucleo/musica';
import {ganhoDaAutomacao, ganhoDoSidechain, disparosDoSidechain, renderizarMusica, TAXA_MUSICA, KITS} from '../src/nucleo/musica-som';
import {comprovanteDeLicencas, definirLicenca, licencasDaMusica, textoDoCredito, textoDosCreditos, type InfoKit} from '../src/nucleo/musica-licencas';
import {MODELOS_MUSICA, musicaDoModelo, patchDoModelo} from '../src/nucleo/musica-modelos';
import {entregaDaMusica} from '../src/nucleo/musica-entrega';

const TAXA = TAXA_MUSICA;
const aplicar = <T,>(d: T, patch: unknown[]) => jsonpatch.applyPatch(structuredClone(d), patch as Operation[], true).newDocument as T;
const rms = (x: Float32Array, de: number, ate: number) => {
  let s = 0;
  for (let i = de; i < ate; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, ate - de));
};

/** Bumbo nos quatro tempos e um pad (sintetizador) segurando um acorde o compasso inteiro, em faixas separadas. */
const comPad = (): DocMusica => {
  const d = novaMusica({bpm: 120});
  d.mixer.master!.limitador = {ativo: false};
  d.canais.push({id: 'bat', nome: 'Bateria', tipo: 'bateria', faixa_mixer: 'bat', kit: 'eletronico'}, {id: 'pad', nome: 'Pad', tipo: 'sintetizador', faixa_mixer: 'pad', preset: 'pad'});
  d.mixer.faixas.push({id: 'bat', nome: 'Bateria'}, {id: 'pad', nome: 'Pad'});
  d.padroes.push({id: 'p1', canal: 'bat', dur: 4, notas: [0, 1, 2, 3].map((em) => ({peca: 'bumbo' as const, em}))},
    {id: 'p2', canal: 'pad', dur: 4, notas: [{nota: 60, em: 0, dur: 4}, {nota: 64, em: 0, dur: 4}, {nota: 67, em: 0, dur: 4}]});
  d.arranjo.clipes.push({id: 'c1', canal: 'bat', em: 0, dur: 8, padrao: 'p1'}, {id: 'c2', canal: 'pad', em: 0, dur: 8, padrao: 'p2'});
  return d;
};

describe('sidechain e automação (item 22)', () => {
  it('o sidechain dispara nas notas do bumbo e abaixa a faixa logo depois de cada uma', () => {
    const d = comPad();
    d.mixer.faixas[1].sidechain = {de: 'bat', quanto_db: 12, soltura_ms: 200};
    const m = resolverMusica(d).musica;
    expect(disparosDoSidechain(m, m.faixas[1].sidechain!)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    const g = ganhoDoSidechain([0.5], {quanto_db: 12, ataque_ms: 5, soltura_ms: 200}, TAXA, TAXA);
    expect(20 * Math.log10(g[Math.round(0.5 * TAXA)])).toBeCloseTo(-12, 1); // fundo na nota
    expect(g[Math.round(0.4 * TAXA)]).toBe(1); // antes do ataque, nada
    expect(g[Math.round(0.71 * TAXA)]).toBe(1); // depois da soltura, de volta
    // no som: o pad fica mais baixo logo depois do bumbo do que no meio entre dois bumbos
    const r = renderizarMusica(d, {}, {porFaixa: true}).faixas!.pad[0];
    const logoDepois = rms(r, Math.round(1.0 * TAXA), Math.round(1.05 * TAXA));
    const noMeio = rms(r, Math.round(1.3 * TAXA), Math.round(1.45 * TAXA));
    expect(noMeio / logoDepois).toBeGreaterThan(2);
  });

  it('sidechain de canal que não existe vira aviso e fica desligado', () => {
    const d = comPad();
    d.mixer.faixas[1].sidechain = {de: 'nada'};
    const {musica, avisos} = resolverMusica(d);
    expect(musica.faixas[1].sidechain).toBeNull();
    expect(avisos.join(' ')).toMatch(/sidechain da faixa "Pad" vem do canal "nada"/);
  });

  it('a automação faz retas em dB entre os pontos e toma o lugar do fader', () => {
    const g = ganhoDaAutomacao([{s: 1, db: 0}, {s: 2, db: -20}], 3 * 100, 100);
    expect(g[50]).toBeCloseTo(1, 6); // antes do primeiro: o valor dele
    expect(20 * Math.log10(g[150])).toBeCloseTo(-10, 4); // no meio da reta
    expect(20 * Math.log10(g[250])).toBeCloseTo(-20, 4); // depois do último
    const seco = renderizarMusica(comPad(), {}, {porFaixa: true}).faixas!.pad[0]; // fader em 0 dB, sem automação
    const d = comPad();
    d.mixer.faixas[1].volume_db = -30; // o fader some quando há automação
    d.automacoes = [{alvo: 'pad', pontos: [{em: 0, db: 0}, {em: 4, db: 0}, {em: 8, db: -40}]}];
    const r = renderizarMusica(d, {}, {porFaixa: true}).faixas!.pad[0];
    const trecho = (x: Float32Array, a: number, b: number) => rms(x, Math.round(a * TAXA), Math.round(b * TAXA));
    expect(trecho(r, 0.5, 1.5) / trecho(seco, 0.5, 1.5)).toBeCloseTo(1, 3); // até o ponto em 0 dB, igual ao fader em 0
    // de 2 s a 4 s a reta vai de 0 a −40 dB: perto de 3,75 s, uns −35 dB
    expect(20 * Math.log10(trecho(r, 3.7, 3.8) / trecho(seco, 3.7, 3.8))).toBeCloseTo(-35, 0);
  });

  it('a automação do master vale para a mistura e para os stems; alvo que não existe é aviso', () => {
    const d = comPad();
    d.automacoes = [{alvo: 'master', pontos: [{em: 0, db: 0}, {em: 8, db: -30}]}, {alvo: 'nada', pontos: [{em: 0, db: 0}]}];
    expect(resolverMusica(d).avisos.join(' ')).toMatch(/faixa "nada", que não existe/);
    const e = entregaDaMusica(d, {}, {stems: true});
    const soma = e.stems!.reduce((s, x) => s + x.canais[0][Math.round(3.6 * TAXA)], 0);
    if (e.medida.limitador_db === 0) expect(soma).toBeCloseTo(e.mistura[0][Math.round(3.6 * TAXA)], 4);
  });
});

describe('licenças e créditos (item 24, com dados de exemplo)', () => {
  /** Um kit CC BY de exemplo (não existe nem foi baixado) e um áudio de fora. */
  const KIT_EXEMPLO: InfoKit = {id: 'exemplo-ccby', nome: 'Bateria de exemplo', licenca: 'CC BY 4.0', spdx: 'CC-BY-4.0', titulo: 'Kit de Exemplo', autor: 'Fulana de Tal',
    link: 'https://exemplo.org/kit'};
  const comDeFora = () => {
    const d = comPad();
    d.canais[0].kit = 'exemplo-ccby';
    d.canais.push({id: 'cama', nome: 'Cama', tipo: 'audio', faixa_mixer: 'cama'});
    d.arranjo.clipes.push({id: 'c3', canal: 'cama', em: 0, dur: 8, audio: 'midia/cama.wav', corte_s: 0, ganho_db: 0});
    return d;
  };

  it('cada som tem origem, licença e classe; o kit CC BY pede crédito e o áudio sem licença impede publicar', () => {
    const l = licencasDaMusica(comDeFora(), {kits: [...KITS, KIT_EXEMPLO], hashes: {'midia/cama.wav': 'ab'.repeat(32)}});
    expect(l.sons.map((x) => [x.tipo, x.id, x.licenca, x.classe])).toEqual([
      ['kit', 'exemplo-ccby', 'CC-BY-4.0', 'credito'], ['sintetizador', 'pad', 'proprio', 'livre'], ['audio', 'midia/cama.wav', 'nao_sei', 'sem_licenca']]);
    expect(l.sons[2].sha256).toBe('ab'.repeat(32));
    expect(l.creditos).toEqual(['"Kit de Exemplo" por Fulana de Tal (https://exemplo.org/kit), licença CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)']);
    expect(l.pode_publicar).toBe(false);
    expect(l.impede[0]).toMatch(/cama\.wav: licença não informada/);
  });

  it('dizer a licença do áudio tira o impedimento; o texto literal do crédito vale sobre o montado', () => {
    let d = comDeFora();
    d = aplicar(d, definirLicenca(d, {arquivo: 'midia/cama.wav', licenca: 'CC-BY-4.0', credito: 'Música: "Cama" de Beltrano (CC BY 4.0)'}).patch);
    expect(d.licencas).toEqual([{arquivo: 'midia/cama.wav', licenca: 'CC-BY-4.0', credito: 'Música: "Cama" de Beltrano (CC BY 4.0)'}]);
    d = aplicar(d, definirLicenca(d, {arquivo: 'midia/cama.wav', licenca: 'uso_proprio'}).patch); // troca, não duplica
    expect(d.licencas).toHaveLength(1);
    const l = licencasDaMusica(d, {kits: [...KITS, KIT_EXEMPLO]});
    expect(l.pode_publicar).toBe(true);
    expect(l.sons.find((x) => x.tipo === 'audio')?.classe).toBe('declarado');
    expect(textoDoCredito({licenca: 'CC-BY-4.0', credito: 'Texto exigido'})).toBe('Texto exigido');
    expect(() => definirLicenca(d, {licenca: 'MIT'})).toThrow(/arquivo.*ou o "kit"/);
  });

  it('o arquivo de créditos e o comprovante dizem o que se usou e o que falta', () => {
    const l = licencasDaMusica(comDeFora(), {kits: [...KITS, KIT_EXEMPLO]});
    const t = textoDosCreditos('Batida de teste', l);
    expect(t).toMatch(/^Créditos · Batida de teste/);
    expect(t).toMatch(/- "Kit de Exemplo" por Fulana de Tal/);
    expect(t).toMatch(/Sons sem exigência de crédito: sintetizador Pad\./);
    expect(t).toMatch(/Antes de publicar, confira a licença de:\n- cama\.wav/);
    const c = comprovanteDeLicencas({musica: 'm1', titulo: 'Batida de teste', arquivo: 'saidas/x.wav', licencas: l, gerado_em: '2026-11-08T12:00:00.000Z'});
    expect(c).toMatchObject({formato: 1, musica: 'm1', arquivo: 'saidas/x.wav', pode_publicar: false});
    expect(c.sons).toHaveLength(3);
  });

  it('kit que não está na lista não tem licença; só conta o que se ouve (canal mudo fica de fora); o kit da casa é próprio', () => {
    expect(licencasDaMusica(comDeFora()).sons[0]).toMatchObject({id: 'exemplo-ccby', licenca: 'nao_sei', classe: 'sem_licenca'});
    const d = comDeFora();
    d.canais[0].kit = 'eletronico';
    d.canais[2].mudo = true;
    const l = licencasDaMusica(d);
    expect(l.sons.map((x) => x.id)).toEqual(['eletronico', 'pad']);
    expect(l.sons[0].licenca).toBe('proprio');
    expect(l.pode_publicar).toBe(true);
  });
});

describe('modelos (item 27, só som gerado)', () => {
  it('cada modelo resolve sem aviso, toca e usa só sons próprios', () => {
    for (const {id} of MODELOS_MUSICA.filter((x) => x.id !== 'vazio')) {
      const d = musicaDoModelo(id, {titulo: `Modelo ${id}`});
      const {avisos, musica} = resolverMusica(d);
      expect(avisos, id).toEqual([]);
      expect(musica.duracao_s, id).toBeGreaterThan(1);
      expect(licencasDaMusica(d).sons.every((x) => x.classe === 'livre'), id).toBe(true);
      const som = renderizarMusica(d, {}, {taxa: 24000});
      expect(rms(som.canais[0], 0, som.canais[0].length), id).toBeGreaterThan(0.005);
      expect(d.titulo).toBe(`Modelo ${id}`);
    }
  }, 60_000);

  it('batida: bateria, baixo com sidechain do bumbo e acordes; trilha: fade no fim; efeito: impacto no fim', () => {
    const b = musicaDoModelo('batida');
    expect(b.canais.map((c) => c.tipo)).toEqual(['bateria', 'sintetizador', 'sintetizador']);
    expect(b.mixer.faixas.find((f) => f.sidechain)?.sidechain).toMatchObject({de: 'bateria', peca: 'bumbo'});
    expect(resolverMusica(b).musica.duracao_batidas).toBe(32);
    const t = musicaDoModelo('trilha_video', undefined, {dur_s: 30});
    expect(resolverMusica(t).musica.duracao_batidas).toBe(48); // 30 s a 90 BPM = 11,25 compassos → 12
    expect(t.automacoes?.[0]).toMatchObject({alvo: 'master', pontos: [{em: 44, db: 0}, {em: 48, db: -40}]});
    const e = musicaDoModelo('efeito_sonoro', undefined, {dur_s: 2});
    const m = resolverMusica(e).musica;
    expect(m.duracao_batidas).toBe(4);
    expect(e.padroes.find((p) => p.canal === 'bateria')!.notas.filter((n) => n.em === 2).map((n) => n.peca)).toEqual(['bumbo', 'prato', 'tom_grave']);
  });

  it('a entrega chega ao alvo com o limitador trabalhando muito (batida com fade no master, o caso da prévia)', () => {
    const d = musicaDoModelo('batida');
    d.automacoes = [{alvo: 'master', pontos: [{em: 0, db: 0}, {em: 28, db: -30}]}];
    const e = entregaDaMusica(d, {});
    expect(e.medida.limitador_db).toBeGreaterThan(1);
    expect(Math.abs((e.medida.lufs ?? 0) + 14)).toBeLessThanOrEqual(0.3);
    expect(e.medida.no_alvo).toBe(true);
  });

  it('o patch do modelo troca o documento aberto e guarda título e vídeo', () => {
    const d = novaMusica({titulo: 'Minha'});
    d.video = {documento: 'video', em_ms: 500, voz_guia: true};
    const n = aplicar(d, patchDoModelo(d, 'batida'));
    expect(n.titulo).toBe('Minha');
    expect(n.video).toEqual({documento: 'video', em_ms: 500, voz_guia: true});
    expect(n.canais).toHaveLength(3);
    expect(n.bpm).toBe(100);
  });
});
