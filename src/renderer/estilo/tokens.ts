// Tokens do Estúdio num arquivo só (docs/tela.md §7; ux/pesquisa-ux-visual.md §4): o CSS de :root, do tema claro, do
// alto contraste e da densidade compacta, o tema do dockview e o ITheme do xterm saem daqui. Nenhum outro arquivo de
// estilo do renderer escreve cor em hexadecimal (testes/css-renderer.test.ts confere).
//
// "Grafite neutro, um acento, a IA em violeta": superfícies em cinza de croma zero com degraus visíveis (as barras ficam
// um degrau abaixo do corpo do painel, como no VS Code), e cada cor tem um sentido só: azul = seleção, foco e botão
// principal; violeta = agente; âmbar = comentário; vermelho = cabeça de reprodução. A pessoa não tem cor e nenhuma cor de
// marca entra na interface (marca é conteúdo). O tema claro usa os mesmos nomes; o alto contraste só reatribui.

type Tokens = Record<`--${string}`, string>;

/** Escuro (padrão). Contrastes medidos sobre o corpo (--fundo-2): --texto 13,9:1, --texto-2 7,9:1, --texto-3 5,9:1. */
export const ESCURO: Tokens = {
  // superfícies
  '--fundo-0': '#111111', // vão entre painéis, barra de título
  '--fundo-1': '#191919', // barras: abas, rodapé, transporte, régua, trilho, cabeçalho de faixa
  '--fundo-2': '#202020', // corpo do painel, aba ativa
  '--fundo-3': '#292929', // campo, hover
  '--fundo-4': '#323232', // ativo, pressionado
  '--fundo-elevado': '#262626', // menus, popovers, diálogos (com sombra)
  '--entorno-monitor': '#1b1b1b', // em volta da peça no monitor (ISO 12646 pede cinza)
  '--xadrez': 'repeating-conic-gradient(#2a2a2a 0 25%, #333333 0 50%) 0 0 / 16px 16px',
  '--sombra-peca': '0 0 0 1px rgba(255, 255, 255, 0.06), 0 6px 24px rgba(0, 0, 0, 0.55)',
  '--vidro': 'rgba(17, 17, 17, 0.72)', // fundo translúcido sobre o monitor (trilho do 3D, rótulos)
  '--veu': 'rgba(0, 0, 0, 0.55)', // atrás dos diálogos

  // bordas e texto
  '--borda': '#2e2e2e', // divisória decorativa
  '--borda-campo': '#3a3a3a', // contorno de campo em repouso
  '--borda-forte': '#484848', // contorno de botão e controle
  '--texto': '#ededed',
  '--texto-2': '#b4b4b4',
  '--texto-3': '#9b9b9b',
  '--icone-inativo': '#6e6e6e', // só ícone e item desabilitado, nunca texto
  '--alca': '#ffffff', // alça de redimensionar sobre a peça
  '--guia': '#ff3d9a', // guias de encaixe e distâncias no arrasto (não é nenhum sinal da interface)

  // acento = seleção, foco e botão principal (não é "a cor da pessoa")
  '--acento': '#70b8ff',
  '--acento-forte': '#94caff', // hover do botão principal
  '--acento-fundo': '#0d2847', // item selecionado (opaco): texto 12,7:1
  '--acento-fraco': 'rgba(112, 184, 255, 0.12)',
  '--acento-selecao': 'rgba(112, 184, 255, 0.28)',
  '--acento-tracejado': 'rgba(112, 184, 255, 0.7)',
  '--sobre-acento': '#111111', // texto sobre o acento: 9:1

  // sentidos fixos
  '--agente': '#baa7ff',
  '--agente-fundo': '#291f43',
  '--agente-borda': 'rgba(186, 167, 255, 0.45)',
  '--sobre-agente': '#1b1430',
  '--comentario': '#ffca16',
  '--pino': '#ffca16', // pino e contador de comentário (preenchidos)
  '--sobre-pino': '#111111',
  '--cabeca': '#ff4d4d',
  '--ok': '#3dd68c',
  '--ok-fundo': '#132d21',
  '--aviso': '#ffa057',
  '--aviso-fundo': '#331e0b',
  '--erro': '#ff9592',
  '--erro-fundo': '#3b1219',

  // cores de faixa: só dentro de linhas do tempo, arranjo e listas de canal; não coincidem com os sinais
  '--faixa-azul': '#70b8ff',
  '--faixa-ciano': '#4ccce6',
  '--faixa-verde': '#3dd68c',
  '--faixa-lima': '#a8d672',
  '--faixa-rosa': '#e796f3',
  '--faixa-areia': '#d6b98a',

  // terminal: as 16 cores do xterm (o Claude Code usa no tema dark-ansi)
  '--term-preto': '#191919', '--term-vermelho': '#ff9592', '--term-verde': '#3dd68c', '--term-amarelo': '#ffca16',
  '--term-azul': '#70b8ff', '--term-magenta': '#baa7ff', '--term-ciano': '#7ce2fe', '--term-branco': '#b4b4b4',
  '--term-preto-claro': '#8a8a8a', '--term-vermelho-claro': '#ffb4b1', '--term-verde-claro': '#74e3ac', '--term-amarelo-claro': '#ffdc5c',
  '--term-azul-claro': '#9ccdff', '--term-magenta-claro': '#d2c6ff', '--term-ciano-claro': '#a6ecff', '--term-branco-claro': '#ededed',

  // elevação: dentro da doca a separação é por tom; sombra só no que flutua
  '--sombra-1': '0 1px 2px rgba(0, 0, 0, 0.4)',
  '--sombra-2': '0 0 0 1px rgba(255, 255, 255, 0.06), 0 8px 24px rgba(0, 0, 0, 0.45)',
  '--sombra-3': '0 0 0 1px rgba(255, 255, 255, 0.08), 0 24px 64px rgba(0, 0, 0, 0.6)',
};

