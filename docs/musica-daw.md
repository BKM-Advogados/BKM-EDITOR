# Música: o que falta para uma DAW completa

## 1) Resumo

O Estúdio tem um motor de música próprio em TypeScript puro. Ele renderiza a música inteira offline e roda igual amostra a amostra na janela, no worker, no processo principal e no MCP stdio. Tem um kit 808 sintetizado de 10 peças, 4 presets de um sintetizador, mixer com EQ de 3 bandas, compressor, 2 retornos fixos (reverb e delay), limitador, sidechain por notas, automação só de volume, piano roll simples, MIDI e exportação com loudness. O MCP de música já cobre bastante coisa.

O FL Studio é outra categoria. Tem samplers multi-zona com round robin (DirectWave, FPC), dezenas de sintetizadores e mais de 80 efeitos. Tem mixer com 500 faixas, 10 inserts por faixa, roteamento livre e PDC. Automatiza quase todo parâmetro. Tem gravação de áudio e MIDI, time-stretch (Newtime/Newtone), ASIO e hospeda VST/VST3/AU/CLAP.

A falta estrutural é o motor. Ele processa buffers inteiros e não tem processadores por bloco, tempo real, grafo de roteamento nem cache que escale. Pelas contas, 24 faixas de 5 min passam de 5 GB.

O teste do metal falhou por quatro faltas concretas: não há distorção nem IR de gabinete, não há sampler (portanto nem bateria acústica), não há guitarra e não há bend nem articulação por nota.

Quase tudo cabe na D1. Só ficam fora dela ASIO/E/S nativa, VST3/CLAP, plugins GPL de terceiros, Ableton Link e o Estúdio como plugin.

## 2) Decisões de arquitetura a tomar primeiro

Cada decisão vira um ADR em `docs/` antes da onda M1.

### A1. Rever a D1?

- **Opção 1: manter a D1 estrita.** Prós: o render é idêntico em todo lugar e a segurança é simples. Contras: nunca haverá VST/CLAP, ASIO nem latência profissional para monitorar guitarra no Windows.
- **Opção 2: D1 revisada em duas camadas.** O render canônico (vídeo, exportação, MCP) continua só TS/WASM. Código nativo entra só na periferia, em processo separado, com a saída congelada em WAV (freeze) para voltar a ser reproduzível. Prós: abre o caminho de mercado sem perder a ligação viva com o vídeo. Contras: um projeto com plugin nativo só renderiza no MCP stdio se estiver congelado. Traz também assinatura, notarização e sandbox no Mac.
- **Opção 3: abandonar a D1.** Contras: perde a garantia central do produto.
- **Recomendação: opção 2, decidida agora como princípio, implementada só na onda M8.** Até lá, tudo dentro da D1.

### A2. Modelo do motor

- **Opção 1: manter o render do buffer inteiro e acrescentar render progressivo por trechos.** Barato, mas não dá tempo real, PDC, automação geral nem memória limitada.
- **Opção 2: grafo de processadores por bloco**, com interface `processar(entradas, saídas, n)`, estado explícito e latência declarada. O mesmo grafo roda em laço offline (worker, main, stdio) e dentro de um AudioWorklet.
- **Recomendação: opção 2.** Une EM-01, MD1, INT-01, SEQ-18, EM-11 e MD2 num item só (M-01 e M-06 abaixo). O motor atual fica como oráculo de teste durante a migração.

### A3. TypeScript ou WASM para o DSP

- **Opção 1: tudo em TS.** Build simples. Mas Math.sin, exp e tanh dependem da versão do V8, e o custo de amp com oversampling 8x e convolução em 4 a 8 guitarras não foi medido.
- **Opção 2: tudo em Rust para WASM.** Determinismo sem V8 e desempenho. Mas pede reescrita total e o build ganha `cargo` e `wasm-pack`.
- **Opção 3: TS no geral e WASM nos nós quentes** (amp, convolução, reamostragem, stretch, NAM), decidido por benchmark.
- **Recomendação: opção 3, com um portão de medição na onda M0.** O teste é 5 min, 4 guitarras, amp 8x, IR de 200 ms e um alvo de RTF. Matemática transcendental própria (aproximações ou tabelas) em TS e em WASM. Sem relaxed-SIMD.

### A4. Contrato de determinismo

- **Recomendação: duas classes.**
  - **Canônico:** offline, bloco fixo, mesmo código ou `.wasm`, soma em ordem fixa, denormais tratados no código. Verificado por hash SHA-256 do PCM na janela, no main e no stdio.
  - **Prévia viva:** worklet, knob mexido na hora, entrada de áudio. Declarada "aproximada". Um botão "ouvir como no render" toca o canônico.
- Corrige a SEQ-18, que marcava `exige_rever_D1` erradamente. Tempo real em worklet não fere a D1, só muda a garantia.

### A5. Plugins

