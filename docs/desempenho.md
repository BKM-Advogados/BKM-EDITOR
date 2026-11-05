# Desempenho desde o desenvolvimento: proposta da frente 3

Estúdio desktop (Electron + React + TypeScript + Remotion), 05/11/2026. O alvo é rodar bem num notebook de 8 GB com GPU integrada. Fonte externa vem com número [n], e a lista está no fim. Dedução está marcada [inferência]. Número que só se confirma medindo está marcado [medir na fase 0]. As correções da conferência de 04/11/2026 já estão aplicadas no texto (tabela no fim).

---

## 0. Resumo

- **O maior consumidor de memória não é o app: é o `claude`.** Relatos de 2026 medem de 110 a 560 MB por sessão viva, e o consumo cresce com o número de sessões abertas e de servidores MCP [15][16]. O relato #61425 (RSS de 372 a 498 MB nos dados colados; o autor falou em ~700 MB) foi fechado por inatividade, sem resposta da equipe [15]. Num PC de 8 GB, o app precisa **limitar as sessões vivas** e **hibernar a aba ociosa**: encerra o processo e retoma depois com `--resume <uuid>` [17].
- **Uma janela e um renderer.** O trabalho pesado sai do processo principal. O PTY roda num `utilityProcess` próprio (pty-host). O render roda num `utilityProcess` aberto só durante a exportação (a confirmar na fase 0). Proxies e efeitos rodam em Workers no renderer [1][2][7][8].
- **O MCP `nucleo` por HTTP local, não por stdio.** No stdio, cada aba sobe um processo `nucleo` a mais. Por HTTP, nenhuma aba sobe processo extra. O Claude Code aceita `type: "http"` com `headers` e expansão `${VAR}` no `.mcp.json` [18].
- **Orçamento por estado, com números.** No perfil leve, sem contar o `claude`: 300 MB parado, 500 MB editando vídeo, 600 a 650 MB com Imagem ou 3D, 1,4 GB exportando. A UI fica interativa em até 1,2 s na segunda abertura. Os tetos reprovam no teste automático (seção 6).
- **GPU é um recurso contado.** O Chromium limitava os contextos WebGL a 16 por processo de renderer, perdendo o mais antigo ao passar disso, segundo a mudança de 2013. Um engenheiro do Chromium disse em 2021 que não há plano de subir o limite, mas não achei documento atual que confirme o 16 [14]. O app fixa um teto bem menor: **no máximo 4 contextos vivos, 3 no perfil leve**, todos criados por um registro central. A GPU integrada usa a RAM do sistema, em geral até metade dela [35]. Então textura também conta no orçamento de RAM.
- **Exportação no PC fraco:** concurrency 2, caches com tamanho fixo (o cache de quadros do `OffthreadVideo` pode chegar a 50% da memória disponível [20]) e `disallowParallelEncoding` ligado à mão no perfil leve. A partir da 4.0.533, o Remotion deixou de desligar a codificação paralela sozinho conforme a memória [19]. A prévia pausa durante o export.
- **O app mede a si mesmo:** marcas de tempo (`performance.mark`), `app.getAppMetrics()` e um selo de RAM na barra de status. Um teste com Playwright em modo Electron reprova o build que passar do teto [3][4][36].

---

## 1. Máquina-alvo e perfis

**Notebook de referência [inferência]:** Windows 11, 8 GB, Intel Core i5 de 11ª a 13ª geração com Iris Xe ou UHD, SSD, tela 1920×1080 em 125%. Na prática, vale o notebook mais fraco da BKM. Nessa máquina, o Windows e os apps de sempre (Teams, Outlook, navegador) já ocupam boa parte da RAM, e a GPU tira a sua parte da mesma memória [35].

O perfil é detectado na inicialização com `os.totalmem()`, `app.getGPUFeatureStatus()` e `app.getGPUInfo('basic')`, e pode ser trocado à mão:

| Parâmetro | Leve (≤ 8,5 GB) | Padrão (8,5 a 24 GB) | Forte (> 24 GB) |
|---|---|---|---|
| Sessões `claude` vivas | 2 | 4 | 8 |
| Áreas pesadas montadas além da visível | 0 | 1 | 2 |
| Escala da prévia de vídeo | 0,5 | 0,75 | 1 |
| Teto de dpr no 3D | 1,0 | 1,5 | 2 |
| Antialias no 3D | desligado em movimento, quadro limpo ao parar | MSAA | MSAA |
| Contextos WebGL vivos | 3 | 4 | 4 |
| Scrollback do xterm | 2.000 linhas | 5.000 | 10.000 |
| Concurrency no export | 2 (1 com pouca RAM livre ou WebGL na composição) | "50%" | "50%" ou o resultado do benchmark |
| Caches de mídia do render | 256 MB cada | 512 MB | 1 GB |
| Cache em disco (proxies, miniaturas) | 2 GB, LRU | 5 GB | 10 GB |
| Maior documento de imagem | 4096×4096 (8192 com aviso) | 8192×8192 | 8192, ou `MAX_TEXTURE_SIZE` se for menor |

Se o WebGL2 aparecer como `unavailable` ou `software`, o 3D e os efeitos por GPU entram em modo reduzido, com aviso na tela [inferência].

---

## 2. Arquitetura de processos

```
Electron, uma BrowserWindow
├─ main ............ janela, IPC, núcleo de documentos (JSON Patch, lock, diário),
│                    servidor MCP HTTP em 127.0.0.1, coletor de métricas      ~60–90 MB
├─ renderer ........ casca React + SÓ a área visível + xterm.js
│   ├─ Worker gpu    (OffscreenCanvas + WebGL2: Imagem e Efeitos)
│   ├─ Worker mídia  (Mediabunny/WebCodecs: proxies, miniaturas)       ~150–350 MB
│   └─ Worker export-imagem (PNG em resolução cheia)
├─ GPU (Chromium) ................................................... ~80–200 MB
├─ network/utility (Chromium) ....................................... ~20–40 MB
├─ pty-host (utilityProcess) ... node-pty, controle de fluxo .......... ~30–50 MB
│     └─ claude.exe por aba (fora do orçamento do app; política na seção 3.4)
└─ render-host (utilityProcess, só exportando) ... @remotion/renderer
      └─ Chrome Headless Shell (N abas) + compositor/FFmpeg ......... ~0,6–1,4 GB
```
Os números por processo são [inferência, medir na fase 0]. Um Electron vazio fica perto de 120 a 200 MB, segundo estimativa de terceiro [37].