/** Claro: os mesmos nomes. Contrastes sobre #ffffff: --texto 17:1, --texto-2 7,5:1, --texto-3 5,9:1, --acento 5,8:1. */
export const CLARO: Tokens = {
  '--fundo-0': '#e6e6e6',
  '--fundo-1': '#f5f5f5',
  '--fundo-2': '#ffffff',
  '--fundo-3': '#f0f0f0',
  '--fundo-4': '#e8e8e8',
  '--fundo-elevado': '#ffffff',
  '--entorno-monitor': '#d9d9d9', // cinza médio, não branco (avaliação de cor)
  '--xadrez': 'repeating-conic-gradient(#e5e5e5 0 25%, #f5f5f5 0 50%) 0 0 / 16px 16px',
  '--sombra-peca': '0 0 0 1px rgba(0, 0, 0, 0.08), 0 6px 24px rgba(0, 0, 0, 0.18)',
  '--vidro': 'rgba(255, 255, 255, 0.8)',
  '--veu': 'rgba(0, 0, 0, 0.3)',
  '--borda': '#e2e2e2',
  '--borda-campo': '#d4d4d4',
  '--borda-forte': '#c8c8c8',
  '--texto': '#1c1c1c',
  '--texto-2': '#555555',
  '--texto-3': '#646464',
  '--icone-inativo': '#8d8d8d',
  '--alca': '#ffffff',
  '--guia': '#d6247c',
  '--acento': '#0b63c5',
  '--acento-forte': '#0a56ab',
  '--acento-fundo': '#dcebff',
  '--acento-fraco': 'rgba(11, 99, 197, 0.1)',
  '--acento-selecao': 'rgba(11, 99, 197, 0.22)',
  '--acento-tracejado': 'rgba(11, 99, 197, 0.7)',
  '--sobre-acento': '#ffffff',
  '--agente': '#6550b9',
  '--agente-fundo': '#ece8ff',
  '--agente-borda': 'rgba(101, 80, 185, 0.4)',
  '--sobre-agente': '#ffffff',
  '--comentario': '#9a5b00',
  '--pino': '#ffc53d',
  '--sobre-pino': '#1c1c1c',
  '--cabeca': '#e5484d',
  '--ok': '#18794e',
  '--ok-fundo': '#e6f6eb',
  '--aviso': '#b04400',
  '--aviso-fundo': '#fff1e7',
  '--erro': '#c62a2f',
  '--erro-fundo': '#feebec',
  '--faixa-azul': '#2f7fd6',
  '--faixa-ciano': '#0f8ea8',
  '--faixa-verde': '#1f8a5a',
  '--faixa-lima': '#5d8a24',
  '--faixa-rosa': '#a245b4',
  '--faixa-areia': '#94723a',
  '--term-preto': '#1c1c1c', '--term-vermelho': '#c62a2f', '--term-verde': '#18794e', '--term-amarelo': '#9a5b00',
  '--term-azul': '#0b63c5', '--term-magenta': '#6550b9', '--term-ciano': '#0f7c93', '--term-branco': '#555555',
  '--term-preto-claro': '#646464', '--term-vermelho-claro': '#e5484d', '--term-verde-claro': '#2b9a66', '--term-amarelo-claro': '#b56b00',
  '--term-azul-claro': '#2f7fd6', '--term-magenta-claro': '#8e4ec6', '--term-ciano-claro': '#0f8ea8', '--term-branco-claro': '#1c1c1c',
  '--sombra-1': '0 1px 2px rgba(0, 0, 0, 0.12)',
  '--sombra-2': '0 0 0 1px rgba(0, 0, 0, 0.06), 0 8px 24px rgba(0, 0, 0, 0.12)',
  '--sombra-3': '0 0 0 1px rgba(0, 0, 0, 0.08), 0 24px 64px rgba(0, 0, 0, 0.18)',
};

