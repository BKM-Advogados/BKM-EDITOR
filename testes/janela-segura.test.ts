// O app que não perde trabalho: instância única (transversal-D5) e janela que recarrega quando o renderer cai (D6).
import {describe, expect, it} from 'vitest';
import {JANELA_RECARGAS_MS, MAX_RECARGAS, avisoDeQuedaEmLaco, decidirRecarga, garantirInstanciaUnica, trazerParaFrente} from '../src/main/janela-segura';

const appFalso = (trava: boolean) => {
  const eventos: Record<string, () => void> = {};
  return {
    saiu: false,
    eventos,
    requestSingleInstanceLock: () => trava,
    quit() {
      this.saiu = true;
    },
    on(evento: string, f: () => void) {
      eventos[evento] = f;
    },
  };
};

describe('instância única', () => {
  it('a primeira fica e escuta a segunda; a segunda sai', () => {
    const primeira = appFalso(true);
    let avisos = 0;
    expect(garantirInstanciaUnica(primeira as never, () => avisos++)).toBe(true);
    expect(primeira.saiu).toBe(false);
    primeira.eventos['second-instance']();
    expect(avisos).toBe(1);

    const segunda = appFalso(false);
    expect(garantirInstanciaUnica(segunda as never, () => avisos++)).toBe(false);
    expect(segunda.saiu).toBe(true);
    expect(segunda.eventos['second-instance']).toBeUndefined();
  });

  it('a janela minimizada volta antes de ir para a frente; janela destruída ou ausente não quebra', () => {
    const chamadas: string[] = [];
    const janela = (min: boolean, destruida = false) => ({
      isDestroyed: () => destruida,
      isMinimized: () => min,
      restore: () => void chamadas.push('restore'),
      show: () => void chamadas.push('show'),
      focus: () => void chamadas.push('focus'),
    });
    trazerParaFrente(janela(true));
    expect(chamadas).toEqual(['restore', 'show', 'focus']);
    chamadas.length = 0;
    trazerParaFrente(janela(false));
    expect(chamadas).toEqual(['show', 'focus']);
    chamadas.length = 0;
    trazerParaFrente(janela(false, true));
    trazerParaFrente(null);
    expect(chamadas).toEqual([]);
  });
});

describe('renderer que caiu', () => {
  it('queda por falta de memória recarrega e anota o instante', () => {
    const d = decidirRecarga('oom', [], 1000);
    expect(d).toEqual({recarregar: true, recargas: [1000]});
  });

  it('saída normal não recarrega', () => {
    const d = decidirRecarga('clean-exit', [], 1000);
    expect(d).toMatchObject({recarregar: false, motivo: 'saida_normal'});
  });

  it('depois de MAX_RECARGAS quedas no último minuto, para de recarregar e avisa', () => {
    let recargas: number[] = [];
    for (let i = 0; i < MAX_RECARGAS; i++) {
      const d = decidirRecarga('crashed', recargas, 1000 + i * 1000);
      expect(d.recarregar).toBe(true);
      recargas = d.recargas;
    }
    const d = decidirRecarga('crashed', recargas, 1000 + MAX_RECARGAS * 1000);
    expect(d).toMatchObject({recarregar: false, motivo: 'cai_em_laco'});
    expect(avisoDeQuedaEmLaco('crashed')).toMatch(/já está gravado/);
  });

  it('queda antiga sai da conta e o app volta a recarregar', () => {
    const antigas = [0, 1000, 2000];
    const d = decidirRecarga('oom', antigas, JANELA_RECARGAS_MS + 5000);
    expect(d).toEqual({recarregar: true, recargas: [JANELA_RECARGAS_MS + 5000]});
  });
});