Três mudanças em relação ao que já estava decidido, com motivo:

1. **node-pty num `utilityProcess` (pty-host), não no processo principal.** O node-pty não é thread-safe e é módulo nativo [9]: se ele cair, cai junto o que estiver no mesmo processo. Uma rajada de saída do TUI do Claude também ocupa o event loop. O VS Code tirou os terminais do renderer em 2022 [7] e depois levou o pty host para o main e para um utility process [8]. O `utilityProcess` é o equivalente do `child_process.fork` com a Services API do Chromium. Ele fala por `MessagePortMain` e aparece em `app.getAppMetrics()` com `serviceName` [2]. Custa cerca de 30 a 50 MB [inferência], e é o único processo Node fixo além do main.
2. **Render num `utilityProcess` aberto só durante a exportação (render-host).** O guia do Remotion para Electron manda o `renderMedia()` para o main e diz que o renderer não deve chamá-lo. O guia não menciona `utilityProcess` [24]. Com o render-host, a orquestração de quadros não disputa o main com a UI, um OOM do render não derruba o app e o processo morre ao fim do export [inferência]. Falta confirmar na fase 0 que o `@remotion/renderer` roda em `utilityProcess`, com os binários fora do `app.asar` (o guia exige isso e manda apontar `binariesDirectory` para `app.asar.unpacked`) [24]. O plano B é o main, como diz o guia.
3. **MCP `nucleo` por HTTP local.** Cada sessão sobe os próprios servidores MCP stdio. Um relato mediu entre 82 e cerca de 146 MB por árvore de *sidecar* (os números do próprio relato não batem) e RAM que cresce com chats abertos × servidores [16]. Por HTTP, nenhuma aba cria processo:
   ```json
   { "mcpServers": { "nucleo": {
       "type": "http",
       "url": "http://127.0.0.1:${ESTUDIO_MCP_PORTA}/mcp",
       "headers": { "Authorization": "Bearer ${ESTUDIO_MCP_TOKEN}" } } } }
   ```
   O app passa porta e token por variável de ambiente para cada PTY e entrega o arquivo com `--mcp-config` [17][18]. Se o stdio for mantido, o `nucleo` vira uma **ponte fina**: um script sem dependências, rodado com `ELECTRON_RUN_AS_NODE`, que só repassa stdio ↔ named pipe do main [inferência].

**O renderer é descartável.** O estado vive no main e no disco: documentos, diário, comentários. Se o renderer cair (`render-process-gone`, motivo `oom`), o main recarrega a janela e restaura a área e a seleção [inferência].

---

## 3. Orçamentos

### 3.1 Inicialização e resposta (notebook de referência, perfil leve)

"Morno" é a segunda abertura; "frio" é logo após reiniciar o Windows. O Electron 42.3.3 e posteriores trazem as mudanças de partida do post oficial, entre elas cache de código gerado na compilação. No benchmark do post, o main ficou em cerca de 75 ms e o renderer em sandbox pintou em cerca de 130 ms, ambos contados **desde o spawn do processo**, não desde um evento "pronto" [6]. Os alvos abaixo dão folga de 3 a 5 vezes para a máquina fraca [inferência].

| Marca | Alvo (morno) | Teto (frio) |
|---|---|---|
| `main:pronto` (`app.whenReady`) | 200 ms | 600 ms |
| `janela:visivel` (`ready-to-show`, casca pintada) | 700 ms | 1,5 s |
| `ui:interativa` (casca e área padrão aceitam entrada) | 1,2 s | 2,5 s |
| `projeto:aberto` (C2: ler os JSON e resolver âncoras em TS) | 300 ms | 800 ms |
| `video:primeiro-quadro` (depois do projeto aberto) | 800 ms | 1,5 s |
| `area:3d:pronta` (primeira vez: chunk + contexto + cena) | 800 ms | 1,5 s |
| `area:imagem:pronta` | 500 ms | 1 s |
| Troca para área já carregada | 150 ms | 300 ms |
| `terminal:pty-pronto` (sem a partida do `claude`) | 150 ms | 400 ms |
| Edição na UI → quadro atualizado (p95) | 50 ms | 100 ms |
| `aplicar_patch` do agente → UI atualizada (p95) | 100 ms | 250 ms |

### 3.2 Memória por estado (perfil leve, sem o `claude`)

Métrica: soma de `privateBytes` (só Windows) de todos os processos de `app.getAppMetrics()`, mais a árvore de pids do pty-host (sem o `claude`) e a do render-host. O Chrome Headless Shell e o compositor não são processos do Chromium do app, então é preciso somá-los pela árvore de pids [inferência]. A unidade da API é KB [4]. No macOS, o campo `privateBytes` não existe, e a medida equivalente fica para verificar na fase 0 (a página da API só documenta `workingSetSize`, `peakWorkingSetSize` e `privateBytes`).

| Estado | Alvo | Teto (reprova) |
|---|---|---|
| E1. Parado: projeto C2 aberto, Vídeo pausado, 1 aba de terminal | 300 MB | 400 MB |
| E2. Vídeo tocando (prévia em escala 0,5), timeline e propriedades | 500 MB | 700 MB |
| E3. Imagem 4096² com 10 camadas e 3 efeitos | 650 MB | 850 MB |
| E4. 3D: 50 primitivas + 1 glTF de 20 MB, girando | 600 MB | 800 MB |
| E5. Exportando o C2 (1080×1920, 80,7 s), concurrency 2, render-host incluído | 1,4 GB | 1,9 GB |
| Volta a E1 depois de E3, E4 e E5 (vazamento) | E1 + 30 MB | E1 + 60 MB |

