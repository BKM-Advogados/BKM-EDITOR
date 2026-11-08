// As ferramentas da música pelo MCP (o mesmo registro do app e do stdio), com o render de verdade (servicoDeRender,
// WAV a 48 kHz, sem ffmpeg): a ida e volta vídeo → música → vídeo (Marco A), a batida criada na Música tocando no vídeo
// sem exportar (Marco B), a ligação viva, cancelar com descartar e o pôr no vídeo.
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {registrarFerramentas} from '../src/nucleo/ferramentas-mcp';
import {novoDocCenas, type DocCenas} from '../src/nucleo/cenas';
import {novoAudioCenas} from '../src/nucleo/audio';
import {Projeto, serializar} from '../src/nucleo/projeto';
import {definirServicoMusica} from '../src/nucleo/musica-projeto';
import {acertarRenders, servicoDeRender} from '../src/main/musica-render';
import {gravarWav} from '../src/main/ffmpeg-som';
import type {DocMusica} from '../src/nucleo/musica';
import {CLASSES_MUSICA} from '../src/nucleo/mcp-musica';

let pasta = '';
let projeto: Projeto;
let cliente: Client;

const chamar = async (name: string, args: Record<string, unknown> = {}) => {
  const r = (await cliente.callTool({name, arguments: args})) as {isError?: boolean; content: {text: string}[]};
  const t = r.content[0].text;
  let dado: unknown = t;
  try {
    dado = JSON.parse(t);
  } catch {
    /* texto */
  }
  return {erro: Boolean(r.isError), dado: dado as any};
};
const video = () => projeto.lerJson<DocCenas>('video/video.json').doc;
const clipe = (id: string) => video().audio!.faixas.flatMap((f) => f.clipes).find((c) => c.id === id)!;

beforeAll(async () => {
  pasta = mkdtempSync(path.join(tmpdir(), 'estudio-musica-'));
  const v = novoDocCenas({largura: 1080, altura: 1920, fps: 30});
  v.cenas[0].duracao_ms = 3000;
  v.cenas.push({...structuredClone(v.cenas[0]), id: 'cena-2', duracao_ms: 5000});
  v.audio = novoAudioCenas();
  v.audio.faixas[0].clipes.push({id: 'voz-1', arquivo: 'midia/voz.wav', em: 0, duracao_ms: 3000});
  v.audio.faixas[1].clipes.push({id: 'clipe-2', arquivo: 'midia/cama.wav', em: 1000, duracao_ms: 4000, corte_ms: 1000, volume: 0.6});
  mkdirSync(path.join(pasta, 'video'), {recursive: true});
  mkdirSync(path.join(pasta, 'midia'), {recursive: true});
  writeFileSync(path.join(pasta, 'estudio.json'), serializar({formato: 1, nome: 'Teste da música', documentos: [{id: 'video', modulo: 'video', caminho: 'video/video.json', titulo: 'Vídeo'}]}));
  writeFileSync(path.join(pasta, 'video', 'video.json'), serializar(v));
  writeFileSync(path.join(pasta, '.gitignore'), 'saidas/\n');
  // a cama: 6 s de um acorde (lá, dó#, mi) a 48 kHz, estéreo
  const n = 6 * 48000;
  const onda = Float32Array.from({length: n}, (_, i) => 0.2 * (Math.sin((2 * Math.PI * 220 * i) / 48000) + Math.sin((2 * Math.PI * 277.2 * i) / 48000) + Math.sin((2 * Math.PI * 329.6 * i) / 48000)));
  writeFileSync(path.join(pasta, 'midia', 'cama.wav'), gravarWav([onda, onda], 48000));
  projeto = new Projeto(pasta);
  definirServicoMusica(servicoDeRender());
  const servidor = new McpServer({name: 'estudio', version: '0'});
  registrarFerramentas(servidor, projeto, 'agente', 'teste');
  cliente = new Client({name: 'teste', version: '0'});
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([servidor.connect(a), cliente.connect(b)]);
});

afterAll(async () => {
  await cliente?.close();
  definirServicoMusica(null);
  rmSync(pasta, {recursive: true, force: true});
});

