// IPC do painel de mídia (frente Casca, rodada 3): a lista e a marcação de tomadas que a interface pede ao processo principal.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, describe, expect, it} from 'vitest';
import {CANAL} from '../src/compartilhado/api';
import {gravarPlano, planoDoProjeto} from '../src/nucleo/criar-projeto';
import {Projeto} from '../src/nucleo/projeto';
import {registrarIpcMidia} from '../src/main/ipc-midia';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'estudio-ipc-midia-'));
afterAll(() => rmSync(tmp, {recursive: true, force: true}));

const destino = gravarPlano(path.join(tmp, 'projeto'), planoDoProjeto({nome: 'IPC mídia', modelo: 'video-branco'}));
mkdirSync(path.join(destino, 'midia'), {recursive: true});
writeFileSync(path.join(destino, 'midia', 'tomada.wav'), Buffer.alloc(64));
writeFileSync(path.join(destino, 'midia', 'tomada.wav.palavras.json'), '{}');

const projeto = new Projeto(destino);
const canais = new Map<string, (...a: any[]) => unknown>();
registrarIpcMidia((canal, f) => void canais.set(canal, f as (...a: any[]) => unknown), () => projeto);
const chamar = async (canal: string, ...a: unknown[]) => canais.get(canal)!(...a);

describe('IPC da mídia', () => {
  it('registra os dois canais', () => {
    expect([...canais.keys()].sort()).toEqual([CANAL.midia, CANAL.midiaMarcar].sort());
  });

  it('o índice vem com o derivado sob o original e os totais', async () => {
    const indice = (await chamar(CANAL.midia)) as {entradas: {caminho: string; derivados: {tipo: string}[]}[]; total: number; pastas: {pasta: string}[]};
    expect(indice.total).toBe(1);
    expect(indice.entradas[0]).toMatchObject({caminho: 'midia/tomada.wav', derivados: [{tipo: 'transcricao'}]});
    expect(indice.pastas).toEqual([{pasta: 'midia', quantidade: 1}]);
  });

  it('a pessoa marca pela interface: entra no diário como pessoa/interface e a lista já traz a marca', async () => {
    const r = (await chamar(CANAL.midiaMarcar, 'midia/tomada.wav', {estado: 'boa', nota: 'a boa'})) as {seq: number; marca: {estado: string}};
    expect(r.marca.estado).toBe('boa');
    expect(projeto.diario().find((e) => e.seq === r.seq)).toMatchObject({autor: 'pessoa', origem: 'interface'});
    const indice = (await chamar(CANAL.midia)) as {entradas: {marca?: {estado: string; nota: string}}[]};
    expect(indice.entradas[0].marca).toEqual({estado: 'boa', nota: 'a boa'});
  });

  it('estado fora da lista é ignorado em vez de gravado; null tira a marca', async () => {
    const torto = (await chamar(CANAL.midiaMarcar, 'midia/tomada.wav', {estado: 'otima' as never})) as {marca: {estado: string} | null};
    expect(torto.marca?.estado).toBe('boa'); // nada mudou
    const sem = (await chamar(CANAL.midiaMarcar, 'midia/tomada.wav', {estado: null, nota: ''})) as {marca: unknown};
    expect(sem.marca).toBeNull();
  });
});
