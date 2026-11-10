// Tela inicial: a central que os editores abrem (Resolve, Premiere, CapCut, Clipchamp). À esquerda, começar: o bloco
// Novo (formato pelo nome do destino, depois o modelo) e o campo "Descreva para o Claude", com o mesmo peso. À
// direita, continuar: o último projeto com miniatura e a grade de recentes. Clicar no formato marca; clicar no modelo
// cria; Enter cria com o que está marcado. Nada pergunta fps, codec ou pasta: tudo tem padrão e fica em "Mais opções".
// Esta tela não carrega o editor (Remotion, Player, dockview): a casca vem depois, com React.lazy.
import React, {useEffect, useMemo, useState} from 'react';
import {ArrowUp, BookOpen, Box, Check, ChevronDown, ChevronRight, Copy, Film, FolderOpen, FolderSearch, Image as ImageIcon, MoreHorizontal, Music, Sparkle, Sparkles, Trash2,
  TriangleAlert, X} from 'lucide-react';
import type {Ambiente, ContaClaude, MarcaInfo, NovoProjeto, Preferencias, Recente} from '../../compartilhado/api';
import type {Modulo} from '../../nucleo/documentos';
import {MODELOS, type IdModelo} from '../../nucleo/modelos';
import {FORMATOS_IMAGEM, FORMATOS_VIDEO, TAMANHO_MAX, TAMANHO_MIN, limitarTamanho, type PresetFormato} from '../../nucleo/formatos';
import {abrirProjeto, avisar, loja, mensagemDe, useLoja} from '../estado/loja';
import {BotaoMenu} from '../componentes/Menu';
import {pedirTexto} from '../componentes/Dialogo';
import {IconeEstudio} from '../componentes/Icones';
import {lerConta} from '../paineis/conversas';
import './inicio.css';

const ABAS: {id: Modulo; nome: string; icone: React.ReactNode}[] = [
  {id: 'video', nome: 'Vídeo', icone: <Film size={15} />},
  {id: 'imagem', nome: 'Imagem', icone: <ImageIcon size={15} />},
  {id: 'animacao', nome: 'Animação', icone: <Sparkles size={15} />},
  {id: '3d', nome: '3D', icone: <Box size={15} />},
];
const ICONE_MODULO: Record<Modulo, React.ReactNode> = {
  video: <Film size={18} />,
  imagem: <ImageIcon size={18} />,
  animacao: <Sparkles size={18} />,
  '3d': <Box size={18} />,
  musica: <Music size={18} />, // frente Música
};
const PERSONALIZADO = 'personalizado';

/** Largura e altura do tamanho livre (transversal-D17): digitar 9000 não vira 1080×1920 em silêncio. O campo guarda o texto
 *  como a pessoa digita; só um valor de 16 a 7680 sobe para o formulário, fora disso o campo fica vermelho com o limite e,
 *  ao sair dele (ou Enter), o número volta ao limite mais perto. */
const CampoTamanho: React.FC<{rotulo: string; valor: number; aoMudar: (n: number) => void; aoInvalidar: (invalido: boolean) => void}> = ({rotulo, valor, aoMudar, aoInvalidar}) => {
  const [texto, setTexto] = useState(String(valor));
  useEffect(() => setTexto(String(valor)), [valor]);
  const n = Number(texto);
  const fora = texto.trim() !== '' && (!Number.isFinite(n) || n < TAMANHO_MIN || n > TAMANHO_MAX);
  useEffect(() => aoInvalidar(fora), [fora]); // eslint-disable-line react-hooks/exhaustive-deps
  const confirmar = () => {
    const v = limitarTamanho(texto.trim() === '' ? valor : n, valor);
    setTexto(String(v));
    aoMudar(v);
  };
  return (
    <input className={`campo${fora ? ' invalido' : ''}`} type="number" aria-label={rotulo} aria-invalid={fora} min={TAMANHO_MIN} max={TAMANHO_MAX} value={texto}
      onChange={(e) => {
        setTexto(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(v) && v >= TAMANHO_MIN && v <= TAMANHO_MAX) aoMudar(Math.round(v));
      }}
      onBlur={confirmar}
      onKeyDown={(e) => e.key === 'Enter' && confirmar()} />
  );
};