describe('música pelo MCP', () => {
  it('toda ferramenta da música tem classe e esquema sem "any" (serve a qualquer provedor)', async () => {
    const {tools} = await cliente.listTools();
    for (const nome of Object.keys(CLASSES_MUSICA)) {
      const t = tools.find((x) => x.name === nome);
      expect(t, nome).toBeTruthy();
      expect(t!.description!.length, nome).toBeLessThan(400);
      // sem z.any(): toda propriedade tem tipo (o Gemini e o modo strict do DeepSeek recusam o vazio)
      const props = (t!.inputSchema as {properties?: Record<string, Record<string, unknown>>}).properties ?? {};
      for (const [k, p] of Object.entries(props)) expect(p.type ?? p.anyOf ?? p.enum, `${nome}.${k}`).toBeTruthy();
    }
  });

  it('a voz não vai para a Música (fica no vídeo, como guia)', async () => {
    const r = await chamar('levar_para', {modulo: 'musica', alvo: {documento: 'video', caminho: '/audio/faixas/@narracao/clipes/@voz-1'}});
    expect(r.erro).toBe(true);
    expect(r.dado).toMatch(/a voz fica no vídeo/);
  });

  it('Marco A: leva o clipe do vídeo à Música, mexe e volta com o render no lugar', async () => {
    projeto.gravarEstado({area: 'video', documento: 'video', selecao: '/audio/faixas/1/clipes/0', tempo_ms: 2500, atualizado_em: new Date().toISOString()});
    const ida = await chamar('levar_para', {modulo: 'musica', alvo: {documento: 'video', caminho: '/audio/faixas/@musica/clipes/@clipe-2'}});
    expect(ida.erro).toBe(false);
    expect(ida.dado).toMatchObject({transicao: 't1', destino: {documento: 'musica', selecao: '/arranjo/clipes/@c1'}, criado: true});
    // pedir de novo devolve a mesma
    expect((await chamar('levar_para', {modulo: 'musica', alvo: {documento: 'video', caminho: '/audio/faixas/@musica/clipes/@clipe-2'}})).dado).toMatchObject({transicao: 't1', ja_aberta: true});
    expect(projeto.lerTexto('.gitignore')).toMatch(/\.estudio\/transicoes\.json[\s\S]*midia\/musica\//);
    const estado = await chamar('estado_do_editor');
    expect(estado.dado.transicao).toEqual({id: 't1', intencao: 'editar', de: 'video/audio/faixas/@musica/clipes/@clipe-2', para: 'musica'});

    const ajuste = await chamar('arranjar', {acao: 'ajustar', clipe: 'c1', ganho_db: -3});
    expect(ajuste.dado).toMatchObject({ok: true, documento: 'musica', clipe: 'c1'});
    const padrao = await chamar('criar_padrao', {canal: 'bateria', estilo: 'basico', no_arranjo: {em: 0, dur: 8}});
    expect(padrao.dado).toMatchObject({ok: true, padrao: 'p1', clipe: 'c2', notas: 12});
    expect(projeto.diario().slice(-2).every((e) => e.transicao === 't1')).toBe(true);

    const lida = await chamar('ler_musica');
    expect(lida.dado.canais.map((c: {id: string}) => c.id)).toEqual(['audio', 'bateria']);
    expect(lida.dado.video).toEqual({documento: 'video', em_ms: 1000, cortes_ms: [3000]});
    expect(lida.dado.duracao).toEqual({batidas: 8, compassos: 2, s: 4});

    const volta = await chamar('concluir_transicao', {transicao: 't1'});
    expect(volta.erro).toBe(false);
    expect(volta.dado).toMatchObject({transicao: 't1', documento: 'video', caminho: '/audio/faixas/@musica/clipes/@clipe-2',
      volta: {area: 'video', documento: 'video', selecao: '/audio/faixas/1/clipes/0', tempo_ms: 2500}});
    expect(volta.dado.seqs).toHaveLength(3); // duas na música e a do vídeo
    const c = clipe('clipe-2');
    expect(c).toMatchObject({musica: 'musica', corte_ms: 0, duracao_ms: 4000, volume: 0.6, musica_original: {arquivo: 'midia/cama.wav', corte_ms: 1000, duracao_ms: 4000}});
    expect(c.arquivo).toMatch(/^midia\/musica\/musica\.[0-9a-f]{16}\.wav$/);
    expect(existsSync(path.join(pasta, c.arquivo))).toBe(true);
    expect(existsSync(path.join(pasta, `${c.arquivo}.envelope.json`))).toBe(true);
    const medida = projeto.lerJson<{integrado_lufs: number; duracao_ms: number}>(c.arquivo.replace(/\.wav$/, '.json')).doc;
    expect(medida.duracao_ms).toBe(4000);
    expect(medida.integrado_lufs).toBeGreaterThan(-40);
    expect(projeto.lerJson<{transicoes: {estado: string}[]}>('.estudio/transicoes.json').doc.transicoes[0].estado).toBe('concluida');
    expect((await chamar('concluir_transicao', {transicao: 't1'})).dado).toMatch(/já foi concluida/);
  });

  it('Marco B e ligação viva: mudar a batida troca o render do clipe do vídeo, sem exportar', async () => {
    const antes = clipe('clipe-2').arquivo;
    const r = await chamar('escrever_notas', {padrao: 'p1', notas: [{peca: 'prato', em: 0}, {peca: 'caixa', em: 1.3}], quantizar: '1/16'});
    expect(r.dado).toMatchObject({ok: true, notas: 14, video_atualizado: ['video/clipe-2']});
    const depois = clipe('clipe-2');
    expect(depois.arquivo).not.toBe(antes);
    expect(existsSync(path.join(pasta, depois.arquivo))).toBe(true);
    expect(existsSync(path.join(pasta, antes))).toBe(false); // o render antigo sai na hora
    const notas = projeto.lerJson<DocMusica>('musica/musica.json').doc.padroes[0].notas;
    expect(notas.some((n) => n.peca === 'caixa' && n.em === 1.25)).toBe(true); // quantizada em semicolcheia
    const lida = await chamar('ler_musica', {eventos: true, de: 0, ate: 4});
    expect(lida.dado.no_video).toEqual([{video: 'video', faixa: 'musica', clipe: 'clipe-2', arquivo: depois.arquivo, em_dia: true}]);
    expect(lida.dado.notas.length).toBeGreaterThan(10);
    const medida = await chamar('medir_musica', {por_faixa: true});
    expect(medida.dado.integrado_lufs).toBeGreaterThan(-40);
    expect(Object.keys(medida.dado.faixas).sort()).toEqual(['audio', 'bateria']);
  });

  it('dividir e aparar mantêm o som no lugar', async () => {
    const d = await chamar('arranjar', {acao: 'dividir', clipe: 'c2', em: 2});
    expect(d.dado.clipes).toEqual(['c2', 'c3']);
    const m = projeto.lerJson<DocMusica>('musica/musica.json').doc;
    expect(m.arranjo.clipes.find((c) => c.id === 'c3')).toMatchObject({em: 2, dur: 6, inicio: 2, padrao: 'p1'});
    const a = await chamar('arranjar', {acao: 'aparar', clipe: 'c1', em: 1});
    expect(a.dado.ok).toBe(true);
    // c1 nasceu com o corte do clipe do vídeo (1 s); aparar 1 batida (0,5 s a 120 BPM) leva o corte a 1,5 s
    expect(projeto.lerJson<DocMusica>('musica/musica.json').doc.arranjo.clipes[0]).toMatchObject({em: 1, dur: 7, corte_s: 1.5});
  });

  it('criar numa faixa e cancelar com descartar deixa o vídeo intacto e desfaz o que se fez', async () => {
    const videoAntes = projeto.lerTexto('video/video.json');
    const ida = await chamar('levar_para', {modulo: 'musica', alvo: {documento: 'video', caminho: '/audio/faixas/@efeitos'}, tempo: {em_ms: 2000, dur_ms: 1000}});
    expect(ida.dado).toMatchObject({transicao: 't2', destino: {documento: 'musica-2'}, criado: true});
    const inicial = projeto.lerTexto('musica/musica-2.json');
    expect(projeto.lerJson<DocMusica>('musica/musica-2.json').doc.video).toMatchObject({em_ms: 2000});
    await chamar('escrever_notas', {padrao: 'p1', notas: [{peca: 'prato', em: 0, forca: 120}]});
    await chamar('trocar_kit', {canal: 'bateria', kit: 'eletronico'});
    const r = await chamar('cancelar_transicao', {transicao: 't2', descartar: true});
    expect(r.dado).toMatchObject({transicao: 't2', revertidas: 2, volta: {area: 'video', documento: 'video'}});
    expect(projeto.lerTexto('musica/musica-2.json')).toBe(inicial);
    expect(projeto.lerTexto('video/video.json')).toBe(videoAntes);
  });

  it('pôr no vídeo cria um clipe ligado na faixa pedida', async () => {
    const r = await chamar('por_no_video', {musica: 'musica', faixa: 'efeitos', em_ms: 500});
    expect(r.dado).toMatchObject({ok: true, documento: 'video', caminho: '/audio/faixas/@efeitos/clipes/@musica-1'});
    const c = clipe('musica-1');
    expect(c).toMatchObject({em: 500, musica: 'musica', arquivo: clipe('clipe-2').arquivo});
  });

  it('na abertura, o render que falta no disco (pasta clonada) volta', async () => {
    const arq = clipe('clipe-2').arquivo;
    rmSync(path.join(pasta, 'midia', 'musica'), {recursive: true, force: true});
    writeFileSync(path.join(pasta, 'midia', 'sobra.txt'), 'x');
    const r = await acertarRenders(projeto, servicoDeRender());
    expect(r.renderizados).toEqual([arq]);
    expect(existsSync(path.join(pasta, arq))).toBe(true);
  });

  it('um app de IA de fora com outro autor também entra no diário da transição', async () => {
    const servidor = new McpServer({name: 'estudio', version: '0'});
    registrarFerramentas(servidor, projeto, 'outro-app', 'mcp-http');
    const fora = new Client({name: 'fora', version: '0'});
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([servidor.connect(a), fora.connect(b)]);
    const r = (await fora.callTool({name: 'levar_para', arguments: {modulo: 'musica', alvo: {documento: 'video', caminho: '/audio/faixas/@musica/clipes/@clipe-2'}}})) as {content: {text: string}[]};
    const t = JSON.parse(r.content[0].text);
    expect(t).toMatchObject({destino: {documento: 'musica'}, criado: false});
    await fora.callTool({name: 'arranjar', arguments: {acao: 'ajustar', clipe: 'c1', ganho_db: -1}});
    // a última é a troca do render no vídeo (autor sistema); a da música é a de antes
    const daMusica = projeto.diario().filter((e) => e.documento === 'musica/musica.json').pop()!;
    expect(daMusica).toMatchObject({autor: 'outro-app', transicao: t.transicao});
    expect(projeto.diario().pop()).toMatchObject({autor: 'sistema', documento: 'video/video.json'});
    await fora.callTool({name: 'concluir_transicao', arguments: {transicao: t.transicao}});
    await fora.close();
  });

  it('acordes, baixo gerado e melodia num sintetizador, pelo MCP; o vídeo recebe a versão nova', async () => {
    const antes = clipe('clipe-2').arquivo;
    const p = await chamar('aplicar_progressao', {documento: 'musica', acordes: ['I', 'vi', 'IV', 'V'], dur_por_acorde: 2});
    expect(p.dado.ok).toBe(true);
    const g = await chamar('gerar_notas', {documento: 'musica', tipo: 'baixo', estilo: 'oitavas'});
    expect(g.dado).toMatchObject({ok: true, canal: 'baixo', notas: 16});
    const lead = await chamar('criar_padrao', {documento: 'musica', canal: 'melodia', instrumento: 'lead', no_arranjo: {em: 0, dur: 8}});
    expect(lead.dado.ok).toBe(true);
    const e = await chamar('escrever_notas', {documento: 'musica', padrao: lead.dado.padrao, notas: [{nota: 61, em: 0, dur: 1}, {nota: 64, em: 1}], na_escala: true});
    expect(e.dado.ok).toBe(true);
    const m = projeto.lerJson<DocMusica>('musica/musica.json').doc;
    expect(m.padroes.find((x) => x.id === lead.dado.padrao)!.notas.map((n) => n.nota)).toEqual([62, 64]); // Dó♯ vai para Ré em Dó maior
    const lida = await chamar('ler_musica', {documento: 'musica'});
    expect(lida.dado.acordes.map((a: {nome: string}) => a.nome)).toEqual(['C', 'Am', 'F', 'G']);
    expect(lida.dado.canais.find((c: {id: string}) => c.id === 'melodia')).toMatchObject({tipo: 'sintetizador', preset: 'lead'});
    expect(clipe('clipe-2').arquivo).not.toBe(antes);
    const recusa = await chamar('criar_padrao', {documento: 'musica', canal: 'melodia', estilo: 'pop'});
    expect(recusa.erro).toBe(true);
    expect(recusa.dado).toMatch(/estilos da casa são de bateria/);
  });

  it('editar_notas, variação, repetir e seções pelo MCP', async () => {
    const lead = projeto.lerJson<DocMusica>('musica/musica.json').doc.padroes.find((x) => x.canal === 'melodia')!;
    const t = await chamar('editar_notas', {documento: 'musica', padrao: lead.id, acao: 'transpor', valor: -12});
    expect(t.dado).toMatchObject({ok: true, notas: 2});
    expect(projeto.lerJson<DocMusica>('musica/musica.json').doc.padroes.find((x) => x.id === lead.id)!.notas.map((n) => n.nota)).toEqual([50, 52]);
    const v = await chamar('criar_padrao', {documento: 'musica', canal: 'bateria', variar: {de: 'p1', quanto: 0.5, semente: 2}});
    expect(v.dado.ok).toBe(true);
    const doc = projeto.lerJson<DocMusica>('musica/musica.json').doc;
    expect(doc.padroes.find((x) => x.id === v.dado.padrao)!.nome).toMatch(/variação/);
    const r = await chamar('arranjar', {documento: 'musica', acao: 'repetir', clipe: 'c3', vezes: 2});
    expect(r.dado.clipes).toHaveLength(2);
    const s1 = await chamar('arranjar', {documento: 'musica', acao: 'secao', nome: 'Intro', em: 0, dur: 4});
    expect(s1.dado).toMatchObject({ok: true, secao: 's1'});
    expect((await chamar('ler_musica', {documento: 'musica'})).dado.secoes[0]).toMatchObject({id: 's1', nome: 'Intro', onde: '1.1'});
  });
});