- **Opção 1: nenhum.**
- **Opção 2: Web Audio Modules 2.0.** Supõe AudioWorklet e não roda no Node do MCP.
- **Opção 3: formato próprio de módulo em WASM.** `init(taxa)`, `processar(bloco)`, parâmetros declarados, estado em JSON, manifesto com licença e hash. Roda nos 4 ambientes.
- **Opção 4: VST3/CLAP nativos.** Precisa da A1, opção 2.
- **Recomendação: opção 3 agora (N-07) e opção 4 depois, em ADR próprio (N-08), começando por CLAP.** O WAM fica só como referência de API.

### A6. Licença do próprio Estúdio e política de dependências

- Hoje o `package.json` tem `private: true` e o repo não tem LICENSE.
- **Recomendação: registrar a política.**
  - Embutidas: MIT, BSD, Apache-2.0, CC0 e CC-BY (com crédito por `musica-licencas.ts`).
  - LGPL: só em módulo separado e substituível, com parecer.
  - GPL e AGPL fora do bundle e do WASM. Isso exclui Surge XT, Vital, Dexed, Dragonfly, Guitarix, Rubber Band, JUCE sem licença comercial e PyFLP como código.
- Isto vem antes de escolher qualquer biblioteca.

### A7. Conteúdo: embarcar ou baixar

- **Recomendação: um pacote base pequeno no instalador e as bibliotecas por download sob demanda.**
  - Pacote base: kit acústico mínimo, IRs próprios e 10 a 20 presets, tudo CC0 próprio.
  - Bibliotecas: manifesto, SHA-256, SPDX e crédito.
- Sem som acústico embarcado, o app não pode dizer que faz metal.

### A8. Isolamento de origem (SharedArrayBuffer)

- O worklet com parâmetros sem bloqueio e o multicore pedem COOP/COEP.
- **Recomendação: testar na M0** se o servidor de mídia, o Player do Remotion e as fontes funcionam com `credentialless` ou CORP.
- Se quebrar, a M5 usa MessagePort e o multicore (M-09) fica adiado.

## 3) Lacunas deduplicadas

Prioridade: E = essencial, I = importante, D = desejável. Complexidade: P, M, G, GG. Os ids das pesquisas originais vão entre colchetes. ⚠D1 marca o que exige rever a D1.

