// Zonas seguras das redes, em frações do quadro (0 a 1), para a sobreposição do monitor. Cada rede cobre parte do vídeo
// com a própria interface (nome do perfil, legenda, botões), e o texto que cai ali some. Os números vêm das
// especificações publicadas e dos modelos de uso corrente, anotados em cada valor; as redes mudam a interface sem avisar,
// então isto é guia, não garantia. A escolha fica na interface e não sai na exportação. As mesmas zonas dizem onde a
// marca d'água da exportação pode ficar (posicaoSegura, no fim).

export type IdZonaSegura = 'vertical' | 'feed' | 'youtube';

/** `coberta`: a interface da rede fica por cima (pintada). `contorno`: só a borda, para o miolo que sobrevive a um corte
 *  ou a área onde algo da rede pode aparecer. `miolo`: o contorno é o que sobra depois do corte (a marca d'água fica
 *  dentro dele); os outros contornos são áreas a evitar, como as cobertas. */
export type ZonaSegura = {tipo: 'coberta' | 'contorno'; x: number; y: number; largura: number; altura: number; rotulo: string; fonte: string; miolo?: boolean};

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
      {tipo: 'contorno', x: 0, y: V(240), largura: 1, altura: V(1440), rotulo: 'Corte 3:4 da grade do perfil', fonte: 'Instagram (2025): grade em 3:4', miolo: true},
    ],
  },
  {
    id: 'feed',
    nome: 'Feed 4:5',
    proporcao: '4:5',
    zonas: [
      // grade do Instagram até janeiro de 2025 e miniaturas quadradas (WhatsApp, LinkedIn): de um 4:5 sobram 1080×1080
      // no centro, 135 px cortados em cima e embaixo
      {tipo: 'contorno', x: 0, y: 135 / 1350, largura: 1, altura: 1080 / 1350, rotulo: 'Corte 1:1 (prévia quadrada)', fonte: 'grade antiga do Instagram e miniaturas quadradas', miolo: true},
      // Instagram, janeiro de 2025: grade em 3:4; de um 4:5 sobram 1012×1350 (34 px cortados de cada lado)
      {tipo: 'contorno', x: L(33.75), y: 0, largura: L(1012.5), altura: 1, rotulo: 'Corte 3:4 da grade do perfil', fonte: 'Instagram (2025): grade em 3:4', miolo: true},
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
      {tipo: 'contorno', x: 0.05, y: 0.05, largura: 0.9, altura: 0.9, rotulo: 'Área segura de título (90%)', fonte: 'SMPTE RP 218', miolo: true},
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

/** Onde acaba (y, em px de 1080×1920) a legenda palavra a palavra do carrossel da Cliente: 16 px acima da faixa que a rede cobre
 *  embaixo (484 px, a do 9:16). A legenda gruda nessa linha e cresce para cima; antes começava em 1480, dentro da faixa
 *  (que começa em 1436) (video-D17). */
export const baseDaLegendaCarrossel = (respiro = 16): number => {
  const faixa = conjuntoDe('vertical')!.zonas.find((z) => z.tipo === 'coberta' && z.largura >= 0.99 && z.y + z.altura >= 0.99)!;
  return Math.round(faixa.y * 1920) - respiro;
};

// ---------- onde a marca d'água pode ficar ----------
export type CantoMarca = 'sup-esq' | 'sup-dir' | 'inf-esq' | 'inf-dir';

/** O canto de cada rede quando a pessoa não escolheu: no vertical, em cima à direita, logo abaixo do nome do perfil (a
 *  coluna de ícones só começa no meio do quadro); no feed, embaixo à direita, dentro dos dois cortes da grade; no
 *  YouTube, em cima à direita, abaixo do título (embaixo à direita ficam os controles e a marca do próprio canal). */
export const CANTO_PADRAO: Record<IdZonaSegura, CantoMarca> = {vertical: 'sup-dir', feed: 'inf-dir', youtube: 'sup-dir'};

/** Conjunto de zonas que vale para a marca d'água num quadro: o sugerido, menos no quadrado (as zonas de 4:5 não servem
 *  a 1:1), que só leva a margem. */
export const zonasDaMarca = (largura: number, altura: number): IdZonaSegura | null =>
  largura > 0 && altura > 0 && Math.abs(largura / altura - 1) < 0.05 ? null : zonaSugerida(largura, altura);

/** Retângulo em frações do quadro (canto de cima à esquerda). */
export type Ret = {x: number; y: number; largura: number; altura: number};
const FOLGA = 1e-9;
const cruza = (a: Ret, b: Ret) => a.x < b.x + b.largura - FOLGA && b.x < a.x + a.largura - FOLGA && a.y < b.y + b.altura - FOLGA && b.y < a.y + a.altura - FOLGA;
const dentro = (a: Ret, b: Ret) => a.x >= b.x - FOLGA && a.y >= b.y - FOLGA && a.x + a.largura <= b.x + b.largura + FOLGA && a.y + a.altura <= b.y + b.altura + FOLGA;

/** A caixa (em px) pode ficar em `ret` (frações)? Dentro do quadro e de todo miolo, sem cruzar coberta nem contorno a
 *  evitar. */
export const livreDasZonas = (zonas: ZonaSegura[], ret: Ret) =>
  dentro(ret, {x: 0, y: 0, largura: 1, altura: 1}) && zonas.every((z) => (z.miolo ? dentro(ret, z) : !cruza(ret, z)));

/** Posição (frações do quadro, canto de cima à esquerda) de uma caixa de `caixa` px num quadro de `quadro` px, o mais
 *  perto possível do `canto` pedido, a `margem` px da borda e das zonas. `evitar` são áreas a mais, tratadas como as
 *  cobertas da rede: a da legenda do vídeo (caixaDaLegenda, em exportacao.ts), para a marca não cobrir a fala. Os
 *  candidatos são as bordas das próprias zonas (encostar logo abaixo da faixa de cima, logo à esquerda da coluna de
 *  ícones, dentro do corte, logo acima da legenda); fica o mais perto do canto entre os que não pisam em nada. Sem
 *  nenhum livre (caixa grande demais), volta o canto com a margem e `segura: false`. */
export const posicaoSegura = (id: IdZonaSegura | null | undefined, canto: CantoMarca, quadro: {largura: number; altura: number},
  caixa: {largura: number; altura: number}, margem: number, evitar: Ret[] = []): {x: number; y: number; segura: boolean} => {
  const zonas: ZonaSegura[] = [...(conjuntoDe(id)?.zonas ?? []),
    ...evitar.map((r): ZonaSegura => ({tipo: 'coberta', x: r.x, y: r.y, largura: r.largura, altura: r.altura, rotulo: 'Evitar', fonte: 'exportação'}))];
  const w = caixa.largura / quadro.largura;
  const h = caixa.altura / quadro.altura;
  const mx = margem / quadro.largura;
  const my = margem / quadro.altura;
  const ideal = {x: canto.endsWith('dir') ? 1 - mx - w : mx, y: canto.startsWith('inf') ? 1 - my - h : my};
  const xs = [ideal.x];
  const ys = [ideal.y];
  for (const z of zonas) {
    if (z.miolo) {
      xs.push(z.x + mx, z.x + z.largura - mx - w);
      ys.push(z.y + my, z.y + z.altura - my - h);
    } else {
      xs.push(z.x - mx - w, z.x + z.largura + mx);
      ys.push(z.y - my - h, z.y + z.altura + my);
    }
  }
  let melhor: {x: number; y: number; d: number} | null = null;
  for (const x of xs) {
    for (const y of ys) {
      if (!livreDasZonas(zonas, {x, y, largura: w, altura: h})) continue;
      const d = ((x - ideal.x) * quadro.largura) ** 2 + ((y - ideal.y) * quadro.altura) ** 2;
      if (!melhor || d < melhor.d - FOLGA) melhor = {x, y, d};
    }
  }
  return melhor ? {x: melhor.x, y: melhor.y, segura: true} : {...ideal, segura: false};
};