**Pior caso no leve:** 1,9 GB do export mais 2 sessões `claude` (cerca de 1 GB) dão cerca de 3 GB. Sobram cerca de 5 GB para o Windows e os outros apps [inferência].

A conta da Imagem que sustenta E3: uma camada RGBA de 4096² tem 64 MB. Dez camadas em resolução cheia dariam 640 MB só na CPU, fora as cópias na GPU. Por isso a regra da seção 4.5 é trabalhar em resolução de trabalho.

### 3.3 CPU, GPU e quadros

- **E1:** CPU média abaixo de 1% em 60 s; nenhum `requestAnimationFrame` em laço (o build de teste conta: menos de 1 por segundo em repouso).
- **E2:** 30 fps com no máximo 2% de quadros pulados. A conta usa o salto de quadro entre eventos `frameupdate` do Player. Zero *long tasks* acima de 50 ms em 10 s de reprodução.
- **E4 parado:** `renderer.info.render.frame` não avança (nenhum quadro renderizado).
- **E5:** latência de entrada na UI com p95 abaixo de 100 ms. Tempo de export de até 3× a duração do vídeo, ou seja, C2 em até 4 min [medir na fase 0, com `npx remotion benchmark` [21]].
- **Bundle [inferência]:** JS inicial do renderer de até 1,5 MB minificado. Three.js, os addons do xterm, Mediabunny e `@remotion/renderer` ficam fora dele.

### 3.4 Política das sessões `claude`

- **Teto de sessões vivas por perfil** (leve 2, padrão 4, forte 8). Uma aba além disso abre hibernada.
- **Hibernação:** cada aba nasce com `--session-id <uuid>` gerado pelo app (precisa ser UUID válido) [17]. Uma aba ociosa encerra o processo e guarda o uuid. Ociosa quer dizer estado "pronto" pelo hook `Stop` ou pelo OSC 7501, sem saída por mais de 10 min. Ao focar, ela volta com `claude --resume <uuid>` [17]. O transcript fica em disco, e arquivar uma sessão ociosa liberou cerca de 390 MB (árvore de processos inteira) no relato [16]. **No MVP, a hibernação é manual (um botão); a automática vem depois.**
- **No perfil leve, evitar `--bg`.** `--bg` inicia a sessão como agente em segundo plano e devolve o controle na hora [17]; a ideia de que ela segue ocupando RAM depois que a janela fecha é [inferência]. No leve, vale "encerrar e retomar".
- **`claude` direto no PTY**, sem PowerShell no meio. Cada `pwsh` ocioso custa dezenas de MB [inferência]. Shell só na aba "Terminal" explícita.
- **Modo leve do agente (opcional):** `--strict-mcp-config` com `--mcp-config` carrega só os servidores do arquivo (o `nucleo` e o MCP da frente), ignorando as outras configurações de MCP da pessoa [17]. A RAM cresce com o número de servidores [16].
- O selo da aba mostra a RAM da sessão, porque o consumo alto do CLI é relatado por mais de uma pessoa [15][16].

---

## 4. Práticas por camada

### 4.1 Electron

- **Uma `BrowserWindow`**, criada com `show: false`, mostrada no `ready-to-show` e com `backgroundColor` definido. Nada de janela oculta para trabalho; trabalho vai para Worker ou `utilityProcess`.
- **Checklist oficial** [1]: medir antes; adiar `require` pesado; não bloquear o main (só I/O assíncrono, sem IPC síncrono nem `@electron/remote`); Web Workers e `requestIdleCallback` no renderer; sem polyfills; recursos empacotados (fontes do Google entram no app, sem rede na partida); main e renderer em bundle; `Menu.setApplicationMenu(null)` antes do `ready` quando o menu for próprio (no macOS, um menu mínimo).
- **`webPreferences`** [5]: `sandbox` e `contextIsolation` ligados (já são o padrão). `spellcheck: false` na janela, porque o padrão é ligado e o app não é editor de texto longo [5][39]. `backgroundThrottling` fica no padrão (`true`): minimizado, Player e 3D param.
- **Versão:** Electron estável recente, 42.3.3 ou posterior, pelas melhorias de partida (cache de código e snapshot) [6]. Testar `v8CacheOptions: 'bypassHeatCheck'` na fase 0 [5] [inferência sobre o ganho].
- **IPC:** mensagens pequenas e em lote. Binário vai por `MessagePort` com transferência ou por caminho de arquivo, nunca base64 dentro de JSON. Captura de tela é `webContents.capturePage(rect)`, chamada no main.
- **Prioridade:** os filhos do render-host rodam abaixo do normal (`os.setPriority`) para a UI continuar respondendo [inferência].
- **Recuperação:** tratar `render-process-gone` e `child-process-gone`, que trazem o motivo (por exemplo, `oom`).

### 4.2 Renderer e áreas

- **Cada área (Vídeo, Imagem, 3D, Efeitos) é um chunk** carregado com `React.lazy(() => import(...))`. O terminal também é chunk, carregado em `requestIdleCallback` se não estiver visível na partida.
- **Ciclo obrigatório `montar → pausar → descarregar`.** Pausar para quadros, Player e áudio. Descarregar faz `dispose` de GPU, `close()` de bitmaps e remove listeners. O documento continua no núcleo, e um cache LRU guarda o que custa reabrir. No perfil leve, a área que sai de vista descarrega na hora.
- **Estado por quadro fora da árvore React.** O tempo atual fica num ref e numa assinatura local. Os controles são irmãos do Player, e `inputProps` é memoizado; sem isso, a árvore inteira re-renderiza [25].
- **Listas** (timeline, camadas, diário, comentários) são virtualizadas acima de cerca de 200 itens.
- **Long tasks:** um `PerformanceObserver` com `type: 'longtask'` registra tarefas acima de 50 ms no log de desempenho.

### 4.3 Terminais

