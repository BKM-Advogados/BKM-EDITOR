// Exportação do carrossel pela interface: cada página vira um documento de uma prancheta só (vistaDaPagina) e passa
// pelo mesmo canvas do PNG simples (desenharDocumento, em exportarPng.ts), com fundo, camadas e a pilha de efeitos; os
// PNG vão ao processo principal, que grava saidas/<nome>/01.png… e o PDF (exportar-paginas.ts). Uma página de cada
// vez, em partes (imagem-D19): desenha, manda e solta antes da próxima, para o carrossel de 20 páginas não segurar 20
// imagens em resolução cheia (nem 20 PNG em base64 num pedido só).
import type {DocImagem} from '../../../nucleo/documentos';
import {paginasDe, vistaDaPagina} from '../../../nucleo/carrossel';
import {avisar, loja} from '../../estado/loja';
import {desenharDocumento} from './exportarPng';

const soltar = (c: HTMLCanvasElement) => {
  c.width = 0;
  c.height = 0;
};

/** PNG (data URL) da página `p` e as camadas cuja imagem não carregou. */
const desenharPagina = async (doc: DocImagem, p: number) => {
  const {canvas, faltaram} = await desenharDocumento(vistaDaPagina(doc, p));
  const png = canvas.toDataURL('image/png');
  soltar(canvas);
  return {png, faltaram};
};

/** Todas as páginas em PNG numerado e o PDF, em saidas/. */
export const exportarCarrossel = async (documento: string) => {
  const doc = loja.get().docs[documento]?.doc as DocImagem | undefined;
  if (!doc) return avisar('A imagem ainda não carregou.', 'erro');
  const paginas = paginasDe(doc);
  avisar(`Exportando ${paginas.length} ${paginas.length === 1 ? 'página' : 'páginas'} em ${doc.largura}×${doc.altura} e o PDF…`);
  try {
    const partes = window.estudio.exportarPaginasEmPartes;
    const {sessao} = await partes.abrir({documento, pdf: true});
    const faltaram: string[] = [];
    for (let p = 0; p < paginas.length; p++) {
      const pagina = await desenharPagina(doc, p);
      await partes.parte(sessao, {png: pagina.png, numero: p + 1});
      faltaram.push(...pagina.faltaram.map((f) => `${f} (${paginas[p].nome})`));
    }
    const r = await partes.fechar(sessao);
    const falta = faltaram.length ? ` (sem imagem: ${faltaram.join(', ')})` : '';
    if (r.ok) avisar(`Carrossel exportado: ${r.pdf ?? r.pasta}${falta}`, faltaram.length ? 'erro' : 'ok');
    else avisar(r.mensagem ? `Exportação: ${r.mensagem}` : 'Exportação cancelada.', r.mensagem ? 'erro' : 'info');
    return r;
  } catch (e) {
    avisar(`Exportação do carrossel falhou: ${(e as Error).message}`, 'erro');
    return null;
  }
};

/** Só a página `p`, em PNG ("<nome> - 03.png" em saidas/). */
export const exportarPagina = async (documento: string, p: number) => {
  const doc = loja.get().docs[documento]?.doc as DocImagem | undefined;
  if (!doc) return avisar('A imagem ainda não carregou.', 'erro');
  const pagina = paginasDe(doc)[p];
  if (!pagina) return avisar('Essa página não existe mais.', 'erro');
  avisar(`Exportando ${pagina.nome} em ${doc.largura}×${doc.altura}…`);
  try {
    const {png, faltaram} = await desenharPagina(doc, p);
    const r = await window.estudio.exportarPaginas({documento, paginas: [{png, numero: p + 1}], pdf: false});
    const falta = faltaram.length ? ` (sem imagem: ${faltaram.join(', ')})` : '';
    if (r.ok) avisar(`PNG exportado: ${r.arquivos?.[0]}${falta}`, faltaram.length ? 'erro' : 'ok');
    else avisar(r.mensagem ? `Exportação: ${r.mensagem}` : 'Exportação cancelada.', r.mensagem ? 'erro' : 'info');
    return r;
  } catch (e) {
    avisar(`Exportação do PNG falhou: ${(e as Error).message}`, 'erro');
    return null;
  }
};
