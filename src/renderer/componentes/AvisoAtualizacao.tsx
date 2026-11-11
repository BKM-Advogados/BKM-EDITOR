// Aviso de versão nova (docs/atualizacao.md): um cartão no canto da janela, na tela inicial e no editor, que não tranca
// nada. Windows: baixa sozinho e avisa quando está pronta ("Reiniciar e atualizar", ou instala ao fechar). Mac e Linux:
// as notas e "Baixar" (o DMG ou o zip certo no navegador), "Pular esta versão" e "Lembrar depois"; no Linux instalado
// pelo script, também "Atualizar agora" (com confirmação) e o comando para atualizar à mão.
import React, {useEffect, useState} from 'react';
import {Download, RefreshCw, X} from 'lucide-react';
import type {EstadoAtualizacao} from '../../compartilhado/atualizacao';
import {copiar} from './Campos';
import {Caixa} from './Controles';
import {confirmar} from './Dialogo';
import {vigiarGravacao} from '../estado/ocupado';
import './atualizacao.css';

/** O estado da atualização, vivo (o aviso e as Preferências). */
export const usarAtualizacao = () => {
  const [e, setE] = useState<EstadoAtualizacao | null>(null);
  useEffect(() => {
    const api = window.estudio.atualizacao;
    if (!api) return;
    let vivo = true;
    void api.estado().then((x) => vivo && setE(x)).catch(() => undefined);
    const largar = api.aoMudar(setE);
    return () => {
      vivo = false;
      largar();
    };
  }, []);
  return e;
};

const pct = (p?: number) => `${Math.round((p ?? 0) * 100)}%`;
const mb = (bytes?: number) => (bytes ? `${Math.round(bytes / 1024 / 1024)} MB` : '');

export const AvisoAtualizacao: React.FC = () => {
  const e = usarAtualizacao();
  const [notasAbertas, setNotasAbertas] = useState(false);
  useEffect(() => vigiarGravacao(), []); // o selo "Gravando…" segura o reinício
  if (!e || e.modo === 'desligado' || !e.novidade || e.adiada) return null;
  if (!['disponivel', 'pronta', 'aguardando', 'instalando', 'falhou'].includes(e.fase) && !(e.fase === 'baixando' && e.linux_script)) return null;
  const n = e.novidade;
  const acao = (a: Parameters<typeof window.estudio.atualizacao.acao>[0]) => void window.estudio.atualizacao.acao(a);
  const windows = e.modo === 'windows';

  const atualizarLinux = async () => {
    const ok = await confirmar({titulo: `Atualizar para ${n.versao}?`, botao: 'Baixar e preparar',
      texto: `O Estúdio baixa ${n.arquivo?.nome ?? 'o zip do Linux'}${n.arquivo?.tamanho ? ` (${mb(n.arquivo.tamanho)})` : ''}, confere o SHA-256 pelo SHA256SUMS.txt da release `
        + 'e deixa a versão nova pronta ao lado da instalada. A troca da pasta ~/.local/opt/Estudio só acontece quando você clicar em "Reiniciar e atualizar".'});
    if (ok) acao('atualizar_linux');
  };

  let titulo = `Versão ${n.versao} disponível`;
  let texto: React.ReactNode = `Você está na ${e.versao_atual}.`;
  let botoes: React.ReactNode = null;
  if (e.fase === 'pronta') {
    titulo = `Versão ${n.versao} pronta`;
    texto = windows ? 'Baixada. Ela é instalada quando você fechar o Estúdio, ou agora, se reiniciar.' : 'Baixada e conferida. Reinicie para trocar de versão.';
    botoes = <>
      <button className="bt fantasma" onClick={() => acao('depois')}>Depois</button>
      <button className="bt principal" onClick={() => acao('reiniciar')}><RefreshCw size={14} />Reiniciar e atualizar</button>
    </>;
  } else if (e.fase === 'aguardando') {
    titulo = 'Reinício marcado';
    texto = `O Estúdio reinicia para atualizar assim que ${e.esperando ?? 'o trabalho em andamento'} terminar.`;
    botoes = <button className="bt" onClick={() => acao('cancelar_reinicio')}>Cancelar o reinício</button>;
  } else if (e.fase === 'instalando') {
    titulo = `Atualizando para ${n.versao}`;
    texto = 'Fechando o projeto e reiniciando…';
  } else if (e.fase === 'baixando') {
    titulo = `Baixando a versão ${n.versao}`;
    texto = <span className="atualizacao-barra" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((e.progresso ?? 0) * 100)}>
      <span style={{width: pct(e.progresso)}} /></span>;
  } else if (e.fase === 'falhou') {
    titulo = 'A atualização não terminou';
    texto = e.erro ?? 'Tente de novo mais tarde.';
    botoes = <>
      <button className="bt fantasma" onClick={() => acao('depois')}>Fechar</button>
      {e.linux_script && n.arquivo && <button className="bt" onClick={() => acao('atualizar_linux')}>Tentar de novo</button>}
      {!windows && <button className="bt principal" onClick={() => acao('baixar')}><Download size={14} />Baixar no navegador</button>}
    </>;
  } else {
    botoes = <>
      <button className="bt fantasma" onClick={() => acao('pular')}>Pular esta versão</button>
      <button className="bt fantasma" onClick={() => acao('depois')}>Lembrar depois</button>
      {e.linux_script && n.arquivo && n.somas
        ? <>
          <button className="bt" onClick={() => acao('baixar')} title={n.arquivo.url}><Download size={14} />Baixar</button>
          <button className="bt principal" onClick={() => void atualizarLinux()}><RefreshCw size={14} />Atualizar agora</button>
        </>
        : <button className="bt principal" onClick={() => acao('baixar')} title={n.arquivo?.url ?? n.pagina}>
          <Download size={14} />{n.arquivo ? `Baixar ${n.arquivo.nome.endsWith('.dmg') ? 'o DMG' : 'o zip'}` : 'Abrir a página da versão'}</button>}
    </>;
  }

  return (
    <div className="atualizacao-aviso" role="status" aria-live="polite">
      <div className="atualizacao-topo">
        <strong>{titulo}</strong>
        {e.fase !== 'instalando' && e.fase !== 'aguardando' && (
          <button className="bti" aria-label="Lembrar depois" title="Lembrar depois" onClick={() => acao('depois')}><X size={14} /></button>
        )}
      </div>
      <div className="atualizacao-texto">{texto}</div>
      {n.notas && (
        <>
          <button className="atualizacao-link" aria-expanded={notasAbertas} onClick={() => setNotasAbertas((v) => !v)}>
            {notasAbertas ? 'Esconder as novidades' : 'Ver as novidades'}</button>
          {notasAbertas && <pre className="atualizacao-notas">{n.notas}</pre>}
        </>
      )}
      {e.linux_script && e.comando_linux && e.fase === 'disponivel' && (
        <div className="atualizacao-comando">
          <span>Ou pelo terminal, a partir do repositório:</span>
          <code>{e.comando_linux}</code>
          <button className="atualizacao-link" onClick={() => copiar(e.comando_linux!, 'Comando copiado')}>Copiar o comando</button>
        </div>
      )}
      {botoes && <div className="atualizacao-botoes">{botoes}</div>}
    </div>
  );
};

