// Configurações › IA, abaixo dos apps de fora (frente IDE, docs/ide.md; harnesses, docs/harnesses.md): a opção
// "Projetos prontos para agentes" (o app escreve em cada projeto, ao criar ou abrir, o guia de cada harness (CLAUDE.md,
// AGENTS.md, GEMINI.md) e o MCP estudio no arquivo de cada um), a lista harness → arquivos, o que foi escrito no projeto
// aberto, o "Abrir no T3 Code" (t3 project add, quando o CLI do T3 está no PATH) e o `codex mcp add` para copiar.
// Desligar não apaga nada.
import React, {useEffect, useState} from 'react';
import type {EstadoIde} from '../../compartilhado/api';
import {copiar} from '../componentes/Campos';
import {Caixa} from '../componentes/Controles';
import {avisar} from '../estado/loja';

export const SecaoProjetosIde: React.FC = () => {
  const [e, setE] = useState<EstadoIde | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const atualizar = () => void window.estudio.ide.estado().then(setE).catch(() => setE(null));
  useEffect(atualizar, []);
  if (!e) return null;
  const ligar = async (ligado: boolean) => {
    await window.estudio.gravarPreferencias({projetos_ide: ligado});
    atualizar();
  };
  const abrirNoT3 = async () => {
    setOcupado(true);
    try {
      const r = await window.estudio.ide.abrirNoT3();
      avisar(r.mensagem, r.ok ? 'info' : 'erro');
    } finally {
      setOcupado(false);
    }
  };
  const gravados = new Set(e.gravados ?? []);
  return (
    <div className="ia-apps">
      <div className="ia-uso-titulo">Agentes de fora: IDEs e terminais</div>
      <Caixa marcado={e.ligado} aoMudar={(v) => void ligar(v)}>Projetos prontos para agentes: Claude Code, T3 Code, Codex, Gemini CLI, Antigravity, Cursor, VS Code, opencode</Caixa>
      <div className="fraco">
        Ao criar ou abrir um projeto, o app escreve nele o guia de cada agente (CLAUDE.md, AGENTS.md, GEMINI.md, o mesmo texto) e liga o MCP
        estudio no arquivo de cada um, sem apagar o que já estiver lá. Os arquivos de MCP têm caminhos deste computador e ficam fora do git.
        Desligar não apaga o que já foi escrito.
      </div>
      <table className="ia-harnesses fraco">
        <tbody>
          {e.harnesses.map((h) => (
            <tr key={h.nome}>
              <td>{h.nome}</td>
              <td><code>{h.guia}</code></td>
              <td><code>{h.mcp}</code>{gravados.has(h.mcp) ? ' (escrito agora)' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {e.raiz && (
        <div className="ia-linha">
          <span className="fraco">{!e.ligado ? 'Desligado: este projeto fica como está.' : e.gravados?.length ? `Ao abrir este projeto, o app escreveu: ${e.gravados.join(', ')}`
            : 'Este projeto já está pronto para os agentes.'}</span>
          <span className="espaco" />
          <button className="bt mini fantasma" onClick={() => copiar(e.raiz!, 'Caminho copiado')}>Copiar caminho</button>
          {e.comandoCodex && (
            <button className="bt mini fantasma" title="Para quem não quer marcar a pasta como confiável no Codex: liga o MCP na configuração do Codex deste computador"
              onClick={() => copiar(e.comandoCodex!, 'Comando do Codex copiado: cole no terminal')}>Copiar comando do Codex</button>
          )}
          <button className="bt mini" disabled={ocupado} title={e.t3 ? `roda ${e.t3} project add` : 'o comando t3 não está no PATH: o botão explica como adicionar à mão'}
            onClick={() => void abrirNoT3()}>Abrir no T3 Code</button>
        </div>
      )}
      {e.avisos?.map((a) => <div key={a} className="ia-estado falta">{a}</div>)}
    </div>
  );
};
