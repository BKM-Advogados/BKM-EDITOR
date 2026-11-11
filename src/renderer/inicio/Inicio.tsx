// Tela inicial: uma porta de entrada. No alto, o pedido ao Claude (com o tipo, o formato e o kit em fichas); embaixo,
// "Começar do zero" com os tipos de peça no mesmo peso (Vídeo, Imagem, Animação, Música, 3D e o exemplo), o formato
// pelo nome do destino e os modelos com miniatura. À direita, Continuar (o último projeto, com Abrir), os Recentes em
// lista e uma linha discreta de estado (Claude, pasta, máquina), que só vira faixa quando falta algo. Clicar no formato
// marca; clicar no modelo cria; Enter cria em branco. Nada pergunta fps, codec ou pasta: tudo tem padrão e fica em
// "Mais opções". Esta tela não carrega o editor (Remotion, Player, dockview): a casca vem depois, com React.lazy.
import React, {useEffect, useMemo, useState} from 'react';
import {usarTemExemplo} from '../estado/exemplo';
import {ArrowUp, BookOpen, Box, Check, ChevronDown, ChevronRight, Copy, Film, FolderOpen, FolderSearch, Image as ImageIcon, MoreHorizontal, Music, Settings2, Sparkle, Sparkles,
  Trash2, TriangleAlert, X} from 'lucide-react';
import type {Ambiente, ContaClaude, MarcaInfo, NovoProjeto, Preferencias, Recente} from '../../compartilhado/api';
import type {Modulo} from '../../nucleo/documentos';
import {MODELOS, type IdModelo} from '../../nucleo/modelos';
import {FORMATOS_IMAGEM, FORMATOS_VIDEO, TAMANHO_MAX, TAMANHO_MIN, limitarTamanho, type PresetFormato} from '../../nucleo/formatos';
import {abrirProjeto, avisar, loja, mensagemDe, useLoja} from '../estado/loja';
import {BotaoMenu, type ItemMenu} from '../componentes/Menu';
import {PainelPreferencias} from '../casca/Preferencias';
import {pedirTexto} from '../componentes/Dialogo';
import {IconeEstudio} from '../componentes/Icones';
import {lerConta} from '../paineis/conversas';
import './inicio.css';
import {Escolha} from '../componentes/Controles';

