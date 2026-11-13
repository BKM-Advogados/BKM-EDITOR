// Leitura das preferências gravadas pelo app (preferencias.json, na pasta de dados), para quem roda fora dele: o servidor
// do Claude Desktop e o listarProjetos. O app grava e valida o resto em src/main/memoria.ts; aqui só a pasta de uma chave.
import {readFileSync} from 'node:fs';
import path from 'node:path';

export const ARQUIVO_PREFERENCIAS = 'preferencias.json';

/** Uma pasta das preferências (pasta_projetos, pasta_modelos…), ou null se não há arquivo, chave ou texto. */
export const pastaDasPreferencias = (dados: string, chave: 'pasta_projetos' | 'pasta_modelos' | 'pasta_marcas' | 'pasta_trilhas'): string | null => {
  try {
    const p = JSON.parse(readFileSync(path.join(dados, ARQUIVO_PREFERENCIAS), 'utf-8').replace(/^﻿/, '')) as Record<string, unknown>;
    const v = p[chave];
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
};

/** A pessoa ligou mcp_confiar_no_cliente: a ponte do Claude Code e do Claude Desktop (mcp-desktop.ts) roda as ações
 *  sensíveis sem a elicitação e sem o cartão do app, porque o cliente já controla a permissão das ferramentas. Lido a
 *  cada chamada, para valer sem reiniciar a ponte. */
export const confiarNoClienteNasPreferencias = (dados: string): boolean => {
  try {
    const p = JSON.parse(readFileSync(path.join(dados, ARQUIVO_PREFERENCIAS), 'utf-8').replace(/^﻿/, '')) as Record<string, unknown>;
    return p.mcp_confiar_no_cliente === true;
  } catch {
    return false;
  }
};