/** Alto contraste (WCAG 1.4.11 à risca): só reatribui; vale nos dois temas. */
export const CONTRASTE_ESCURO: Tokens = {
  '--texto-2': 'var(--texto)', '--texto-3': '#c4c4c4', '--borda-campo': '#6e6e6e', '--borda-forte': '#8a8a8a', '--borda': '#3d3d3d', '--icone-inativo': '#8a8a8a',
};
export const CONTRASTE_CLARO: Tokens = {
  '--texto-2': 'var(--texto)', '--texto-3': '#3a3a3a', '--borda-campo': '#767676', '--borda-forte': '#5e5e5e', '--borda': '#c8c8c8', '--icone-inativo': '#6e6e6e',
};

/** O que não muda com o tema: forma, tipo, medidas e os apelidos (as famílias da linha do tempo apontam para as faixas). */
export const COMUNS: Tokens = {
  '--entorno': 'var(--entorno-monitor)',
  '--texto-sobre-acento': 'var(--sobre-acento)',
  '--pessoa': 'var(--texto-2)', // a pessoa não tem cor: só o agente salta à vista
  '--foco': 'var(--acento)',

  // eixos do 3D (Z só em traço, nunca em letra): os mesmos nos dois temas
  '--eixo-x': '#e5484d',
  '--eixo-y': '#46a758',
  '--eixo-z': '#3e63dd',

  // famílias da linha do tempo
  '--trilha-texto': 'var(--faixa-azul)',
  '--trilha-texto-fundo': 'color-mix(in srgb, var(--trilha-texto) 24%, var(--fundo-2))',
  '--trilha-video': 'var(--trilha-texto)',
  '--trilha-midia': 'var(--faixa-ciano)',
  '--trilha-midia-fundo': 'color-mix(in srgb, var(--trilha-midia) 22%, var(--fundo-2))',
  '--trilha-audio': 'var(--faixa-verde)',
  '--trilha-audio-fundo': 'color-mix(in srgb, var(--trilha-audio) 20%, var(--fundo-2))',
  '--trilha-musica': 'var(--faixa-ciano)',
  '--trilha-musica-fundo': 'color-mix(in srgb, var(--trilha-musica) 20%, var(--fundo-2))',
  '--trilha-sfx': 'var(--faixa-lima)',
  '--trilha-sfx-fundo': 'color-mix(in srgb, var(--trilha-sfx) 18%, var(--fundo-2))',
  '--trilha-efeito': 'var(--faixa-rosa)',
  '--trilha-efeito-fundo': 'color-mix(in srgb, var(--trilha-efeito) 20%, var(--fundo-2))',
  '--trilha-legenda': 'var(--faixa-areia)',
  '--trilha-legenda-fundo': 'color-mix(in srgb, var(--trilha-legenda) 18%, var(--fundo-2))',
  '--trilha-cena-a': 'var(--fundo-3)',
  '--trilha-cena-b': 'var(--fundo-4)',

  // forma
  '--raio-1': '3px', // clipes, etiquetas
  '--raio': '6px', // botões, campos, linhas
  '--raio-2': '8px', // painéis, cartões, menus
  '--raio-3': '12px', // diálogos, cartões grandes da tela inicial
  '--esp-0': '2px', '--esp-1': '4px', '--esp-2': '8px', '--esp-3': '12px', '--esp-4': '16px', '--esp-5': '24px', '--esp-6': '32px',
  '--fonte': "'Inter Variable', 'Segoe UI Variable Text', system-ui, sans-serif",
  '--fonte-mono': "'JetBrains Mono', 'Cascadia Mono', monospace",
  '--tam-1': '11px', // só metadados
  '--tam-2': '12px', // rótulos, abas
  '--tam-3': '13px', // corpo
  '--tam-4': '15px', // títulos de seção e de diálogo
  '--tam-5': '20px',
  '--tam-6': '28px', // tela inicial
  '--peso-normal': '400',
  '--peso-medio': '500',
  '--peso-forte': '600',
  '--icone': '16px',
  '--icone-p': '14px',
  '--traco-icone': '1.6',

  // medidas (confortável; a compacta e a faixa C mudam só estas)
  '--barra': '36px', // a mesma altura do titleBarOverlay do processo principal
  '--rodape': '24px',
  '--controle': '28px',
  '--controle-p': '24px',
  '--linha-lista': '28px',
  '--trilho': '36px',
  '--transporte': '36px',
  '--linha-bloco': '36px', // faixa de blocos na linha do tempo

  // movimento
  '--rapido': '120ms',
  '--medio': '160ms',
};