- **xterm.js:** `scrollback` do perfil (o padrão é 1.000 [10]). Medições de terceiros dão de 1,6 a 2,75 KB por linha a 200 colunas, ou seja, de 8 a 17 MB por aba com 5.000 linhas [13]. Não é preciso muito scrollback, porque o transcript do Claude fica em disco.
- **Renderizador:** o xterm.js 6 tirou o canvas e deixou só DOM e WebGL [38]. O WebGL fica **só na aba visível**: ao trocar de aba, `dispose()` no addon da aba que saiu e carga na que entrou. Em `onContextLoss`, voltar para o DOM [12]. No VS Code, o `/terminal-setup` do Claude desliga a aceleração por GPU "to prevent garbled text" [38]. Testar o TUI fullscreen do Claude com WebGL; se embaralhar, a aba usa DOM.
- **`allowTransparency` desligado**, porque a doc avisa que pesa no desempenho [10]. `cursorBlink` só na aba focada.
- **Controle de fluxo:** o xterm.js processa de 5 a 35 MB/s, e o buffer de escrita descarta o que passar de 50 MB (valor "à data da escrita" do guia) [11]. Entre o pty-host e o renderer, usar ACK por IPC: o renderer confirma a cada cerca de 100 KB processados, e o pty-host chama `pty.pause()` acima da marca alta e `resume()` abaixo da baixa (o guia usa 100.000 e 10.000 bytes de exemplo). A marca alta não deve passar de cerca de 500 KB para o teclado continuar respondendo [11].
- **Windows:** o node-pty usa ConPTY no 1809 ou posterior, e o filho herda as permissões do pai [9].

### 4.4 Vídeo e prévia

- **Cálculo fora do quadro.** O resolvedor de âncoras e a mixagem (portados para TS) rodam no núcleo a cada patch e entregam props prontas. Por quadro, a composição só lê e interpola os blocos visíveis.
- **Player leve:** escala do perfil, controles irmãos, `inputProps` memoizado [25]. `bufferStateDelayInMilliseconds` evita o spinner piscando [26].
- **Mídia:** usar o `<Video>` de `@remotion/media`, que a página de desempenho recomenda; `Html5Video` e `OffthreadVideo` "are not optimized" [21]. `maxCanvasSinkFrameSize` limita o tamanho dos quadros na prévia, mas a decodificação continua em tamanho cheio [27]. `premountFor` monta o vídeo antes do quadro de entrada [27].
- **Proxies (depois do MVP: o C2 não tem vídeo, só foto e áudio):** um Worker com Mediabunny `Conversion` gera a versão de prévia, com `width`/`height`/`fit`, `codec: 'avc'` e `hardwareAcceleration: 'prefer-hardware'` [28]. Isso usa o WebCodecs do Chromium, em geral acelerado por hardware, e roda em Worker [29]. GOP curto para busca rápida [inferência; confirmar a opção na lib]. O proxy fica no cache em disco por hash do arquivo; a exportação usa sempre o original.
- **WebCodecs:** todo `VideoFrame` recebe `close()` assim que deixa de ser usado [29].
- **Miniaturas e quadros (depois do MVP):** LRU de `ImageBitmap` a 160 px de largura, até 64 MB, com `close()` ao sair do cache.
- **Quadro para comentário e para o agente:** se o quadro está na tela, `capturePage` do retângulo do Player. Se não, `renderStillOnWeb` em escala pequena, sem subir o Chrome Headless Shell (a rodada 1 registra o web-renderer como estável desde a 4.0.491).
- **Forma de onda:** picos calculados uma vez (num Worker, não no pty-host) e guardados em JSON, sem `decodeAudioData` do arquivo inteiro. Para referência, 10 min de áudio estéreo a 48 kHz em float32 dão cerca de 230 MB [inferência]. No C2 (80 s), decodificar é aceitável no MVP.

### 4.5 Imagem

- **Resolução de trabalho.** Cada camada guarda a fonte codificada (arquivo) e um único bitmap em até 2× o tamanho do visor, gerado com `createImageBitmap(blob, { resizeWidth, resizeHeight, resizeQuality: 'high' })` [32]. Texto e forma são vetor, rasterizados no tamanho da tela. Dez camadas a 2048² dão cerca de 160 MB, contra 640 MB em resolução cheia.
- **Resolução cheia só no exportar,** no Worker de exportação com `OffscreenCanvas` e `convertToBlob`, uma camada por vez, com `close()` em cada bitmap ao terminar.
- **Limites:** o tamanho máximo de canvas depende do navegador, e passar dele torna o canvas inútil [30]. O app impõe seu teto pelo perfil e por `gl.MAX_TEXTURE_SIZE`, lido em tempo de execução.
- **Filtros na GPU:** um único contexto WebGL2 num Worker (`transferControlToOffscreen` [31], ou `OffscreenCanvas` próprio) é compartilhado por Imagem e Efeitos. Cada visor recebe o resultado com `transferToImageBitmap()` num canvas `bitmaprenderer`. Vários visores, um só contexto [inferência].

### 4.6 3D

- **Three.js (e R3F, se for usado) só no chunk da área 3D.** Os decoders de Draco, Meshopt e KTX2 carregam só quando o glTF pede.
- **`frameloop="demand"`** com `invalidate()` ligado ao `change` dos controles e do gizmo [34]. Parado, a cena não renderiza.
- **dpr com teto do perfil.** Em movimento, o dpr cai (o padrão de *movement regression* e `AdaptivePixelRatio` [34]); ao parar, um quadro limpo. Sombras desligadas por padrão; no leve, no máximo uma sombra direcional de 1024².
- **Dispose explícito:** geometria, material, textura e render target só saem com `dispose()`; tirar da cena não libera nada. Textura vinda de `ImageBitmap` também pede `close()` [33]. Ao descarregar a área: percorrer a cena, chamar `renderer.dispose()` e `forceContextLoss()`, e devolver o contexto ao registro. O `renderer.info.memory` pode não zerar por reuso interno, então o teste compara ciclos, não zero absoluto [33].
- **Textura na GPU integrada é RAM** [35]. Uma textura RGBA de 2048² com mipmaps ocupa cerca de 21 MB; em KTX2/BC7, cerca de 4 vezes menos [inferência]. KTX2 fica depois do MVP.

