// A paleta que os campos de cor oferecem: as cores do kit do documento aberto na área (a imagem lê do kit dela por
// referência; o vídeo de cenas, do tema). Na área Efeitos o valor vai em hexadecimal, porque a pilha de efeitos não lê
// referência. O painel Marca e os campos de 3D não usam (paleta={false} no CampoCor).
import {useMemo} from 'react';
import {paletaDoDocumento, type PaletaAtiva} from '../../nucleo/cor-marca';
import {useLoja} from './loja';

export const usarPaleta = (): PaletaAtiva | undefined => {
  const area = useLoja((e) => e.area);
  const doc = useLoja((e) => {
    const id = e.area === 'efeitos' ? e.alvoEfeitos : e.area === '3d' ? undefined : (e.ativo as Record<string, string | undefined>)[e.area];
    return id ? e.docs[id]?.doc : undefined;
  }) as unknown;
  return useMemo(() => paletaDoDocumento(doc, area !== 'efeitos'), [doc, area]);
};