/** Densidade compacta: Preferências › Aparência, e o padrão da faixa C (janela abaixo de 1600×800). */
export const COMPACTA: Tokens = {
  '--tam-3': '12px',
  '--controle': '24px',
  '--controle-p': '22px',
  '--linha-lista': '24px',
  '--transporte': '32px',
  '--linha-bloco': '28px',
  '--rodape': '22px',
};

/** Tema dos painéis acopláveis (dockview): só apelidos dos tokens. */
export const DOCKVIEW: Record<`--dv-${string}`, string> = {
  '--dv-background-color': 'var(--fundo-0)',
  '--dv-group-view-background-color': 'var(--fundo-2)',
  '--dv-tabs-and-actions-container-background-color': 'var(--fundo-1)',
  '--dv-tabs-and-actions-container-height': '30px',
  '--dv-tabs-and-actions-container-font-size': 'var(--tam-2)',
  '--dv-activegroup-visiblepanel-tab-background-color': 'var(--fundo-2)',
  '--dv-activegroup-hiddenpanel-tab-background-color': 'var(--fundo-1)',
  '--dv-inactivegroup-visiblepanel-tab-background-color': 'var(--fundo-2)',
  '--dv-inactivegroup-hiddenpanel-tab-background-color': 'var(--fundo-1)',
  '--dv-activegroup-visiblepanel-tab-color': 'var(--texto)',
  '--dv-activegroup-hiddenpanel-tab-color': 'var(--texto-3)',
  '--dv-inactivegroup-visiblepanel-tab-color': 'var(--texto-2)',
  '--dv-inactivegroup-hiddenpanel-tab-color': 'var(--texto-3)',
  '--dv-tab-divider-color': 'transparent',
  '--dv-separator-border': 'transparent',
  '--dv-paneview-header-border-color': 'var(--borda)',
  '--dv-sash-color': 'transparent',
  '--dv-active-sash-color': 'var(--acento)',
  '--dv-drag-over-background-color': 'var(--acento-fraco)',
  '--dv-drag-over-border-color': 'var(--acento)',
  '--dv-icon-hover-background-color': 'var(--fundo-3)',
  '--dv-scrollbar-background-color': 'var(--fundo-4)',
};

const bloco = (seletor: string, t: Record<string, string>) => `${seletor} {\n${Object.entries(t).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`;

/** O CSS inteiro dos tokens: :root (escuro), tema claro, alto contraste (pedido ou do sistema) e densidade compacta. */
export const cssDosTokens = () => [
  bloco(':root', {...ESCURO, ...COMUNS, 'color-scheme': 'dark'}),
  bloco(':root[data-tema="claro"]', {...CLARO, 'color-scheme': 'light'}),
  bloco(':root[data-contraste="alto"]', CONTRASTE_ESCURO),
  bloco(':root[data-tema="claro"][data-contraste="alto"]', CONTRASTE_CLARO),
  bloco(':root[data-densidade="compacta"], :root[data-densidade="auto"][data-faixa="C"]', COMPACTA),
  bloco('.dockview-theme-estudio', DOCKVIEW),
  bloco('[data-faixa="C"] .dockview-theme-estudio', {'--dv-tabs-and-actions-container-height': '28px'}),
].join('\n');

/** Valor de um token no tema (para canvas e para o xterm, que não leem CSS). */
export const tokenDo = (tema: 'escuro' | 'claro', nome: `--${string}`) => (tema === 'claro' ? CLARO[nome] : undefined) ?? ESCURO[nome] ?? COMUNS[nome];

/** ITheme do xterm a partir dos tokens. */
export const temaDoTerminal = (tema: 'escuro' | 'claro') => {
  const t = (n: string) => tokenDo(tema, `--${n}`)!;
  return {
    background: t('fundo-1'), foreground: t('texto'), cursor: t('acento'), cursorAccent: t('fundo-1'), selectionBackground: t('acento-selecao'),
    black: t('term-preto'), red: t('term-vermelho'), green: t('term-verde'), yellow: t('term-amarelo'), blue: t('term-azul'), magenta: t('term-magenta'),
    cyan: t('term-ciano'), white: t('term-branco'), brightBlack: t('term-preto-claro'), brightRed: t('term-vermelho-claro'), brightGreen: t('term-verde-claro'),
    brightYellow: t('term-amarelo-claro'), brightBlue: t('term-azul-claro'), brightMagenta: t('term-magenta-claro'), brightCyan: t('term-ciano-claro'),
    brightWhite: t('term-branco-claro'),
  };
};

/** Põe os tokens na página (uma vez, antes do primeiro desenho). */
export const instalarTokens = () => {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('estudio-tokens') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'estudio-tokens';
    document.head.prepend(el);
  }
  el.textContent = cssDosTokens();
};