type Tipo = Modulo; // o que a pessoa quer fazer: a música abre um projeto e vai direto à área Música
const TIPOS: {id: Tipo; nome: string; desc: string; icone: React.ReactNode}[] = [
  {id: 'video', nome: 'Vídeo', desc: 'Cenas com título, texto, lista e imagem', icone: <Film size={18} />},
  {id: 'imagem', nome: 'Imagem', desc: 'Post, capa ou carrossel em páginas', icone: <ImageIcon size={18} />},
  {id: 'animacao', nome: 'Animação', desc: 'Formas, texto e arte em pixel', icone: <Sparkles size={18} />},
  {id: 'musica', nome: 'Música', desc: 'Batida ou trilha para o vídeo', icone: <Music size={18} />},
  {id: '3d', nome: '3D', desc: 'Cena com objetos, luz e câmera', icone: <Box size={18} />},
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

/** Miniatura de modelo: a moldura do formato com as linhas do conteúdo (título, texto), sem foto. */
const Poster: React.FC<{l: number; a: number; modulo: Modulo}> = ({l, a, modulo}) => {
  const k = 86 / Math.max(l, a);
  return (
    <span className="poster" aria-hidden="true">
      <span className={`poster-peca ${modulo}`} style={{width: Math.max(24, l * k), height: Math.max(24, a * k)}}>
        {modulo === '3d' ? <Box size={20} /> : modulo === 'musica' ? <Music size={20} /> : <><i className="l1" /><i className="l2" /><i className="l3" /></>}
      </span>
    </span>
  );
};

const menuDoRecente = (r: Recente, abrir: () => void, duplicar: () => void, esquecer: () => void): ItemMenu[] => [
  ...(r.existe ? [
    {rotulo: 'Abrir', icone: <FolderOpen size={14} />, acao: abrir},
    {rotulo: 'Duplicar…', icone: <Copy size={14} />, acao: duplicar},
    {rotulo: 'Mostrar na pasta', icone: <FolderSearch size={14} />, acao: () => window.estudio.mostrarNaPasta(r.raiz)},
    'sep' as const,
  ] : []),
  {rotulo: 'Remover da lista', icone: <Trash2 size={14} />, acao: esquecer},
];

const nomeDosModulos = (r: Recente) => (r.modulos.length ? r.modulos : (['video'] as Modulo[])).map((m) => TIPOS.find((t) => t.id === m)?.nome ?? m).join(' · ');

const CartaoContinuar: React.FC<{r: Recente; aoAbrir: () => void; aoDuplicar: () => void; aoEsquecer: () => void}> = ({r, aoAbrir, aoDuplicar, aoEsquecer}) => (
  <div className={`cartao-continuar${r.existe ? '' : ' sumiu'}`}>
    <button className="cc-mini" onClick={aoAbrir} title={r.existe ? r.raiz : `A pasta não existe mais: ${r.raiz}`} tabIndex={-1}>
      {r.miniatura ? <img src={r.miniatura} alt="" /> : <Poster l={1080} a={1920} modulo={r.modulos[0] ?? 'video'} />}
      {!r.existe && <span className="cr-sumiu"><TriangleAlert size={14} />pasta não encontrada</span>}
    </button>
    <div className="cc-pe">
      <span className="cc-textos">
        <span className="cc-nome">{r.nome}</span>
        <span className="cc-meta">{nomeDosModulos(r)} · editado {quando(r.aberto_em)}</span>
      </span>
      <BotaoMenu titulo="Mais ações" icone={<MoreHorizontal size={15} />} itens={menuDoRecente(r, aoAbrir, aoDuplicar, aoEsquecer)} />
      <button className="bt principal" onClick={aoAbrir} disabled={!r.existe}>Abrir</button>
    </div>
  </div>
);

const LinhaRecente: React.FC<{r: Recente; aoAbrir: () => void; aoDuplicar: () => void; aoEsquecer: () => void}> = ({r, aoAbrir, aoDuplicar, aoEsquecer}) => (
  <li className={`linha-recente${r.existe ? '' : ' sumiu'}`}>
    <button className="lr-abrir" onClick={aoAbrir} title={r.existe ? r.raiz : `A pasta não existe mais: ${r.raiz}`}>
      <span className="lr-icone">{r.miniatura ? <img src={r.miniatura} alt="" /> : ICONE_MODULO[r.modulos[0] ?? 'video']}</span>
      <span className="lr-textos">
        <span className="lr-nome">{r.nome}</span>
        <span className="lr-meta">{nomeDosModulos(r)} · {quando(r.aberto_em)}</span>
      </span>
      {!r.existe && <span className="lr-sumiu">pasta não encontrada</span>}
    </button>
    <BotaoMenu titulo="Mais ações" icone={<MoreHorizontal size={15} />} itens={menuDoRecente(r, aoAbrir, aoDuplicar, aoEsquecer)} />
  </li>
);

export const Inicio: React.FC = () => {
  const aviso = useLoja((e) => e.aviso);
  const [aba, setAba] = useState<Tipo>('video');
  const temExemplo = usarTemExemplo();
  const [prefs, setPrefs] = useState<Preferencias | null>(null);
  const [ambiente, setAmbiente] = useState<Ambiente | null>(null);
  const [conta, setConta] = useState<ContaClaude | null>(null);
  const [recentes, setRecentes] = useState<Recente[] | null>(null);
  const [formato, setFormato] = useState<Record<'video' | 'imagem' | 'animacao', string>>({video: 'reels', imagem: 'feed', animacao: 'youtube'});
  const [livre, setLivre] = useState({largura: 1080, altura: 1080, fps: 30});
  const [larguraInvalida, setLarguraInvalida] = useState(false);
  const [alturaInvalida, setAlturaInvalida] = useState(false);
  const [maisOpcoes, setMaisOpcoes] = useState(false);
  const [preferencias, setPreferencias] = useState(false);
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

  const semFormato = aba === '3d' || aba === 'musica'; // a música não tem formato; ela nasce num projeto de vídeo
  const lista = aba === 'imagem' ? FORMATOS_IMAGEM : FORMATOS_VIDEO;
  const idFormato = semFormato ? '' : formato[aba as 'video' | 'imagem' | 'animacao'];
  const preset = semFormato ? null : lista.find((f) => f.id === idFormato) ?? lista[0];
  const tamanho = idFormato === PERSONALIZADO ? livre : preset ? {largura: preset.largura, altura: preset.altura, fps: livre.fps} : undefined;
  const modelos = MODELOS.filter((m) => m.modulo === (aba === 'musica' ? 'video' : aba));
  const branco = modelos[0]?.id;
  const kit = aba !== '3d' ? marcas.find((m) => m.id === marca) : undefined;
  const nomeDoTipo = TIPOS.find((t) => t.id === aba)!.nome;
  const proporcao = idFormato === PERSONALIZADO ? `${livre.largura}×${livre.altura}` : preset?.proporcao;
  const chip = semFormato ? nomeDoTipo : `${nomeDoTipo} · ${proporcao}`;
  const claudePronto = Boolean(ambiente?.claude && conta?.instalado);

  const criar = async (modelo: IdModelo, pedidoClaude?: {texto: string; rotulo: string; contexto: string}) => {
    if (ocupado) return;
    setOcupado(true);
    try {
      const o: NovoProjeto = {modelo, nome: nome.trim() || undefined, pasta: pasta || undefined,
        ...(aba !== '3d' && tamanho ? {formato: tamanho, formato_id: idFormato, marca: kit?.id} : {}), ...(aba === 'musica' ? {marca: kit?.id} : {})};
      const info = await window.estudio.criarProjeto(o);
      if (pedidoClaude) loja.definir({pedidoClaude});
      await abrirProjeto(info);
      // Música: o projeto nasce com o vídeo em branco e abre na área Música, nos modelos (Batida, Trilha…)
      if (aba === 'musica') loja.definir({area: 'musica'});
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
  const trocarPasta = async () => {
    const p = await window.estudio.escolherPasta('Pasta dos projetos do Estúdio');
    if (p) setPrefs(await window.estudio.gravarPreferencias({pasta_projetos: p}));
  };
  const mandarAoClaude = () => {
    const t = pedido.trim();
    if (!t || !claudePronto || !branco) return;
    const doc = aba === '3d' ? 'uma cena 3D em branco (documento "cena3d")'
      : aba === 'musica' ? `um vídeo em branco (documento "video", ${tamanho?.largura}×${tamanho?.altura}); o pedido é de música: crie a música com criar_documento (módulo música)`
      : `${aba === 'video' ? 'um vídeo de cenas' : aba === 'animacao' ? 'uma animação' : 'uma imagem'} em branco (documento "${aba}", ${tamanho?.largura}×${tamanho?.altura})`;
    void criar(branco, {texto: t, rotulo: `Projeto novo · ${chip}${kit ? ` · ${kit.nome}` : ''}`,
      contexto: `projeto novo, criado agora com ${doc}. Monte o pedido nesse documento pelas ferramentas do MCP "estudio" (o CLAUDE.md da pasta explica o formato). Faça direto, sem perguntar, e diga no fim o que montou.`});
  };

  // Enter cria em branco com o que está marcado (fora de campo de texto e de botão, que já tratam o Enter)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (e.ctrlKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void abrirPasta();
      }
      if (e.key !== 'Enter' || /INPUT|TEXTAREA|SELECT|BUTTON/.test(alvo.tagName) || document.querySelector('.dialogo-fundo') || !branco) return;
      e.preventDefault();
      void criar(branco);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  });

  const pastaPadrao = prefs?.pasta_projetos ?? ambiente?.pasta_padrao ?? '';
  const [continuar, ...outros] = recentes ?? [];
  const estadoClaude = useMemo(() => {
    if (!ambiente || conta === null) return {texto: 'conferindo o Claude…', ok: false};
    if (!ambiente.claude || !conta.instalado) return {texto: 'Claude Code não está instalado neste PC. O resto do Estúdio funciona sem ele.', ok: false};
    if (!conta.logado) return {texto: 'Claude instalado, falta entrar na sua conta (abra um projeto e use "Abrir terminal").', ok: false};
    return {texto: `Claude pronto${conta.email ? ` · ${conta.email}` : ''}`, ok: true};
  }, [ambiente, conta]);
  // a linha de estado só vira faixa quando falta algo (Claude, Git) ou a pasta está no OneDrive
  const falta = Boolean((ambiente && conta !== null && !estadoClaude.ok) || (ambiente && !ambiente.git) || /onedrive/i.test(pastaPadrao));

  return (
    <div className="inicio-janela">
      <header className="inicio-barra">
        <span className="inicio-marca"><IconeEstudio tamanho={18} />Estúdio</span>
        <span className="esp" />
        <button className="bt fantasma" onClick={() => void abrirPasta()}><FolderOpen size={14} />Abrir pasta…<kbd>Ctrl+O</kbd></button>
        <button className="bt fantasma" onClick={() => setPreferencias(true)}><Settings2 size={14} />Preferências</button>
      </header>
      <main className="inicio">
        <div className="inicio-col comecar">
          <div className="inicio-titulo">
            <h1>O que vamos fazer hoje?</h1>
            <p>Descreva a peça para o Claude ou escolha um ponto de partida. Tudo fica salvo na hora.</p>
          </div>

          <section className={`pedido-claude${claudePronto ? '' : ' desligado'}`} aria-label="Pedir ao Claude">
            <textarea rows={2} aria-label="Pedido ao Claude"
              placeholder={claudePronto ? 'Ex.: 5 cenas sobre férias proporcionais, com um número grande na terceira e a frase de fecho no final…'
                : 'Instale e entre no Claude Code para usar este campo; o resto do Estúdio funciona sem ele'}
              disabled={!claudePronto || ocupado} value={pedido} onChange={(e) => setPedido(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  mandarAoClaude();
                }
              }} />
            <div className="pc-rodape">
              <span className="ficha" title="O tipo e o formato escolhidos embaixo">{TIPOS.find((t) => t.id === aba)!.icone}{chip}</span>
              {aba !== '3d' && (
                <span className="ficha-kit">
                  <Escolha className="ficha" valor={marca} rotulo="Kit de marca do projeto novo" aoMudar={setMarca}
                    opcoes={[['', 'Kit: Neutro'] as [string, string], ...marcas.filter((m) => m.id !== 'neutro').map((m): [string, string] => [m.id, `Kit: ${m.nome}`])]} />
                </span>
              )}
              <span className={`pc-estado${estadoClaude.ok ? ' ok' : ''}`}>{estadoClaude.ok ? 'Claude pronto · sua conta' : estadoClaude.texto}</span>
              <button className="enviar" disabled={!claudePronto || !pedido.trim() || ocupado} onClick={mandarAoClaude} title="Criar o projeto e mandar ao Claude (Enter)"
                aria-label="Criar o projeto e mandar ao Claude"><ArrowUp size={16} /></button>
            </div>
          </section>

          <div className="linha-secao"><span className="rotulo-secao">Começar do zero</span></div>
          <div className="grade-tipos" role="radiogroup" aria-label="Tipo de peça">
            {TIPOS.map((t) => (
              <button key={t.id} role="radio" aria-checked={aba === t.id} className={`cartao-tipo${aba === t.id ? ' marcado' : ''}`} onClick={() => setAba(t.id)}
                onDoubleClick={() => branco && void criar(branco)}>
                <span className="ct-icone">{t.icone}</span>
                <span className="ct-nome">{t.nome}</span>
                <span className="ct-desc">{t.desc}</span>
              </button>
            ))}
            {temExemplo && (
              <button className="cartao-tipo exemplo" onClick={() => void verExemplo()}>
                <span className="ct-icone"><BookOpen size={18} /></span>
                <span className="ct-nome">Ver um exemplo</span>
                <span className="ct-desc">Abre uma cópia para explorar</span>
              </button>
            )}
          </div>

          {!semFormato && (
            <>
              <div className="linha-secao"><span className="rotulo-secao">Formato</span><span className="nota">o mesmo documento serve a outros formatos depois</span></div>
              <div className="grade-formatos">
                {lista.map((f) => (
                  <CartaoFormato key={f.id} f={f} marcado={idFormato === f.id} aoMarcar={() => setFormato((x) => ({...x, [aba]: f.id}))}
                    aoCriar={() => branco && void criar(branco)} />
                ))}
                <CartaoFormato f={null} marcado={idFormato === PERSONALIZADO} aoMarcar={() => {
                  setFormato((x) => ({...x, [aba]: PERSONALIZADO}));
                  setMaisOpcoes(true);
                }} aoCriar={() => branco && void criar(branco)} />
              </div>
            </>
          )}

          <div className="linha-secao"><span className="rotulo-secao">{aba === 'musica' ? 'Começar' : 'Modelos'}</span>
            <span className="nota">{aba === 'musica' ? 'o projeto abre na Música, com os modelos de batida e trilha' : 'clique para criar · Enter cria em branco'}</span></div>
          <div className="grade-modelos">
            {modelos.map((m) => {
              const f = m.formato_fixo ? FORMATOS_VIDEO.find((x) => x.id === m.formato_fixo) : undefined;
              const l = f?.largura ?? tamanho?.largura ?? 1920;
              const a = f?.altura ?? tamanho?.altura ?? 1080;
              return (
                <button key={m.id} className="cartao-modelo" disabled={ocupado} onClick={() => void criar(m.id)} title={m.descricao}>
                  <Poster l={aba === 'musica' ? 1 : l} a={aba === 'musica' ? 1 : a} modulo={aba === 'musica' ? 'musica' : m.modulo} />
                  <span className="cm-texto">
                    <span className="cm-nome">{aba === 'musica' ? 'Música nova' : m.nome}</span>
                    <span className="cm-desc">{aba === 'musica' ? 'Batida, trilha ou efeito sonoro' : f ? `${f.proporcao} · ${m.descricao}` : m.descricao}</span>
                  </span>
                </button>
              );
            })}
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
              {!semFormato && idFormato === PERSONALIZADO && (
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
                  <Escolha valor={livre.fps} rotulo="Quadros por segundo" aoMudar={(fps) => setLivre((x) => ({...x, fps}))}
                    opcoes={[24, 25, 30, 50, 60].map((n): [number, string] => [n, String(n)])} />
                </label>
              )}
            </div>
          )}
        </div>

        <div className="inicio-col continuar">
          {recentes === null ? <div className="vazio">carregando os recentes…</div> : !continuar ? (
            <section className="sem-recentes">
              <div className="sr-titulo">Nenhum projeto ainda</div>
              <div className="sr-texto">{temExemplo ? 'Descreva a peça para o Claude, escolha um tipo ao lado, ou veja um exemplo para entender como o Estúdio funciona.'
                : 'Descreva a peça para o Claude ou escolha um tipo ao lado.'}</div>
            </section>
          ) : (
            <>
              <div className="linha-secao"><span className="rotulo-secao">Continuar</span></div>
              <CartaoContinuar r={continuar} aoAbrir={() => void abrir(continuar)} aoDuplicar={() => void duplicar(continuar)} aoEsquecer={() => void esquecer(continuar)} />
              {outros.length > 0 && (
                <>
                  <div className="linha-secao"><span className="rotulo-secao">Recentes</span></div>
                  <ul className="lista-recentes">
                    {outros.map((r) => <LinhaRecente key={r.raiz} r={r} aoAbrir={() => void abrir(r)} aoDuplicar={() => void duplicar(r)} aoEsquecer={() => void esquecer(r)} />)}
                  </ul>
                </>
              )}
            </>
          )}
          <section className={`estado-inicio${falta ? ' falta' : ''}`} aria-label="Estado">
            <div className={estadoClaude.ok ? 'ok' : ambiente && conta !== null ? 'alerta' : ''}>{estadoClaude.ok ? <Check size={14} /> : <Sparkle size={14} />}<span>{estadoClaude.texto}</span></div>
            <div className={/onedrive/i.test(pastaPadrao) ? 'alerta' : ''}><FolderOpen size={14} /><span>Projetos em <code title={pastaPadrao}>{pastaPadrao}</code></span>
              <button className="bt fantasma mini" onClick={() => void trocarPasta()}>Trocar…</button></div>
            {ambiente && <div className="ok"><Check size={14} /><span>Esta máquina: perfil {ambiente.perfil.nome === 'leve' ? 'leve (até 8 GB)' : ambiente.perfil.nome === 'padrao' ? 'padrão (até 16 GB)' : 'forte'}</span></div>}
            {ambiente && !ambiente.git && <div className="alerta"><TriangleAlert size={14} /><span>Sem o Git instalado, não há pontos de restauração (Ctrl+S). O resto funciona.</span></div>}
          </section>
        </div>
      </main>
      {aviso && (
        <div className={`inicio-aviso ${aviso.tipo}`} role="status" aria-live="polite">
          {aviso.tipo === 'erro' && <TriangleAlert size={14} />}<span>{aviso.texto}</span>
          <button className="bti" onClick={() => loja.definir({aviso: undefined})} title="Fechar" aria-label="Fechar"><X size={14} /></button>
        </div>
      )}
      {preferencias && <PainelPreferencias aoFechar={() => setPreferencias(false)} />}
    </div>
  );
};
