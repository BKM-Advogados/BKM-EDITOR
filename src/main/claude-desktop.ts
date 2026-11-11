// Claude Desktop no app (frente claude-desktop, docs/claude-desktop.md):
// - o arquivo de descoberta: com o app aberto, a pasta de dados dele tem o endereço do MCP por HTTP, um token só do
//   Claude Desktop (origem "Claude Desktop" no diário, o mesmo portão de permissão) e o projeto aberto. O MCP do Claude
//   Desktop (mcp/desktop.ts) lê o arquivo e passa pelo app sem a pessoa ligar "Apps de IA de fora" nem colar token.
//   O token nasce a cada abertura do app; o arquivo é 0600 e sai quando o app fecha.
// - o botão "Conectar ao Claude Desktop" (Configurações › IA): grava ou tira a entrada "estudio" do
//   claude_desktop_config.json, mesclando com o que existe, e não regrava o arquivo quando nada muda.
// Sem Electron aqui: main.ts passa o executável, o script, a pasta de dados e o endereço do MCP.
import {randomBytes} from 'node:crypto';
import {chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ARQUIVO_DESCOBERTA, ARQUIVO_INSTALACAO, arquivoConfigClaude, configConectada, configDesconectada, lerDescoberta, ORIGEM_CLAUDE_DESKTOP, pastaDoClaude,
  servidorClaudeDesktop, situacaoDaConfig, sistemaAtual, type Descoberta, type SituacaoConfig, type Sistema,
} from '../nucleo/claude-desktop';
import type {EstadoClaudeDesktop} from '../compartilhado/api';
export type {EstadoClaudeDesktop};
import {gravarAtomico, gravarAtomicoNoLugar} from '../nucleo/gravar-seguro';
import {emTranslocacao} from './ide';

type Mcp = {registrarFixo: (token: string, origem: string) => void; esquecerFixo: (token: string) => void};

/** Grava só para o usuário (0600): o arquivo tem o token. No Windows o modo não vale, e a pasta do perfil já é só dele. */
const gravarPrivado = (arquivo: string, texto: string) => {
  mkdirSync(path.dirname(arquivo), {recursive: true});
  gravarAtomico(arquivo, texto, undefined, ((p: string, t: string) => writeFileSync(p, t, {encoding: 'utf-8', mode: 0o600})) as typeof writeFileSync);
  if (process.platform !== 'win32') chmodSync(arquivo, 0o600);
};

/** Uma pasta de extensão do Estúdio entre as extensões do Claude Desktop (o nome leva o "name" do manifesto, estudio). */
export const temExtensao = (pastaClaude: string) => {
  try {
    return readdirSync(path.join(pastaClaude, 'Claude Extensions')).some((n) => /(^|[.\-_])estudio([.\-_]|$)/i.test(n));
  } catch {
    return false;
  }
};

export const criarClaudeDesktop = (o: {dados: string; executavel: string; script: string; versao: string; mcp: () => Mcp | null;
  url: () => string | null; sistema?: Sistema; pid?: number}) => {
  const sistema = o.sistema ?? sistemaAtual();
  const descoberta = path.join(o.dados, ARQUIVO_DESCOBERTA);
  const instalacao = path.join(o.dados, ARQUIVO_INSTALACAO);
  const servidor = servidorClaudeDesktop({executavel: o.executavel, script: o.script});
  let token: string | null = null;
  let projeto: string | null = null;

  const ler = (arquivo: string) => (existsSync(arquivo) ? readFileSync(arquivo, 'utf-8') : null);

  const estado = (aviso?: string): EstadoClaudeDesktop => {
    const arquivo = arquivoConfigClaude(sistema);
    let situacao: SituacaoConfig;
    try {
      situacao = situacaoDaConfig(ler(arquivo), servidor);
    } catch {
      situacao = 'ilegivel';
    }
    const pasta = pastaDoClaude(sistema);
    return {arquivo, situacao, claude_encontrado: existsSync(pasta), extensao: temExtensao(pasta), translocado: emTranslocacao(o.executavel),
      ...(aviso ? {aviso} : {})};
  };

  return {
    arquivoDescoberta: descoberta,
    arquivoInstalacao: instalacao,
    /** Grava onde este Estúdio está instalado (sem token; não sai ao fechar), para o lançador da extensão achar a pasta
     *  escolhida à mão com o app fechado. Rodando de uma cópia temporária do macOS, não grava. Nunca lança. */
    registrarInstalacao() {
      if (emTranslocacao(o.executavel)) return false;
      const texto = `${JSON.stringify({formato: 1, executavel: o.executavel, script: o.script, versao: o.versao}, null, 2)}\n`;
      try {
        if (ler(instalacao) === texto) return true;
        mkdirSync(path.dirname(instalacao), {recursive: true});
        gravarAtomicoNoLugar(instalacao, texto);
        return true;
      } catch {
        return false;
      }
    },
    /** Publica (ou republica) a descoberta: na abertura do app e ao abrir ou fechar um projeto. Nunca lança. */
    publicar(raiz?: string | null) {
      if (raiz !== undefined) projeto = raiz ? path.resolve(raiz) : null;
      const url = o.url();
      const mcp = o.mcp();
      if (!url || !mcp) return false;
      if (!token) {
        token = randomBytes(24).toString('hex');
        mcp.registrarFixo(token, ORIGEM_CLAUDE_DESKTOP);
      }
      const d: Descoberta = {formato: 1, url: `${url}/mcp`, token, pid: o.pid ?? process.pid, host: os.hostname(), executavel: o.executavel,
        script: o.script, versao: o.versao, projeto, em: new Date().toISOString()};
      try {
        gravarPrivado(descoberta, `${JSON.stringify(d, null, 2)}\n`);
        return true;
      } catch {
        return false; // pasta de dados sem escrita: o Claude Desktop segue pelo projeto escolhido, com o app fechado
      }
    },
    /** Ao fechar o app: apaga o arquivo se ainda for o deste app e esquece o token. */
    retirar() {
      if (lerDescoberta(descoberta)?.token === token) rmSync(descoberta, {force: true});
      if (token) o.mcp()?.esquecerFixo(token);
      token = null;
    },
    estado: () => estado(),
    /** Grava ou atualiza a entrada "estudio" no claude_desktop_config.json; sem mudança, não toca no arquivo. */
    conectar(): EstadoClaudeDesktop {
      if (emTranslocacao(o.executavel)) {
        return estado('o Estúdio está rodando de uma cópia temporária do macOS (aberto de Downloads): mova o Estudio.app para Aplicativos e abra de novo antes de conectar');
      }
      const arquivo = arquivoConfigClaude(sistema);
      const r = configConectada(ler(arquivo), servidor);
      if (r.aviso) return estado(r.aviso);
      if (r.texto !== null) {
        mkdirSync(path.dirname(arquivo), {recursive: true});
        gravarAtomicoNoLugar(arquivo, r.texto);
      }
      return estado();
    },
    /** Tira a entrada "estudio" (só a que o Estúdio pôs); o resto do arquivo fica como estava. */
    desconectar(): EstadoClaudeDesktop {
      const arquivo = arquivoConfigClaude(sistema);
      const r = configDesconectada(ler(arquivo));
      if (r.aviso) return estado(r.aviso);
      if (r.texto !== null) gravarAtomicoNoLugar(arquivo, r.texto);
      return estado();
    },
  };
};

export type ClaudeDesktop = ReturnType<typeof criarClaudeDesktop>;