### 4.7 Efeitos

- **Pilha única em JSON** (desfoque, brilho, vinheta, granulado, correção de cor), com dois motores:
  - **Bitmap (foto, vídeo, camada de imagem):** shader no contexto WebGL2 compartilhado. O desfoque é separável em dois passes, e a prévia roda em resolução reduzida.
  - **DOM da composição Remotion (texto, formas, blocos):** o navegador não deixa passar pós-processamento WebGL sobre DOM. Aqui o motor é CSS: `filter` no contêiner da camada; vinheta como `radial-gradient` sobreposto; granulado como textura de ruído pré-gerada, em ladrilho e deslocada por quadro com `mix-blend-mode`; brilho com custo limitado. A página de desempenho do Remotion lista `blur`, `box-shadow`, gradientes e `drop-shadow` como efeitos CSS acelerados por GPU, que ficam lentos onde não há GPU (a doc fala de instâncias de nuvem; vale o mesmo cuidado no notebook sem GPU dedicada) [21]. Por isso o app limita quantos ficam ativos ao mesmo tempo [inferência sobre o desenho].
- **Paridade no render:** composição com WebGL pede `gl: 'angle'` no desktop. A doc chama os vazamentos de memória do `angle` de problema conhecido e manda dividir renders longos em partes [22]. No Remotion 4.0 o padrão local é `null` (o Chrome decide); só a 5.0 passa a ter `angle` como padrão [22].

### 4.8 Exportação

- **Um render por vez,** no render-host, com `cancelSignal` e `onProgress` [19].
- **Perfil leve:** `concurrency: 2` (o padrão é metade das threads de CPU [19]), ou 1 se `os.freemem()` estiver abaixo de 2 GB ou se houver WebGL na composição. `offthreadVideoCacheSizeInBytes` e `mediaCacheSizeInBytes` fixos em 256 MB: o primeiro tem padrão de até 50% da memória disponível no início do render [20]; o padrão do segundo não está documentado nas páginas consultadas, e fixar o valor evita depender dele. `disallowParallelEncoding: true` [19][20].
- **Codificação:** `hardwareAcceleration: 'if-possible'` (valores: `disabled`, o padrão, `if-possible` e `required`) [23]. No macOS usa VideoToolbox; no Windows e no Linux só há NVENC, que exige NVIDIA e vale para H.264 e H.265 [23]. Com `hardwareAcceleration`, não se usa `crf`; usa-se `videoBitrate` [19]. Num notebook Intel, a codificação é x264 na CPU. "Exportar rascunho" usa `scale: 0.5` e um `x264Preset` rápido.
- **Durante o export:** o Player pausa. No leve, Imagem e 3D descarregam (no padrão, só pausam). A edição de documentos continua, porque o render usa as props congeladas no início.
- **Navegador:** `ensureBrowser()` no primeiro export ou em ocioso, com progresso na tela. Binários do Remotion fora do `app.asar` [24].

### 4.9 Documentos, diário e git

- O documento fica carregado uma vez no núcleo. Os patches viajam como operações JSON Patch, pequenas, aplicadas no lugar.
- O desfazer guarda o patch inverso, até 200 na memória; o resto já está no diário em disco.
- O diário é JSONL em append assíncrono, com rotação por tamanho.
- O watcher cobre só os documentos conhecidos, com debounce de 100 ms, e ignora gravação própria por hash.
- O `git` roda pela CLI em processo filho assíncrono, com commit agrupado em ocioso [inferência].

---

## 5. Medição no próprio app

- **Módulo `perf`**, igual nos dois lados:
  - `perf.marca('area:evento')` usa `performance.mark` no renderer e `perf_hooks` no main.
  - Os tempos ficam em época absoluta (`performance.timeOrigin + performance.now()`), para cruzar processos.
  - As marcas são as da seção 3.1.
- **Coletor no main:**
  - `app.getAppMetrics()` traz por processo `type`, `serviceName`, `cpu`, `creationTime` e `memory` (`workingSetSize`, `peakWorkingSetSize` e `privateBytes`, este só no Windows), em KB [4].
  - `process.getHeapStatistics()` e `process.getBlinkMemoryInfo()` trazem heap e DOM [3].
  - `process.getSystemMemoryInfo()` traz a RAM livre [3].
  - A árvore de pids do pty-host e do render-host vem do SO (`tasklist`/`ps`).
  - A coleta roda a cada 10 s, ou a cada 2 s com o painel aberto [inferência].
- **Selo na barra de status:** "RAM 612 MB · 2 agentes". Fica amarelo acima de 80% do alvo do estado e vermelho acima do teto. O clique abre a tabela por processo, por área e por aba.
- **Contadores do build de teste:** contextos WebGL vivos (pelo registro da GPU), `ImageBitmap` abertos, `renderer.info.memory` do 3D, chamadas de `requestAnimationFrame` por segundo e quadros pulados do Player.
- **Log local** em `perf/AAAA-MM-DD.jsonl`, na pasta de dados do app (nada sai do PC).
- **Diagnóstico profundo,** sob demanda: `contentTracing` e DevTools.

---

## 6. Teste automático que reprova

- **Ferramenta:** Playwright em modo Electron. `_electron.launch()`, depois `electronApp.evaluate(({ app }) => app.getAppMetrics())` para rodar no main e `firstWindow()` para a janela [36]. A API está na seção "Experimental" da doc [36].
- **Modo de teste:** `--perfil=leve --teste-desempenho` liga `--js-flags=--expose-gc` para chamar `gc()` antes de cada medida, usa uma cópia fixa do projeto C2 e desliga atualização automática.
- **Arquivos:** `tests/desempenho/orcamento.json` (perfil → estado → `memoria_mb`, `tempo_ms`, `cpu_ocioso_pct`, `contextos_webgl`, `quadros_pulados_pct`) e `tests/desempenho/estados.spec.ts`.
- **Roteiro:**
  1. Partida: tempo até `ui:interativa`.
  2. E1: assentar 5 s, chamar `gc()`, fazer 10 amostras a cada 500 ms e pegar o p95 da soma de `privateBytes`, mais CPU média em 30 s.
  3. E2: tocar 10 s; conferir quadros pulados e *long tasks*.
  4. E3 e E4: abrir os fixtures (imagem 4096² com 10 camadas; cena com 50 primitivas e glTF).
  5. E5: exportar os primeiros 10 s do C2 (o export inteiro roda à noite, no notebook de referência).
  6. Vazamento: abrir e descarregar 3D e Imagem 20 vezes. Depois de `gc()`, o crescimento tem de ficar abaixo de 30 MB. Contextos WebGL e `ImageBitmap` voltam ao valor de antes.
  7. Terminal: um agente falso (script Node) despeja 50 MB de ANSI numa aba. O teste confere que a memória do renderer fica limitada e que a tecla ecoa em menos de 100 ms durante a rajada. Não usa o `claude` real, porque o teste não tem login.
