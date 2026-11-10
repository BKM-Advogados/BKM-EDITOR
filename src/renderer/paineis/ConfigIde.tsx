// Configurações › IA, abaixo dos apps de fora (frente IDE, docs/ide.md): a opção "Projetos prontos para IDE" (o app
// escreve .mcp.json, .claude/settings.local.json e t3.json em cada projeto ao criar ou abrir), o que foi escrito no
// projeto aberto e o "Abrir no T3 Code" (t3 project add, quando o CLI do T3 está no PATH). Desligar não apaga nada.
import React, {useEffect, useState} from 'react';
import type {EstadoIde} from '../../compartilhado/api';
import {copiar} from '../componentes/Campos';
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
  return (
    <div className="ia-apps">
      <div className="ia-uso-titulo">IDE de agentes (T3 Code, Claude Code, Cursor)</div>
      <div className="ia-linha">
        <label><input type="checkbox" checked={e.ligado} onChange={(ev) => void ligar(ev.target.checked)} /> Projetos prontos para IDE: T3 Code, Claude Code, Cursor</label>
      </div>
      <div className="fraco">
        Ao criar ou abrir um projeto, o app escreve nele o .mcp.json (o MCP estudio), o .claude/settings.local.json (que aprova esse MCP) e o
        t3.json (threads na própria pasta), sem apagar o que já estiver lá. Desligar não apaga o que já foi escrito.
      </div>
      {e.raiz && (
        <div className="ia-linha">
          <span className="fraco">{e.gravados?.length ? `Atualizados agora neste projeto: ${e.gravados.join(', ')}` : e.ligado ? 'Este projeto já está pronto para IDE.' : 'Desligado: este projeto fica como está.'}</span>
          <span className="espaco" />
          <button className="bt mini fantasma" onClick={() => copiar(e.raiz!, 'Caminho copiado')}>Copiar caminho</button>
          <button className="bt mini" disabled={ocupado} title={e.t3 ? `roda ${e.t3} project add` : 'o comando t3 não está no PATH: o botão explica como adicionar à mão'}
            onClick={() => void abrirNoT3()}>Abrir no T3 Code</button>
        </div>
      )}
      {e.avisos?.map((a) => <div key={a} className="ia-estado falta">{a}</div>)}
    </div>
  );
};
