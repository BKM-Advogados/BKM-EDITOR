// Outro kit de marca fictício para os testes: um escritório de exemplo, sem logo, com as quatro cores da paleta marinho
// e dourado que o app ainda reconhece nas imagens de antes do campo `marca` (marca.ts, PALETA_MARINHO_ANTIGA) e só a
// fonte Inter (sem mono: o numeral cai na fonte de texto).
import type {Marca} from '../../src/nucleo/marca';

export const KIT_ESCRITORIO: Marca = {
  formato: 1,
  id: 'escritorio',
  nome: 'Escritório Exemplo',
  cores: {fundo: '#101826', texto: '#F2EEE6', destaque: '#C9A961', suave: '#A5ADBA'},
  fontes: {titulo: 'Inter', texto: 'Inter', arquivos: []},
  assinatura: 'escritorio.exemplo',
  notas: 'Kit fictício dos testes.',
};
