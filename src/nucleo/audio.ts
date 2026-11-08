// Som do vídeo de cenas (cenas.ts): faixas (narração, música, efeitos) com clipes em ms da linha do tempo, o envelope de
// loudness de cada arquivo (medido uma vez e gravado em midia/<arquivo>.envelope.json) e o ducking da música sob a voz.
// Tudo aqui é puro: a interface decodifica o áudio com Web Audio, o processo principal lê os envelopes do disco, e os
// dois chamam estas funções. Os níveis são em dB com a ponderação K da ITU-R BS.1770 (o que o medidor de LUFS mede),
// para a diferença voz × música sair em LU medidos, e não em "volume" chutado.

export type PapelFaixa = 'voz' | 'musica' | 'efeitos';

/** A música cai sob a voz: `alvo_lu` abaixo da voz (mediana), com ataque e soltura em ms. Só vale em faixa de música. */
export type Ducking = {ativo?: boolean; alvo_lu?: number; ataque_ms?: number; soltura_ms?: number};

export type ClipeAudio = {
  id: string;
  arquivo: string; // caminho no projeto (midia/narracao.wav)
  nome?: string; // o que a linha do tempo mostra (padrão: o nome do arquivo)
  em: number; // ms na linha do tempo do vídeo
  duracao_ms: number;
  corte_ms?: number; // início dentro do arquivo (padrão 0)
  volume?: number; // 0 a 1 (padrão 1)
  fade_in_ms?: number;
  fade_out_ms?: number;
  mudo?: boolean;
  original?: string; // voz limpa: o arquivo da pessoa, intacto ("Voltar ao original" põe de volta em `arquivo`)
  limpeza?: LimpezaClipe; // o que a limpeza de voz fez e mediu (limpeza-voz.ts)
  // frente Música (src/nucleo/musica-video.ts): o clipe toca o render do documento de música `musica`, refeito quando a
  // música muda; `musica_original` guarda o áudio de antes do "Editar em Música", para "Voltar ao original"
  musica?: string;
  musica_original?: {arquivo: string; corte_ms?: number; duracao_ms: number};
};

/** Limpeza de voz gravada no clipe: a intensidade usada e o ruído nas pausas e a voz antes e depois, em dB (ponderação K). */
export type LimpezaClipe = {intensidade: IntensidadeLimpeza; ruido_antes_db: number; ruido_depois_db: number; voz_antes_db: number | null; voz_depois_db: number | null};
export type IntensidadeLimpeza = 'leve' | 'media' | 'forte';

export type FaixaAudio = {id: string; nome: string; papel?: PapelFaixa; volume?: number; mudo?: boolean; ducking?: Ducking; clipes: ClipeAudio[]};

/** `alvo_lufs` e `pico_dbtp`: o loudness integrado e o pico verdadeiro máximo do arquivo exportado (padrão −14 e −1). */
export type AudioCenas = {faixas: FaixaAudio[]; alvo_lufs?: number; pico_dbtp?: number};

/** Loudness por janela do arquivo, em dB com ponderação K (o mesmo número do LUFS, por janela). `db` tem uma entrada
 *  por `janela_ms`; SILENCIO_DB é "nada". Gravado em midia/<arquivo>.envelope.json pelo processo principal, com `fonte`:
 *  o arquivo como ele estava quando foi medido (tamanho, data e sha256), para remedir quando a tomada for regravada com o
 *  mesmo nome. A versão sobe quando a conta muda: a 2 veio com a ponderação K do libebur128 (rodada 2), e o envelope da
 *  versão 1 (0.3.0) conta como não medido. */
export const VERSAO_ENVELOPE = 2;
export type FonteDoEnvelope = {tamanho: number; modificado_ms?: number; sha256?: string};
export type Envelope = {versao: typeof VERSAO_ENVELOPE; janela_ms: number; duracao_ms: number; db: number[]; fonte?: FonteDoEnvelope};

