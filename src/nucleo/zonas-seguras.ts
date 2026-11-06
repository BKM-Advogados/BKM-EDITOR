// Zonas seguras das redes, em frações do quadro (0 a 1), para a sobreposição do monitor. Cada rede cobre parte do vídeo
// com a própria interface (nome do perfil, legenda, botões), e o texto que cai ali some. Os números vêm das
// especificações publicadas e dos modelos de uso corrente, anotados em cada valor; as redes mudam a interface sem avisar,
// então isto é guia, não garantia. A escolha fica na interface e não sai na exportação.

export type IdZonaSegura = 'vertical' | 'feed' | 'youtube';

/** `coberta`: a interface da rede fica por cima (pintada). `contorno`: só a borda, para o miolo que sobrevive a um corte
 *  ou a área onde algo da rede pode aparecer. */
export type ZonaSegura = {tipo: 'coberta' | 'contorno'; x: number; y: number; largura: number; altura: number; rotulo: string; fonte: string};

export type ConjuntoZonas = {id: IdZonaSegura; nome: string; proporcao: string; zonas: ZonaSegura[]};

// as contas abaixo são em px de 1080×1920 (vertical), 1080×1350 (feed) e 1920×1080 (YouTube), divididas pelo lado
const V = (px: number) => px / 1920; // fração da altura do 9:16
const L = (px: number) => px / 1080; // fração da largura do 9:16 e do 4:5

export const ZONAS_SEGURAS: ConjuntoZonas[] = [
  {
    id: 'vertical',
    nome: 'Reels, TikTok e Shorts',
    proporcao: '9:16',
    zonas: [
      // Meta, especificações do Reels Ads (1080×1920): "deixe cerca de 14% (250 px) de cima livres de texto e logo"
      {tipo: 'coberta', x: 0, y: 0, largura: 1, altura: V(250), rotulo: 'Nome do perfil e menu', fonte: 'Meta, Reels Ads: 250 px de cima'},
      // TikTok for Business, modelo de zona segura 1080×1920: 484 px embaixo (legenda, som e perfil). A Meta pede 340 px
      // no Reels e os Shorts ficam entre 180 e 290 px nos modelos de terceiros: o maior dos três manda
      {tipo: 'coberta', x: 0, y: 1 - V(484), largura: 1, altura: V(484), rotulo: 'Legenda, som e perfil', fonte: 'TikTok for Business: 484 px embaixo (Reels: 340 px)'},
      // TikTok for Business: 140 px à direita para curtir, comentar e compartilhar; no Reels e nos Shorts a coluna tem
      // largura parecida e começa perto da metade do quadro
      {tipo: 'coberta', x: 1 - L(140), y: 0.42, largura: L(140), altura: 1 - V(484) - 0.42, rotulo: 'Curtir, comentar, compartilhar', fonte: 'TikTok for Business: 140 px à direita'},
      // Instagram, janeiro de 2025: a grade do perfil passou de 1:1 para 3:4; de um 9:16 sobram 1080×1440 no centro
      // (240 px cortados em cima e embaixo)
      {tipo: 'contorno', x: 0, y: V(240), largura: 1, altura: V(1440), rotulo: 'Corte 3:4 da grade do perfil', fonte: 'Instagram (2025): grade em 3:4'},
    ],
  },
  {
    id: 'feed',
    nome: 'Feed 4:5',
    proporcao: '4:5',
    zonas: [
      // grade do Instagram até janeiro de 2025 e miniaturas quadradas (WhatsApp, LinkedIn): de um 4:5 sobram 1080×1080
      // no centro, 135 px cortados em cima e embaixo
      {tipo: 'contorno', x: 0, y: 135 / 1350, largura: 1, altura: 1080 / 1350, rotulo: 'Corte 1:1 (prévia quadrada)', fonte: 'grade antiga do Instagram e miniaturas quadradas'},
      // Instagram, janeiro de 2025: grade em 3:4; de um 4:5 sobram 1012×1350 (34 px cortados de cada lado)
      {tipo: 'contorno', x: L(33.75), y: 0, largura: L(1012.5), altura: 1, rotulo: 'Corte 3:4 da grade do perfil', fonte: 'Instagram (2025): grade em 3:4'},
    ],
  },
  {
    id: 'youtube',
    nome: 'YouTube 16:9',
    proporcao: '16:9',
    zonas: [
      // player do YouTube em 1920×1080: barra de progresso, controles e o degradê por baixo deles ocupam o décimo de
      // baixo [medida aproximada do player no desktop, 2026]
      {tipo: 'coberta', x: 0, y: 0.9, largura: 1, altura: 0.1, rotulo: 'Barra de progresso e controles', fonte: 'player do YouTube (aproximado)'},
      // título e canal por cima do vídeo no player incorporado e no celular, no décimo de cima [aproximado]
      {tipo: 'coberta', x: 0, y: 0, largura: 1, altura: 0.1, rotulo: 'Título e canal (incorporado e celular)', fonte: 'player do YouTube (aproximado)'},
      // as legendas automáticas ficam logo acima dos controles, no meio
      {tipo: 'contorno', x: 0.15, y: 0.76, largura: 0.7, altura: 0.13, rotulo: 'Legendas automáticas', fonte: 'posição padrão das legendas do YouTube'},
      // SMPTE RP 218 (HD): área segura de título a 90% do quadro, a mesma dos "safe margins" do Premiere e do Resolve
      {tipo: 'contorno', x: 0.05, y: 0.05, largura: 0.9, altura: 0.9, rotulo: 'Área segura de título (90%)', fonte: 'SMPTE RP 218'},
    ],
  },
];

export const conjuntoDe = (id?: IdZonaSegura | null) => ZONAS_SEGURAS.find((z) => z.id === id);

/** O conjunto que combina com o quadro: vertical acima de 1,3 de altura por largura, feed até aí, YouTube quando é mais
 *  largo que alto. */
export const zonaSugerida = (largura: number, altura: number): IdZonaSegura => {
  if (!(largura > 0 && altura > 0) || largura > altura) return 'youtube';
  return altura / largura > 1.3 ? 'vertical' : 'feed';
};