const quando = (iso: string) => {
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 60 * 24) return `há ${Math.round(min / 60)} h`;
  if (min < 60 * 48) return 'ontem';
  return d.toLocaleDateString('pt-BR', {day: '2-digit', month: 'short'});
};

/** Moldura do formato desenhada na proporção certa, com a área segura. */
const Moldura: React.FC<{l: number; a: number; ativo?: boolean}> = ({l, a, ativo}) => {
  const k = 34 / Math.max(l, a);
  return (
    <span className={`moldura${ativo ? ' ativo' : ''}`} aria-hidden="true">
      <span style={{width: Math.max(10, l * k), height: Math.max(10, a * k)}} />
    </span>
  );
};

const CartaoFormato: React.FC<{f: PresetFormato | null; marcado: boolean; aoMarcar: () => void; aoCriar: () => void}> = ({f, marcado, aoMarcar, aoCriar}) => (
  <button className={`cartao-formato${marcado ? ' marcado' : ''}`} onClick={aoMarcar} onDoubleClick={aoCriar} aria-pressed={marcado}
    title={f ? `${f.nome} · ${f.proporcao} · ${f.largura}×${f.altura}. Duplo clique cria em branco.` : 'Tamanho livre: escolha em Mais opções'}>
    {f ? <Moldura l={f.largura} a={f.altura} ativo={marcado} /> : <span className="moldura livre" aria-hidden="true"><span /></span>}
    <span className="cf-texto">
      <span className="cf-nome">{f ? f.nome : 'Personalizado'}</span>
      <span className="cf-meta">{f ? `${f.proporcao} · ${f.largura}×${f.altura}` : 'largura e altura livres'}</span>
      {f && <span className="cf-destino">{f.destino}</span>}
    </span>
    {marcado && <Check size={14} className="cf-check" />}
  </button>
);

const CartaoRecente: React.FC<{r: Recente; grande?: boolean; aoAbrir: () => void; aoDuplicar: () => void; aoEsquecer: () => void}> = ({r, grande, aoAbrir, aoDuplicar, aoEsquecer}) => (
  <div className={`cartao-recente${grande ? ' grande' : ''}${r.existe ? '' : ' sumiu'}`}>
    <button className="cr-abrir" onClick={aoAbrir} title={r.existe ? r.raiz : `A pasta não existe mais: ${r.raiz}`}>
      <span className="cr-mini">
        {r.miniatura ? <img src={r.miniatura} alt="" /> : <span className="cr-icones">{(r.modulos.length ? r.modulos : (['video'] as Modulo[])).map((m) => <span key={m}>{ICONE_MODULO[m]}</span>)}</span>}
        {!r.existe && <span className="cr-sumiu"><TriangleAlert size={14} />pasta não encontrada</span>}
      </span>
      <span className="cr-texto">
        {grande && <span className="cr-rotulo">Continuar</span>}
        <span className="cr-nome">{r.nome}</span>
        <span className="cr-meta">{quando(r.aberto_em)}</span>
      </span>
    </button>
    <div className="cr-menu">
      <BotaoMenu titulo="Mais ações" icone={<MoreHorizontal size={15} />} itens={[
        ...(r.existe ? [
          {rotulo: 'Abrir', icone: <FolderOpen size={14} />, acao: aoAbrir},
          {rotulo: 'Duplicar…', icone: <Copy size={14} />, acao: aoDuplicar},
          {rotulo: 'Mostrar na pasta', icone: <FolderSearch size={14} />, acao: () => window.estudio.mostrarNaPasta(r.raiz)},
          'sep' as const,
        ] : []),
        {rotulo: 'Remover da lista', icone: <Trash2 size={14} />, acao: aoEsquecer},
      ]} />
    </div>
  </div>
);