| id | área | item | prio | cx | depende de |
|---|---|---|---|---|---|
| M-01 | motor | Grafo de processadores por bloco, com estado, latência declarada e N entradas/saídas (multi-out, sidechain) [EM-01, MD1, INT-01] | E | GG | M-02, M-03 |
| M-02 | motor | Esquema versionado, migradores puros e endereço único de parâmetro (`faixa/efeito/param`) para automação, MIDI learn, MCP e UI [crítica] | E | M | — |
| M-03 | motor | Contrato de determinismo em duas classes e hashes de referência nos 4 ambientes [MD15] | E | M | — |
| M-04 | motor | Orçamento de memória, cache em disco com LRU e carga preguiçosa de amostras [MD6, INS-16] | E | G | M-01 |
| M-05 | motor | Núcleo WASM para os nós quentes, com matemática própria e sem relaxed-SIMD [MD3] | E | G | M-01, A3 |
| M-06 | motor | Reprodução em tempo real em AudioWorklet com o mesmo grafo [MD2, EM-11, SEQ-18] | E | G | M-01 |
| M-07 | motor | PDC automático e track delay manual [MD4, EM-12] | E | M | M-01 |
| M-08 | motor | Freeze, bounce e consolidar (faixa, padrão, seleção) [MD7, EM-21] | I | M | M-01, M-04 |
| M-09 | motor | Multicore (pool de workers, soma em ordem fixa) [MD8] | I | G | M-01, M-06, A8 |
| M-10 | motor | Render fora do event loop do MCP, com progresso, cancelamento e WAV em streaming [MD16] | I | M | M-01 |
| M-11 | motor | Reamostragem de qualidade (Hermite e sinc com janela) [MD17] | I | M | M-01 |
| M-12 | motor | Carga de CPU, underruns, buffer configurável, smart disable [MD14] | I | M | M-06 |
| M-13 | motor | Proteção contra NaN/Inf, DC e clip de segurança só na saída ao vivo [MD19] | D | P | M-06 |
| M-14 | motor | FFT e STFT comuns, extraídas de `limpeza-voz.ts` (hoje a única FFT em `src/nucleo`) | E | P | — |
| M-15 | motor | Sandbox de módulos WASM e modelos baixados (hash, sem rede/fs, tetos) [crítica] | I | M | N-07 |
| I-01 | instrumentos | Instrumento genérico com registro, alocador de vozes (polifonia, roubo, mono/legato, glide) e estéreo por voz [INS-01, MD9] | E | G | M-01, M-02 |
| I-02 | instrumentos | Sampler de uma amostra (raiz, loop, ADSR, filtro, velocidade) [INS-02] | E | M | I-01, M-11 |
| I-03 | instrumentos | Sampler multi-zona com camadas, round robin por semente, grupos de corte e import SFZ/SF2 [INS-03, INT-10] | E | G | I-02, M-04 |
| I-04 | instrumentos | Bateria acústica por amostras: peças definidas pelo kit, mapa GM 35-81, multi-mic com saídas para o mixer [INS-04, SEQ-16] | E | G | I-03, X-02, F-02 |
| I-05 | instrumentos | Fonte de guitarra (Karplus-Strong estendido) com afinação por corda (drop, 7 e 8 cordas, A4 ajustável) [INS-05, crítica] | E | G | I-01, S-01 |
| I-06 | instrumentos | Articulações: palm mute, pinch, bend, vibrato, slide, legato, tremolo, strum e power chord [INS-07] | E | G | I-05, S-01 |
| I-07 | instrumentos | Baixo elétrico com divisão limpo/drive [INS-06] | I | M | I-05, X-03 |
| I-08 | instrumentos | Subtrativo completo (3 osciladores, unison, 2 SVF, LFOs, matriz, presets da pessoa) [INS-08] | I | M | I-01 |
| I-09 | instrumentos | FM/RM de 4 a 6 operadores, escrito do zero (sem Dexed) [INS-09] | I | G | I-08 |
| I-10 | instrumentos | Wavetable (sem FL nativo confirmado; incerto) [INS-10] | D | G | I-08, M-14 |
| I-11 | instrumentos | Aditivo e ressíntese [INS-11] | D | GG | I-01, M-14 |
| I-12 | instrumentos | Fatiador (Slicex) [INS-12] | I | M | I-03, M-14 |
| I-13 | instrumentos | Granular [INS-13] | D | M | I-02 |
| I-14 | instrumentos | Rompler, banco GM e orquestral (teclas e cordas do black metal sinfônico) [INS-14] | I | G | I-03, F-01 |
| I-15 | instrumentos | Camadas e split (Layer, Patcher de instrumento) [INS-18] | D | M | I-01 |
| I-16 | instrumentos | Percussão sintetizada com parâmetros expostos e membrana [INS-19] | D | M | I-01 |
| I-17 | instrumentos | UI dos instrumentos: editor, teclado, pads, mapeador de zonas, pré-escuta [INS-17] | E | G | I-01 |
| X-01 | mixer | Cadeia de inserts por faixa (ordem, bypass, mix, cache por prefixo) [EM-02] | E | M | M-01, M-02 |
| X-02 | mixer | Roteamento em DAG: buses, envios pré/pós, retornos genéricos, multi-out, sidechain por áudio [EM-03, crítica] | E | G | X-01, M-07 |
| X-03 | mixer | Distorção e amp de alto ganho com oversampling (pré tight, triodos, tone stack, power amp) [EM-04, INS-05 amp, MD11] | E | G | X-01, M-05 |
| X-04 | mixer | Convolução particionada (IR de gabinete e reverb) [EM-05, MD12] | E | M | X-01, M-14, M-07 |
| X-05 | mixer | Noise gate e expansor com sidechain [EM-06] | E | P | X-01, X-02 |
| X-06 | mixer | EQ paramétrico de até 8 bandas, 12-48 dB/oit, M/S (fase linear depois) [EM-07] | E | M | X-01 |
| X-07 | mixer | Compressor completo (joelho, RMS, lookahead, mix) e sidechain por áudio [EM-08] | E | M | X-01, X-02 |
| X-08 | mixer | Automação de qualquer parâmetro (curvas, LFO, seguidor de envelope) [EM-09, SEQ-11, MD10, FI-14] | E | G | X-01, M-02 |
| X-09 | mixer | Medidores e análise: LUFS por faixa, RMS, espectro, correlação, vectorscope [EM-10, FI-02 parte] | I | M | M-14 |
| X-10 | mixer | Utilitário de canal: polaridade, troca L/R, largura M/S, trim [EM-13] | I | P | X-01 |
| X-11 | mixer | Transient shaper [EM-14] | I | P | X-01 |
| X-12 | mixer | Reverb algorítmico (Dattorro/FDN) como processador [EM-15] | I | M | X-01, X-02 |
| X-13 | mixer | Delay completo como insert [EM-16] | I | P | X-01 |
| X-14 | mixer | Chorus, flanger, phaser, tremolo [EM-17] | I | M | X-01 |
| X-15 | mixer | Filtros como efeito e wah [EM-18] | I | P | X-01, X-08 |
| X-16 | mixer | Multibanda, soft clipper, limitador de master e dither TPDF com semente [EM-19] | I | M | X-07, X-03 |
| X-17 | mixer | Presets de cadeia, A/B, rack e matriz na UI; MCP `efeitos`, `rotear`, `automatizar`, `criar_faixa` [EM-20, FI-17] | E | M | X-01, X-02, X-08 |
| X-18 | mixer | Organização: grupos, VCA, cores, ordem, seleção múltipla [crítica] | D | M | X-02 |
| X-19 | mixer | Vocoder [EM-23] | D | M | X-02 |
| X-20 | mixer | Gross Beat-like, frequency shifter, de-esser, EQ dinâmico, Patcher [EM-24] | D | M | X-02, X-08 |
| S-01 | sequência | Nota estendida: id, pan, pitch_cents, curva de bend, art, legato, slide, mudo, rel [SEQ-01, INT-18] | E | M | M-02 |
| S-02 | sequência | Mapa de andamento e de compasso; MIDI import/export com vários tempos [SEQ-02] | E | G | M-02 |
| S-03 | sequência | Piano roll em canvas: ghost notes, editor de eventos, slide, laço, slice/glue; 20 mil notas fluidas [SEQ-07, crítica] | E | G | S-01 |
| S-04 | sequência | Step sequencer avançado: passos livres, ratchet, shift, swing por canal, padrões de tamanhos distintos (polimetria) [SEQ-09, crítica] | I | M | S-01, S-02 |
| S-05 | sequência | Playlist: faixas livres, clipes de automação, make unique, chop, vários arranjos [SEQ-10] | E | G | S-01, X-08 |
| S-06 | sequência | Ferramentas: strum, arpejador, randomize, flam, chop, articulação, riff [SEQ-08] | I | M | S-01 |
| S-07 | sequência | CC, pitch bend, aftertouch e program change no modelo e no MIDI [SEQ-17] | I | M | S-01, X-08 |
| S-08 | sequência | Marcadores de ação, loop de seleção, pré-roll, punch, contagem [SEQ-12] | I | M | S-02 |
| S-09 | sequência | Time-stretch e pitch de clipes, cacheados em disco [SEQ-04, EM-22, FI-15] | E | G | S-02, M-05, M-14 |
| S-10 | sequência | Onsets, BPM e warp markers [SEQ-05] | I | G | S-09 |
| S-11 | sequência | Correção de afinação monofônica (YIN e PSOLA) [SEQ-06] | D | G | S-09 |
| S-12 | sequência | Editor de áudio estilo Edison [SEQ-15] | I | G | S-09, M-14 |
| S-13 | sequência | Performance mode [SEQ-13] | D | G | M-06, S-05 |
| S-14 | sequência | Takes e comping [SEQ-14] | D | M | N-02, S-05 |
| S-15 | sequência | Tablatura: entrada por corda/casa e import GP/MusicXML (alphaTab, MPL-2.0) [FI-16, crítica] | I | G | S-01, I-05 |
| S-16 | sequência | Áudio para MIDI polifônico (Basic Pitch, Apache-2.0) [crítica] | D | G | M-14 |
| N-01 | integração | Entrada Web MIDI: tocar, gravar, CC64, bend; liberar `midi` em `janela-segura.ts:94` [INT-02, MD18] | E | M | M-06 |
| N-02 | integração | Gravação de áudio multipista, monitoramento, latência por loopback, punch [INT-05, SEQ-03, MD5] | E | G | M-06, M-07 |
| N-03 | integração | Saída de áudio (`setSinkId`), latencyHint, latência exibida [INT-06] | I | P | M-06 |
| N-04 | integração | MIDI learn por projeto e global, pickup [INT-03] | I | M | N-01, X-08 |
| N-05 | integração | MIDI out e clock mestre/escravo [INT-04] | I | M | N-01, M-06 |
| N-06 | integração | E/S nativa de baixa latência (ASIO, WASAPI exclusivo, JACK) ⚠D1 [INT-07, MD5] | I | GG | M-06, A1 |
| N-07 | integração | Formato de módulo da casa em WASM [INT-08, FI-08 alternativa] | I | G | M-01, M-05 |
| N-08 | integração | Hospedar CLAP/VST3 (AU no Mac) em processo separado ⚠D1 [INT-09, INS-20, EM-25, SEQ-19, MD13, FI-08] | I | GG | M-01, M-07, M-08, A1 |
| N-09 | integração | Oferecer plugins livres de terceiros (baixar o binário oficial) ⚠D1 [INT-12] | I | M | N-08, N-10 |
| N-10 | integração | Licenças estendidas (plugin, preset, amostra, IR, modelo NAM), NOTICE e SBOM [INT-11] | I | M | — |
| N-11 | integração | Troca e entrega: DAWproject, import de stems, FLAC/MP3, 44,1 a 96 kHz, float32, render de seleção [INT-13, crítica] | I | M | S-05 |
| N-12 | integração | Import .flp (só referência, sem código GPL) [INT-14] | D | G | N-11 |
| N-13 | integração | Superfícies de controle por perfil JSON [INT-15] | D | M | N-04, N-05 |
| N-14 | integração | Controle remoto pela LAN e OSC [INT-16] | D | M | N-04 |
| N-15 | integração | Ableton Link (o FL não tem) ⚠D1 [INT-17] | D | M | M-06, A1 |
| N-16 | integração | Estúdio como plugin CLAP/VST3 ⚠D1 [INT-19] | D | GG | N-08 |
| N-17 | integração | Conteúdo online com licença (API do Freesound, NC filtrado) [INT-20] | D | M | F-01, N-10 |
| N-18 | integração | Separação de stems por IA no onnxruntime-web, sem nativo [INT-21, FI-03] | D | G | N-11 |
| F-01 | fluxo | Navegador de samples, presets e kits com pré-escuta, tags, busca; MCP `listar_instrumentos`, `carregar_instrumento`, `buscar_amostra` [INS-15, FI-06, INT-10] | E | G | I-03, N-10 |
| F-02 | fluxo | Pacote de conteúdo base embarcado (kit acústico, IRs próprios, presets) [crítica] | E | M | N-10 |
| F-03 | fluxo | MCP de composição por gênero: `gerar_riff`, `gerar_bateria` (blast, d-beat, gallop, breakdown polirrítmico), `gerar_estrutura`, modos [FI-01] | E | G | I-04, I-06, S-02, S-04 |
| F-04 | fluxo | Escuta do Claude: `analisar_trecho`, espectrograma em PNG, `verificar_musica` [FI-05] | E | M | M-14, X-09 |
| F-05 | fluxo | Mix e master assistidos, comparação com referência [FI-02] | I | G | F-04, X-16 |
| F-06 | fluxo | Modelos de gênero e "salvar como modelo" [FI-09] | I | M | F-03, X-17 |
| F-07 | fluxo | Histórico navegável, versões nomeadas, autosave (retenção do diário não verificada) [FI-10] | I | M | — |
| F-08 | fluxo | Painéis acopláveis (dockview MIT) e Channel Rack [FI-11] | I | G | — |
| F-09 | fluxo | Atalhos configuráveis e paleta de comandos [FI-12] | D | M | — |
| F-10 | fluxo | Tutoriais e projetos de exemplo [FI-13] | D | M | F-06 |
| F-11 | fluxo | Geração de áudio por IA, como fonte externa [FI-04] | D | GG | N-07, N-10 |
| F-12 | fluxo | Backup e colaboração (via git) [FI-18] | D | G | F-07 |
| F-13 | qualidade | Suíte de aceitação sonora: renders de referência, análise espectral automática, roteiro de audição humana [crítica] | E | M | M-14 |

