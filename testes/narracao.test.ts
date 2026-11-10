// Narração por IA, núcleo puro e provedores (docs/narracao.md): o formato exato do pedido de cada provedor contra um HTTP
// falso, PCM → WAV, LINEAR16, erros em pt-BR (chave recusada, API desativada, cota, voz), pronúncias, pausas, hash do cache,
// estado das cenas, a fala na faixa de voz (com ducking), o ajuste da duração das cenas e a estimativa de custo.
import {createHash} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import jsonpatch, {type Operation} from 'fast-json-patch';
import {envelopeDeAmostras} from '../src/nucleo/audio';
import {novoDocCenas, resolverCenas, type DocCenas} from '../src/nucleo/cenas';
import {aplicarPronuncias, amostrasDoWav16, configDaNarracao, ErroNarracao, erroDoGoogle, hashDaFala, lerWav16, medirFala, problemasDaNarracao, textoFalado, wavDaResposta,
  wavDePcm16} from '../src/nucleo/narracao';
import {ajustarCenasAFala, itensDaNarracao, patchDasFalas} from '../src/nucleo/narracao-cenas';
import {corpoCloudTts, sintetizarCloudTts, vozesCloudTts} from '../src/nucleo/narracao-cloud-tts';
import {corpoGemini, sintetizarGemini, vozesGemini} from '../src/nucleo/narracao-gemini';
import {sha256Texto} from '../src/nucleo/sha256';
import {custoNarracao} from '../src/main/ia/precos';
import {base64, CHAVE_GEMINI, CHAVE_TTS, criarGoogleFalso, pcmSeno} from './fixtures/narracao-falsa';

const aplicar = (doc: DocCenas, patch: unknown[]) => jsonpatch.applyPatch(structuredClone(doc), patch as Operation[], true, false).newDocument as DocCenas;
const docBase = (): DocCenas => ({
  ...novoDocCenas({largura: 1080, altura: 1920, fps: 30}),
  cenas: [
    {id: 'c1', duracao_ms: 4000, blocos: [], narracao: {texto: 'Bem-vindo ao treinamento do PIN.'}},
    {id: 'c2', duracao_ms: 3000, blocos: [], narracao: {texto: 'Fale com o RH [pausa] antes de bater o ponto.'}},
    {id: 'c3', duracao_ms: 2000, blocos: []},
  ],
});

describe('sha256 puro', () => {
  it('bate com o node:crypto em textos curtos, longos, acentuados e nas bordas do bloco', () => {
    for (const t of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'b'.repeat(64), 'ç'.repeat(200), 'Fale com o RH 🎙️ agora', 'x'.repeat(10000)]) {
      expect(sha256Texto(t)).toBe(createHash('sha256').update(t, 'utf8').digest('hex'));
    }
  });
});

