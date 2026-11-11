// Configurações › IA (frente IA, rodada 3): a lista de provedores no "padrão Cline". Para cada um: o que falta, onde
// fica o servidor, a chave (só os 4 últimos caracteres aparecem; ela é testada na lista de modelos antes de gravar),
// o modelo (da lista do próprio endereço), o endereço (no compatível e nos locais) e o provedor padrão. Embaixo, o
// uso do mês com a composição: tokens de entrada (parte do cache), de saída e o custo estimado pela tabela.
import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {AudioLines, CircleAlert, CircleCheck, ExternalLink, KeyRound, RefreshCw, ShieldQuestion, X} from 'lucide-react';
import type {ConfigsDoApp, EstadoAppsDeFora, EstadoClaudeDesktop, EstadoNarracaoIA, EstadoProvedor, UsoDoMes} from '../../compartilhado/api';
import {copiar} from '../componentes/Campos';
import {avisar} from '../estado/loja';
import {estadoConversas, fecharConfigIA, lerProvedores, responderAvulso} from './conversas';
import {SecaoProjetosIde} from './ConfigIde'; // frente IDE
import './config-ia.css';
import {Caixa, Escolha} from '../componentes/Controles';
import './conversa.css'; // o cartão de permissão solto usa o mesmo estilo do da conversa

const mil = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', {maximumFractionDigits: 1})} mil` : String(n));
const NOMES_USO: Record<string, string> = {'gemini-tts': 'Gemini TTS (narração)', 'google-tts': 'Google Cloud TTS (narração)'};
const usd = (n: number) => `US$ ${n.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2})}`;