export const JANELA_MS = 50;
export const SILENCIO_DB = -100;
const PORTA_ABSOLUTA_DB = -70; // abaixo disto é silêncio, como a porta absoluta do BS.1770
const PORTA_RELATIVA_LU = 10; // janelas 10 LU abaixo da média não contam no nível (porta relativa do BS.1770)
const PORTA_VOZ_LU = 18; // há voz na janela quando ela está a menos de 18 LU da referência da narração
const MUSICA_SEM_MEDIDA_DB = -14; // música sem envelope ainda: nível típico de música masterizada para streaming
const VOZ_SEM_MEDIDA_DB = -20; // narração sem envelope ainda: nível típico de voz gravada e normalizada

export const DUCKING_PADRAO = {alvo_lu: 20, ataque_ms: 80, soltura_ms: 500} as const; // a casa mixa música de 18 a 23 LU abaixo da voz
export const ALVO_LU_MIN = 6;
export const ALVO_LU_MAX = 36;
export const DURACAO_CLIPE_MIN = 100;
// o arquivo exportado: −14 LUFS integrado (YouTube, Instagram, Spotify) e pico verdadeiro até −1 dBTP
export const ALVO_LUFS_PADRAO = -14;
export const PICO_DBTP_PADRAO = -1;
export const ALVO_LUFS_MIN = -30;
export const ALVO_LUFS_MAX = -9;
export const PICO_DBTP_MIN = -6;
export const PICO_DBTP_MAX = 0;

export const PAPEIS: Record<PapelFaixa, {nome: string; nome_faixa: string; id: string; volume: number}> = {
  voz: {nome: 'Narração', nome_faixa: 'Narração', id: 'narracao', volume: 1},
  musica: {nome: 'Música', nome_faixa: 'Música', id: 'musica', volume: 1},
  efeitos: {nome: 'Efeito sonoro', nome_faixa: 'Efeitos', id: 'efeitos', volume: 1},
};

export const dbDeGanho = (g: number) => (g <= 0 ? SILENCIO_DB : 20 * Math.log10(g));
export const ganhoDeDb = (db: number) => Math.pow(10, db / 20);
const limitar = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const numero = (v: unknown, padrao: number) => (typeof v === 'number' && Number.isFinite(v) ? v : padrao);

/** Papel pelo campo ou, faltando, pelo nome da faixa ("Narração" é voz, "Trilha" é música, o resto é efeito). */
export const papelDe = (f: {papel?: unknown; nome?: unknown}): PapelFaixa => {
  if (f.papel === 'voz' || f.papel === 'musica' || f.papel === 'efeitos') return f.papel;
  const n = String(f.nome ?? '').toLowerCase();
  if (/narra|voz|fala|locu/.test(n)) return 'voz';
  if (/m[uú]sic|trilha|cama|fundo/.test(n)) return 'musica';
  return 'efeitos';
};

/** Faixa nova de um papel; a de música já nasce com ducking ligado. */
export const novaFaixaAudio = (papel: PapelFaixa, id: string): FaixaAudio => ({
  id,
  nome: PAPEIS[papel].nome_faixa,
  papel,
  volume: PAPEIS[papel].volume,
  clipes: [],
  ...(papel === 'musica' ? {ducking: {ativo: true, ...DUCKING_PADRAO}} : {}),
});

/** Som novo do documento: narração, música e efeitos, vazios. */
export const novoAudioCenas = (): AudioCenas => ({faixas: [novaFaixaAudio('voz', 'narracao'), novaFaixaAudio('musica', 'musica'), novaFaixaAudio('efeitos', 'efeitos')]});

/** O nome que a linha do tempo mostra: o dado, ou o do arquivo; a voz limpa mostra o do original, com "(limpa)". */
export const nomeDoClipe = (c: {nome?: string; arquivo: string; original?: string}) =>
  c.nome || (c.original ? `${c.original.split('/').pop()} (limpa)` : c.arquivo.split('/').pop() || c.arquivo);

// ---------- envelope: ponderação K e loudness por janela ----------
export type Biquad = {b0: number; b1: number; b2: number; a1: number; a2: number};

