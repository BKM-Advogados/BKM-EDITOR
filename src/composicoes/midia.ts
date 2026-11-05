// Onde a composição acha os arquivos do projeto (narração, logo, efeitos sonoros, fotos). No app, a prévia e a exportação
// recebem `base_midia` nas props: o servidor local do processo principal, que só serve a pasta do projeto aberto. Sem
// base (Remotion Studio), cai no staticFile da pasta pública. A raiz da composição chama definirBaseMidia antes dos
// filhos renderizarem, então o valor é o mesmo em todo quadro.
import {staticFile} from 'remotion';

let base: string | null = null;

export const definirBaseMidia = (b?: string | null) => {
  base = b ? b.replace(/\/+$/, '') : null;
};

export const midia = (src: string): string => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return src;
  if (!base) return staticFile(src);
  return `${base}/${src.split('/').map(encodeURIComponent).join('/')}`;
};
