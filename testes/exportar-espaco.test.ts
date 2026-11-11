// Espaço em disco da exportação (auditoria de render, R2 e R8): a conta do espaço livre pedido antes de renderizar, a
// checagem com o statfs real (que não bloqueia quando não dá para medir), o disco cheio reconhecido nas mensagens, e a
// estimativa com o áudio como sai do Remotion (320 kb/s).
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {discoCheio, faltaEspaco} from '../src/main/exportar';
import {espacoNecessario, estimarBytes, KBPS_AUDIO} from '../src/nucleo/exportacao';

describe('R2 · espaço em disco', () => {
  it('pede todos os arquivos mais duas cópias do maior (loudness), com folga; no mesmo disco, o pior momento', () => {
    const e = espacoNecessario([400e6, 100e6], true, false);
    expect(e.saidas).toBe(Math.round((500e6 + 800e6) * 1.15) + 100e6);
    expect(e.temporarios).toBe(Math.round(400e6 * 1.15) + 300e6);
    const m = espacoNecessario([400e6, 100e6], true, true);
    expect(m.temporarios).toBe(0);
    expect(m.saidas).toBe(Math.max(Math.round(1300e6 * 1.15), Math.round(500e6 * 1.15) + e.temporarios) + 100e6);
    // 5 min de 1080p "alta" (12 Mb/s + 320 kb/s ≈ 462 MB) no mesmo disco: ~1,7 GB livres
    const cinco = estimarBytes(12000, 300_000, true);
    expect(espacoNecessario([cinco], true, true).saidas / 1e9).toBeCloseTo(1.69, 1);
    expect(espacoNecessario([400e6], false, false).saidas).toBe(Math.round(400e6 * 1.15) + 100e6); // sem som não há loudness
  });

  it('faltaEspaco: bloqueia o que não cabe, deixa passar o que cabe e não bloqueia se não der para medir', async () => {
    expect(await faltaEspaco(os.tmpdir(), [1e15], true)).toMatch(/pouco espaço em disco/);
    expect(await faltaEspaco(os.tmpdir(), [1e6], true)).toBeNull();
    expect(await faltaEspaco(path.join(os.tmpdir(), 'nao-existe-estudio'), [1e15], true)).toBeNull();
  });

  it('reconhece o disco cheio nas mensagens do Node e do ffmpeg', () => {
    expect(discoCheio('ENOSPC: no space left on device, write')).toBe(true);
    expect(discoCheio('o ffmpeg falhou (228): … Lsize= 1280')).toBe(true);
    expect(discoCheio('o ffmpeg falhou (1): Invalid data')).toBe(false);
  });
});

describe('R8 · a estimativa conta o áudio como sai (320 kb/s)', () => {
  it('KBPS_AUDIO = 320', () => {
    expect(KBPS_AUDIO).toBe(320);
    expect(estimarBytes(0, 10_000, true)).toBe(400_000);
  });
});
