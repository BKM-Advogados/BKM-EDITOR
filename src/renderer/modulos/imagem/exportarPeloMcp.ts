// A janela atende a exportação final pedida pelo MCP (exportar_imagem e exportar_carrossel, src/nucleo/mcp-exportacao-final.ts):
// o processo principal pede pela ponte (src/main/exportacao-servico.ts) e a janela desenha com as mesmas funções do diálogo
// de exportar (exportarPng e exportarCarrossel), que gravam em saidas/ e avisam a pessoa. O documento é relido antes, para
// sair o que o agente acabou de gravar. Ligada uma vez no App, para valer com o editor de qualquer módulo na tela.
import type {FormatoImagem} from '../../../nucleo/exportacao';
import {carregarDoc} from '../../estado/loja';
import {ocupadoDurante} from '../../estado/ocupado';
import {atender} from '../../ponte-janela';
import {exportarCarrossel} from './exportarPaginas';
import {exportarPng} from './exportarPng';

type PedidoImagem = {documento: string; formato: FormatoImagem; qualidade: number; escala: number; nome?: string};
type PedidoCarrossel = {documento: string; pdf: boolean; nome?: string};

export const atenderExportacaoPeloMcp = () => {
  const largarImagem = atender('exportar:imagem', async (dados) => {
    const p = dados as PedidoImagem;
    await carregarDoc(p.documento);
    // qualidade de 5 a 100, como no diálogo; o canvas recebe de 0 a 1
    const r = await ocupadoDurante('exportando', () => exportarPng(p.documento, {formato: p.formato, qualidade: p.qualidade / 100, escala: p.escala, nome: p.nome, revelar: false}));
    if (!r.ok) throw new Error(r.mensagem ?? 'a exportação da imagem falhou');
    return r;
  });
  const largarCarrossel = atender('exportar:carrossel', async (dados) => {
    const p = dados as PedidoCarrossel;
    await carregarDoc(p.documento);
    const r = await exportarCarrossel(p.documento, {pdf: p.pdf, nome: p.nome});
    if (!r.ok) throw new Error(r.mensagem ?? 'a exportação do carrossel falhou');
    return r;
  });
  return () => {
    largarImagem();
    largarCarrossel();
  };
};
