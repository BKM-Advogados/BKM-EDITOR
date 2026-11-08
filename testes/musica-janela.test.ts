// O render da música fora da thread que atende a janela: a ponte com a janela (pedido, prazo, sem janela) e o serviço
// de render que pede à janela e grava o que ela devolve, igual, byte a byte, ao que faria no processo.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {CANAL, type RespostaJanela} from '../src/compartilhado/api';
import {criarPonteJanela} from '../src/main/ponte-janela';
import {servicoDeRender} from '../src/main/musica-render';
import {gravarWav} from '../src/main/ffmpeg-som';
import {envelopeDeAmostras} from '../src/nucleo/audio';
import {medirAmostras} from '../src/nucleo/loudness';
import {novaMusica, type DocMusica} from '../src/nucleo/musica';
import {codificarWav16, renderizarMusica} from '../src/nucleo/musica-som';
import {padraoDoEstilo} from '../src/nucleo/musica-estilos';
import {Projeto, serializar} from '../src/nucleo/projeto';

const pastas: string[] = [];
afterAll(() => pastas.forEach((p) => rmSync(p, {recursive: true, force: true})));

/** Uma janela de mentira: guarda o ouvinte da resposta e responde (ou não) aos pedidos. */
const janelaFalsa = (atender?: (acao: string, dados: unknown) => RespostaJanela | null) => {
  let responder: ((id: string, r: RespostaJanela) => void) | null = null;
  const pedidos: string[] = [];
  const ponte = criarPonteJanela({
    temJanela: () => true,
    ouvir: (canal, f) => canal === CANAL.mcpResposta && (responder = f as never),
    enviar: (canal, id, acao, dados) => {
      expect(canal).toBe(CANAL.mcpPedido);
      pedidos.push(acao as string);
      const r = atender?.(acao as string, dados);
      if (r) setTimeout(() => responder!(id as string, r), 5);
    },
  });
  return {ponte, pedidos};
};

const projeto = () => {
  const pasta = mkdtempSync(path.join(tmpdir(), 'estudio-musica-j-'));
  pastas.push(pasta);
  const d = novaMusica();
  d.canais.push({id: 'bateria', nome: 'Bateria', tipo: 'bateria'});
  d.padroes.push({id: 'p1', canal: 'bateria', dur: 4, notas: padraoDoEstilo('pop').notas});
  d.arranjo.clipes.push({id: 'c1', canal: 'bateria', em: 0, dur: 8, padrao: 'p1'});
  mkdirSync(path.join(pasta, 'musica'), {recursive: true});
  writeFileSync(path.join(pasta, 'estudio.json'), serializar({formato: 1, nome: 'J', documentos: [{id: 'musica', modulo: 'musica', caminho: 'musica/musica.json', titulo: 'M'}]}));
  writeFileSync(path.join(pasta, 'musica', 'musica.json'), serializar(d));
  return new Projeto(pasta);
};

describe('ponte com a janela', () => {
  it('sem janela, responde na hora; sem resposta, para no prazo', async () => {
    const sem = criarPonteJanela({temJanela: () => false, ouvir: () => undefined, enviar: () => undefined});
    expect(await sem('musica:render', {})).toEqual({ok: false, mensagem: 'sem janela do Estúdio aberta'});
    const {ponte} = janelaFalsa(() => null);
    const r = await ponte('musica:render', {}, {tempo_ms: 30});
    expect(r.ok).toBe(false);
    expect(r.mensagem).toMatch(/não respondeu "musica:render"/);
  });

  it('o render feito pela janela é gravado como o do processo, com medida e envelope', async () => {
    const p = projeto();
    // a "janela" faz a mesma conta que o worker faria (render.worker.ts), com o documento que recebeu
    const {ponte, pedidos} = janelaFalsa((acao, dados) => {
      const {doc} = dados as {doc: DocMusica};
      const r = renderizarMusica(doc, {});
      const m = medirAmostras(r.canais, r.taxa);
      return {ok: true, dados: {wav: codificarWav16(r.canais, r.taxa), duracao_s: r.duracao_s, avisos: r.avisos, faltando: [], envelope: envelopeDeAmostras(r.canais, r.taxa),
        medida: {integrado_lufs: m.integrado_lufs, pico_dbtp: m.pico_dbtp}}};
    });
    const pelaJanela = await servicoDeRender({janela: ponte}).renderizar(p, 'musica');
    expect(pedidos).toEqual(['musica:render']);
    expect(pelaJanela.novo).toBe(true);
    expect(pelaJanela.medida.feito_por).toBe('janela');
    const bytes = readFileSync(path.join(p.raiz, pelaJanela.arquivo));
    // o mesmo documento, feito no processo: os mesmos bytes (o WAV de 16 bits dos dois lados)
    const noProcesso = renderizarMusica(p.lerJson<DocMusica>('musica/musica.json').doc, {});
    expect(bytes.equals(gravarWav(noProcesso.canais, noProcesso.taxa))).toBe(true);
    expect(p.existe(`${pelaJanela.arquivo}.envelope.json`)).toBe(true);
    // de novo: reaproveita, sem pedir
    expect((await servicoDeRender({janela: ponte}).renderizar(p, 'musica')).novo).toBe(false);
    expect(pedidos).toHaveLength(1);
  });

  it('janela que não atende: o processo faz a conta', async () => {
    const p = projeto();
    const {ponte} = janelaFalsa(() => ({ok: false, mensagem: 'a janela não atende "musica:render" agora'}));
    const r = await servicoDeRender({janela: ponte}).renderizar(p, 'musica');
    expect(r.medida.feito_por).toBe('processo');
    expect(p.existe(r.arquivo)).toBe(true);
  });
});