- **Regra de aprovação:** passar do teto reprova; passar do alvo gera aviso. Cada estado roda 3 vezes, vale a mediana, com tolerância de 10% por ruído. Os resultados vão para JSONL, para ver a tendência.
- **Onde roda:** localmente (`npm run desempenho`) antes de integrar, e em CI Windows quando houver. Na CI não há GPU, então o Chromium cai para software. Por isso existe um perfil `ci` calibrado à parte [inferência].

Esboço do núcleo do teste:
```ts
const app = await electron.launch({ args: ['.', '--perfil=leve', '--teste-desempenho'] });
const win = await app.firstWindow();
await win.waitForFunction(() => performance.getEntriesByName('ui:interativa').length > 0);
const kb = await app.evaluate(({ app }) =>
  app.getAppMetrics().reduce((s, p) => s + (p.memory.privateBytes ?? p.memory.workingSetSize), 0));
expect(kb / 1024).toBeLessThan(orcamento.leve.E1.teto_mb);
```

---

## 7. Regras de código para todo módulo

1. O main só orquestra: I/O assíncrono e IPC. Trabalho de CPU acima de 16 ms vai para Worker ou `utilityProcess`.
2. Sem IPC síncrono e sem `@electron/remote`. Binário vai por `MessagePort` com transferência ou por caminho de arquivo, nunca base64 em JSON.
3. Import dinâmico para toda área e para toda lib acima de cerca de 100 KB (three, addons do xterm, mediabunny, `@remotion/renderer`, git). Nada pesado no import do topo do arquivo.
4. Toda área implementa `montar / pausar / descarregar`. O `descarregar` devolve memória e contextos, e o teste confere.
5. Contexto WebGL só via `gpu.criarContexto(dono)`, que conta, limita (3 ou 4) e libera. Ninguém chama `getContext('webgl2')` direto.
6. Todo recurso liberável tem dono e é liberado: geometria, material, textura, render target, `ImageBitmap.close()`, `VideoFrame.close()`, `URL.revokeObjectURL`, listeners, timers, PTY.
7. Nenhum laço de quadros em repouso: Player pausado, 3D `demand`, nenhum *polling* abaixo de 1 s, animação de UI por CSS.
8. A prévia nunca roda em resolução cheia por padrão: usa a escala do perfil e proxies. Resolução cheia só na exportação.
9. Imagem trabalha em até 2× o visor. A resolução cheia só existe no exportar, em Worker, uma camada por vez.
10. Cálculo derivado (âncoras, mixagem, layout da timeline) acontece no patch, memoizado, nunca dentro do quadro. `inputProps` sempre memoizado.
11. O tempo atual não sobe na árvore React: fica num ref com assinatura local, e os controles são irmãos do Player.
12. Listas acima de cerca de 200 itens são virtualizadas.
13. Documento muda por JSON Patch aplicado no lugar, e o desfazer guarda o patch inverso. Nunca clonar o documento inteiro por edição.
14. Todo cache tem teto em bytes e é LRU. Nada de "metade da RAM".
15. Terminal: scrollback do perfil, WebGL só na aba visível, controle de fluxo com ACK, `claude` direto no PTY.
16. O agente respeita o teto de sessões vivas do perfil, e a sessão ociosa hiberna com `--resume <uuid>`.
17. Exportação: uma por vez, em processo próprio, com concurrency e caches do perfil, cancelável. A prévia pausa.
18. Recurso novo declara seu custo no `orcamento.json` e entra no teste. Mudança que passa do teto não entra.
19. Medir com `perf.marca()`. Nada de `console.log` em laço quente.
20. Sem rede na partida: fontes e recursos vêm empacotados no app.

---

## 8. Corte do MVP

**Entra agora:**
- Perfis leve e padrão, detectados pela RAM.
- Processos: main, renderer, pty-host (`utilityProcess`) e render-host (só no export; plano B no main).
- `nucleo` por HTTP local.
- Áreas em chunks com o ciclo `montar/pausar/descarregar`; no leve, só a área visível fica montada.
- Registro da GPU com teto.
- 3D com `demand`, teto de dpr e dispose ao descarregar.
- Player com escala, `inputProps` memoizado e controles irmãos; resolvedor fora da composição.
- Imagem em resolução de trabalho, com exportação PNG em Worker.
- Efeitos: um contexto WebGL2 compartilhado entre Imagem e Efeitos; motor CSS no vídeo.
- Terminal: scrollback de 2.000 linhas, WebGL só na aba visível (ou DOM), controle de fluxo com ACK, `claude` direto no PTY, até 2 sessões vivas, hibernação manual.
- Export com concurrency 2, caches de 256 MB, `disallowParallelEncoding`, cancelar e prévia pausada.
- Módulo `perf` com marcas, selo de RAM e log JSONL.
- Teste Playwright com partida, E1, E2, E4, export de 10 s, vazamento do 3D e rajada no terminal, tudo sobre o `orcamento.json`.

**Fica para depois:**
- Proxies de vídeo com Mediabunny.
- Miniaturas na timeline e forma de onda pré-calculada.
- Hibernação automática e painel completo de desempenho.
- KTX2, Draco e Meshopt.
- Exportação de imagem grande em blocos.
- Render em partes com `gl: 'angle'`.
- Rodada noturna no notebook de referência e perfil `ci` calibrado.
- `contentTracing`.