## 4) Roadmap em ondas

As ondas vêm ordenadas por dependência e, entre itens livres, por valor para o teste do metal. "Sonnet" é para itens de escopo fechado, com padrão já existente e teste claro. "Opus" é para arquitetura, DSP fino, migração com garantia byte a byte e decisões de licença.

### Onda M0: decisões e fundações baratas
- **Objetivo:** fechar as decisões A1 a A8 e reduzir o risco de som antes de investir.
- **Itens:** ADRs A1-A8; M-02, M-03, M-14, F-13 (parte automática); N-10 (política e campos). Mais uma **espícula de som** fora do app: KS + amp + IR num script vitest, renderizando um riff de 30 s, para validar a qualidade de ouvido e medir o RTF (portão da A3). Mais o teste de COOP/COEP (A8).
- **Pronto quando:** os ADRs estiverem aprovados pelo dono. Os hashes de referência dos documentos atuais batem nos 4 ambientes. A FFT é um módulo comum com teste. A espícula tem áudio ouvido e aprovado, e o RTF está registrado.
- **Sonnet:** M-14, F-13 (hashes), N-10 (campos). **Opus:** ADRs, M-02, M-03, espícula.

### Onda M1: motor por blocos
- **Objetivo:** trocar o coração sem mudar o som.
- **Itens:** M-01, M-04, M-07, M-11. Migração de EQ, compressor, Freeverb, delay e limitador para processadores. M-05 só se a espícula reprovar o TS.
- **Pronto quando:** os documentos antigos dão hash idêntico. A exceção é compressor e limitador (o lookahead vira latência), que ficam dentro de uma tolerância aprovada pelo dono. Uma música de 5 min e 24 faixas cabe no orçamento do `docs/desempenho.md`. O PDC alinha as faixas num teste de impulso.
- **Sonnet:** migração de cada efeito para processador, com teste de oráculo. **Opus:** M-01, M-04, M-07, M-05.