/** Preferências › Atualizações: a procura automática, o "Procurar agora" e o que a última procura disse. */
export const SecaoAtualizacoes: React.FC<{automatico: boolean; aoMudar: (v: boolean) => void}> = ({automatico, aoMudar}) => {
  const e = usarAtualizacao();
  const [procurando, setProcurando] = useState(false);
  const procurar = async () => {
    setProcurando(true);
    try {
      await window.estudio.atualizacao.procurar();
    } finally {
      setProcurando(false);
    }
  };
  if (!e) return null;
  const quando = e.ultima_procura ? new Date(e.ultima_procura).toLocaleString('pt-BR', {dateStyle: 'short', timeStyle: 'short'}) : null;
  const como = e.modo === 'windows' ? 'No Windows a versão nova baixa sozinha e é instalada quando você fecha o Estúdio.'
    : e.modo === 'aviso' ? `Neste sistema o Estúdio avisa da versão nova e abre o download no navegador${e.linux_script ? ' (ou atualiza sozinho, se você confirmar)' : ''}.`
      : 'Em desenvolvimento o Estúdio não procura atualizações.';
  return (
    <>
      <div className="dialogo-secao">Atualizações</div>
      <Caixa marcado={automatico} aoMudar={aoMudar}>Procurar atualizações automaticamente</Caixa>
      <div className="dialogo-texto">{como} Versão instalada: {e.versao_atual}.{quando ? ` Última procura: ${quando}.` : ''}</div>
      <div className="atualizacao-linha">
        <button className="bt" disabled={procurando || e.procurando || e.modo === 'desligado'} onClick={() => void procurar()}>
          <RefreshCw size={14} />{procurando || e.procurando ? 'Procurando…' : 'Procurar agora'}</button>
        {e.mensagem && <span className="dialogo-texto" role="status">{e.mensagem}</span>}
      </div>
      {e.novidade && e.adiada && ['disponivel', 'pronta'].includes(e.fase) && (
        <button className="atualizacao-link" onClick={() => void window.estudio.atualizacao.acao('mostrar')}>Mostrar o aviso da versão {e.novidade.versao}</button>
      )}
    </>
  );
};