---

## 9. O que medir na fase 0 (checklist, não portão)

1. Electron vazio e app com só a casca no notebook mais fraco: soma de `privateBytes` e tempo até `ready-to-show`. Isso calibra a seção 3.
2. RAM de uma sessão `claude` parada e depois de 1 h de uso, com e sem `--strict-mcp-config`.
3. Chrome Headless Shell por aba no C2 1080×1920, com concurrency 1, 2 e 4 (`npx remotion benchmark` [21]), e o tempo de export.
4. `@remotion/renderer` dentro de `utilityProcess`, com os binários fora do asar.
5. WebGL do xterm.js com o TUI do Claude (texto embaralhado?) e custo da troca de addon entre abas.
6. Contagem real de contextos com Player, Imagem, Efeitos e terminal abertos juntos, abaixo de 3 no leve; e o limite real de contextos do Chromium embutido no Electron escolhido (a fonte pública do 16 é de 2013).
7. Paridade dos efeitos CSS e WebGL entre a prévia e o render.
8. Versão do Remotion realmente instalada (a proposta supõe 4.0.534, que a doc consultada não confirma) e padrão efetivo de `mediaCacheSizeInBytes`.

---

## Fontes (acessos em 04/11/2026)

1. Electron, Performance: https://www.electronjs.org/docs/latest/tutorial/performance
2. Electron, utilityProcess: https://www.electronjs.org/docs/latest/api/utility-process
3. Electron, process: https://www.electronjs.org/docs/latest/api/process
4. Electron, ProcessMetric e MemoryInfo (KB; `privateBytes` só no Windows): https://www.electronjs.org/docs/latest/api/structures/process-metric e https://www.electronjs.org/docs/latest/api/structures/memory-info
5. Electron, WebPreferences: https://www.electronjs.org/docs/latest/api/structures/web-preferences
6. "A Faster Electron", 20/05/2026 (Electron 42.3.3 / 43 beta): https://f98b35da.electron-website.pages.dev/blog/a-faster-electron
7. VS Code, "Migrating VS Code to process sandboxing", 28/11/2022: https://code.visualstudio.com/blogs/2022/11/28/vscode-sandbox
8. VS Code PR #178708: https://github.com/microsoft/vscode/pull/178708
9. node-pty: https://github.com/microsoft/node-pty
10. xterm.js, ITerminalOptions: https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/
11. xterm.js, Flow control: https://xtermjs.org/docs/guides/flowcontrol/
12. xterm.js, addon-webgl: https://github.com/xtermjs/xterm.js/tree/master/addons/addon-webgl
13. Memória do scrollback, estimativas de terceiros: https://github.com/attson/atterm/pull/343 e https://github.com/clawterm/ClawTerm/issues/305
14. Limite de contextos WebGL no Chromium: https://codereview.chromium.org/14217005/ ; https://groups.google.com/a/chromium.org/g/graphics-dev/c/fmNedEEAYpA ; https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/webgl/webgl_rendering_context_base.cc
15. Claude Code, issue #61425: https://github.com/anthropics/claude-code/issues/61425
16. Claude Code, issue #88524: https://github.com/anthropics/claude-code/issues/88524
17. Claude Code, CLI reference: https://code.claude.com/docs/en/cli-reference
18. Claude Code, MCP: https://code.claude.com/docs/en/mcp
19. Remotion, renderMedia(): https://www.remotion.dev/docs/renderer/render-media
20. Remotion, SIGKILL: https://www.remotion.dev/docs/troubleshooting/sigkill
21. Remotion, Performance: https://www.remotion.dev/docs/performance
22. Remotion, `--gl`: https://www.remotion.dev/docs/gl-options
23. Remotion, Hardware acceleration: https://www.remotion.dev/docs/hardware-acceleration
24. Remotion, Electron: https://www.remotion.dev/docs/electron
25. Remotion, Player best practices: https://www.remotion.dev/docs/player/best-practices
26. Remotion, buffer state: https://www.remotion.dev/docs/player/buffer-state
27. Remotion, `<Video>` de @remotion/media: https://www.remotion.dev/docs/media/video
28. Mediabunny, Converting media files: https://mediabunny.dev/guide/converting-media-files
29. Chrome for Developers, WebCodecs: https://developer.chrome.com/docs/web-platform/best-practices/webcodecs
30. MDN, `<canvas>`: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/canvas
31. MDN, transferControlToOffscreen: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/transferControlToOffscreen
32. MDN, createImageBitmap: https://developer.mozilla.org/en-US/docs/Web/API/Window/createImageBitmap
33. three.js, How to dispose of objects: https://threejs.org/docs/manual/en/introduction/How-to-dispose-of-objects.html
34. React Three Fiber, Scaling performance: https://r3f.docs.pmnd.rs/advanced/scaling-performance
35. Intel, memória compartilhada da GPU integrada: https://www.intel.com/content/www/us/en/support/articles/000056339/graphics.html
36. Playwright, ElectronApplication: https://playwright.dev/docs/api/class-electronapplication
37. Estimativa de base do Electron (terceiro, não é medição): https://www.vivianvoss.net/blog/the-electron-tax
38. Pesquisa anterior da casa: `pesquisa-editor-video-ia-2026-11-04/relatorio-2-suite-e-terminal.md`, seção 5.2
39. PR do projeto bb sobre spellcheck e throttling (argumento sem benchmark): https://github.com/get-bb/bb/pull/2934

---

## Conferência

Acessos em 04/11/2026. "Não confirmada" quer dizer que a fonte aberta não trouxe o dado; as afirmações não abertas nesta rodada (itens 13, 31 a 39 da lista de fontes, exceto o Playwright) seguem como estavam e ficam para a fase 0.

