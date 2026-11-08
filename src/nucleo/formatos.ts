// Formatos de saída, pelo nome do destino ("Reels 9:16") e não pelo perfil técnico. A tela inicial, o resumo do vídeo,
// a exportação e o MCP leem esta lista. Documento de vídeo sem `formato` é o carrossel vertical de antes: 1080×1920 a
// 30 qps.

export type Formato = {largura: number; altura: number; fps: number};

export type PresetFormato = {id: string; nome: string; destino: string; proporcao: string; largura: number; altura: number};

export const FORMATO_PADRAO: Formato = {largura: 1080, altura: 1920, fps: 30};
export const FPS_PADRAO = 30;

export const FORMATOS_VIDEO: PresetFormato[] = [
  {id: 'reels', nome: 'Reels e Shorts', destino: 'Instagram, TikTok, YouTube Shorts', proporcao: '9:16', largura: 1080, altura: 1920},
  {id: 'feed', nome: 'Feed', destino: 'Instagram e LinkedIn', proporcao: '4:5', largura: 1080, altura: 1350},
  {id: 'quadrado', nome: 'Quadrado', destino: 'Feed e WhatsApp', proporcao: '1:1', largura: 1080, altura: 1080},
  {id: 'youtube', nome: 'YouTube e apresentação', destino: 'YouTube, TV, telão', proporcao: '16:9', largura: 1920, altura: 1080},
];

export const FORMATOS_IMAGEM: PresetFormato[] = [
  {id: 'feed', nome: 'Post retrato', destino: 'Instagram', proporcao: '4:5', largura: 1080, altura: 1350},
  {id: 'quadrado', nome: 'Post quadrado', destino: 'Instagram, WhatsApp', proporcao: '1:1', largura: 1080, altura: 1080},
  {id: 'story', nome: 'Story e capa de Reels', destino: 'Instagram', proporcao: '9:16', largura: 1080, altura: 1920},
  {id: 'miniatura', nome: 'Miniatura do YouTube', destino: 'YouTube', proporcao: '16:9', largura: 1280, altura: 720},
  {id: 'linkedin', nome: 'LinkedIn', destino: 'Post com link', proporcao: '1,91:1', largura: 1200, altura: 627},
  {id: 'a4', nome: 'A4 para imprimir', destino: '300 dpi', proporcao: 'A4', largura: 2480, altura: 3508},
];

const mdc = (a: number, b: number): number => (b ? mdc(b, a % b) : a);

/** "9:16" para os tamanhos da lista; para um tamanho livre, a razão reduzida. */
export const proporcaoDe = (largura: number, altura: number): string => {
  const p = [...FORMATOS_VIDEO, ...FORMATOS_IMAGEM].find((f) => f.largura === largura && f.altura === altura);
  if (p) return p.proporcao;
  const d = mdc(largura, altura) || 1;
  return `${largura / d}:${altura / d}`;
};

export const presetDe = (lista: PresetFormato[], id?: string) => lista.find((f) => f.id === id);

/** O que o resolvedor e a exportação aceitam de largura e altura (px). Fora disso a prévia e o MP4 trocavam, em silêncio, para
 *  1080×1920 (transversal-D17): quem cria o documento já limita aqui. */
export const TAMANHO_MIN = 16;
export const TAMANHO_MAX = 7680;

/** Largura ou altura dentro de 16 a 7680 px, arredondada; vazio, zero ou texto que não é número volta ao `padrao`. */
export const limitarTamanho = (n: unknown, padrao = 1080): number => {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v <= 0) return padrao;
  return Math.min(TAMANHO_MAX, Math.max(TAMANHO_MIN, Math.round(v)));
};

/** Formato do documento de vídeo, com o padrão do carrossel para documento antigo. */
export const formatoDoVideo = (doc: unknown): Formato => {
  const f = (doc as {formato?: unknown} | null)?.formato;
  if (!f || typeof f !== 'object') return FORMATO_PADRAO;
  const {largura, altura, fps} = f as Partial<Formato>;
  const ok = (n: unknown, min: number, max: number) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  return {
    largura: ok(largura, TAMANHO_MIN, TAMANHO_MAX) ? Math.round(largura!) : FORMATO_PADRAO.largura,
    altura: ok(altura, TAMANHO_MIN, TAMANHO_MAX) ? Math.round(altura!) : FORMATO_PADRAO.altura,
    fps: ok(fps, 1, 120) ? fps! : FPS_PADRAO,
  };
};

/** "9:16 · 1080×1920 · 30 qps". */
export const rotuloFormato = (f: Formato) => `${proporcaoDe(f.largura, f.altura)} · ${f.largura}×${f.altura} · ${f.fps} qps`;

export const vertical = (f: {largura: number; altura: number}) => f.altura > f.largura;