const LinhaProvedor: React.FC<{p: EstadoProvedor; aberto: boolean; abrir: () => void}> = ({p, aberto, abrir}) => {
  const [chave, setChave] = useState('');
  const [msg, setMsg] = useState<{ok: boolean; texto: string} | null>(null);
  const [modelos, setModelos] = useState<string[]>([]);
  const [modelo, setModelo] = useState(p.modelo ?? '');
  const [base, setBase] = useState(p.base ?? '');
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    setModelo(p.modelo ?? '');
    setBase(p.base ?? '');
  }, [p.modelo, p.base]);

  const gravarChave = async () => {
    setOcupado(true);
    try {
      const r = await window.estudio.ia.gravarChave(p.id, chave);
      setMsg({ok: r.ok, texto: r.mensagem});
      if (r.ok) {
        setChave('');
        if (r.modelos?.length) setModelos(r.modelos);
      }
      await lerProvedores();
    } finally {
      setOcupado(false);
    }
  };
  const buscarModelos = async () => {
    setOcupado(true);
    try {
      const r = await window.estudio.ia.modelos(p.id);
      if (r.ok) setModelos(r.modelos);
      setMsg(r.ok ? {ok: true, texto: `${r.modelos.length} modelos neste endereço`} : {ok: false, texto: r.mensagem});
    } finally {
      setOcupado(false);
    }
  };
  const configurar = async (c: {modelo?: string; base?: string}) => {
    try {
      await window.estudio.ia.configurar(p.id, c);
      await lerProvedores();
    } catch (e) {
      setMsg({ok: false, texto: String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')});
    }
  };

  const estado = p.pronto ? <span className="ia-estado pronto"><CircleCheck size={12} />pronto</span>
    : <span className="ia-estado falta"><CircleAlert size={12} />falta {p.falta ?? 'configurar'}</span>;
  return (
    <div className={`ia-provedor${aberto ? ' aberto' : ''}`}>
      <button className="ia-cabeca" onClick={abrir} aria-expanded={aberto}>
        <span className="ia-nome">{p.nome}</span>
        {p.experimental && <span className="ia-selo">experimental</span>}
        {p.padrao && <span className="ia-selo padrao">padrão</span>}
        <span className="espaco" />
        {estado}
      </button>
      {aberto && (
        <div className="ia-corpo">
          <div className="ia-info">Servidor: {p.servidor}{p.via === 'acp' ? ' · agente instalado neste PC, com a configuração e o login dele' : ''}</div>
          {p.via === 'claude-cli' && <div className="ia-info">O login é o da Anthropic: abra um terminal do Claude e digite /login. O app não vê a sua senha.</div>}
          {p.via === 'openai' && p.chave !== 'nenhuma' && (
            <div className="ia-linha">
              <KeyRound size={13} />
              {p.chave_final ? <span>chave …{p.chave_final} {p.chave_origem === 'ambiente' ? `(da variável ${p.chave_variavel ?? 'de ambiente'})` : '(neste PC)'}</span>
                : <span className="fraco">sem chave</span>}
              <input className="campo" type="password" placeholder={p.chave_final ? 'trocar a chave' : 'cole a chave aqui'} value={chave} autoComplete="off"
                onChange={(e) => setChave(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && chave.trim() && void gravarChave()} />
              <button className="bt mini principal" disabled={!chave.trim() || ocupado} onClick={() => void gravarChave()}>Testar e gravar</button>
              {p.chave_origem === 'cofre' && <button className="bt mini fantasma" onClick={() => void window.estudio.ia.apagarChave(p.id).then(lerProvedores)}>Apagar</button>}
              {p.paginaChave && <button className="bt mini fantasma" onClick={() => void window.estudio.abrirFonte(p.paginaChave!)}><ExternalLink size={12} />Onde pego a chave?</button>}
            </div>
          )}
          {p.via === 'openai' && (p.id === 'compativel' || p.local) && (
            <div className="ia-linha">
              <span className="rot">Endereço</span>
              <input className="campo" placeholder="http://127.0.0.1:11434/v1" value={base} onChange={(e) => setBase(e.target.value)} />
              <button className="bt mini" disabled={base === (p.base ?? '')} onClick={() => void configurar({base})}>Gravar</button>
            </div>
          )}
          {p.via === 'openai' && (
            <div className="ia-linha">
              <span className="rot">Modelo</span>
              {modelos.length ? (
                <Escolha valor={modelo || undefined} rotulo="Modelo" aoMudar={(m) => (setModelo(m), void configurar({modelo: m}))}
                  opcoes={[...(modelo && !modelos.includes(modelo) ? [[modelo, modelo] as [string, string]] : []), ...modelos.map((m): [string, string] => [m, m])]} />
              ) : (
                <input className="campo" placeholder="nome do modelo" value={modelo} onChange={(e) => setModelo(e.target.value)}
                  onBlur={() => modelo !== (p.modelo ?? '') && void configurar({modelo})} />
              )}
              <button className="bt mini fantasma" disabled={ocupado || (p.chave === 'exigida' && !p.chave_final)} onClick={() => void buscarModelos()}
                title="Ler a lista de modelos do próprio endereço"><RefreshCw size={12} />Lista</button>
            </div>
          )}
          {msg && <div className={`ia-msg${msg.ok ? '' : ' erro'}`}>{msg.texto}</div>}
          {p.pronto && !p.padrao && (
            <button className="bt mini fantasma" onClick={() => void window.estudio.ia.padrao(p.id).then(lerProvedores).then(() => avisar(`${p.nome} é o padrão das conversas novas`))}>
              Usar como padrão das conversas novas
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// Narração por IA (docs/narracao.md): o Gemini TTS usa a chave do Gemini das conversas (aqui só o estado dela e o aviso do
// plano gratuito); o Google Cloud TTS (vozes Chirp 3: HD) tem chave própria, testada na lista de vozes (sem custo) antes de
// gravar, cifrada como as outras e mostrada só pelos 4 últimos caracteres.
const PAGINA_CHAVE_TTS = 'https://console.cloud.google.com/apis/credentials';
const PAGINA_API_TTS = 'https://console.cloud.google.com/apis/library/texttospeech.googleapis.com';
const SecaoNarracao: React.FC<{foco: boolean; abrirGemini: () => void}> = ({foco, abrirGemini}) => {
  const [e, setE] = useState<EstadoNarracaoIA | null>(null);
  const [chave, setChave] = useState('');
  const [msg, setMsg] = useState<{ok: boolean; texto: string} | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const ler = () => void window.estudio.narracao.estado().then(setE).catch(() => setE(null));
  useEffect(ler, []);
  useEffect(() => {
    if (foco) caixa.current?.scrollIntoView({block: 'nearest'});
  }, [foco, e]);
  if (!e) return null;
  const gravar = async () => {
    setOcupado(true);
    try {
      const r = await window.estudio.narracao.gravarChave(chave);
      setMsg({ok: r.ok, texto: r.mensagem});
      if (r.ok) setChave('');
      ler();
    } finally {
      setOcupado(false);
    }
  };
  const g = e.gemini;
  const t = e['google-tts'];
  return (
    <div ref={caixa} className={`ia-apps ia-narracao${foco ? ' foco' : ''}`}>
      <div className="ia-uso-titulo"><AudioLines size={13} /> Narração por IA (a voz do vídeo de cenas)</div>
      <div className="ia-linha">
        <span className="ia-nome">Gemini TTS</span>
        {g.pronto ? <span className="ia-estado pronto"><CircleCheck size={12} />usa a chave do Gemini …{g.final} {g.origem === 'ambiente' ? `(da variável ${g.variavel ?? 'de ambiente'})` : '(neste PC)'}</span>
          : <span className="ia-estado falta"><CircleAlert size={12} />falta a chave do Gemini</span>}
        <span className="espaco" />
        {!g.pronto && <button className="bt mini" onClick={abrirGemini}>Pôr a chave do Gemini</button>}
      </div>
      <div className="fraco">Gemini 3.8 Flash TTS e Flash-Lite TTS, pela mesma chave das conversas. No plano gratuito do Gemini, o Google pode usar o texto e o áudio
        para melhorar os produtos dele; no plano pago, não. O preço da fala dobra em 01/01/2027.</div>
      <div className="ia-linha">
        <span className="ia-nome">Google Cloud TTS</span>
        <KeyRound size={13} />
        {t.final ? <span>chave …{t.final} {t.origem === 'ambiente' ? `(da variável ${t.variavel ?? 'de ambiente'})` : '(neste PC)'}</span> : <span className="fraco">sem chave</span>}
        <input className="campo" type="password" placeholder={t.final ? 'trocar a chave' : 'cole a chave aqui'} value={chave} autoComplete="off"
          onChange={(ev) => setChave(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && chave.trim() && void gravar()} />
        <button className="bt mini principal" disabled={!chave.trim() || ocupado} onClick={() => void gravar()}>Testar e gravar</button>
        {t.origem === 'cofre' && <button className="bt mini fantasma" onClick={() => void window.estudio.narracao.apagarChave().then(ler)}>Apagar</button>}
        <button className="bt mini fantasma" onClick={() => void window.estudio.abrirFonte(PAGINA_CHAVE_TTS)}><ExternalLink size={12} />Onde pego a chave?</button>
      </div>
      <div className="fraco">Vozes Chirp 3: HD em português (pt-BR-Chirp3-HD-…). A chave é testada na lista de vozes, que não custa nada. Ative a Cloud Text-to-Speech
        API no projeto da chave (<button className="link" onClick={() => void window.estudio.abrirFonte(PAGINA_API_TTS)}>abrir</button>). US$ 30 por milhão de caracteres,
        com 1 milhão grátis por mês.</div>
      {msg && <div className={`ia-msg${msg.ok ? '' : ' erro'}`}>{msg.texto}</div>}
    </div>
  );
};

// Claude Desktop (docs/claude-desktop.md): um botão grava a entrada "estudio" no claude_desktop_config.json (mesclada,
// sem apagar o que existe) e outro a tira. Com o app aberto, o Claude Desktop opera no projeto aberto aqui, sem porta
// fixa nem token colado (arquivo de descoberta); com o app fechado, escolhe um projeto pela lista.
const TEXTO_SITUACAO: Record<EstadoClaudeDesktop['situacao'], string> = {
  conectado: 'conectado: reinicie o Claude Desktop se ele estava aberto',
  desatualizado: 'conectado a outra cópia do Estúdio: conecte de novo',
  manual: 'já há um "estudio" posto à mão no Claude Desktop',
  desconectado: 'não conectado',
  ilegivel: 'o arquivo de configuração do Claude Desktop não é JSON válido',
};

const SecaoClaudeDesktop: React.FC = () => {
  const [e, setE] = useState<EstadoClaudeDesktop | null>(null);
  useEffect(() => {
    void window.estudio.ia.claudeDesktop().then(setE).catch(() => setE(null));
  }, []);
  if (!e) return null;
  const falhar = (err: unknown) => avisar(String((err as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'erro');
  const depois = (x: EstadoClaudeDesktop) => (setE(x), x.aviso && avisar(x.aviso, 'erro'));
  const ok = e.situacao === 'conectado';
  return (
    <div className="ia-apps">
      <div className="ia-uso-titulo">Claude Desktop</div>
      <div className="ia-linha">
        <span className={ok ? 'ia-estado pronto' : 'ia-estado falta'}>{ok ? <CircleCheck size={12} /> : <CircleAlert size={12} />}{TEXTO_SITUACAO[e.situacao]}</span>
        <span className="espaco" />
        {e.situacao !== 'conectado' && <button className="bt mini" disabled={e.translocado || e.situacao === 'manual' || e.situacao === 'ilegivel'}
          onClick={() => void window.estudio.ia.claudeDesktopConectar().then(depois).catch(falhar)}>Conectar ao Claude Desktop</button>}
        {(e.situacao === 'conectado' || e.situacao === 'desatualizado') && <button className="bt mini fantasma"
          onClick={() => void window.estudio.ia.claudeDesktopDesconectar().then(depois).catch(falhar)}>Desconectar</button>}
      </div>
      <div className="fraco">
        Com o Estúdio aberto, o Claude Desktop trabalha no projeto aberto aqui, e os pedidos de permissão aparecem nesta tela. Com o app
        fechado, ele lista os seus projetos e trabalha no que você escolher. Tudo entra no Histórico como "Claude Desktop".
        {!e.claude_encontrado && ' O Claude Desktop não foi encontrado neste PC: instale e abra uma vez.'}
        {e.extensao && ' A extensão do Estúdio já está instalada no Claude Desktop: não precisa conectar por aqui também.'}
        {e.translocado && ' Mova o Estudio.app para Aplicativos e abra de novo antes de conectar.'}
      </div>
      <div className="fraco">Arquivo: {e.arquivo}</div>
    </div>
  );
};

// Apps de IA de fora (padrão Screenpipe): ligar a porta só deste PC, criar um app com token próprio, copiar a
// configuração (HTTP para Cursor, Cline, Windsurf, VS Code; stdio para o Claude Desktop) e revogar. Quem entra por fora
// passa pelo mesmo portão de permissão e aparece no Histórico com o nome do app.
const SecaoAppsDeFora: React.FC = () => {
  const [e, setE] = useState<EstadoAppsDeFora | null>(null);
  const [nome, setNome] = useState('');
  const [porta, setPorta] = useState('');
  const [mostrar, setMostrar] = useState<{nome: string; configs: ConfigsDoApp} | null>(null);
  const atualizar = (x: EstadoAppsDeFora) => (setE(x), setPorta(String(x.porta)));
  useEffect(() => {
    void window.estudio.ia.apps().then(atualizar).catch(() => setE(null));
  }, []);
  if (!e) return null;
  const falhar = (err: unknown) => avisar(String((err as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'erro');
  return (
    <div className="ia-apps">
      <div className="ia-uso-titulo">Apps de IA de fora (Claude Desktop, Cursor, Cline, Windsurf…)</div>
      <div className="ia-linha">
        <Caixa marcado={e.ligado} aoMudar={(v) => void window.estudio.ia.appsLigar(v, Number(porta)).then(atualizar).catch(falhar)}>Deixar apps deste PC usarem o projeto aberto</Caixa>
        <span className="rot">Porta</span>
        <input className="campo porta" value={porta} onChange={(ev) => setPorta(ev.target.value.replace(/\D/g, ''))}
          onBlur={() => Number(porta) !== e.porta && void window.estudio.ia.appsLigar(e.ligado, Number(porta)).then(atualizar).catch(falhar)} />
        {e.ligado && <span className={e.ouvindo ? 'ia-estado pronto' : 'ia-estado falta'}>{e.ouvindo ? 'ouvindo só em 127.0.0.1' : e.erro ?? 'fechada'}</span>}
      </div>
      {e.apps.map((a) => (
        <div key={a.id} className="ia-linha">
          <span className="ia-nome">{a.nome}</span>
          <span className="fraco">desde {new Date(a.criado_em).toLocaleDateString('pt-BR')}</span>
          <span className="espaco" />
          <button className="bt mini fantasma" onClick={() => void window.estudio.ia.appsConfigs(a.id).then((c) => setMostrar({nome: a.nome, configs: c})).catch(falhar)}>Configuração</button>
          <button className="bt mini fantasma" onClick={() => void window.estudio.ia.appsRevogar(a.id).then((x) => (atualizar(x), setMostrar(null))).catch(falhar)}>Revogar</button>
        </div>
      ))}
      <div className="ia-linha">
        <input className="campo" placeholder="nome do app (ex.: Cursor)" value={nome} onChange={(ev) => setNome(ev.target.value)} />
        <button className="bt mini" disabled={!nome.trim()} onClick={() => void window.estudio.ia.appsNovo(nome).then(async (r) => {
          setMostrar({nome, configs: r.configs});
          setNome('');
          atualizar(await window.estudio.ia.apps());
        }).catch(falhar)}>Conectar outro app de IA</button>
      </div>
      {mostrar && (
        <div className="ia-configs">
          <div className="fraco">Cole no arquivo de servidores MCP do {mostrar.nome}. O token é dele: se vazar, revogue e crie outro.</div>
          <div className="ia-config"><span className="rot">HTTP</span><span className="fraco">Cursor, Cline, Windsurf, VS Code</span>
            <button className="bt mini fantasma" onClick={() => copiar(mostrar.configs.http, 'Configuração copiada')}>Copiar</button></div>
          <pre className="perm-cmd">{mostrar.configs.http}</pre>
          <div className="ia-config"><span className="rot">stdio</span><span className="fraco">quem só aceita stdio (usa a ponte do Estúdio; o Claude Desktop tem a seção própria acima)</span>
            <button className="bt mini fantasma" onClick={() => copiar(mostrar.configs.stdio, 'Configuração copiada')}>Copiar</button></div>
          <pre className="perm-cmd">{mostrar.configs.stdio}</pre>
        </div>
      )}
    </div>
  );
};

const DialogoConfigIA: React.FC = () => {
  const cfg = useSyncExternalStore(estadoConversas.assinar, estadoConversas.configIA);
  const provedores = useSyncExternalStore(estadoConversas.assinar, estadoConversas.provedores);
  const [aberto, setAberto] = useState<string | undefined>(undefined);
  const [uso, setUso] = useState<UsoDoMes>({});
  useEffect(() => {
    if (!cfg) return;
    setAberto(cfg.foco);
    void window.estudio.ia.usoDoMes().then(setUso).catch(() => setUso({}));
  }, [cfg]);
  // Esc fecha mesmo com o foco fora do diálogo (o onKeyDown do fundo só pega com o foco dentro dele)
  useEffect(() => {
    if (!cfg) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && fecharConfigIA();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [cfg]);
  if (!cfg) return null;
  const persistente = provedores.some((p) => p.cofre_persistente);
  const cofreTexto = provedores.find((p) => p.cofre_texto)?.cofre_texto;
  const linhasUso = Object.entries(uso);
  return (
    <div className="dialogo-fundo" onPointerDown={(e) => e.target === e.currentTarget && fecharConfigIA()} onKeyDown={(e) => e.key === 'Escape' && fecharConfigIA()}>
      <div className="dialogo config-ia" role="dialog" aria-modal="true" aria-label="Configurações da IA">
        <div className="dialogo-titulo">IA: provedores e chaves<button aria-label="Fechar" className="bti fechar" onClick={fecharConfigIA} title="Fechar"><X size={14} /></button></div>
        <div className="dialogo-texto">
          Escolha com qual IA conversar. Todas editam pelo mesmo MCP do Estúdio, com o mesmo histórico e o mesmo Reverter.
          {cofreTexto ? ` Chave ${cofreTexto}.` : persistente ? ' A chave fica cifrada neste PC.' : ' Neste PC a chave vale só enquanto o app estiver aberto.'}
        </div>
        <div className="ia-lista">
          {provedores.map((p) => <LinhaProvedor key={p.id} p={p} aberto={aberto === p.id} abrir={() => setAberto((a) => (a === p.id ? undefined : p.id))} />)}
        </div>
        <SecaoNarracao foco={cfg.foco === 'narracao'} abrirGemini={() => setAberto('gemini')} />
        <SecaoClaudeDesktop />
        <SecaoAppsDeFora />
        <SecaoProjetosIde />
        <div className="ia-uso">
          <div className="ia-uso-titulo">Uso deste mês neste PC</div>
          {linhasUso.length ? (
            <table>
              <tbody>
                {linhasUso.map(([id, u]) => (
                  <tr key={id}>
                    <td>{provedores.find((p) => p.id === id)?.nome ?? NOMES_USO[id] ?? id}</td>
                    <td>{u.turnos} {id === 'gemini-tts' || id === 'google-tts' ? 'falas' : 'respostas'}</td>
                    <td>{id === 'google-tts' ? `${mil(u.entrada)} caracteres` : <>{mil(u.entrada)} tokens de entrada ({mil(u.cache)} do cache) · {mil(u.saida)} de saída</>}</td>
                    <td className="num">{u.custo_usd ? `≈ ${usd(u.custo_usd)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div className="fraco">Nenhuma conversa por chave neste mês.</div>}
          <div className="fraco">Custo estimado pela tabela de preços do app (08/11/2026); o valor cobrado é o da fatura do provedor. Conversas pela conta do Claude não entram aqui.</div>
        </div>
      </div>
    </div>
  );
};

// Pedidos do portão vindos de uma aba sem conversa no painel (o Claude ou outro agente no terminal, um app de IA de
// fora): o mesmo cartão, solto no canto da tela, com a origem escrita. Sem resposta em 10 min, o servidor nega.
const PedidosAvulsos: React.FC = () => {
  const avulsos = useSyncExternalStore(estadoConversas.assinar, estadoConversas.avulsos);
  if (!avulsos.length) return null;
  return (
    <div className="ia-avulsos" role="alertdialog" aria-label="Pedidos de permissão da IA">
      {avulsos.map((p) => (
        <div key={p.id} className="permissao ia-avulso">
          <div className="perm-topo"><ShieldQuestion size={15} />{p.origem} quer {p.motivo}</div>
          {(p.entrada.url ?? p.entrada.arquivo) !== undefined && <pre className="perm-cmd">{String(p.entrada.url ?? p.entrada.arquivo)}</pre>}
          <div className="perm-botoes">
            <button className="bt principal mini" onClick={() => responderAvulso(p.id, true)}>Permitir</button>
            <button className="bt mini" onClick={() => responderAvulso(p.id, true, true)}>Sempre nesta conversa</button>
            <button className="bt fantasma mini" onClick={() => responderAvulso(p.id, false)}>Negar</button>
          </div>
        </div>
      ))}
    </div>
  );
};

/** Montado uma vez no App: o diálogo Configurações › IA e os pedidos de permissão soltos. */
export const ConfigIA: React.FC = () => (
  <>
    <DialogoConfigIA />
    <PedidosAvulsos />
  </>
);