export const Inicio: React.FC = () => {
  const aviso = useLoja((e) => e.aviso);
  const [aba, setAba] = useState<Modulo>('video');
  const [prefs, setPrefs] = useState<Preferencias | null>(null);
  const [ambiente, setAmbiente] = useState<Ambiente | null>(null);
  const [conta, setConta] = useState<ContaClaude | null>(null);
  const [recentes, setRecentes] = useState<Recente[] | null>(null);
  const [formato, setFormato] = useState<Record<'video' | 'imagem' | 'animacao', string>>({video: 'reels', imagem: 'feed', animacao: 'youtube'});
  const [livre, setLivre] = useState({largura: 1080, altura: 1080, fps: 30});
  const [larguraInvalida, setLarguraInvalida] = useState(false);
  const [alturaInvalida, setAlturaInvalida] = useState(false);
  const [maisOpcoes, setMaisOpcoes] = useState(false);
  const [nome, setNome] = useState('');
  const [pasta, setPasta] = useState('');
  const [pedido, setPedido] = useState('');
  const [ocupado, setOcupado] = useState(false);
  // kit de marca do projeto novo ('' = tema neutro, como sempre)
  const [marcas, setMarcas] = useState<MarcaInfo[]>([]);
  const [marca, setMarca] = useState('');

  const carregarRecentes = () => void window.estudio.recentes().then(setRecentes).catch(() => setRecentes([]));
  useEffect(() => {
    void window.estudio.preferencias().then((p) => {
      setPrefs(p);
      setFormato({video: p.formato_video, imagem: p.formato_imagem, animacao: 'youtube'});
    });
    void window.estudio.ambiente().then(setAmbiente);
    void lerConta().then(setConta).catch(() => setConta(null));
    void window.estudio.marcas.listar().then(setMarcas).catch(() => setMarcas([]));
    carregarRecentes();
  }, []);

  const lista = aba === 'imagem' ? FORMATOS_IMAGEM : FORMATOS_VIDEO;
  const idFormato = aba === '3d' || aba === 'musica' ? '' : formato[aba]; // frente Música: a música não tem formato
  const preset = aba === '3d' || aba === 'musica' ? null : lista.find((f) => f.id === idFormato) ?? lista[0];
  const tamanho = idFormato === PERSONALIZADO ? livre : preset ? {largura: preset.largura, altura: preset.altura, fps: livre.fps} : undefined;
  const modelos = MODELOS.filter((m) => m.modulo === aba);
  const branco = modelos.find((m) => !m.exemplo)!.id;
  const kit = aba !== '3d' ? marcas.find((m) => m.id === marca) : undefined;
  const chip = aba === '3d' ? 'Cena 3D · Em branco' : `${idFormato === PERSONALIZADO ? `${livre.largura}×${livre.altura}` : preset?.proporcao}${kit ? ` · ${kit.nome}` : ''} · Em branco`;
  const claudePronto = Boolean(ambiente?.claude && conta?.instalado);

  const criar = async (modelo: IdModelo, pedidoClaude?: {texto: string; rotulo: string; contexto: string}) => {
    if (ocupado) return;
    setOcupado(true);
    try {
      const o: NovoProjeto = {modelo, nome: nome.trim() || undefined, pasta: pasta || undefined,
        ...(aba !== '3d' && tamanho && !MODELOS.find((m) => m.id === modelo)?.exemplo ? {formato: tamanho, formato_id: idFormato, marca: kit?.id} : {})};
      const info = await window.estudio.criarProjeto(o);
      if (pedidoClaude) loja.definir({pedidoClaude});
      await abrirProjeto(info);
    } catch (e) {
      avisar(mensagemDe(e), 'erro');
    } finally {
      setOcupado(false);
    }
  };

  const abrir = async (r: Recente) => {
    if (!r.existe) return avisar(`A pasta deste projeto não existe mais: ${r.raiz}. Use "Remover da lista".`, 'erro');
    try {
      await abrirProjeto(await window.estudio.abrirProjeto(r.raiz));
    } catch (e) {
      avisar(mensagemDe(e), 'erro');
    }
  };
  const duplicar = async (r: Recente) => {
    const n = await pedirTexto({titulo: 'Duplicar projeto', rotulo: 'Nome da cópia', valor: `${r.nome} (cópia)`, botao: 'Duplicar e abrir'});
    if (!n) return;
    try {
      await abrirProjeto(await window.estudio.duplicarProjeto({raiz: r.raiz, nome: n}));
    } catch (e) {
      avisar(mensagemDe(e), 'erro');
    }
  };
  const esquecer = async (r: Recente) => {
    await window.estudio.esquecerRecente(r.raiz);
    carregarRecentes();
  };
  const abrirPasta = async () => {
    try {
      const i = await window.estudio.abrirPasta();
      if (i) await abrirProjeto(i);
    } catch (e) {
      avisar(mensagemDe(e), 'erro');
    }
  };
  const verExemplo = async () => {
    try {
      await abrirProjeto(await window.estudio.abrirExemplo());
    } catch (e) {
      avisar(mensagemDe(e), 'erro');
    }
  };
  const mandarAoClaude = () => {
    const t = pedido.trim();
    if (!t || !claudePronto) return;
    const doc = aba === '3d' ? 'uma cena 3D em branco (documento "cena3d")'
      : `${aba === 'video' ? 'um vídeo de cenas' : 'uma imagem'} em branco (documento "${aba}", ${tamanho?.largura}×${tamanho?.altura})`;
    void criar(branco, {texto: t, rotulo: `Projeto novo · ${chip.replace(' · Em branco', '')}`,
      contexto: `projeto novo, criado agora com ${doc}. Monte o pedido nesse documento pelas ferramentas do MCP "estudio" (o CLAUDE.md da pasta explica o formato). Faça direto, sem perguntar, e diga no fim o que montou.`});
  };

  // Enter cria com o que está marcado (fora de campo de texto e de botão, que já tratam o Enter)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (e.ctrlKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void abrirPasta();
      }
      if (e.key !== 'Enter' || /INPUT|TEXTAREA|SELECT|BUTTON/.test(alvo.tagName) || document.querySelector('.dialogo-fundo')) return;
      e.preventDefault();
      void criar(branco);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  });

  const primeiraVez = prefs && !prefs.boas_vindas_vista;
  const pastaPadrao = prefs?.pasta_projetos ?? ambiente?.pasta_padrao ?? '';
  const [continuar, ...outros] = recentes ?? [];
  const estadoClaude = useMemo(() => {
    if (!ambiente || conta === null) return {texto: 'conferindo o Claude…', ok: false};
    if (!ambiente.claude || !conta.instalado) return {texto: 'Claude Code não está instalado neste PC. O resto do Estúdio funciona sem ele.', ok: false};
    if (!conta.logado) return {texto: 'Claude instalado, falta entrar na sua conta (abra um projeto e use "Abrir terminal").', ok: false};
    return {texto: `Claude pronto${conta.email ? ` · ${conta.email}` : ''}`, ok: true};
  }, [ambiente, conta]);

  return (
    <div className="inicio-janela">
      <header className="inicio-barra">
        <span className="inicio-marca"><IconeEstudio tamanho={18} />Estúdio</span>
      </header>
      <main className="inicio">
        <div className="inicio-col comecar">
          {primeiraVez && (
            <section className="faixa-primeira" aria-label="Antes de começar">
              <div className="fp-titulo">Antes de começar</div>
              <ul>
                <li className={estadoClaude.ok ? 'ok' : ''}><Sparkle size={14} />{estadoClaude.texto}</li>
                <li className="ok"><FolderOpen size={14} />Projetos novos ficam em <code title={pastaPadrao}>{pastaPadrao}</code>
                  <button className="bt fantasma mini" onClick={async () => {
                    const p = await window.estudio.escolherPasta('Pasta dos projetos do Estúdio');
                    if (p) setPrefs(await window.estudio.gravarPreferencias({pasta_projetos: p}));
                  }}>Trocar…</button></li>
                {ambiente && <li className="ok"><Check size={14} />Perfil desta máquina: {ambiente.perfil.nome === 'leve' ? 'leve (até 8 GB)' : ambiente.perfil.nome === 'padrao' ? 'padrão (até 16 GB)' : 'forte'}</li>}
                {ambiente && !ambiente.git && <li className="alerta"><TriangleAlert size={14} />Sem o Git instalado, não há pontos de restauração (Ctrl+S). O resto funciona.</li>}
              </ul>
              <div className="fp-botoes">
                <button className="bt principal" onClick={async () => setPrefs(await window.estudio.gravarPreferencias({boas_vindas_vista: true}))}>Pronto</button>
                <button className="bt fantasma" onClick={() => void verExemplo()}><BookOpen size={14} />Ver um pronto</button>
              </div>
            </section>
          )}

          <section className="bloco-novo" aria-label="Novo projeto">
            <div className="bloco-cab">
              <h2>Novo</h2>
              <div className="abas-novo" role="tablist">
                {ABAS.map((a) => (
                  <button key={a.id} role="tab" aria-selected={aba === a.id} className={aba === a.id ? 'ativa' : ''} onClick={() => setAba(a.id)}>{a.icone}{a.nome}</button>
                ))}
              </div>
            </div>

            {aba !== '3d' && (
              <>
                <div className="rotulo-secao">Formato</div>
                <div className="grade-formatos">
                  {lista.map((f) => (
                    <CartaoFormato key={f.id} f={f} marcado={idFormato === f.id} aoMarcar={() => setFormato((x) => ({...x, [aba]: f.id}))}
                      aoCriar={() => void criar(branco)} />
                  ))}
                  <CartaoFormato f={null} marcado={idFormato === PERSONALIZADO} aoMarcar={() => {
                    setFormato((x) => ({...x, [aba]: PERSONALIZADO}));
                    setMaisOpcoes(true);
                  }} aoCriar={() => void criar(branco)} />
                </div>
              </>
            )}

            <div className="rotulo-secao">Modelo</div>
            <div className="grade-modelos">
              {modelos.map((m) => (
                <button key={m.id} className={`cartao-modelo${m.exemplo ? '' : ' principal'}`} disabled={ocupado} onClick={() => void criar(m.id)}>
                  <span className="cm-poster">{m.exemplo ? <span className="cm-cliente">Cliente</span> : ICONE_MODULO[m.modulo]}</span>
                  <span className="cm-texto">
                    <span className="cm-nome">{m.nome}{!m.exemplo && !m.formato_fixo && aba !== '3d' && <span className="cm-chip">{chip.replace(' · Em branco', '')}</span>}
                      {m.formato_fixo && <span className="cm-chip">{FORMATOS_VIDEO.find((f) => f.id === m.formato_fixo)?.proporcao ?? m.formato_fixo}</span>}</span>
                    <span className="cm-desc">{m.descricao}</span>
                  </span>
                  {!m.exemplo && <kbd>Enter</kbd>}
                </button>
              ))}
            </div>

            <button className="mais-opcoes" onClick={() => setMaisOpcoes((x) => !x)} aria-expanded={maisOpcoes}>
              {maisOpcoes ? <ChevronDown size={14} /> : <ChevronRight size={14} />}Mais opções
            </button>
            {maisOpcoes && (
              <div className="painel-opcoes">
                <label><span>Nome</span><input className="campo" placeholder="Sem título · data e hora" value={nome} onChange={(e) => setNome(e.target.value)} /></label>
                <label><span>Pasta</span>
                  <span className="linha-pasta">
                    <input className="campo" readOnly value={pasta || pastaPadrao} title={pasta || pastaPadrao} />
                    <button className="bt" onClick={async () => setPasta((await window.estudio.escolherPasta('Onde criar o projeto')) ?? pasta)}>Escolher…</button>
                  </span>
                </label>
                {/onedrive/i.test(pasta || pastaPadrao) && <div className="alerta-opcoes"><TriangleAlert size={13} />Pasta dentro do OneDrive: a sincronização pode travar a gravação.</div>}
                {aba !== '3d' && (
                  <label><span>Marca</span>
                    <select className="campo" value={marca} onChange={(e) => setMarca(e.target.value)} title="Cores, fonte e logo do kit entram no tema do documento novo">
                      <option value="">Sem kit (tema neutro)</option>
                      {marcas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
                    </select>
                  </label>
                )}
                {aba !== '3d' && idFormato === PERSONALIZADO && (
                  <label><span>Tamanho</span>
                    <span className="linha-pasta">
                      <CampoTamanho rotulo="Largura" valor={livre.largura} aoMudar={(n) => setLivre((x) => ({...x, largura: n}))} aoInvalidar={setLarguraInvalida} />
                      <span className="vezes">×</span>
                      <CampoTamanho rotulo="Altura" valor={livre.altura} aoMudar={(n) => setLivre((x) => ({...x, altura: n}))} aoInvalidar={setAlturaInvalida} />
                    </span>
                    {(larguraInvalida || alturaInvalida) && <span className="erro-campo">Largura e altura vão de {TAMANHO_MIN} a {TAMANHO_MAX} px.</span>}
                  </label>
                )}
                {aba === 'video' && (
                  <label><span>Quadros por segundo</span>
                    <select className="campo" value={livre.fps} onChange={(e) => setLivre((x) => ({...x, fps: Number(e.target.value)}))}>
                      {[24, 25, 30, 50, 60].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                )}
              </div>
            )}
          </section>

          <section className={`bloco-claude${claudePronto ? '' : ' desligado'}`} aria-label="Começar com o Claude">
            <div className="bloco-cab"><h2><Sparkle size={16} className="ic-agente" />Começar conversando</h2></div>
            <div className="caixa-claude">
              <textarea rows={2} placeholder={claudePronto ? 'Descreva o vídeo para o Claude… ex.: 5 cenas sobre férias proporcionais, com um número grande na 3ª' : 'Instale e entre no Claude Code para usar este campo'}
                disabled={!claudePronto || ocupado} value={pedido} onChange={(e) => setPedido(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    mandarAoClaude();
                  }
                }} />
              <div className="cc-rodape">
                <span className="cm-chip">{chip}</span>
                <span className={`cc-estado${estadoClaude.ok ? ' ok' : ''}`}>{estadoClaude.texto}</span>
                <button className="bti enviar" disabled={!claudePronto || !pedido.trim() || ocupado} onClick={mandarAoClaude} title="Criar o projeto e mandar ao Claude (Enter)"><ArrowUp size={16} /></button>
              </div>
            </div>
          </section>
        </div>

        <div className="inicio-col continuar">
          {recentes === null ? <div className="vazio">carregando os recentes…</div> : !continuar ? (
            <section className="sem-recentes">
              <div className="sr-titulo">Nenhum projeto ainda</div>
              <div className="sr-texto">Escolha um formato e um modelo ao lado, ou veja um vídeo pronto para entender como o Estúdio funciona.</div>
              <button className="bt" onClick={() => void verExemplo()}><BookOpen size={14} />Ver um pronto (carrossel narrado)</button>
            </section>
          ) : (
            <>
              <CartaoRecente r={continuar} grande aoAbrir={() => void abrir(continuar)} aoDuplicar={() => void duplicar(continuar)} aoEsquecer={() => void esquecer(continuar)} />
              {outros.length > 0 && (
                <>
                  <div className="rotulo-secao">Recentes</div>
                  <div className="grade-recentes">
                    {outros.map((r) => <CartaoRecente key={r.raiz} r={r} aoAbrir={() => void abrir(r)} aoDuplicar={() => void duplicar(r)} aoEsquecer={() => void esquecer(r)} />)}
                  </div>
                </>
              )}
            </>
          )}
          <div className="inicio-acoes">
            <button className="bt fantasma" onClick={() => void abrirPasta()}><FolderOpen size={14} />Abrir pasta…<kbd>Ctrl+O</kbd></button>
            <button className="bt fantasma" onClick={() => void verExemplo()}><BookOpen size={14} />Ver um pronto</button>
          </div>
        </div>
      </main>
      {aviso && (
        <div className={`inicio-aviso ${aviso.tipo}`} role="status">
          {aviso.tipo === 'erro' && <TriangleAlert size={14} />}<span>{aviso.texto}</span>
          <button className="bti" onClick={() => loja.definir({aviso: undefined})} title="Fechar"><X size={14} /></button>
        </div>
      )}
    </div>
  );
};