### Onda M2: instrumentos e notas
- **Objetivo:** ter um sampler e um modelo de nota que aguentem guitarra e bateria.
- **Itens:** I-01, S-01, S-02, I-02, I-03, F-02 (kit acústico mínimo), F-01 fase 1 (catálogo e MCP, sem UI), I-17 fase 1 (editor de parâmetros).
- **Pronto quando:** um SFZ do MuldjordKit (CC-BY-4.0) toca com round robin idêntico nos 4 ambientes. A bateria e o sintetizador atuais migram para a interface de instrumento com hash igual. Mudanças de compasso e andamento renderizam e exportam no MIDI.
- **Sonnet:** parser SFZ (opcodes principais), F-02, migração do MIDI para vários tempos. **Opus:** I-01, S-02 (transversal), I-03 (zonas e semente).

### Onda M3: mixer de verdade
- **Objetivo:** inserts, buses e automação geral.
- **Itens:** X-01, X-02, X-05, X-06, X-07, X-08, X-04, X-10, X-11, X-13, X-17.
- **Pronto quando:** dá para montar pelo MCP um bus de bateria com compressão paralela, dois retornos de reverb, gate com sidechain por áudio e automação do corte de um filtro. Documento antigo soa igual. Mexer no slot 5 não refaz os slots 1 a 4.
- **Sonnet:** X-05, X-06, X-10, X-11, X-13, as ferramentas MCP de X-17, a UI do rack. **Opus:** X-02 (DAG, multi-out, sidechain), X-08, X-04 (partição e latência).

