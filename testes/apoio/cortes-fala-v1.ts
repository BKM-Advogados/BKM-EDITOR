// Cópia do proporCortes de antes do C15 (O(n²·k)), só para o teste de equivalência: a versão nova tem de dar a mesma saída.
import {ehPreenchimento, juntarCortes, MARGEM_PALAVRA_MS, PAUSA_MANTIDA_MS, SILENCIO_MIN_MS, type CorteFala, type OpcoesCortes} from '../../src/nucleo/cortes-fala';
import type {PalavraLegenda} from '../../src/nucleo/legendas';

const CORTE_MIN_MS = 60;

export const proporCortesV1 = (todas: PalavraLegenda[], o: OpcoesCortes = {}): CorteFala[] => {
  const margem = o.margem_ms ?? MARGEM_PALAVRA_MS;
  const pausa = o.pausa_ms ?? PAUSA_MANTIDA_MS;
  const silencioMin = Math.max(o.silencio_min_ms ?? SILENCIO_MIN_MS, pausa + CORTE_MIN_MS);
  const ini = o.inicio_ms ?? 0;
  const fim = o.fim_ms ?? Infinity;
  const ws = todas.filter((p) => Number.isFinite(p.s) && Number.isFinite(p.e) && (p.s + p.e) / 2 >= ini && (p.s + p.e) / 2 < fim).sort((a, b) => a.s - b.s);
  if (!ws.length) return [];
  const preench = new Set(o.preenchimento === false ? [] : ws.filter((p) => ehPreenchimento(p.w)));
  // o preenchimento que não dá para tirar inteiro, longe das vizinhas, vira palavra que fica (e a conta recomeça)
  const ficam = new Set(ws.filter((p) => !preench.has(p)));
  const cortes: CorteFala[] = [];
  for (let volta = 0; volta < ws.length + 1; volta++) {
    cortes.length = 0;
    const kept = ws.filter((p) => ficam.has(p));
    let mudou = false;
    const m = Math.max(margem, pausa / 2);
    for (let i = 0; i + 1 < kept.length && !mudou; i++) {
      const a = kept[i];
      const b = kept[i + 1];
      const dentro = ws.filter((p) => preench.has(p) && !ficam.has(p) && p.s >= a.e && p.e <= b.s);
      const de = a.e + m;
      const ate = b.s - m;
      const presos = dentro.filter((p) => p.s < de || p.e > ate);
      if (presos.length) {
        presos.forEach((p) => ficam.add(p));
        mudou = true;
        break;
      }
      if ((dentro.length || b.s - a.e >= silencioMin) && ate - de >= CORTE_MIN_MS) {
        cortes.push({de_ms: Math.round(de), ate_ms: Math.round(ate), motivo: dentro.length ? 'preenchimento' : 'silencio', ...(dentro.length ? {texto: dentro.map((p) => p.w).join(' ')} : {})});
      }
    }
    if (mudou) continue;
    // as pontas: o silêncio antes da primeira palavra e depois da última fica com meia pausa
    if (o.pontas !== false && kept.length) {
      const lead = Math.max(margem, pausa / 2);
      const primeira = kept[0];
      const ultima = kept[kept.length - 1];
      const antes = ws.filter((p) => preench.has(p) && !ficam.has(p) && p.e <= primeira.s);
      if (antes.some((p) => p.s < ini)) antes.forEach((p) => ficam.add(p));
      if (primeira.s - lead - ini >= CORTE_MIN_MS && (antes.length || primeira.s - ini >= silencioMin)) {
        cortes.unshift({de_ms: Math.round(ini), ate_ms: Math.round(primeira.s - lead), motivo: antes.length ? 'preenchimento' : 'silencio',
          ...(antes.length ? {texto: antes.map((p) => p.w).join(' ')} : {})});
      }
      const depois = ws.filter((p) => preench.has(p) && !ficam.has(p) && p.s >= ultima.e);
      if (Number.isFinite(fim) && fim - (ultima.e + lead) >= CORTE_MIN_MS && (depois.length || fim - ultima.e >= silencioMin)) {
        cortes.push({de_ms: Math.round(ultima.e + lead), ate_ms: Math.round(fim), motivo: depois.length ? 'preenchimento' : 'silencio',
          ...(depois.length ? {texto: depois.map((p) => p.w).join(' ')} : {})});
      }
    }
    break;
  }
  return juntarCortes(cortes);
};
