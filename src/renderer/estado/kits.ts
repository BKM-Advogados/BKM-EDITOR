// Os kits de marca como a interface os vê: lidos da pasta marcas/ uma vez e guardados aqui, para o inspector, o painel
// Marca e as predefinições "Da marca" olharem a mesma lista. Quem grava um kit (o painel Marca) avisa por definirKit ou
// recarregarKits e todo mundo que lê (usarKits) se atualiza na hora, sem reabrir o app.
import {useEffect, useSyncExternalStore} from 'react';
import {MARCAS_INICIAIS, type Marca} from '../../nucleo/marca';

let kits: Marca[] = MARCAS_INICIAIS;
let lidos = false;
const ouvintes = new Set<() => void>();
const assinar = (f: () => void) => {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
};
const mudou = () => ouvintes.forEach((f) => f());

/** Lê a pasta de novo (depois de trocar a pasta dos kits, por exemplo). Sem ponte ou com erro, fica a lista que havia. */
export const recarregarKits = async () => {
  try {
    const lista = await window.estudio.marcas.listar();
    kits = lista.length ? lista : MARCAS_INICIAIS;
    lidos = true;
    mudou();
  } catch {
    /* a lista de fábrica continua valendo */
  }
};

/** Um kit gravado, criado ou duplicado pelo painel: entra na lista (ou troca o que tinha o mesmo id). */
export const definirKit = (k: Marca) => {
  kits = kits.some((x) => x.id === k.id) ? kits.map((x) => (x.id === k.id ? k : x)) : [...kits, k];
  lidos = true;
  mudou();
};

export const kitsAgora = () => kits;

export const usarKits = (): Marca[] => {
  useEffect(() => {
    if (!lidos) void recarregarKits();
  }, []);
  return useSyncExternalStore(assinar, () => kits);
};