### Onda M4: metal
- **Objetivo:** passar o teste Satyricon + Meshuggah.
- **Itens:** X-03, I-04, I-05, I-06, I-07, S-04, F-03, F-04, X-09, X-16 (limitador e dither), X-12. Presets de cadeia: "rítmica high gain", "solo", "bus de bateria", "master metal".
- **Pronto quando:** o Claude, só pelo MCP, produz 3 a 4 min com guitarras dobradas L/R, bateria acústica com blast e double bass, solo com bends e delay automatizado, e um breakdown polirrítmico. A suíte F-13 passa. O dono ouve e aprova contra uma referência.
- **Sonnet:** estilos de bateria em `musica-estilos.ts`, X-09, presets, F-04 (PNG e métricas). **Opus:** X-03, I-05, I-06, I-04 (multi-mic), F-03.

### Onda M5: tempo real e gravação
- **Objetivo:** tocar e gravar como numa DAW.
- **Itens:** M-06, N-01, N-02, N-03, M-08, M-12, M-13, N-04, S-07, S-08.
- **Pronto quando:** um teclado MIDI toca o sintetizador com latência exibida. Gravar uma guitarra DI pelo amp com o offset medido por loopback deixa o take alinhado em até 1 ms. Uma faixa congelada toca do disco e invalida pelo hash.
- **Sonnet:** N-03, M-13, S-08, a UI de MIDI. **Opus:** M-06, N-02, M-12.

### Onda M6: edição e arranjo
- **Objetivo:** paridade de fluxo com o Piano roll e o Playlist do FL.
- **Itens:** S-03, S-05, S-06, S-09, S-10, S-12, F-07, F-08, F-01 fase 2 (UI do navegador), S-15.
- **Pronto quando:** um riff de 20 mil notas edita sem travar. Um loop importado acompanha o BPM. Clipes de automação aparecem no Playlist.
- **Sonnet:** S-06, F-07, F-08, partes de S-12. **Opus:** S-03 (desempenho), S-09 (stretch determinístico), S-05.

### Onda M7: amplitude
- **Objetivo:** catálogo de instrumentos e efeitos de DAW comercial.
- **Itens:** I-08, I-09, I-12, I-14, X-14, X-15, X-16 (multibanda), F-05, F-06, N-11, M-09, M-10, N-07, M-15.
- **Pronto quando:** um MIDI GM importado soa completo. Há exportação em FLAC e MP3 e ida e volta em DAWproject. O render de 5 min com 30 faixas usa vários núcleos com hash igual.
- **Sonnet:** I-08, X-14, X-15, F-06, N-11 (formatos). **Opus:** I-09, M-09, N-07, M-15, F-05.

### Onda M8: ecossistema (condicionada à A1)
- **Objetivo:** plugins nativos e E/S profissional.
- **Itens:** N-08 (CLAP primeiro), N-06, N-09, N-05, N-13, N-15.
- **Pronto quando:** um plugin CLAP carrega em processo isolado, a latência entra no PDC, o estado fica no documento e a faixa congela para o MCP stdio. Um plugin que trava não derruba o app.
- **Opus:** tudo, exceto os perfis de N-13 (sonnet).

### Onda M9: desejáveis
- I-10, I-11, I-13, I-15, I-16, X-18, X-19, X-20, S-11, S-13, S-14, S-16, N-12, N-14, N-16, N-17, N-18, F-09, F-10, F-11, F-12. Escolher pelo uso real.

## 5) O que destrava o teste do metal

| Necessidade | Itens | Onda |
|---|---|---|
| Guitarra distorcida | I-05 (fonte KS e afinação drop/7-8 cordas), X-03 (amp com oversampling), X-04 (IR de gabinete), X-05 (gate), X-06 (PA e PB contra o fizz), dobra L/R por semente, X-02 (bus de guitarras) | M2 a M4 |
| Bateria acústica | I-03 (sampler SFZ), I-04 (kit de metal multi-mic, mapa GM), M-04 (memória), F-02 (kit embarcado), X-11 (clique do bumbo), X-07 (compressão paralela), estilos blast, d-beat e gallop | M2 a M4 |
| Solos | S-01 (bend por nota), I-06 (vibrato, legato, pinch, slide), X-08 (automação do envio de delay e do wah), X-12 e X-13 | M2 a M4 |
| Breakdown | S-02 (andamento e compasso), S-04 (padrões de tamanhos distintos sobre 4/4), I-06 (palm mute), X-05 (corte seco), F-03 (`gerar_riff` com agrupamentos 3+3+3+3+4) | M2 e M4 |
| Mix | X-02 (buses), X-06, X-07, X-16 (limitador e dither), X-09 e F-04 (o Claude "ouve" por métricas), F-13 (aceitação) | M3 e M4 |
| Base de tudo | M-01, M-02, M-03, M-07, I-01 | M0 a M2 |

