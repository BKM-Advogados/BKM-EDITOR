// Animação para leigos (ux/pesquisa-ux-visual.md, item 24): pré-ajustes de entrada e saída escrevem os quadros-chave
// a partir da agulha, sem apagar os de fora do trecho; o modo animar liga e desliga.
import {describe, expect, it} from 'vitest';
import {novaCamadaAnimacao} from '../src/nucleo/animacao';
import {modoAnimar} from '../src/renderer/modulos/animacao/preajustes';
import {DURACAO_PREAJUSTE_MS, PREAJUSTES, trilhasComPreajuste} from '../src/nucleo/animacao-preajustes';

const camada = () => ({...novaCamadaAnimacao('forma', 'f1'), x: 100, y: 200, opacidade: 1});
const pre = (id: string) => PREAJUSTES.find((p) => p.id === id)!;

describe('pré-ajustes da animação', () => {
  it('"Subir" na entrada: de 80 px abaixo e transparente até o valor de agora', () => {
    const t = trilhasComPreajuste(camada(), pre('subir'), 'entrada', 1000, 4000);
    expect(t.y).toEqual([{t_ms: 1000, valor: 280, curva: 'saida'}, {t_ms: 1000 + DURACAO_PREAJUSTE_MS, valor: 200, curva: 'suave'}]);
    expect(t.opacidade?.map((k) => k.valor)).toEqual([0, 1]);
  });
  it('a saída termina no fim do documento quando a agulha está perto dele', () => {
    const t = trilhasComPreajuste(camada(), pre('surgir'), 'saida', 3900, 4000);
    expect(t.opacidade).toEqual([{t_ms: 4000 - DURACAO_PREAJUSTE_MS, valor: 1, curva: 'entrada'}, {t_ms: 4000, valor: 0, curva: 'suave'}]);
  });
  it('os quadros-chave fora do trecho ficam', () => {
    const c = {...camada(), trilhas: {opacidade: [{t_ms: 3000, valor: 0.5}]}};
    const t = trilhasComPreajuste(c, pre('surgir'), 'entrada', 0, 4000);
    expect(t.opacidade?.map((k) => k.t_ms)).toEqual([0, DURACAO_PREAJUSTE_MS, 3000]);
  });
  it('o modo animar alterna e avisa quem ouve', () => {
    let n = 0;
    const largar = modoAnimar.assinar(() => n++);
    const antes = modoAnimar.get();
    modoAnimar.alternar();
    expect(modoAnimar.get()).toBe(!antes);
    modoAnimar.alternar();
    largar();
    expect(n).toBe(2);
  });
});
