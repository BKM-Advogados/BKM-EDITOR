// Um kit de marca fictício para os testes: paleta escura com cores de apoio por nome, três fontes (título, texto e mono),
// logo e assinatura. As quatro cores principais e as fontes são as da paleta antiga que o app ainda reconhece nas imagens
// de antes do campo `marca` (marca.ts, PALETA_ANTIGA e FONTES_ANTIGAS).
import type {Marca} from '../../src/nucleo/marca';

export const KIT_TESTE: Marca = {
  formato: 1,
  id: 'teste',
  nome: 'Kit de Teste',
  cores: {fundo: '#171A19', texto: '#F4F0EA', destaque: '#C88155', suave: '#A09F9B',
    terracota: '#C88155', terracotaEscura: '#795033', terracotaClara: '#E4B492', grafite: '#2E3331', grafiteEscuro: '#171A19', nevoa: '#3D4142',
    areia: '#F4F0EA', aco: '#37556A'},
  fontes: {titulo: 'Archivo', texto: 'IBM Plex Sans', mono: 'IBM Plex Mono', arquivos: []},
  logo: 'logo.png',
  assinatura: '@escritorio.teste',
  notas: 'Kit fictício dos testes.',
};