O teste passa ao fim da **M4**. A espícula da M0 diz cedo se o KS e o amp em TS soam aceitáveis. Se não soarem, há dois planos B, ambos dentro da D1:

- NAM em WASM (neural-amp-modeler-wasm ou @opendaw/nam-wasm, MIT a conferir) como nó da X-03, com RTF e determinismo medidos.
- Gravar guitarra real (N-02, antecipada) e reamplificar pela X-03 e X-04.

## 6) Riscos e licenças

### Riscos técnicos
- **Reescrita do motor (M-01):** quebra os testes byte a byte. O compressor e o limitador mudam de algoritmo. A mitigação é o oráculo, a migração nó a nó e uma tolerância aprovada.
- **Memória:** o modelo atual é O(faixas × duração). São 414 MB medidos com 60 s e mais de 5 GB calculados para 24 faixas de 5 min. Bibliotecas multi-mic somam GB. A M-04 vem antes da I-04.
- **Determinismo:** depende da versão do V8 enquanto houver Math.sin, exp ou tanh do motor JS. Atualizar o Electron pode mudar hashes. Round robin, humanização e granular só com `geradorDe`. O NAM usa Eigen e funções transcendentais: é idêntico só no mesmo binário, e o custo não foi medido.
- **Desempenho:** amp 8x em 4 a 8 guitarras, IR e multibanda numa música de 5 min. O re-render estimado (não medido) é de segundos a dezenas de segundos sem M-04, M-08 e M-09.
- **Latência no Chromium:** sem ASIO, e com o WASAPI compartilhado não medido aqui, monitorar guitarra pelo amp pode não servir no Windows. Medir antes da N-06.
- **COOP/COEP:** pode quebrar o servidor de mídia, o Player do Remotion e as fontes. Testar na M0.
- **Qualidade subjetiva:** o som até hoje foi conferido só por medida. Metal convincente exige audição com referência (F-13).
- **Segurança:** módulos WASM, modelos .nam e IRs baixados precisam de hash e sandbox. Plugins nativos rodam fora da sandbox do Electron e, no Mac, pedem `disable-library-validation` no auxiliar. Controle pela LAN tira o app do 127.0.0.1.
- **Áreas sobrepostas:** havia de 2 a 6 cópias de vários itens nas pesquisas. A tabela acima é a fonte única.

### Licenças (conferir o LICENSE de cada item antes de adotar)
- **Seguras para embutir (a confirmar):** CLAP SDK (MIT), NeuralAmpModelerCore (MIT), sfizz (BSD-2, a conferir), spessasynth_core (Apache-2.0, a conferir), fft.js (MIT), PFFFT (tipo BSD), rustfft/realfft (MIT/Apache), Signalsmith Stretch (MIT), libsamplerate e speexdsp (BSD), Basic Pitch (Apache-2.0), dockview (MIT), cpal, miniaudio, PortAudio, RtMidi.
- **VST3 SDK:** relicenciado como MIT na versão 3.8 (out./nov. 2025), segundo librearts.org e o portal da Steinberg. Incerto, conferir a data e o escopo. O ASIO continua a confirmar: a pesquisa cita GPLv3 ou proprietário, e a relicença também é citada.
- **Condicionais:** alphaTab (MPL-2.0, ok como dependência), SoundTouch e soundtouchjs (LGPL, só em módulo separado, com parecer), LSP (LGPL-3.0).
- **Proibidas no bundle enquanto o Estúdio for fechado:** Surge XT, Vital, Dexed, Dragonfly, Guitarix, Hydrogen (GPL), Rubber Band (GPL ou comercial), JUCE (AGPLv3 ou comercial), Ableton Link (GPLv2+ ou comercial), FluidSynth (LGPL-2.1, delicada), PyFLP (GPL-3, só leitura de referência).
- **Conteúdo:**
  - DrumGizmo MuldjordKit e DRSKit: CC-BY-4.0, conferir restrições extras do DRSKit.
  - Karoryfer: CC0 ou CC-BY por pacote.
  - VSCO-2 CE: acredita-se CC0, conferir.
  - Salamander: licença incerta.
  - Não se achou kit CC0 de metal nem banco livre de guitarra multi-sample bom.
  - IRs "free" sem licença explícita ficam fora.
  - Cada modelo .nam tem licença própria.
- **IA:** pesos do MusicGen CC-BY-NC. Stable Audio Open na Stability Community License, com limite de receita. Pesos do Demucs a conferir. Nada disso foi verificado nesta rodada.