describe('PCM → WAV e LINEAR16', () => {
  it('põe o cabeçalho WAV de 16 bits, 24 kHz, mono em volta do PCM cru, e lê de volta', () => {
    const pcm = pcmSeno(1000);
    const wav = wavDePcm16(pcm, 24000);
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF');
    const v = new DataView(wav.buffer);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(24000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(pcm.length);
    expect(wav.length).toBe(44 + pcm.length);
    expect(lerWav16(wav)).toEqual({taxa: 24000, canais: 1, inicio: 44, bytes: pcm.length});
    const a = amostrasDoWav16(wav)!;
    expect(a.canais[0].length).toBe(24000);
    expect(Math.max(...a.canais[0])).toBeCloseTo(0.25, 2);
  });

  it('a resposta em WAV fica como veio; a em audio/L16 ganha o cabeçalho com a taxa do mimeType', () => {
    const pcm = pcmSeno(500, 16000);
    const comCabecalho = wavDePcm16(pcm, 16000);
    expect(wavDaResposta(comCabecalho, 'audio/wav')).toMatchObject({wav: comCabecalho, taxa: 16000, duracao_ms: 500});
    const cru = wavDaResposta(pcm, 'audio/L16;codec=pcm;rate=16000');
    expect(cru.taxa).toBe(16000);
    expect(cru.duracao_ms).toBe(500);
    expect(lerWav16(cru.wav)?.bytes).toBe(pcm.length);
    expect(wavDaResposta(pcmSeno(1000), undefined).taxa).toBe(24000); // sem taxa: 24 kHz, o padrão dos dois
    expect(() => wavDaResposta(new TextEncoder().encode('RIFF quebrado......................................'), 'audio/wav')).toThrow(ErroNarracao);
  });

  it('WAV gravado em fluxo (data com tamanho 0) vale até o fim do arquivo', () => {
    const wav = wavDePcm16(pcmSeno(200), 24000);
    new DataView(wav.buffer).setUint32(40, 0, true);
    expect(lerWav16(wav)?.bytes).toBe(wav.length - 44);
  });
});

describe('Gemini TTS: o pedido e a resposta', () => {
  it('generateContent com a chave no cabeçalho, AUDIO, voz e estilo à parte do texto', async () => {
    const g = criarGoogleFalso();
    const r = await sintetizarGemini({chave: CHAVE_GEMINI, modelo: 'gemini-3.8-flash-tts', voz: 'Kore', texto: 'Olá <short pause> mundo', estilo: 'calmo e didático', fetch: g.fetch});
    const p = g.pedidos[0];
    expect(p.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent');
    expect(p.metodo).toBe('POST');
    expect(p.cabecalhos['x-goog-api-key']).toBe(CHAVE_GEMINI);
    expect(p.url).not.toContain(CHAVE_GEMINI); // a chave fica fora da URL
    expect(p.corpo).toEqual({
      contents: [{role: 'user', parts: [{text: 'Olá <short pause> mundo', speech_metadata: {style: 'calmo e didático'}}]}],
      generationConfig: {responseModalities: ['AUDIO'], speechConfig: {voiceConfig: {voice: 'Kore'}}},
    });
    expect(lerWav16(r.wav)).toMatchObject({taxa: 24000, canais: 1});
    expect(r.duracao_ms).toBeGreaterThan(300);
    expect(r.uso).toEqual({entrada: 20, saida: 100});
    expect(r.formato).toBe('doc-3.8');
  });

  it('sem estilo, a parte vai só com o texto; o PCM cru dos modelos anteriores vira WAV', async () => {
    const g = criarGoogleFalso({gemini: 'l16'});
    const r = await sintetizarGemini({chave: CHAVE_GEMINI, modelo: 'gemini-3.8-flash-lite-tts', voz: 'Puck', texto: 'Teste', fetch: g.fetch});
    expect(g.pedidos[0].corpo.contents[0].parts[0]).toEqual({text: 'Teste'});
    expect(String.fromCharCode(...r.wav.subarray(0, 4))).toBe('RIFF');
    expect(r.taxa).toBe(24000);
  });

  it('campo novo recusado (400 "Unknown name"): pede de novo no formato anterior (prebuiltVoiceConfig e estilo antes do texto)', async () => {
    let primeira = true;
    const g = criarGoogleFalso({respostas: [(p) => {
      if (!p.url.includes(':generateContent') || !primeira) return undefined;
      primeira = false;
      return new Response(JSON.stringify({error: {code: 400, message: 'Invalid JSON payload received. Unknown name "voice" at \'generation_config.speech_config.voice_config\'', status: 'INVALID_ARGUMENT'}}), {status: 400});
    }]});
    const r = await sintetizarGemini({chave: CHAVE_GEMINI, modelo: 'gemini-3.8-flash-tts', voz: 'Kore', texto: 'Oi', estilo: 'animado', fetch: g.fetch});
    expect(r.formato).toBe('anterior');
    expect(g.pedidos).toHaveLength(2);
    expect(g.pedidos[1].corpo).toEqual(corpoGemini({voz: 'Kore', texto: 'Oi', estilo: 'animado'}, true));
    expect(g.pedidos[1].corpo.generationConfig.speechConfig.voiceConfig).toEqual({prebuiltVoiceConfig: {voiceName: 'Kore'}});
    expect(g.pedidos[1].corpo.contents[0].parts[0].text).toBe('animado:\nOi');
  });

  it('sem áudio na resposta: diz o motivo', async () => {
    const g = criarGoogleFalso({respostas: [() => Response.json({candidates: [{finishReason: 'SAFETY', content: {parts: []}}]})]});
    await expect(sintetizarGemini({chave: CHAVE_GEMINI, modelo: 'gemini-3.8-flash-tts', voz: 'Kore', texto: 'x', fetch: g.fetch})).rejects.toThrow(/não devolveu áudio \(motivo: SAFETY\)/);
  });

  it('chave recusada: erro em pt-BR, do tipo "chave", sem a chave no texto', async () => {
    const g = criarGoogleFalso();
    const e = await sintetizarGemini({chave: 'AIzaERRADA0000', modelo: 'gemini-3.8-flash-tts', voz: 'Kore', texto: 'x', fetch: g.fetch}).catch((x) => x);
    expect(e).toBeInstanceOf(ErroNarracao);
    expect(e.tipo).toBe('chave');
    expect(e.message).toMatch(/a chave do Gemini foi recusada pelo Google/);
    expect(e.message).not.toContain('AIzaERRADA0000');
  });

  it('vozes: as 30 prontas e as da biblioteca estendida em português', async () => {
    const g = criarGoogleFalso();
    const r = await vozesGemini({chave: CHAVE_GEMINI, fetch: g.fetch});
    expect(r.vozes).toHaveLength(31);
    expect(r.vozes.find((v) => v.id === 'Kore')).toMatchObject({descricao: 'firme', genero: 'feminina'});
    expect(r.vozes.at(-1)).toMatchObject({id: 'voz-estendida-1', nome: 'Bia', genero: 'feminina'});
    expect(g.pedidos[0].url).toContain('/voices?language_code=pt-BR');
    expect((await vozesGemini({})).vozes).toHaveLength(30); // sem chave, sem rede
  });
});

describe('Google Cloud TTS (Chirp 3: HD): o pedido e a resposta', () => {
  it('text:synthesize com LINEAR16, voz pt-BR e speakingRate; texto puro sem pausa', async () => {
    const g = criarGoogleFalso();
    const r = await sintetizarCloudTts({chave: CHAVE_TTS, voz: 'pt-BR-Chirp3-HD-Charon', texto: 'Bom dia.', velocidade: 1.1, fetch: g.fetch});
    const p = g.pedidos[0];
    expect(p.url).toBe('https://texttospeech.googleapis.com/v1/text:synthesize');
    expect(p.cabecalhos['x-goog-api-key']).toBe(CHAVE_TTS);
    expect(p.corpo).toEqual({input: {text: 'Bom dia.'}, voice: {languageCode: 'pt-BR', name: 'pt-BR-Chirp3-HD-Charon'}, audioConfig: {audioEncoding: 'LINEAR16', speakingRate: 1.1}});
    expect(lerWav16(r.wav)).toMatchObject({taxa: 24000, canais: 1}); // LINEAR16 já vem com o cabeçalho WAV
  });

  it('com pausa do Chirp, vai em markup; velocidade fora da faixa é cortada', () => {
    expect(corpoCloudTts({voz: 'v', texto: 'Um [pause long] dois', velocidade: 5})).toMatchObject({input: {markup: 'Um [pause long] dois'}, audioConfig: {speakingRate: 2}});
  });

  it('mais de 5000 bytes: recusa antes de ir ao Google', async () => {
    const g = criarGoogleFalso();
    await expect(sintetizarCloudTts({chave: CHAVE_TTS, voz: 'v', texto: 'ã'.repeat(2600), fetch: g.fetch})).rejects.toThrow(/5000/);
    expect(g.pedidos).toHaveLength(0);
  });

  it('vozes: só as Chirp 3: HD, ordenadas; chave recusada lança "chave"', async () => {
    const g = criarGoogleFalso();
    const r = await vozesCloudTts({chave: CHAVE_TTS, fetch: g.fetch});
    expect(r.vozes.map((v) => v.id)).toEqual(['pt-BR-Chirp3-HD-Charon', 'pt-BR-Chirp3-HD-Kore']);
    expect(g.pedidos[0].url).toBe('https://texttospeech.googleapis.com/v1/voices?languageCode=pt-BR');
    await expect(vozesCloudTts({chave: 'errada-123456', fetch: g.fetch})).rejects.toMatchObject({tipo: 'chave'});
  });

  it('sem rede: erro "rede" em pt-BR, sem a chave', async () => {
    const f = (async () => {
      throw new TypeError(`fetch failed ${CHAVE_TTS}`);
    }) as typeof fetch;
    const e = await sintetizarCloudTts({chave: CHAVE_TTS, voz: 'v', texto: 'oi', fetch: f}).catch((x) => x);
    expect(e.tipo).toBe('rede');
    expect(e.message).toMatch(/sem internet/);
    expect(e.message).not.toContain(CHAVE_TTS);
  });
});

describe('erros do Google em pt-BR', () => {
  const corpo = (code: number, message: string, status = '', reason?: string) => JSON.stringify({error: {code, message, status, ...(reason ? {details: [{reason}]} : {})}});
  it('chave, API desativada, cota, voz, modelo e serviço', () => {
    expect(erroDoGoogle(400, corpo(400, 'API key not valid.', 'INVALID_ARGUMENT', 'API_KEY_INVALID'), {provedor: 'google-tts'}).tipo).toBe('chave');
    const d = erroDoGoogle(403, corpo(403, 'Cloud Text-to-Speech API has not been used in project 123 before or it is disabled.', 'PERMISSION_DENIED', 'SERVICE_DISABLED'), {provedor: 'google-tts'});
    expect(d.tipo).toBe('desativada');
    expect(d.message).toContain('texttospeech.googleapis.com');
    expect(erroDoGoogle(429, corpo(429, 'Quota exceeded', 'RESOURCE_EXHAUSTED'), {provedor: 'gemini'})).toMatchObject({tipo: 'cota'});
    const v = erroDoGoogle(400, corpo(400, "Voice 'pt-BR-Chirp3-HD-Nada' does not exist."), {provedor: 'google-tts', voz: 'pt-BR-Chirp3-HD-Nada'});
    expect(v.tipo).toBe('voz');
    expect(v.message).toMatch(/a voz "pt-BR-Chirp3-HD-Nada" não existe/);
    expect(erroDoGoogle(404, corpo(404, 'models/xyz is not found'), {provedor: 'gemini', modelo: 'xyz'})).toMatchObject({tipo: 'modelo'});
    expect(erroDoGoogle(503, 'fora do ar', {provedor: 'gemini'})).toMatchObject({tipo: 'servico'});
    expect(erroDoGoogle(401, corpo(401, `chave ${CHAVE_GEMINI} ruim`), {provedor: 'gemini', chave: CHAVE_GEMINI}).message).not.toContain(CHAVE_GEMINI);
  });
});

describe('pronúncias e pausas', () => {
  const dic = [{de: 'PIN', para: 'pin'}, {de: 'RH', para: 'erre agá'}, {de: 'ctps', para: 'cê tê pê esse'}, {de: 'CLT', para: 'cê ele tê'}, {de: 'CLT-A', para: 'cê ele tê a'},
    {de: '%', para: ' por cento'}];
  it('palavra inteira, sigla só na mesma caixa, minúsculas em qualquer caixa, a mais longa primeiro e sem trocar duas vezes', () => {
    const r = aplicarPronuncias('O PIN do RH; a pinça; rh minúsculo; CTPS e Ctps; CLT-A e CLT; 10% no RHS.', dic);
    expect(r.texto).toBe('O pin do erre agá; a pinça; rh minúsculo; cê tê pê esse e cê tê pê esse; cê ele tê a e cê ele tê; 10 por cento no RHS.');
    expect(r.trocas.find((t) => t.de === 'ctps')?.vezes).toBe(2);
    expect(aplicarPronuncias('A B', [{de: 'A', para: 'B'}, {de: 'B', para: 'C'}]).texto).toBe('B C'); // uma passada só
    expect(aplicarPronuncias('ação AÇÃO', [{de: 'ação', para: 'x'}]).texto).toBe('x x'); // acento conta como letra
    expect(aplicarPronuncias('texto', []).texto).toBe('texto');
  });

  it('o texto final leva as pausas no formato de cada provedor', () => {
    const gem = configDaNarracao({provedor: 'gemini', pronuncias: dic});
    const chirp = configDaNarracao({provedor: 'google-tts', pronuncias: dic});
    expect(textoFalado('Fale  com o RH [pausa] e [pausa longa] depois.', gem)).toBe('Fale com o erre agá <short pause> e <long pause> depois.');
    expect(textoFalado('Fale com o RH [pausa] e [pausa longa] depois.', chirp)).toBe('Fale com o erre agá [pause short] e [pause long] depois.');
    expect(textoFalado('Oi <short pause> tudo <laugh> bem', chirp)).toBe('Oi [pause short] tudo bem');
    expect(textoFalado('Oi [pause long] tchau', gem)).toBe('Oi <long pause> tchau');
  });
});

describe('cache: o hash do pedido', () => {
  it('muda com o texto, a voz, o modelo e o estilo no Gemini; a velocidade só conta no Cloud TTS', () => {
    const g = configDaNarracao({voz: 'Kore'});
    const h = hashDaFala('Olá', g);
    expect(h).toMatch(/^[0-9a-f]{20}$/);
    expect(hashDaFala('Olá', g)).toBe(h);
    expect(hashDaFala('Olá!', g)).not.toBe(h);
    expect(hashDaFala('Olá', {...g, voz: 'Puck'})).not.toBe(h);
    expect(hashDaFala('Olá', {...g, estilo: 'animado'})).not.toBe(h);
    expect(hashDaFala('Olá', {...g, modelo: 'gemini-3.8-flash-lite-tts'})).not.toBe(h);
    expect(hashDaFala('Olá', {...g, velocidade: 1.5})).toBe(h);
    const c = configDaNarracao({provedor: 'google-tts', voz: 'Kore'});
    expect(c.voz).toBe('pt-BR-Chirp3-HD-Kore');
    expect(hashDaFala('Olá', {...c, velocidade: 1.5})).not.toBe(hashDaFala('Olá', c));
    expect(hashDaFala('Olá', {...c, estilo: 'animado'})).toBe(hashDaFala('Olá', c));
    expect(hashDaFala('Olá', c)).not.toBe(h);
  });
});

describe('estado de cada cena: sem texto, a gerar, gerada, desatualizada', () => {
  it('segue o texto, as pronúncias, a voz e o arquivo', () => {
    let doc = docBase();
    const itens = itensDaNarracao(doc);
    expect(itens.map((i) => i.estado)).toEqual(['pendente', 'pendente', 'sem_texto']);
    expect(itens[1].texto_final).toBe('Fale com o RH <short pause> antes de bater o ponto.');
    const p = patchDasFalas(doc, itens.slice(0, 2).map((i) => ({cena: i.cena, arquivo: i.arquivo!, duracao_ms: 2000, hash: i.hash!})));
    doc = aplicar(doc, p.patch);
    expect(itensDaNarracao(doc).map((i) => i.estado)).toEqual(['gerada', 'gerada', 'sem_texto']);
    // pronúncia nova que pega a cena 2: só ela desatualiza
    doc = {...doc, narracao: {pronuncias: [{de: 'RH', para: 'erre agá'}]}};
    expect(itensDaNarracao(doc).map((i) => i.estado)).toEqual(['gerada', 'desatualizada', 'sem_texto']);
    // texto da cena 1 muda
    doc.cenas[0].narracao = {texto: 'Bem-vindo!'};
    expect(itensDaNarracao(doc)[0].estado).toBe('desatualizada');
    // o arquivo sumiu do disco
    const so1 = aplicar(docBase(), patchDasFalas(docBase(), [{cena: 'c1', arquivo: itens[0].arquivo!, duracao_ms: 1000, hash: itens[0].hash!}]).patch);
    expect(itensDaNarracao(so1, () => false)[0]).toMatchObject({estado: 'desatualizada', motivo: expect.stringContaining('não está mais no projeto')});
    expect(itensDaNarracao(so1, () => true)[0].estado).toBe('gerada');
  });

  it('a medida estima caracteres, segundos e tokens de áudio (25 por segundo)', () => {
    const m = medirFala('Fale com o RH antes de bater o ponto.', configDaNarracao({}));
    expect(m.caracteres).toBe(37);
    expect(m.palavras).toBe(9);
    expect(m.segundos).toBeGreaterThan(3);
    expect(m.tokens_saida).toBe(Math.ceil(m.segundos * 25));
    expect(medirFala('a b c', configDaNarracao({provedor: 'google-tts', velocidade: 2})).segundos).toBeLessThan(medirFala('a b c', configDaNarracao({})).segundos);
  });
});

describe('a fala na faixa de voz', () => {
  it('sem som: cria as três faixas e a fala entra na de narração, no começo da cena mais a folga', () => {
    const doc = docBase();
    const [i1, i2] = itensDaNarracao(doc);
    const r = patchDasFalas(doc, [{cena: 'c1', arquivo: i1.arquivo!, duracao_ms: 2500, hash: i1.hash!}, {cena: 'c2', arquivo: i2.arquivo!, duracao_ms: 1800, hash: i2.hash!}]);
    const d = aplicar(doc, r.patch);
    const voz = d.audio!.faixas.find((f) => f.papel === 'voz')!;
    expect(voz.clipes).toEqual([
      {id: 'fala-1', arquivo: i1.arquivo, em: 300, duracao_ms: 2500, nome: 'Fala da cena 1', narracao_ia: {cena: 'c1', hash: i1.hash}},
      {id: 'fala-2', arquivo: i2.arquivo, em: 4300, duracao_ms: 1800, nome: 'Fala da cena 2', narracao_ia: {cena: 'c2', hash: i2.hash}},
    ]);
    expect(d.audio!.faixas.find((f) => f.papel === 'musica')?.ducking?.ativo).toBe(true);
    expect(r.avisos).toEqual([]);
  });

  it('a narração gravada pela pessoa fica onde está: as falas vão para uma faixa nova "Narração IA"; gerar de novo troca o clipe e mantém o id', () => {
    const doc: DocCenas = {...docBase(), narracao: {folga_ms: 0}, audio: {faixas: [{id: 'narracao', nome: 'Narração', papel: 'voz', clipes: [{id: 'gravada', arquivo: 'midia/eu.wav', em: 0, duracao_ms: 5000}]}]}};
    const [i1] = itensDaNarracao(doc);
    const d1 = aplicar(doc, patchDasFalas(doc, [{cena: 'c1', arquivo: i1.arquivo!, duracao_ms: 5000, hash: i1.hash!}]).patch);
    expect(d1.audio!.faixas[0].clipes).toHaveLength(1);
    expect(d1.audio!.faixas[1]).toMatchObject({id: 'narracao-ia-1', nome: 'Narração IA', papel: 'voz', clipes: [{id: 'fala-1', em: 0}]});
    // texto novo: o mesmo clipe com o arquivo novo
    d1.cenas[0].narracao = {texto: 'Outro texto.'};
    const [n1] = itensDaNarracao(d1);
    const r2 = patchDasFalas(d1, [{cena: 'c1', arquivo: n1.arquivo!, duracao_ms: 1200, hash: n1.hash!}]);
    const d2 = aplicar(d1, r2.patch);
    expect(d2.audio!.faixas[1].clipes).toEqual([{id: 'fala-1', arquivo: n1.arquivo, em: 0, duracao_ms: 1200, nome: 'Fala da cena 1', narracao_ia: {cena: 'c1', hash: n1.hash}}]);
    expect(r2.clipes[0]).toMatchObject({id: 'fala-1', novo: false});
  });

  it('avisa quando a fala passa do fim da cena', () => {
    const doc = docBase();
    const [, i2] = itensDaNarracao(doc);
    expect(patchDasFalas(doc, [{cena: 'c2', arquivo: i2.arquivo!, duracao_ms: 3500, hash: i2.hash!}]).avisos[0]).toMatch(/fala da cena 2 .* passa do fim da cena/);
  });

  it('a música que já existe cai sob a voz gerada (ducking medido com o envelope do WAV)', () => {
    const doc: DocCenas = {...docBase(), audio: {faixas: [
      {id: 'musica', nome: 'Música', papel: 'musica', ducking: {ativo: true, alvo_lu: 20}, clipes: [{id: 'm1', arquivo: 'midia/trilha.wav', em: 0, duracao_ms: 9000}]},
    ]}};
    const [i1] = itensDaNarracao(doc);
    const d = aplicar(doc, patchDasFalas(doc, [{cena: 'c1', arquivo: i1.arquivo!, duracao_ms: 2000, hash: i1.hash!}]).patch);
    const voz = amostrasDoWav16(wavDePcm16(pcmSeno(2000), 24000))!;
    const musica = amostrasDoWav16(wavDePcm16(pcmSeno(9000), 24000))!;
    const envelopes = {[i1.arquivo!]: envelopeDeAmostras(voz.canais, voz.taxa), 'midia/trilha.wav': envelopeDeAmostras(musica.canais, musica.taxa)};
    const m = resolverCenas(d, {envelopes}).props.audio!.faixas.find((f) => f.papel === 'musica')!.clipes[0];
    expect(m.ducking?.medido).toBe(true);
    expect(m.ducking!.reducao_db).toBeGreaterThan(10);
    const g = m.ducking!.ganho;
    expect(g[Math.floor(1000 / m.ducking!.janela_ms)]).toBeLessThan(0.5); // sob a fala (0,3 s a 2,3 s)
    expect(g[Math.floor(6000 / m.ducking!.janela_ms)]).toBe(1); // depois dela
  });
});

describe('ajustar a duração das cenas à fala', () => {
  const comFalas = () => {
    const doc: DocCenas = {...docBase(), audio: {faixas: [
      {id: 'musica', nome: 'Música', papel: 'musica', clipes: [{id: 'm1', arquivo: 'midia/trilha.wav', em: 0, duracao_ms: 9000}]},
    ]}};
    const [i1, i2] = itensDaNarracao(doc);
    return aplicar(doc, patchDasFalas(doc, [{cena: 'c1', arquivo: i1.arquivo!, duracao_ms: 2000, hash: i1.hash!}, {cena: 'c2', arquivo: i2.arquivo!, duracao_ms: 4000, hash: i2.hash!}]).patch);
  };

  it('cada cena com fala dura folga + fala + margem; as falas vão para o começo das cenas novas', () => {
    const doc = comFalas();
    const r = ajustarCenasAFala(doc);
    expect(r.mudancas.map((m) => [m.n, m.antes_ms, m.depois_ms])).toEqual([[1, 4000, 2800], [2, 3000, 4800]]);
    const d = aplicar(doc, r.patch);
    expect(d.cenas.map((c) => c.duracao_ms)).toEqual([2800, 4800, 2000]);
    const falas = d.audio!.faixas.flatMap((f) => f.clipes).filter((c) => c.narracao_ia);
    expect(falas.map((c) => [c.narracao_ia!.cena, c.em])).toEqual([['c1', 300], ['c2', 3100]]);
    expect(itensDaNarracao(d).every((i) => !i.clipe || i.clipe.em + i.clipe.duracao_ms <= i.t_out)).toBe(true);
    // a música andou com as cenas (a mesma conta de quando a pessoa muda a duração): o total segue o vídeo novo
    expect(resolverCenas(d).avisos.filter((a) => /fora do vídeo/.test(a))).toEqual([]);
    // de novo: nada a fazer
    expect(ajustarCenasAFala(d).patch).toEqual([]);
  });

  it('apenas_alongar só cresce as curtas; margem própria; cenas escolhidas', () => {
    const doc = comFalas();
    expect(ajustarCenasAFala(doc, {apenas_alongar: true}).mudancas.map((m) => m.n)).toEqual([2]);
    expect(ajustarCenasAFala(doc, {margem_ms: 0, cenas: ['1']}).mudancas).toEqual([{cena: 'c1', n: 1, antes_ms: 4000, depois_ms: 2300, fala_ms: 2000}]);
  });

  it('o patch passa pelo Projeto sem o ajuste do som mexer de novo (já mexe em /audio)', () => {
    const doc = comFalas();
    const r = ajustarCenasAFala(doc);
    expect(r.patch.some((o) => o.path === '/audio')).toBe(true);
  });
});

describe('custo estimado (src/main/ia/precos.ts)', () => {
  const m = {tokens_entrada: 1_000_000, tokens_saida: 1_000_000, caracteres: 1_000_000};
  it('Gemini Flash e Flash-Lite dobram em 01/01/2027; Cloud TTS por caractere', () => {
    expect(custoNarracao('gemini', 'gemini-3.8-flash-tts', m, new Date('2026-11-10'))?.usd).toBeCloseTo(9.5);
    expect(custoNarracao('gemini', 'gemini-3.8-flash-tts', m, new Date('2027-01-01T12:00:00Z'))?.usd).toBeCloseTo(19);
    expect(custoNarracao('gemini', 'gemini-3.8-flash-lite-tts', m, new Date('2026-12-31T12:00:00Z'))?.usd).toBeCloseTo(6.5);
    expect(custoNarracao('gemini', 'gemini-3.8-flash-lite-tts', m, new Date('2027-02-01'))?.usd).toBeCloseTo(13);
    const c = custoNarracao('google-tts', 'chirp3-hd', {tokens_entrada: 0, tokens_saida: 0, caracteres: 1000});
    expect(c?.usd).toBeCloseTo(0.03);
    expect(c?.nota).toMatch(/1 milhão de caracteres grátis/);
    expect(c?.tabela).toBe('10/11/2026');
    expect(custoNarracao('gemini', 'modelo-desconhecido', m)).toBeUndefined();
  });

  it('um minuto de fala no Flash custa perto de US$ 0,014 (60 s × 25 tokens × US$ 9/M)', () => {
    expect(custoNarracao('gemini', 'gemini-3.8-flash-tts', {tokens_entrada: 0, tokens_saida: 1500, caracteres: 0}, new Date('2026-11-10'))?.usd).toBeCloseTo(0.0135, 4);
  });
});

describe('validação no resolvedor: campo fora do lugar vira aviso', () => {
  it('provedor, velocidade, pronúncias, campos desconhecidos e clipe de cena que não existe', () => {
    const doc = {...docBase(), narracao: {provedor: 'azure', velocidade: 9, pronuncias: [{de: 'PIN'}], cor: 'azul'}} as unknown as DocCenas;
    doc.cenas[0].narracao = {texto: 'oi', voz: 'x'} as never;
    doc.cenas[1].narracao = 'texto solto' as never;
    doc.audio = {faixas: [{id: 'v', nome: 'Narração', papel: 'voz', clipes: [{id: 'f', arquivo: 'midia/narracao/x.wav', em: 0, duracao_ms: 1000, narracao_ia: {cena: 'sumiu', hash: 'h'}}]}]};
    const avisos = problemasDaNarracao(doc);
    expect(avisos.join('\n')).toMatch(/campo desconhecido "cor"/);
    expect(avisos.join('\n')).toMatch(/provedor "azure" não existe/);
    expect(avisos.join('\n')).toMatch(/"velocidade" 9 fora de 0.25 a 2/);
    expect(avisos.join('\n')).toMatch(/1 pronúncia sem "de" e "para"/);
    expect(avisos.join('\n')).toMatch(/campo desconhecido "voz" na narração da cena 1/);
    expect(avisos.join('\n')).toMatch(/narração da cena 2 é \{texto\}/);
    expect(avisos.join('\n')).toMatch(/cena "sumiu", que não existe mais/);
    const r = resolverCenas(doc);
    expect(r.avisos.filter((a) => a.startsWith('Narração:'))).toHaveLength(avisos.length);
    expect(r.props.cenas).toHaveLength(3); // o vídeo toca
    expect(problemasDaNarracao(docBase())).toEqual([]);
  });

  it('configuração com padrões e limites', () => {
    expect(configDaNarracao(undefined)).toEqual({provedor: 'gemini', modelo: 'gemini-3.8-flash-tts', voz: 'Charon', estilo: '', velocidade: 1, folga_ms: 300, margem_ms: 500, pronuncias: []});
    expect(configDaNarracao({provedor: 'google-tts', modelo: 'x', velocidade: 0.1, folga_ms: -5})).toMatchObject({modelo: 'chirp3-hd', voz: 'pt-BR-Chirp3-HD-Charon', velocidade: 0.25, folga_ms: 0});
    expect(configDaNarracao({voz: 'pt-BR-Chirp3-HD-Kore'}).voz).toBe('Kore');
  });

  it('base64 das respostas', () => {
    expect(Array.from(new Uint8Array(Buffer.from(base64(new Uint8Array([0, 255, 7])), 'base64')))).toEqual([0, 255, 7]);
  });
});