| Afirmação | Status | Correção | URL |
|---|---|---|---|
| `concurrency` padrão do Remotion é metade das threads | confirmada | | https://www.remotion.dev/docs/renderer/render-media |
| Desde a 4.0.533 o Remotion não desliga a codificação paralela sozinho; `disallowParallelEncoding` existe | confirmada | | https://www.remotion.dev/docs/renderer/render-media |
| O motor da casa está na 4.0.534 | não confirmada | a doc não cita a versão instalada; conferir no `package.json` | https://www.remotion.dev/docs/renderer/render-media |
| `offthreadVideoCacheSizeInBytes` vai por padrão a até 50% da memória | corrigida | confirmado para `offthreadVideoCacheSizeInBytes` ("50% da memória disponível no início do render"); o padrão de `mediaCacheSizeInBytes` não está documentado nas páginas abertas | https://www.remotion.dev/docs/troubleshooting/sigkill |
| `hardwareAcceleration`: `if-possible`; VideoToolbox no macOS; NVENC só com NVIDIA (Windows e Linux x64), H.264/H.265 | confirmada | valores: `disabled` (padrão), `if-possible`, `required`; sem `crf` com aceleração | https://www.remotion.dev/docs/hardware-acceleration |
| `renderMedia` roda no main, não no renderer; binários fora do `app.asar`; guia não menciona `utilityProcess` | confirmada | | https://www.remotion.dev/docs/electron |
| `<Video>` de `@remotion/media` recomendado; `Html5Video`/`OffthreadVideo` "not optimized"; `npx remotion benchmark` para a concurrency | confirmada | | https://www.remotion.dev/docs/performance |
| `maxCanvasSinkFrameSize` e `premountFor`; decodificação continua em tamanho cheio | confirmada | | https://www.remotion.dev/docs/media/video |
| Remotion pede cuidado com `blur`, `box-shadow` e gradientes | corrigida | a doc os lista como efeitos CSS acelerados por GPU que ficam lentos em nuvem sem GPU e sugere imagem pré-calculada; o texto agora diz isso | https://www.remotion.dev/docs/performance |
| `gl: 'angle'` tem vazamentos conhecidos; dividir vídeos longos; sem WebGL fica o padrão `null` | corrigida | no Remotion 4.0 o padrão local é `null`; `angle` só é padrão na 5.0 | https://www.remotion.dev/docs/gl-options |
| `app.getAppMetrics()`: `privateBytes` só no Windows, valores em KB | confirmada | | https://www.electronjs.org/docs/latest/api/structures/memory-info |
| No macOS `residentSet` não vem e o `private` é a medida mais fiel | não confirmada | a página só lista `workingSetSize`, `peakWorkingSetSize` e `privateBytes`; frase removida | https://www.electronjs.org/docs/latest/api/structures/memory-info |
| `ProcessMetric` traz `type`, `serviceName`, `cpu`, `memory` | confirmada | acrescentados `creationTime`, `name` | https://www.electronjs.org/docs/latest/api/structures/process-metric |
| `utilityProcess` = `fork` com Services API do Chromium, `MessagePortMain`, `serviceName` em `getAppMetrics` | confirmada | | https://www.electronjs.org/docs/latest/api/utility-process |
| Electron 42.3.3 traz cache de código "de fábrica"; ~75 ms até o main e ~130 ms até a primeira pintura | corrigida | as melhorias de partida (incluindo cache de código gerado no build) chegam na 42.3.3, e os tempos são contados desde o spawn do processo, não desde `app.whenReady` | https://f98b35da.electron-website.pages.dev/blog/a-faster-electron |
| xterm.js processa 5 a 35 MB/s; descarta acima de 50 MB; callback a cada 100 KB; marca alta até ~500 KB | confirmada | 50 MB é "à data da escrita" do guia | https://xtermjs.org/docs/guides/flowcontrol/ |
| `scrollback` padrão 1.000; `allowTransparency` pesa no desempenho | confirmada | | https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/ |
| Playwright `_electron`, `evaluate`, `firstWindow`; API na seção Experimental | confirmada | `launch` é documentado na página da classe Electron | https://playwright.dev/docs/api/class-electronapplication |
| `claude`: `--session-id` (UUID), `--resume`, `--bg`, `--mcp-config`, `--strict-mcp-config` | confirmada | `--strict-mcp-config` ignora todas as outras configurações de MCP | https://code.claude.com/docs/en/cli-reference |
| `.mcp.json` aceita `type: "http"`, `headers` e `${VAR}` | confirmada | `streamable-http` é alias | https://code.claude.com/docs/en/mcp |
| Relatos medem 110 a 560 MB por sessão (#61425 e #88524) | corrigida | 110 a 560 MB vem do #88524; o #61425 mostra 372 e 498 MB nos dados (o autor falou em ~700 MB) e foi fechado por inatividade | https://github.com/anthropics/claude-code/issues/88524 |
| ~82 MB por árvore de sidecar; ~390 MB liberados ao arquivar | corrigida | o 82 MB não bate com a tabela do mesmo relato (11 árvores = 1.606 MB, ~146 MB cada); 390 MB ao arquivar confirmado | https://github.com/anthropics/claude-code/issues/88524 |
| Chromium perde o contexto WebGL mais antigo acima de 16 por renderer | corrigida | confirmado só na mudança de 2013 e na fala de 2021 (sem plano de subir o limite); sem doc atual que confirme o 16 | https://codereview.chromium.org/14217005/ |
| GPU integrada usa até metade da RAM do sistema | não confirmada | fonte da Intel não aberta nesta rodada | https://www.intel.com/content/www/us/en/support/articles/000056339/graphics.html |
| xterm.js 6 removeu o canvas; `/terminal-setup` do Claude desliga a GPU no VS Code | não confirmada | vem da pesquisa interna (fonte 38), não aberta nesta rodada | |
| VS Code moveu o pty host para main / utility process | não confirmada | fontes 7 e 8 não abertas nesta rodada | https://github.com/microsoft/vscode/pull/178708 |
| Three.js dispose, R3F `frameloop="demand"`, MDN (`createImageBitmap`, canvas), Mediabunny, WebCodecs | não confirmada | fontes 26 a 34 não abertas nesta rodada; conferir na implementação | |
