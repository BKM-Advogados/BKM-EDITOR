// Preferências da exportação por projeto (.estudio/exportacao.json): a marca d'água de cada destino. Quem lê e grava é o processo
// principal (o diálogo de exportar, src/main/ipc-exportacao.ts) e o MCP (ferramenta marca_dagua, src/nucleo/mcp-exportar.ts), por
// isso o código mora aqui, sem Electron. Arquivo ausente ou estragado é preferência vazia: o diálogo volta aos padrões.
import jsonpatch from 'fast-json-patch';
import type {OperacaoPatch} from './documentos';
import {normalizarPrefsExportacao, type PrefsExportacao} from './exportacao';
import {PASTA_INTERNA, serializar, versaoDe, type Projeto} from './projeto';
import path from 'node:path';

export const ARQUIVO_PREFS_EXPORTACAO = path.join(PASTA_INTERNA, 'exportacao.json');
/** O caminho como o diário o escreve (sempre com barra). */
export const CAMINHO_PREFS_NO_DIARIO = `${PASTA_INTERNA}/exportacao.json`;

export const lerPrefsExportacao = (p: Projeto): PrefsExportacao => {
  try {
    return p.existe(ARQUIVO_PREFS_EXPORTACAO) ? normalizarPrefsExportacao(p.lerJson<unknown>(ARQUIVO_PREFS_EXPORTACAO).doc) : {};
  } catch {
    return {};
  }
};

/** Junta a mudança ao que já estava (por destino) e grava; devolve o arquivo inteiro como ficou. */
export const gravarPrefsExportacao = (p: Projeto, mudanca: PrefsExportacao): PrefsExportacao => {
  const atual = lerPrefsExportacao(p);
  const novo = normalizarPrefsExportacao({...atual, marca_dagua: {...atual.marca_dagua, ...normalizarPrefsExportacao(mudanca).marca_dagua}});
  p.gravarTexto(ARQUIVO_PREFS_EXPORTACAO, serializar(novo));
  return novo;
};

/** O mesmo que `gravarPrefsExportacao`, para quem não é a pessoa na interface (o agente): a mudança entra no diário com o patch e o
 *  inverso, para o Histórico mostrar quem mexeu na marca d'água. As escolhas da pessoa no diálogo não passam por aqui. */
export const gravarPrefsExportacaoNoDiario = (p: Projeto, mudanca: PrefsExportacao, quem: {autor: string; origem: string; rotulo: string}): PrefsExportacao => {
  const antes = lerPrefsExportacao(p);
  const textoAntes = p.existe(ARQUIVO_PREFS_EXPORTACAO) ? p.lerTexto(ARQUIVO_PREFS_EXPORTACAO) : serializar(antes);
  const depois = gravarPrefsExportacao(p, mudanca);
  const texto = serializar(depois);
  p.registrar({
    seq: p.ultimaSeq() + 1,
    em: new Date().toISOString(),
    documento: CAMINHO_PREFS_NO_DIARIO,
    autor: quem.autor,
    origem: quem.origem,
    rotulo: quem.rotulo,
    versao_antes: versaoDe(textoAntes),
    versao_depois: versaoDe(texto),
    patch: jsonpatch.compare(antes, depois) as OperacaoPatch[],
    inverso: jsonpatch.compare(depois, antes) as OperacaoPatch[],
  });
  return depois;
};