// coeficientes do BS.1770 para qualquer taxa de amostragem (prateleira alta de ~+4 dB perto de 1,7 kHz e passa-altas RLB
// em 38 Hz), com as constantes do libebur128 (as mesmas do ffmpeg): a 48 kHz dão os coeficientes da tabela da norma
const prateleiraAlta = (taxa: number): Biquad => {
  const f0 = 1681.974450955533;
  const ganho = 3.999843853973347;
  const q = 0.7071752369554196;
  const k = Math.tan((Math.PI * f0) / taxa);
  const vh = Math.pow(10, ganho / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const a0 = 1 + k / q + k * k;
  return {b0: (vh + (vb * k) / q + k * k) / a0, b1: (2 * (k * k - vh)) / a0, b2: (vh - (vb * k) / q + k * k) / a0, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q + k * k) / a0};
};
const passaAltas = (taxa: number): Biquad => {
  const f0 = 38.13547087602444;
  const q = 0.5003270373238773;
  const k = Math.tan((Math.PI * f0) / taxa);
  const a0 = 1 + k / q + k * k;
  // o numerador do passa-altas é 1, −2, 1 sem normalizar, como na norma (o ganho em 1 kHz fica no −0,691)
  return {b0: 1, b1: -2, b2: 1, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q + k * k) / a0};
};
const filtrar = (x: Float32Array, f: Biquad): Float32Array => {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = f.b0 * x0 + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    y[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return y;
};

/** Sinal com a ponderação K (o que se mede antes de tirar o LUFS). */
export const ponderacaoK = (amostras: Float32Array, taxa: number) => filtrar(filtrar(amostras, prateleiraAlta(taxa)), passaAltas(taxa));

/** Os dois biquads da ponderação K, em ordem (prateleira e passa-altas), para quem filtra aos pedaços (loudness.ts). */
export const coeficientesK = (taxa: number): [Biquad, Biquad] => [prateleiraAlta(taxa), passaAltas(taxa)];

/** Envelope de um áudio decodificado: potência média por janela (somada entre canais, como o BS.1770) em dB. */
export const envelopeDeAmostras = (canais: Float32Array[], taxa: number, janela_ms = JANELA_MS): Envelope => {
  const n = canais[0]?.length ?? 0;
  const porJanela = Math.max(1, Math.round((taxa * janela_ms) / 1000));
  const janelas = Math.ceil(n / porJanela);
  const soma = new Float64Array(janelas);
  for (const canal of canais) {
    const k = ponderacaoK(canal, taxa);
    for (let i = 0; i < n; i++) soma[Math.floor(i / porJanela)] += k[i] * k[i];
  }
  const db = new Array<number>(janelas);
  for (let j = 0; j < janelas; j++) {
    const amostras = Math.min(porJanela, n - j * porJanela);
    const potencia = soma[j] / Math.max(1, amostras);
    db[j] = potencia > 0 ? Math.max(SILENCIO_DB, Math.round((-0.691 + 10 * Math.log10(potencia)) * 10) / 10) : SILENCIO_DB;
  }
  return {versao: VERSAO_ENVELOPE, janela_ms, duracao_ms: Math.round((n / taxa) * 1000), db};
};

/** Envelope inteiro e na versão atual; o da versão 1 (0.3.0) não passa, para ser medido de novo com a conta nova. */
export const ehEnvelope = (e: unknown): e is Envelope => {
  const o = e as Partial<Envelope> | null;
  const f = o?.fonte as Partial<FonteDoEnvelope> | undefined;
  return Boolean(o && o.versao === VERSAO_ENVELOPE && typeof o.janela_ms === 'number' && o.janela_ms > 0 && typeof o.duracao_ms === 'number' && Array.isArray(o.db)
    && (f === undefined || (typeof f === 'object' && f !== null && typeof f.tamanho === 'number' && (f.modificado_ms === undefined || typeof f.modificado_ms === 'number')
      && (f.sha256 === undefined || typeof f.sha256 === 'string'))));
};

/** O envelope ainda é do arquivo como ele está agora? 'em_dia': mesmo tamanho e mesma data; 'conferir': mesmo tamanho e
 *  outra data (cópia, git clone), e só o sha256 decide; 'velho': outro tamanho, ou envelope sem carimbo. */
export const conferirEnvelope = (env: Envelope, atual: {tamanho: number; modificado_ms: number}): 'em_dia' | 'conferir' | 'velho' => {
  const f = env.fonte;
  if (!f || f.tamanho !== atual.tamanho) return 'velho';
  if (typeof f.modificado_ms === 'number' && Math.floor(f.modificado_ms) === Math.floor(atual.modificado_ms)) return 'em_dia';
  return f.sha256 ? 'conferir' : 'velho';
};

export const mediana = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Nível de referência de uma lista de janelas (dB): mediana do que passa pelas portas absoluta (−70) e relativa
 *  (10 LU abaixo da média de potência), como o BS.1770 faz antes de integrar. null = só silêncio. */
export const referenciaDeJanelas = (db: number[]): number | null => {
  const comSom = db.filter((v) => v > PORTA_ABSOLUTA_DB);
  if (!comSom.length) return null;
  const media = 10 * Math.log10(comSom.reduce((s, v) => s + Math.pow(10, v / 10), 0) / comSom.length);
  const passam = comSom.filter((v) => v >= media - PORTA_RELATIVA_LU);
  return mediana(passam.length ? passam : comSom);
};

/** Janelas do envelope entre dois tempos do arquivo (ms). */
export const janelasEntre = (env: Envelope, de_ms: number, ate_ms: number): number[] => {
  const i0 = Math.max(0, Math.floor(de_ms / env.janela_ms));
  const i1 = Math.min(env.db.length, Math.ceil(ate_ms / env.janela_ms));
  return i1 > i0 ? env.db.slice(i0, i1) : [];
};

export const nivelDeReferencia = (env: Envelope, de_ms = 0, ate_ms = env.duracao_ms) => referenciaDeJanelas(janelasEntre(env, de_ms, ate_ms));

// ---------- ducking ----------
/** Um clipe de voz posto na linha do tempo, com o ganho (faixa × clipe) em dB; sem envelope, conta como voz o tempo todo. */
export type TrechoDeVoz = {em: number; duracao_ms: number; corte_ms: number; ganho_db: number; env?: Envelope};

export type ResultadoDucking = {janela_ms: number; ganho: number[]; reducao_db: number; voz_db: number | null; musica_db: number | null; medido: boolean};

/** Ganho da música, janela a janela a partir do começo do clipe dela: 1 sem voz; sob a voz cai `reducao_db`, que é
 *  o quanto falta para a mediana da música ficar `alvo_lu` abaixo da mediana da voz (as duas medidas, com os ganhos
 *  de faixa e clipe). Ataque e soltura são rampas lineares em ms. */
export const calcularDucking = (o: {
  musica: {em: number; duracao_ms: number; corte_ms: number; ganho_db: number; env?: Envelope};
  vozes: TrechoDeVoz[];
  alvo_lu?: number;
  ataque_ms?: number;
  soltura_ms?: number;
  janela_ms?: number;
}): ResultadoDucking => {
  const janela = o.janela_ms ?? JANELA_MS;
  const alvo = limitar(numero(o.alvo_lu, DUCKING_PADRAO.alvo_lu), ALVO_LU_MIN, ALVO_LU_MAX);
  const ataque = Math.max(1, numero(o.ataque_ms, DUCKING_PADRAO.ataque_ms));
  const soltura = Math.max(1, numero(o.soltura_ms, DUCKING_PADRAO.soltura_ms));
  const n = Math.max(1, Math.ceil(o.musica.duracao_ms / janela));

  // referência da voz: mediana de todas as janelas com som dos clipes de voz (cada um com o seu ganho)
  const janelasVoz: number[] = [];
  const vozes = o.vozes.map((v) => {
    const db = v.env ? janelasEntre(v.env, v.corte_ms, v.corte_ms + v.duracao_ms).map((x) => (x > PORTA_ABSOLUTA_DB ? x + v.ganho_db : x)) : [];
    janelasVoz.push(...db);
    const ref = v.env ? referenciaDeJanelas(db) : null;
    return {...v, ref};
  });
  const voz_db = referenciaDeJanelas(janelasVoz);
  const musicaDb = o.musica.env ? nivelDeReferencia(o.musica.env, o.musica.corte_ms, o.musica.corte_ms + o.musica.duracao_ms) : null;
  const musica_db = musicaDb === null ? null : musicaDb + o.musica.ganho_db;
  const medido = voz_db !== null && musica_db !== null;
  // sem medida ainda, supõe níveis típicos (narração a −20, música a −14) até a interface gravar os envelopes
  const refVoz = voz_db ?? VOZ_SEM_MEDIDA_DB;
  const refMusica = musica_db ?? MUSICA_SEM_MEDIDA_DB + o.musica.ganho_db;
  const reducao_db = vozes.length ? Math.max(0, Math.round((refMusica - (refVoz - alvo)) * 10) / 10) : 0;

  const haVozEm = (t: number) => {
    for (const v of vozes) {
      if (t < v.em || t >= v.em + v.duracao_ms) continue;
      if (!v.env) return true;
      const i = Math.floor((v.corte_ms + (t - v.em)) / v.env.janela_ms);
      const db = v.env.db[i];
      if (db === undefined) continue;
      const porta = Math.max(PORTA_ABSOLUTA_DB, (v.ref ?? PORTA_ABSOLUTA_DB + PORTA_VOZ_LU) - PORTA_VOZ_LU);
      if (db + v.ganho_db > porta) return true;
    }
    return false;
  };

  const ganho = new Array<number>(n);
  let p = 0; // presença suavizada, 0 a 1
  const sobe = janela / ataque;
  const desce = janela / soltura;
  for (let k = 0; k < n; k++) {
    const alvoP = reducao_db > 0 && haVozEm(o.musica.em + k * janela + janela / 2) ? 1 : 0;
    p = alvoP > p ? Math.min(alvoP, p + sobe) : Math.max(alvoP, p - desce);
    ganho[k] = reducao_db > 0 ? Math.round(ganhoDeDb(-p * reducao_db) * 1000) / 1000 : 1;
  }
  return {janela_ms: janela, ganho, reducao_db, voz_db, musica_db, medido};
};

// ---------- resolução para as props da composição ----------
export type DuckingP = {ativo: boolean; alvo_lu: number; ataque_ms: number; soltura_ms: number};
export type ClipeAudioP = {
  origem: string;
  id: string;
  arquivo: string;
  nome: string;
  em: number;
  duracao_ms: number;
  corte_ms: number;
  volume: number;
  fade_in_ms: number;
  fade_out_ms: number;
  mudo: boolean;
  fora: boolean; // começa depois do fim do vídeo: não toca
  envelope?: Envelope;
  nivel_db?: number; // mediana do trecho usado, sem ganhos
  ducking?: ResultadoDucking;
};
export type FaixaAudioP = {origem: string; id: string; nome: string; papel: PapelFaixa; volume: number; mudo: boolean; ducking?: DuckingP; clipes: ClipeAudioP[]};
export type AudioP = {faixas: FaixaAudioP[]; alvo_lufs: number; pico_dbtp: number};

const seg = (ms: number) => (ms / 1000).toLocaleString('pt-BR', {maximumFractionDigits: 1});

/** Faixas e clipes nas props, em ms de saída. O que estiver fora do lugar vira aviso, não erro: o vídeo sempre toca.
 *  `envelopes` vem por arquivo (midia/x.wav → o .envelope.json ao lado), quando já medido. */
export const resolverAudio = (audio: AudioCenas | undefined, duracao_video: number, envelopes: Record<string, Envelope | undefined> = {}): {audio?: AudioP; avisos: string[]} => {
  const avisos: string[] = [];
  if (!audio || !Array.isArray(audio.faixas)) return {avisos};
  const faixas: FaixaAudioP[] = audio.faixas.map((f, i): FaixaAudioP => {
    const papel = papelDe(f);
    const nome = typeof f.nome === 'string' && f.nome ? f.nome : PAPEIS[papel].nome_faixa;
    const volume = limitar(numero(f.volume, 1), 0, 1);
    if (numero(f.volume, 1) !== volume) avisos.push(`a faixa "${nome}" tem volume ${String(f.volume)}; vai com ${volume} (o volume vai de 0 a 1)`);
    const clipes = (Array.isArray(f.clipes) ? f.clipes : []).map((c, j): ClipeAudioP => {
      const origem = `/audio/faixas/${i}/clipes/${j}`;
      const env = envelopes[c.arquivo];
      const nomeClipe = nomeDoClipe(c);
      let em = numero(c.em, 0);
      if (em < 0) {
        avisos.push(`o clipe "${nomeClipe}" começa antes do zero (${seg(em)} s); vai para o começo`);
        em = 0;
      }
      let corte_ms = Math.max(0, numero(c.corte_ms, 0));
      let duracao_ms = Math.max(DURACAO_CLIPE_MIN, numero(c.duracao_ms, env?.duracao_ms ?? 1000));
      if (env && corte_ms >= env.duracao_ms) {
        avisos.push(`o corte do clipe "${nomeClipe}" (${seg(corte_ms)} s) passa do fim do arquivo (${seg(env.duracao_ms)} s); volta ao zero`);
        corte_ms = 0;
      }
      if (env && corte_ms + duracao_ms > env.duracao_ms + 1) {
        duracao_ms = Math.max(DURACAO_CLIPE_MIN, env.duracao_ms - corte_ms);
        avisos.push(`o clipe "${nomeClipe}" pedia mais do que o arquivo tem; fica com ${seg(duracao_ms)} s`);
      }
      const fora = em >= duracao_video;
      if (fora) avisos.push(`o clipe "${nomeClipe}" começa em ${seg(em)} s, depois do fim do vídeo (${seg(duracao_video)} s): não toca`);
      else if (em + duracao_ms > duracao_video + 1) avisos.push(`o clipe "${nomeClipe}" passa ${seg(em + duracao_ms - duracao_video)} s do fim do vídeo; o som corta no fim`);
      const volumeClipe = limitar(numero(c.volume, 1), 0, 1);
      const fade_in_ms = limitar(numero(c.fade_in_ms, 0), 0, duracao_ms);
      const fade_out_ms = limitar(numero(c.fade_out_ms, 0), 0, duracao_ms);
      return {
        origem, id: c.id, arquivo: c.arquivo, nome: nomeClipe, em, duracao_ms, corte_ms, volume: volumeClipe, fade_in_ms, fade_out_ms, mudo: Boolean(c.mudo), fora,
        envelope: env, nivel_db: env ? nivelDeReferencia(env, corte_ms, corte_ms + duracao_ms) ?? undefined : undefined,
      };
    });
    const d = f.ducking;
    const ducking: DuckingP | undefined = papel === 'musica'
      ? {ativo: d?.ativo !== false, alvo_lu: limitar(numero(d?.alvo_lu, DUCKING_PADRAO.alvo_lu), ALVO_LU_MIN, ALVO_LU_MAX),
        ataque_ms: Math.max(1, numero(d?.ataque_ms, DUCKING_PADRAO.ataque_ms)), soltura_ms: Math.max(1, numero(d?.soltura_ms, DUCKING_PADRAO.soltura_ms))}
      : undefined;
    return {origem: `/audio/faixas/${i}`, id: f.id, nome, papel, volume, mudo: Boolean(f.mudo), ducking, clipes};
  });

  // ducking: a música cai sob a narração que toca (faixas de voz não mudas, clipes não mudos e dentro do vídeo)
  const vozes: TrechoDeVoz[] = faixas.filter((f) => f.papel === 'voz' && !f.mudo).flatMap((f) =>
    f.clipes.filter((c) => !c.mudo && !c.fora).map((c): TrechoDeVoz => ({em: c.em, duracao_ms: c.duracao_ms, corte_ms: c.corte_ms, ganho_db: dbDeGanho(f.volume * c.volume), env: c.envelope})));
  const semEnvelopeVoz = vozes.filter((v) => !v.env).length;
  for (const f of faixas) {
    if (f.papel !== 'musica' || !f.ducking?.ativo || !vozes.length) continue;
    for (const c of f.clipes) {
      if (c.mudo || c.fora) continue;
      c.ducking = calcularDucking({musica: {em: c.em, duracao_ms: c.duracao_ms, corte_ms: c.corte_ms, ganho_db: dbDeGanho(f.volume * c.volume), env: c.envelope},
        vozes, alvo_lu: f.ducking.alvo_lu, ataque_ms: f.ducking.ataque_ms, soltura_ms: f.ducking.soltura_ms});
      if (!c.envelope) avisos.push(`a música "${c.nome}" ainda não foi medida; o ducking supõe ${MUSICA_SEM_MEDIDA_DB} dB até a interface medir`);
    }
  }
  if (semEnvelopeVoz) avisos.push(`${semEnvelopeVoz === 1 ? 'um clipe de narração ainda não foi medido' : `${semEnvelopeVoz} clipes de narração ainda não foram medidos`}; a música cai o tempo todo sob ${semEnvelopeVoz === 1 ? 'ele' : 'eles'}`);
  // o alvo do arquivo exportado (loudness.ts mede o arquivo final e corrige o ganho até ele)
  const alvo_lufs = limitar(numero(audio.alvo_lufs, ALVO_LUFS_PADRAO), ALVO_LUFS_MIN, ALVO_LUFS_MAX);
  if (audio.alvo_lufs !== undefined && numero(audio.alvo_lufs, NaN) !== alvo_lufs) avisos.push(`o alvo de loudness ${String(audio.alvo_lufs)} LUFS está fora de ${ALVO_LUFS_MIN} a ${ALVO_LUFS_MAX}; vai com ${alvo_lufs}`);
  const pico_dbtp = limitar(numero(audio.pico_dbtp, PICO_DBTP_PADRAO), PICO_DBTP_MIN, PICO_DBTP_MAX);
  if (audio.pico_dbtp !== undefined && numero(audio.pico_dbtp, NaN) !== pico_dbtp) avisos.push(`o pico máximo ${String(audio.pico_dbtp)} dBTP está fora de ${PICO_DBTP_MIN} a ${PICO_DBTP_MAX}; vai com ${pico_dbtp}`);
  return {audio: {faixas, alvo_lufs, pico_dbtp}, avisos};
};

/** Fator dos fades em `t_ms` desde o começo do clipe (0 a 1). */
export const fatorFades = (c: {duracao_ms: number; fade_in_ms: number; fade_out_ms: number}, t_ms: number) => {
  const entrada = c.fade_in_ms > 0 ? limitar(t_ms / c.fade_in_ms, 0, 1) : 1;
  const saida = c.fade_out_ms > 0 ? limitar((c.duracao_ms - t_ms) / c.fade_out_ms, 0, 1) : 1;
  return entrada * saida;
};

/** Volume do clipe em `t_ms` desde o começo dele: faixa × clipe × fades × ducking, entre 0 e 1. É o que a composição
 *  passa ao Html5Audio a cada quadro e o que a linha do tempo desenha sobre a forma de onda. */
export const volumeDoClipe = (f: {volume: number; mudo: boolean}, c: ClipeAudioP, t_ms: number) => {
  if (f.mudo || c.mudo) return 0;
  const duck = c.ducking ? c.ducking.ganho[limitar(Math.floor(t_ms / c.ducking.janela_ms), 0, c.ducking.ganho.length - 1)] ?? 1 : 1;
  return limitar(f.volume * c.volume * fatorFades(c, t_ms) * duck, 0, 1);
};