### Incertezas sobre o FL
- O FL não tem ASIO como item à parte: o driver "FL Studio ASIO" é dele.
- Estes parecem ausentes no FL, mas sem negação oficial: MPE, Ableton Link, DAWproject, AAF, wavetable nativo dedicado e amp moderno de alto ganho.
- O FL Slayer está "deprecated" no manual.
- O máximo de passos do Channel Rack aparece como 64 numa página e 512 em outra.
- Itens do menu Tools do piano roll além da Riff Machine, Consolidate como freeze, o Gopher 2026 e a contagem do FL Cloud vêm de memória ou de imprensa.
- Fica a verificar no código: se o piano roll é só do sintetizador e qual a retenção do diário.

## 7) Fontes

### Image-Line (oficiais)
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/generator_plugins.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/effects_plugins.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/DirectWave.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/FPC.htm
- https://www.image-line.com/fl-studio-news/fpc-layer-randomization
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/FL%20Slayer.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/mixer.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/mixer_trackprops.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Hardcore.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Distructor.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Fruity%20Parametric%20EQ%202.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Fruity%20Limiter.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-beta-online-manual/html/plugins/Maximus.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Wave%20Candy.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/pianoroll.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/playlist.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/channelrack.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/recording_audio.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Newtone.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Newtime.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/Edison_2.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/envsettings_audio.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/envsettings_midi.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/automation_linking.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/fformats_save_export.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/plugins/wrapper.htm
- https://www.image-line.com/fl-studio-learning-content/fl-studio-online-manual/html/plugins_supported.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/rewire.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/envsettings_files.htm
- https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/menu_file.htm
- https://www.image-line.com/fl-studio/compare
- https://www.image-line.com/fl-studio-news/fl-studio-2025-whats-new-2
- https://www.image-line.com/fl-studio-news/fl-studio-2025-2
- https://www.image-line.com/fl-cloud/faq
- https://www.image-line.com/blog/more-plugins-and-sounds-in-fl-cloud
- Fórum: https://forum.image-line.com/viewtopic.php?t=98559, ?p=1863571 (Link), ?p=2030818 (MPE), ?p=2067040 (stems)

### Terceiros
- https://sfzinstruments.github.io/drums
- https://github.com/sfzinstruments/DrumGizmo.MuldjordKit
- https://freepats.zenvoid.org/Percussion/acoustic-drum-kit.html
- https://www.tone3000.com/blog/introducing-the-nam-web-player
- https://www.tone3000.com/blog/opendaw-now-supports-tone3000
- https://steinbergmedia.github.io/vst3_dev_portal/pages/VST+3+Licensing/VST3+License
- https://librearts.org/2025/11/steinberg-relicenses-vst3-and-asio/
- https://www.bitwig.com/stories/transferring-projects-between-bitwig-studio-and-other-daws-333
- https://github.com/webaudiomodules/api
- https://github.com/ircam-ismm/node-web-audio-api
- https://tracker.debian.org/media/packages/a/ableton-link/copyright-3.1.2dfsg-1
- https://pyflp.readthedocs.io/en/latest/reference/plugins/vst.html
- Imprensa (FL Cloud, Gopher): musictech.net, djmag.com, mixmag.net, musicradar.com, attackmagazine.com

### Código e docs do Estúdio
- /home/laures/Projects/estudio/src/nucleo/musica-som.ts
- /home/laures/Projects/estudio/src/nucleo/musica.ts
- /home/laures/Projects/estudio/src/nucleo/musica-midi.ts
- /home/laures/Projects/estudio/src/nucleo/midi.ts
- /home/laures/Projects/estudio/src/nucleo/musica-licencas.ts
- /home/laures/Projects/estudio/src/nucleo/musica-entrega.ts
- /home/laures/Projects/estudio/src/nucleo/musica-estilos.ts
- /home/laures/Projects/estudio/src/nucleo/musica-teoria.ts
- /home/laures/Projects/estudio/src/nucleo/musica-modelos.ts
- /home/laures/Projects/estudio/src/nucleo/musica-acoes.ts
- /home/laures/Projects/estudio/src/nucleo/mcp-musica.ts
- /home/laures/Projects/estudio/src/nucleo/loudness.ts
- /home/laures/Projects/estudio/src/nucleo/limpeza-voz.ts
- /home/laures/Projects/estudio/src/renderer/modulos/musica/render.worker.ts
- /home/laures/Projects/estudio/src/renderer/modulos/musica/motor.ts
- /home/laures/Projects/estudio/src/renderer/modulos/musica/PianoRoll.tsx
- /home/laures/Projects/estudio/src/renderer/modulos/musica/Monitor.tsx
- /home/laures/Projects/estudio/src/renderer/modulos/musica/Inspector.tsx
- /home/laures/Projects/estudio/src/renderer/modulos/musica/AutomacaoArranjo.tsx
- /home/laures/Projects/estudio/src/renderer/modulos/video/gravador.ts
- /home/laures/Projects/estudio/src/main/janela-segura.ts
- /home/laures/Projects/estudio/src/main/musica-render.ts
- /home/laures/Projects/estudio/docs/musica.md
- /home/laures/Projects/estudio/docs/audio.md
- /home/laures/Projects/estudio/docs/arquitetura.md
- /home/laures/Projects/estudio/docs/desempenho.md
- /home/laures/Projects/estudio/package.json
