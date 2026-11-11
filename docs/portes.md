# Portes: Windows e macOS

> Estado em 10/11/2026, branch `frente/portes-win-mac`, sobre a V3 (tag `v3.0.0`, pacote 1.0.0).
> O Estúdio nasceu no Windows (V1 e V2), foi migrado para o Linux em 09/11/2026 e a V3 saiu do Linux com terminais
> (node-pty), transcrição (whisper.cpp), música renderizada pelo ffmpeg, cofre de chaves (safeStorage), MCP por stdio e
> HTTP, animação e legendas. Este documento revalida o Windows e começa o porte para o Mac.

**Em uma frase:** o código foi revisado e corrigido para os dois sistemas, e os pacotes de Windows (x64) e Mac (arm64 e
x64) foram **gerados a partir do Linux e conferidos por dentro**, mas **nenhum deles foi aberto num Windows ou num Mac
de verdade**. "Empacotado a partir do Linux" não é "testado no Windows": a [lista de verificação](#9-lista-de-verificação-manual)
é o que falta para dizer que funciona.

Legenda das tabelas: ✅ funciona e foi conferido (no Linux, ou no conteúdo do pacote) · 🟡 corrigido ou preparado, só uma
máquina real confirma · ❌ não funciona ou falta · ➖ não se aplica.

---

## 1. Auditoria por recurso

| Recurso | Linux | Windows | macOS | O que foi visto e feito |
|---|---|---|---|---|
| **Pastas** (`app.getPath`) | ✅ `~/.config/Estudio` | 🟡 `%APPDATA%\Estudio` | 🟡 `~/Library/Application Support/Estudio` | Tudo sai de `app.getPath('userData')` e `os.homedir()`; nenhum caminho fixo no código. Projetos e modelos em `~/Estudio` nos três (fora do OneDrive e do iCloud, que travam a gravação atômica). |
| **Cofre de chaves** (safeStorage) | ✅ libsecret, com o switch do mosaico | 🟡 DPAPI (conta do Windows) | 🟡 Keychain ("Estudio Safe Storage") | Nada a mudar: `cofre-arquivo.ts` e `textoDoCofre` já tratam os três. No Mac **sem assinatura**, cada versão nova do app pede de novo a senha do Keychain (a ACL do item é presa à assinatura): clicar em "Sempre permitir". |
| **Compositor do Remotion** (render, ffmpeg, ffprobe) | ✅ `-linux-x64-gnu` | 🟡 `-win32-x64-msvc`, no pacote | 🟡 `-darwin-arm64` ou `-darwin-x64`, no pacote | Empacotado e conferido. No Mac o `ffmpeg` pede `libavcodec.dylib` e as outras **pelo nome curto** (sem `@rpath`), achadas pela pasta atual e pelo `DYLD_LIBRARY_PATH` (o Remotion passa os dois). A extração de áudio da transcrição não passava: corrigido (`ambienteDoFfmpeg`). Com hardened runtime isso exige entitlements próprios (seção 5). |
| **node-pty** (terminais) | ✅ | 🟡 conpty, pré-compilado | 🟡 pré-compilado | `@lydell/node-pty` é N-API, sem recompilar. O pacote leva o núcleo e o binário do alvo. |
| **esbuild / rollup** | ✅ | ➖ | ➖ | Só no build (Vite, `mcp:build`); o `npm ci` de cada sistema instala o binário certo. Não vão no app. |
| **Navegador de render** (Chrome Headless Shell) | ✅ remotion.media | 🟡 `win64`, no pacote (remotion.media) | 🟡 `mac-arm64` (remotion.media) e `mac-x64` (Chrome for Testing), no pacote | **Quebrava** no empacotamento cruzado: o `ensureBrowser` só baixa o do sistema atual e o pacote saía sem navegador (exportar exigiria internet). Agora o `forge.config.ts` baixa o do alvo do mesmo endereço que o Remotion usaria lá (`src/main/navegador-alvo.ts`) e tira as sobras de build do zip do mac-arm64 (`gen/` e `pyproto/`, ~95 MB e 4.500 arquivos). |
| **ffmpeg** (som, música, legendas) | ✅ | 🟡 `ffmpeg.exe` + DLLs ao lado | 🟡 `ffmpeg` + dylibs | Sempre o do compositor, nunca o do sistema. O MCP por stdio do app instalado não achava o ffmpeg (procurava em `resources/node_modules`): corrigido em `caminhoFfmpeg`. |
| **whisper-cli** (transcrição) | 🟡 compilado pela pessoa (PATH ou `bin/`) | 🟡 baixa o binário x64 oficial (SHA-256 preso) | 🟡 embutido pelo CI, ou Homebrew | Seção 6. Antes, no Mac, a única saída era compilar à mão, e o PATH do Finder nem via o Homebrew. |
| **Shell do terminal** | ✅ `$SHELL -l` | 🟡 `powershell.exe -NoLogo` | 🟡 shell da conta (`zsh -l`) | `shellPadrao` (plataforma.ts). No Windows o PATH novo ia **ao lado** do `Path` do sistema e o PowerShell lia o antigo (sem `~\.local\bin`): corrigido (`comPath`). |
| **Achar o `claude`** | ✅ | 🟡 `where`, prefere `.exe`, aceita `.cmd` | 🟡 `which` com PATH ampliado | Aberto pelo Finder, o app recebe `PATH=/usr/bin:/bin:/usr/sbin:/sbin`: sem `~/.local/bin` (instalador oficial), `/opt/homebrew/bin` e `/usr/local/bin` o `claude` não era achado. `caminhoDeBusca` soma essas pastas (e `%APPDATA%\npm` no Windows). Instalações por nvm/fnm continuam fora: o doc recomenda o instalador oficial. |
| **Git** (pontos de restauração) | ✅ | 🟡 Git for Windows (opcional) | 🟡 Xcode CLT ou Homebrew | No Mac, `/usr/bin/git` sem as ferramentas de linha de comando **abre o instalador da Apple** a cada chamada (o app chamava na partida e em cada projeto). Agora só chama um git que existe (`gitDoMac`, `src/main/git.ts`). |
| **Atalhos Ctrl/Cmd** | ✅ | ✅ (Ctrl, como antes) | 🟡 Cmd | Os atalhos usavam só `ctrlKey`: no Mac o Cmd+N/O/S/W/Z/D/K e Cmd+Shift+E não faziam nada, e o Ctrl+W do terminal fechava o projeto. `src/renderer/teclas.ts` decide o modificador; os menus mostram `⌘N`, `⇧⌘E`. Os avisos ("Ctrl+Z desfaz") e dicas de campo ainda dizem Ctrl. |
| **Tecla delete** | ✅ | ✅ | 🟡 | A tecla "delete" do Mac é o Backspace: excluir cena, bloco, clipe, legenda, página e efeito só funcionava com fn+delete. Agora o Backspace apaga a seleção no Mac. |
| **Menu do app** | ➖ (escondido) | ➖ (escondido) | 🟡 | No Mac a barra de menu é do sistema: sem um menu Editar com os papéis, **Cmd+C/Cmd+V não funcionam nos campos de texto**. `menu-do-app.ts`: Estúdio (Sobre, Ocultar, Sair), Editar, Visualizar (tela cheia), Janela, Ajuda. Sem Recarregar (Cmd+R derrubaria terminais e conversas) e sem Fechar janela no Cmd+W (o Cmd+W da casca fecha o projeto). No Windows e no Linux segue o menu padrão do Electron, escondido. |
| **Janela** (barra própria) | ✅ (mosaico sem botões) | ✅ botões à direita (WCO) | 🟡 semáforos à esquerda | Mac: `titleBarStyle: 'hidden'` + `titleBarOverlay: true` + `trafficLightPosition {14, 11}`; a casca e a tela inicial contornam os semáforos pela `env(titlebar-area-x)`. A posição exata só se vê num Mac. |
| **Microfone** (gravar narração) | ✅ | 🟡 | 🟡 | Mac: `NSMicrophoneUsageDescription` no Info.plist (sem ele o macOS derruba o app no `getUserMedia`), entitlement `device.audio-input` para o hardened runtime e pedido pelo sistema (`askForMediaAccess`) no `setPermissionRequestHandler`. Microfone negado mostra onde liberar em cada sistema. |
| **Ícones** | ✅ `.png` | ✅ `.ico` (7 tamanhos, no `.exe`) | 🟡 `.icns` novo | `build/icone.icns` gerado de `build/icone.png` (`scripts/gerar-icns.mjs`, 10 tamanhos até 1024). Conferido que é o `electron.icns` do `.app`. |
| **Abrir pasta por argumento ou arrastar** | 🟡 | 🟡 | 🟡 | Antes não havia. Agora: pasta com `estudio.json` como argumento (atalho, "Abrir com", arrastar a pasta no `Estudio.exe`), na segunda abertura (vai para a primeira) e, no Mac, pasta solta no ícone do Dock (`open-file` + `CFBundleDocumentTypes`). Arrastar a pasta **para dentro da janela** continua sem fazer nada. |
| **Separadores e quebras de linha** | ✅ | ✅ | ✅ | O código monta caminhos com `path.join`; os relativos do projeto viram `/` (`split(path.sep).join('/')`). SRT/VTT importados normalizam CRLF; o diário (`.jsonl`) e o `CLAUDE.md` toleram `\r`. Nada a corrigir. |
| **Nomes proibidos** (`<>:"/\|?*`, CON, NUL…) | ✅ | 🟡 | ✅ | Pasta de projeto, exportações e tomadas gravadas já limpavam os caracteres, mas não os reservados **com extensão** (`nul.x`, `CON.srt`), e música e legendas não olhavam reservados. `src/nucleo/nome-de-arquivo.ts` junta as regras. Ids de documento e de render são do app (ASCII). |
| **Caminho longo** (Windows, 260) | ➖ | 🟡 | ➖ | O Node trata caminho longo sozinho; o risco é nos filhos (ffmpeg, whisper, git) com projeto em pasta funda. O projeto padrão (`%USERPROFILE%\Estudio\<até 60>\midia\<até 60>`) fica perto de 150. Projeto em pasta funda do OneDrive pode passar: ligar `LongPathsEnabled` e `git config --global core.longpaths true`. |
| **Fontes de fallback** | ✅ | ✅ | ✅ | A interface leva Inter e JetBrains Mono (fontsource); as composições carregam as fontes do tema (Google Fonts ou arquivo do kit). Só o que nenhuma fonte cobre (emoji) cai na do sistema e muda de desenho: Segoe UI Emoji, Apple Color Emoji, Noto. |
| **Instância única, progresso na barra** | ✅ | 🟡 barra de tarefas | 🟡 Dock | `requestSingleInstanceLock` e `setProgressBar` são dos três. |
| **MCP por HTTP** | ✅ | 🟡 | 🟡 | `127.0.0.1`, sem diferença por sistema. |
| **MCP por stdio e apps de fora** | ✅ | 🟡 | 🟡 | `process.execPath` + `ELECTRON_RUN_AS_NODE=1` + `resources/dist-mcp/ponte.cjs`. No Mac, app aberto de Downloads sem assinatura roda de um caminho temporário (App Translocation) e a config gravada quebra depois: seção 8. |
| **Assinatura** | ➖ | ❌ sem certificado (SmartScreen) | ❌ sem conta da Apple (Gatekeeper) | Mac: preparado e desligado (seção 5). Windows: sem certificado de assinatura de código; o SmartScreen pede "Executar assim mesmo". |
| **Instalador** | ✅ `scripts/instalar-linux.sh` | ❌ daqui; 🟡 no CI | ❌ daqui; 🟡 no CI | NSIS precisa de Windows ou Wine (seção 4); DMG precisa de Mac (hdiutil). |

### Bloqueadores de cada sistema

**Windows** (revalidar, não portar):
1. Ninguém abriu este pacote num Windows. O código Windows da V2 continua, mas a V3 inteira (terminais, transcrição,
   música, cofre, MCP, animação) só rodou no Linux.
2. O instalador NSIS não sai do Linux sem Wine: sai no CI (`windows-latest`) ou num Windows com `npm run instalador:win`.
3. Sem assinatura de código: SmartScreen na primeira vez (já era assim na V2) e o antivírus da BKM (GravityZone) já
   travou executáveis do app; pode pedir exceção de novo.

**Mac** (porte novo):
1. Ninguém abriu este pacote num Mac. A janela, o menu, os atalhos e o pedido de microfone foram feitos sem ver.
2. Sem conta de desenvolvedor da Apple: o `.app` sai sem assinatura; o Gatekeeper bloqueia e a pessoa precisa do
   "abrir mesmo assim" (seção 5). Sem assinatura também não há notarização.
3. Com assinatura e hardened runtime, o ffmpeg do Remotion só acha as bibliotecas com os entitlements de DYLD
   (`build/entitlements.filhos.plist`). É o caminho previsto, mas **ninguém assinou e rodou um render ainda**.
4. O whisper-cli só vem no app se o CI compilar; o pacote gerado daqui não tem (transcrição pede o Homebrew).
5. DMG só num Mac (CI `macos-15`/`macos-15-intel` ou à mão).

---

## 2. O que foi validado, e onde

| Verificação | Onde | Resultado |
|---|---|---|
| `npm run typecheck` | Linux (Omarchy) | ✅ zero erros |
| `npm test` | Linux | ✅ **922** passando, 3 pulados (888 de antes + 34 de `testes/portes.test.ts`) |
| `npm run mcp:build` | Linux | ✅ |
| Lógica por sistema (janela, PATH, shell, git, atalhos, nomes, whisper, menu, assinatura) | vitest no Linux, com a plataforma injetada | ✅ — é a decisão, não o comportamento do sistema |
| `electron-forge package --platform win32 --arch x64` | **a partir do Linux** | ✅ gerado e conferido por dentro (seção 3); **não executado** |
| `Estudio.exe`: ícone e versão | lido com o `resedit` no Linux | ✅ 7 tamanhos; BKM Advogados, Estúdio, 1.0.0 (sem Wine: o packager 18 usa `resedit`) |
| NSIS (`electron-builder --prepackaged … --win nsis`) | Linux | ❌ `spawn wine ENOENT`: o electron-builder roda o gerador do desinstalador; precisa de Windows ou Wine |
| `electron-forge package --platform darwin --arch arm64` e `x64` | **a partir do Linux** | ✅ gerados e conferidos por dentro; `.zip` com o `.app` (symlinks dos frameworks e bits de execução preservados); **não executados**, **sem assinatura** (nem ad hoc: não há `codesign` no Linux) |
| `Info.plist` do `.app` | lido com `plistlib` | ✅ `br.com.bkmadvogados.estudio`, `NSMicrophoneUsageDescription`, `CFBundleDocumentTypes` (pasta), categoria vídeo, macOS mínimo 12.0 |
| `build/icone.icns` | estrutura conferida (10 blocos PNG, 16 a 1024) | ✅; não aberto no Finder |
| `.github/workflows/build.yml` | YAML conferido no Linux | ✅ sintaxe; **nunca rodou** (sem push) |
| `npm run package` (Linux) com o forge.config novo | Linux | ✅ `out/pacote/Estudio-linux-x64` (647 MB), só com os nativos do Linux mesmo com os de Windows e Mac no `node_modules` |
| App do Linux empacotado, com HOME isolado: pasta de projeto como argumento, Ctrl+W, Meta+W | Linux (Hyprland), pela porta de depuração | ✅ o projeto do argumento abre direto no editor; Ctrl+W fecha e volta ao início; Meta+W não faz nada no Linux; barra igual à da V3 |
| App aberto, render, gravação, transcrição, terminal, cofre, MCP | Windows e Mac | ❌ **não testado**: lista da seção 9 |

---

## 3. Como empacotar, e o que sai

### A partir do Linux (como estes pacotes foram feitos)

```bash
npm ci && node node_modules/electron/install.js
npm run nativos:win            # compositor e node-pty do Windows, com a integridade do package-lock
npm run pacote:win             # out/pacote/Estudio-win32-x64
npm run portatil:win           # out/pacote/make/zip/win32/x64/Estudio-win32-x64-1.0.0.zip
npm run nativos:mac            # compositor e node-pty do Mac (arm64 e x64)
npm run pacote:mac             # out/pacote/Estudio-darwin-{arm64,x64}/Estudio.app + o .zip de cada
```

`scripts/nativos-alvo.mjs` baixa com `npm pack` os pacotes nativos do alvo na versão do `package-lock.json`, confere o
sha512 contra o `integrity` do lock e descompacta em `node_modules`, ao lado dos do Linux (não mexe no `package.json`).
O navegador de render do alvo baixa sozinho na primeira vez (`node_modules/.remotion/chrome-headless-shell/<alvo>`).
O Electron do alvo vem do cache do `@electron/get`.

| Pacote (10/11/2026, gerado no Linux) | Pasta | `.zip` portátil |
|---|---|---|
| Windows x64 | `out/pacote/Estudio-win32-x64`: **768 MB** (navegador 303 MB, compositor 29 MB, node-pty 12 MB, `app.asar` 56 MB) | `out/pacote/make/zip/win32/x64/Estudio-win32-x64-1.0.0.zip`: **325 MB** |
| Mac arm64 | `out/pacote/Estudio-darwin-arm64/Estudio.app`: **737 MB** (navegador 358 MB, nativos 18 MB, `app.asar` 56 MB) | `out/pacote/make/zip/darwin/arm64/Estudio-darwin-arm64-1.0.0.zip`: **274 MB** |
| Mac x64 | `out/pacote/Estudio-darwin-x64/Estudio.app`: **601 MB** | `out/pacote/make/zip/darwin/x64/Estudio-darwin-x64-1.0.0.zip`: **261 MB** |

O navegador de render é metade de cada pacote. O do mac-arm64 sem as sobras de build tem 358 MB; com elas seriam ~450.

### Num Windows

```powershell
npm ci
npm run instalador:win         # pacote + NSIS: Estudio-Setup-2.0.0.exe na raiz (o "npm run instalador" antigo faz o mesmo)
```

### Num Mac

```bash
npm ci
npm run instalador:mac         # pacote + DMG da arquitetura deste Mac: out/instalador/Estudio-2.0.0-arm64.dmg
npm run instalador:mac -- x64  # o Intel, a partir de um Mac Apple Silicon
```

O DMG é do electron-builder (`electron-builder.yml`, `mac:` e `dmg:`), com `identity: null`: ele só monta o DMG e não
assina de novo. A escolha foi não usar o `@electron-forge/maker-dmg`: o `appdmg` dele só instala no Mac e quebraria o
`npm ci` no Windows e no Linux.

### No Linux, nada mudou

`npm run package` e `bash scripts/instalar-linux.sh` continuam iguais (o forge.config só muda o que é do Windows e do Mac).

---

## 4. Windows: o que mudou e o que ficou

- **Instalador:** NSIS por usuário (`%LocalAppData%\Programs\Estudio`), sem administrador, como na V2. Do Linux não sai
  (precisa de Wine para o desinstalador); `npm run instalador:win` num Windows ou o CI.
- **Executável e ícone:** o `@electron/packager` 18 escreve ícone e versão com o `resedit` (JavaScript), então o
  pacote do Windows sai do Linux sem Wine, com ícone. Conferido.
- **Terminal:** PowerShell (`-NoLogo`), PATH com `%USERPROFILE%\.local\bin` (o `claude.exe` do instalador oficial) e
  `%APPDATA%\npm` (o `claude.cmd` do npm), sem o `Path` duplicado.
- **whisper-cli:** baixa o `whisper-bin-x64.zip` oficial do whisper.cpp b5454 com SHA-256 conferido (sem mudança). No
  Windows ARM o app roda como x64 emulado e usa o mesmo binário.
- **Nomes:** `nome-de-arquivo.ts` cobre CON, NUL, COM1–9, LPT1–9 também com extensão.

---

## 5. Mac: assinatura, notarização e "abrir mesmo assim"

### Sem conta da Apple (como sai hoje)

Num Mac sem certificado (o CI sem os secrets), o empacotamento **assina ad hoc** o `.app` inteiro (`identity: '-'`,
sem hardened runtime): o Apple Silicon não roda binário com assinatura inválida, e o packager mexe no Info.plist e nos
auxiliares do Electron depois da assinatura ad hoc que vem com ele. Fora do Mac não há `codesign`: **o pacote feito no
Linux sai com essas assinaturas desencontradas** (passo 3 abaixo). Assinatura ad hoc não é da Apple: o Gatekeeper
bloqueia do mesmo jeito. Para abrir:

1. Descompacte o `.zip` e **arraste o `Estudio.app` para Aplicativos antes de abrir**. Aberto de Downloads, o macOS
   roda o app de uma cópia temporária (App Translocation) e as configurações do MCP gravadas por ele apontam para um
   caminho que some.
2. Tire a quarentena no Terminal:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Estudio.app
   ```

   Ou, sem Terminal: abra uma vez (o macOS recusa), vá em **Ajustes do Sistema › Privacidade e Segurança** e clique em
   **Abrir mesmo assim**. No macOS 15 o clique com Control › Abrir não pula mais o Gatekeeper.
3. **Só no pacote gerado no Linux** (o do CI já vem coerente): se o app não abrir ou fechar na hora no Apple Silicon,
   assine ad hoc no próprio Mac (o `codesign` vem no macOS, sem Xcode):

   ```bash
   codesign --force --deep --sign - /Applications/Estudio.app
   ```

Se o macOS disser que o app "está danificado", é a quarentena (passo 2) ou a assinatura desencontrada (passo 3).

### Com conta da Apple (preparado, desligado)

`build/mac.ts` liga a assinatura e a notarização **só num Mac e só com as variáveis no ambiente**:

| Variável | Para quê |
|---|---|
| `ESTUDIO_MAC_IDENTIDADE` | o certificado do keychain, ex.: `Developer ID Application: BKM Advogados (ABCDE12345)`. Liga a assinatura com hardened runtime |
| `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | notarização pela chave da API do App Store Connect (preferida; `APPLE_API_KEY` é o caminho do `.p8`) |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | notarização pelo Apple ID com senha de app |
| `ESTUDIO_MAC_ADHOC=0` | sem identidade, desliga a assinatura ad hoc (o padrão num Mac é assinar ad hoc) |
| `ESTUDIO_WHISPER_EMBUTIDO` | caminho de um `whisper-cli` compilado, que vai para `Contents/Resources/whisper` |

Entitlements (hardened runtime):

- `build/entitlements.mac.plist` (o app e os auxiliares do Electron): `cs.allow-jit` e
  `cs.allow-unsigned-executable-memory` (V8), `cs.disable-library-validation` (o `.node` do node-pty) e
  `device.audio-input` (gravar narração).
- `build/entitlements.filhos.plist` (compositor do Remotion, navegador de render, whisper-cli): os do V8 mais
  `cs.allow-dyld-environment-variables` e `cs.disable-library-validation`, porque o ffmpeg do Remotion acha as dylibs
  pelo `DYLD_LIBRARY_PATH`. A alternativa mais fechada, para depois: no CI, reescrever as dependências com
  `install_name_tool -change libavcodec.dylib @loader_path/libavcodec.dylib` antes de assinar, e tirar esses dois.

O que fazer para ligar: conta Apple Developer (US$ 99/ano), certificado **Developer ID Application** exportado em
`.p12`, e os secrets do CI (cabeçalho do `build.yml`). Depois de notarizado, o "abrir mesmo assim" deixa de ser preciso.

---

## 6. whisper-cli no Mac: a estratégia

O whisper.cpp só publica binário pronto do Windows x64. No Mac, em ordem (`acharWhisperCli`):

1. **O da pasta do whisper** (`~/Estudio/modelos/whisper/bin/whisper-cli`): quem quiser trocar põe o seu ali.
2. **O que vem no app** (`Estudio.app/Contents/Resources/whisper/whisper-cli`): o CI compila a versão presa do app
   (v1.9.5), estática (`BUILD_SHARED_LIBS=OFF`), com Metal embutido no arm64 e sem instruções nativas no x64
   (`GGML_NATIVE=OFF`, para rodar em qualquer Intel), alvo macOS 12. Um binário só, assinado junto com o app.
3. **O do Homebrew** (`brew install whisper-cpp`, em `/opt/homebrew/bin` ou `/usr/local/bin`), achado mesmo com o PATH
   curto do Finder. A versão do Homebrew anda sozinha; as opções que o app usa (`-ojf`, `--vad`, `-vm`) existem desde a
   1.7.6.

Sem nenhum dos três, o painel de legendas diz para instalar pelo Homebrew. Os modelos (small, base, VAD) baixam como
nos outros sistemas, com SHA-256.

Não foi feito: publicar o binário do Mac num lançamento próprio com SHA-256 para baixar no primeiro uso, como no
Windows. Fica como alternativa se o app embutido pesar (são ~3 MB).

---

## 7. CI (`.github/workflows/build.yml`)

**Como disparar:** Actions › **Build** › **Run workflow** (`workflow_dispatch`, só para o que já está no `main`), subindo
uma tag `v*` (`git tag v3.1.0 && git push origin v3.1.0`) ou subindo um branch `ci/*` (`git push origin HEAD:ci/<nome>`),
que valida um branch antes do `main`. Não roda em push comum nem em PR. Acompanhar: `gh run list --branch ci/<nome>` e
`gh run view <id> --log-failed`.

**Matriz:** `ubuntu-latest` (Linux x64), `windows-latest` (Windows x64), `macos-15` (Mac Apple Silicon; o `macos-14` deixou de ser aceito em 10/11/2026) e
`macos-15-intel` (Mac Intel). O `macos-13` pedido no início foi aposentado pelo GitHub em dezembro de 2025; o
`macos-15-intel` é a imagem Intel que ficou (prevista até agosto de 2027). Se ela também sair, o Intel passa a sair do
`macos-14` com `--arch x64` (o x64 empacota num Apple Silicon; o whisper x64 precisaria de compilação cruzada com
`-DCMAKE_OSX_ARCHITECTURES=x86_64`).

**Em cada sistema:** `npm ci` (cache do npm pelo `setup-node`), Electron, cache do navegador de render, `typecheck`,
`test`, `mcp:build`, pacote e `.zip` portátil, e o instalador (NSIS no Windows, DMG no Mac). Os arquivos sobem como
artifact `estudio-<sistema>-<arch>` por 14 dias. No Mac, compila o whisper-cli e assina e notariza **só se os secrets
existirem**; sem eles, o `.app` sai sem assinatura e o passo de conferência só mostra o `codesign -dv`.

**Testes fora do Linux:** a suíte passou inteira no Windows, no Mac Apple Silicon e no Mac Intel do CI em 10/11/2026
(execução 42860394514: 1018 a 1020 testes, nenhuma falha), depois de três ajustes de portabilidade nos testes (LF no
checkout, caminhos pelo sistema pedido, o ffmpeg do Mac com as bibliotecas). Desde então teste vermelho segura o pacote
em qualquer sistema.

**Quanto custa:** em repositório privado, o minuto do Linux conta 1, o do Windows 2 e o do **Mac 10**. Estimativa por
execução completa (sem cache quente): Linux ~12 min (12), Windows ~20 min (40), Mac arm64 ~30 min (300), Mac Intel
~35 min (350): **~700 minutos da cota por execução**, quase tudo do Mac. A cota incluída é de 2.000 min/mês no plano Free
e 3.000 no Team: dá 3 ou 4 execuções completas por mês sem pagar. Para economizar: rodar só por tag, ou tirar uma
das linhas do Mac da matriz quando não for lançamento. (Os valores da cota e o preço do minuto excedente mudam;
conferir em docs.github.com, "billing for GitHub Actions", antes de ligar.)

---

## 8. O que as outras frentes precisam respeitar

Para a **frente/integracao-ide** (`.mcp.json`, `.claude/settings.local.json`, `t3.json`, `ver_quadro`/`ver_trecho`):

| | Windows (NSIS) | Mac | Linux (`instalar-linux.sh`) |
|---|---|---|---|
| Executável | `%LOCALAPPDATA%\Programs\Estudio\Estudio.exe` | `/Applications/Estudio.app/Contents/MacOS/Estudio` | `~/.local/opt/Estudio/Estudio` |
| `nucleo.cjs` | `%LOCALAPPDATA%\Programs\Estudio\resources\dist-mcp\nucleo.cjs` | `/Applications/Estudio.app/Contents/Resources/dist-mcp/nucleo.cjs` | `~/.local/opt/Estudio/resources/dist-mcp/nucleo.cjs` |
| Compositor (ffmpeg) | `resources\app.asar.unpacked\node_modules\@remotion\compositor-win32-x64-msvc\` | `Contents/Resources/app.asar.unpacked/node_modules/@remotion/compositor-darwin-<arch>/` | `resources/app.asar.unpacked/node_modules/@remotion/compositor-linux-x64-gnu/` |
| Navegador de render | `resources\app.asar.unpacked\remotion-browser\win64\…\chrome-headless-shell.exe` | `…/remotion-browser/mac-<arm64\|x64>/…/chrome-headless-shell` | `…/remotion-browser/linux64/…` |

- **Nunca escrever esses caminhos fixos:** sair sempre de `process.execPath` e `process.resourcesPath` (o zip portátil
  do Windows roda de qualquer pasta, e no Mac o app pode estar fora de Aplicativos).
- **Mac, App Translocation:** se `process.execPath` contém `/AppTranslocation/`, o app está rodando de uma cópia
  temporária (aberto de Downloads, com quarentena). Não gravar configuração com esse caminho: avisar para mover o
  `Estudio.app` para Aplicativos e abrir de novo.
- **`ELECTRON_RUN_AS_NODE=1`** depende do fuse `RunAsNode` do Electron ligado (o padrão). Se alguém desligar fuses para
  endurecer o app, o MCP por stdio e a ponte dos apps de fora param.
- **Windows:** caminhos com espaço (`C:\Users\Ana Souza\…`) vão sem aspas no `command` do JSON (o Claude não usa
  shell); `JSON.stringify` cuida das barras invertidas.
- **Render fora do app (`ver_quadro`):** no app empacotado, o `binariesDirectory` é a pasta do compositor acima e o
  `browserExecutable` sai de `getPackagedBrowserPaths` com `projectRoot` = `resources/app.asar`. No Mac o Remotion põe o
  `DYLD_LIBRARY_PATH` sozinho; quem rodar o ffmpeg direto usa `opcoesDoFfmpeg`/`ambienteDoFfmpeg`
  (`src/nucleo/ffmpeg-ambiente.ts`), inclusive as fixtures dos testes: sem ele o ffmpeg do Mac aborta (SIGABRT).
  `testes/portes.test.ts` confere que todo spawn do ffmpeg no código e nos testes passa por ali.
- **MCP por stdio e o ffmpeg:** `caminhoFfmpeg` agora acha o ffmpeg com a raiz em `resources` (era o caso do
  `nucleo.cjs` instalado, que transcrevia só no desenvolvimento).

Para a **frente/narracao-ia**: os arquivos gerados em `midia/narracao` devem passar por `nomeDeArquivo`
(`src/nucleo/nome-de-arquivo.ts`) se o nome vier de texto da pessoa; a chave do Cloud TTS no cofre segue o mesmo
`safeStorage` (Keychain no Mac, com o pedido de senha a cada versão sem assinatura).

---

## 9. Lista de verificação manual

Para rodar num Windows 10/11 x64 e num Mac (um Apple Silicon e, se houver, um Intel), com o pacote do CI ou de
`npm run instalador:win` / `npm run instalador:mac`. Anotar sistema, versão e o que falhou.

**Instalar e abrir**
- [ ] Windows: o NSIS instala sem pedir administrador, cria atalho na área de trabalho e no Iniciar; SmartScreen com
      "Executar assim mesmo"; o antivírus não bloqueia.
- [ ] Mac: o `.app` vai para Aplicativos e abre depois do `xattr` (ou do "Abrir mesmo assim"); ícone certo no Dock e
      no Finder. Com o pacote feito no Linux, anotar se precisou do `codesign --force --deep --sign -`.
- [ ] A janela abre com a barra própria: no Windows os três botões à direita sem cobrir nada; no Mac os semáforos à
      esquerda, alinhados no meio da barra, sem cobrir o logo nem o nome do projeto (tela inicial e editor).
- [ ] Mac: menu Estúdio › Sobre mostra 2.0.0 e BKM Advogados; Cmd+Q sai; Cmd+H oculta; Cmd+M minimiza.
- [ ] Abrir de novo com o app aberto traz a janela para a frente (não abre outra).

**Projeto**
- [ ] Criar projeto em branco (vídeo 9:16): a pasta nasce em `~/Estudio` (`%USERPROFILE%\Estudio`).
- [ ] Nome de projeto `CON` e `nul.x` cria `Projeto CON` / `Projeto nul.x` (Windows).
- [ ] Atalhos: Ctrl (Windows) / Cmd (Mac) + N, O, S, W, Z, D, K, Shift+E; Alt/Option+1…6 troca de área.
- [ ] Mac: Cmd+C, Cmd+V, Cmd+A e Cmd+Z dentro de um campo de texto; a tecla delete apaga a cena ou o bloco selecionado.
- [ ] Ver um exemplo abre e a prévia toca (só quando a instalação traz `exemplos/`; sem ela o botão não aparece).
- [ ] Pasta de projeto: arrastar no `Estudio.exe` / no ícone do Dock abre o projeto (com o app fechado e aberto).
- [ ] Git: ponto de restauração com Ctrl/Cmd+S. Mac sem as ferramentas do Xcode: o app **não** abre o instalador da
      Apple e avisa que não há git.

**Exportar**
- [ ] Exportar MP4 H.264 9:16 de um vídeo de cenas **sem internet** (o navegador vem no app); o arquivo toca.
- [ ] Exportar vários destinos (9:16 e 16:9) e cancelar no meio: o arquivo pela metade some.
- [ ] Barra de progresso na barra de tarefas (Windows) / no Dock (Mac).
- [ ] Música: exportar WAV, M4A e Opus (o ffmpeg do compositor codifica).
- [ ] Mac assinado (quando houver): o mesmo export, para confirmar que o ffmpeg acha as dylibs com hardened runtime.

**Som e fala**
- [ ] Gravar narração: Mac pede o microfone na primeira vez (texto do Info.plist); negar e tentar de novo mostra onde
      liberar; liberar em Ajustes e gravar funciona. Windows: com a chave "apps da área de trabalho" desligada, a
      mensagem aponta para ela.
- [ ] Transcrever: Windows baixa o whisper (9 MB) e o modelo small (190 MB) e transcreve; Mac com o whisper embutido
      (pacote do CI) transcreve; Mac sem ele avisa do Homebrew, e com `brew install whisper-cpp` transcreve.
- [ ] Limpeza de voz e medidor de loudness num clipe.

**Claude e terminal**
- [ ] O app acha o `claude` instalado pelo instalador oficial (Windows: `claude.exe`; Mac: `~/.local/bin/claude`) e
      pelo npm (`claude.cmd` / Homebrew).
- [ ] Aba de terminal: PowerShell (Windows) / zsh com o perfil da pessoa (Mac); `claude --version` roda dentro dele;
      Ctrl+C e Ctrl+W funcionam no terminal sem fechar o projeto.
- [ ] Conversa com o Claude: `/login` pelo terminal, "Já entrei", um pedido que muda o documento e o Reverter.

**Cofre e MCP**
- [ ] Configurações › IA: gravar uma chave; fechar e abrir o app; a chave continua (Windows: "na sua conta do Windows";
      Mac: "no Keychain deste Mac"). Mac sem assinatura: depois de trocar de versão, o Keychain pede a senha.
- [ ] MCP por HTTP: um app de fora (Cursor ou VS Code) conectado pela config HTTP lê o projeto.
- [ ] MCP por stdio: a config stdio (Claude Desktop) com o executável do app e `ELECTRON_RUN_AS_NODE=1` lista as
      ferramentas e transcreve (o ffmpeg em `app.asar.unpacked`).
- [ ] Mac aberto de Downloads (sem mover): o caminho das configs mostra `AppTranslocation` (deve ser recusado quando a
      frente IDE tratar).

---

## 10. Decisões registradas

- **Mac por arquitetura, não universal.** O pacote universal juntaria dois navegadores de render (o `ensureBrowser` não
  serve ao universal), dois compositores e dois whisper: mais de 1 GB. Um `.zip`/DMG por arquitetura.
- **Menu só no Mac.** No Windows e no Linux continua o menu padrão do Electron, escondido (`autoHideMenuBar`), como na V3.
- **Permissões:** o handler novo libera tudo como o padrão do Electron fazia, menos o microfone no Mac, que passa pelo
  pedido do sistema.
- **Sobras do navegador fora do pacote:** `gen/` e `pyproto/` do zip mac-arm64 da remotion.media são do build do
  Chromium (devtools e protobufs do Python); o headless shell não os lê.
- **DMG pelo electron-builder**, não pelo `maker-dmg` do Forge (o `appdmg` só instala no Mac).
- **Entitlements de DYLD só nos binários filhos**, não no app.
- **CI sem rodar sozinho** (só `workflow_dispatch` e tags) por causa do custo do Mac.

---

## 11. Próximos passos

1. **Rodar o CI uma vez** (Run workflow) e baixar os quatro artifacts: confirma o NSIS, o DMG, o whisper do Mac e a
   suíte de testes no Windows e no Mac.
2. **Passar a lista da seção 9 num Windows** (o PC da BKM onde a V2 rodava) e **num Mac**. Abrir cada falha como item
   desta frente.
3. **Conta Apple Developer**: com ela, os secrets do CI e uma execução assinada para provar o render com hardened runtime.
4. Trocar os textos "Ctrl+Z desfaz" e as dicas de campo por `rotuloDoAtalho` (hoje só menus e botões mudam no Mac).
5. Arrastar uma pasta de projeto para dentro da janela (hoje só no ícone).
6. Certificado de assinatura de código para o Windows, se o SmartScreen ou o antivírus atrapalharem.
