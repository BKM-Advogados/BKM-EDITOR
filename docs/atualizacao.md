# Atualização automática

> Estado em 11/11/2026, branch `frente/atualizacao`. Entra na 2.0.1 (tag `v4.0.1`).

O Estúdio procura a última release do GitHub (`BKM-Advogados/BKM-EDITOR`) 15 segundos depois de abrir e depois a cada
6 horas. No Windows, baixa sozinho e instala ao fechar. No Mac e no Linux, avisa e abre o download certo no navegador. No
Linux instalado pelo `scripts/instalar-linux.sh`, também troca a pasta do app, se a pessoa confirmar.

**Quem tem a 2.0.0 precisa instalar a 2.0.1 à mão uma vez.** A 2.0.0 não tem o atualizador. Da 2.0.1 em diante, as
versões novas chegam sozinhas (Windows) ou com aviso (Mac e Linux).

## Em cada sistema

### Windows: baixa e instala sozinho

- Quem procura é o `electron-updater` (NsisUpdater), com o provider `github`.
- Ele lê a release marcada como "Latest" (a mais nova que não é pre-release) e o `latest.yml` dela.
- Compara o `version` do `latest.yml` com a versão do app. Maior: baixa em silêncio.
- O `.blockmap` permite baixar só os blocos que mudaram. Se o diferencial falhar, baixa o instalador inteiro.
- O download é conferido pelo `sha512` do `latest.yml`.
- Baixada, a versão instala quando a pessoa fecha o Estúdio (instalador em silêncio). O botão "Reiniciar e atualizar"
  do aviso instala na hora e reabre o app.
- Sem assinatura de código: o `app-update.yml` não tem `publisherName`, então o updater não confere assinatura. A
  integridade vem do `sha512`, que sai da mesma release (não protege de uma release adulterada).
- Instalação por usuário (`perMachine: false`): o `latest.yml` sai sem `isAdminRightsRequired` e nada pede administrador.
- "Pular esta versão" não existe no Windows: a versão já baixou e instala ao fechar.
- Arquivos no PC: `%APPDATA%\Estudio\atualizacao\app-update.yml` e o cache do download em `%LOCALAPPDATA%\estudio-updater`.

**Por que o app escreve o próprio `app-update.yml`.** O instalador sai de `electron-builder --prepackaged` sobre o pacote
do Forge. Nesse caminho o electron-builder não grava o `resources/app-update.yml` (o passo que grava só roda quando ele
mesmo empacota). Então o app escreve o arquivo em `userData` e aponta o updater para ele. O conteúdo é o que o
electron-builder gravaria a partir do bloco `publish` do `electron-builder.yml`; um teste confere os dois.

### Mac: só aviso

- O aviso mostra as novidades e o botão "Baixar o DMG", que abre no navegador o DMG da arquitetura: `arm64` no Apple
  Silicon (inclusive o app x64 aberto pelo Rosetta) e `x64` no Intel.
- Por que não instala sozinho: o atualizador do Mac (Squirrel.Mac) só aceita uma versão nova com a mesma assinatura
  Developer ID válida da instalada. O app ainda sai sem assinatura nem notarização, então a troca automática falharia.
  O Gatekeeper também pede o "Abrir mesmo assim" a cada app novo.
- Quando houver certificado e notarização (secrets do CI, `docs/portes.md`), dá para ligar o MacUpdater (zip e
  `latest-mac.yml`). Fica para depois.

### Linux

- Zip descompactado em qualquer pasta: aviso com "Baixar o zip".
- Instalado pelo `scripts/instalar-linux.sh` (executável em `~/.local/opt/Estudio/Estudio`): o aviso também tem
  "Atualizar agora", que pede confirmação e então:
  1. baixa `Estudio-linux-x64-<versão>.zip` para `~/.local/opt/Estudio.baixando`, calculando o SHA-256;
  2. confere com o `SHA256SUMS.txt` da release. Não bateu: recusa e apaga o download;
  3. extrai (`unzip`, ou `bsdtar`) e deixa o app pronto em `~/.local/opt/Estudio.novo`;
  4. no "Reiniciar e atualizar", fecha o projeto, troca as pastas (`Estudio` vira `Estudio.antigo`, `Estudio.novo`
     vira `Estudio`) e reabre pelo executável novo;
  5. a abertura seguinte apaga `Estudio.antigo`, `Estudio.baixando` e um `Estudio.novo` que tenha sobrado.
- O atalho (`.desktop`) e o ícone ficam como estão.
- O aviso também mostra o comando para atualizar pelo terminal, a partir do clone do repositório:
  `git pull && bash scripts/instalar-linux.sh`.
- Linux ARM: a release não tem zip, e o aviso leva à página da release.

### Em desenvolvimento

- Com o app sem empacotar (`npm run dev`), nada é procurado. Preferências diz isso.
- Na prévia web, `?atualizacao=aviso`, `?atualizacao=linux` ou `?atualizacao=windows` na URL mostra o aviso.

## O que a pessoa vê

- Um cartão no canto da janela, na tela inicial e no editor. Não tranca nada.
- Mac e Linux: as novidades (o texto da release), "Baixar", "Pular esta versão" e "Lembrar depois".
- Windows: o cartão só aparece com a versão já baixada: "Reiniciar e atualizar" ou "Depois" (instala ao fechar).
- "Lembrar depois" esconde o cartão até a próxima procura, ou até "Mostrar o aviso" nas Preferências.
- "Pular esta versão" grava a versão nas preferências. A procura automática não avisa mais dela; uma versão mais nova
  avisa normalmente; o "Procurar agora" mostra mesmo a pulada.
- Preferências › Atualizações: "Procurar atualizações automaticamente" (ligado por padrão), "Procurar agora" com o
  resultado, a versão instalada e a hora da última procura.
- Sem rede, a procura automática fica em silêncio. Só o "Procurar agora" diz que falhou.
- O reinício espera o que está em andamento: a exportação (vídeo no processo principal; imagem, carrossel e música na
  tela), a gravação da narração e o documento sendo salvo. O cartão diz "Reinício marcado" e tem "Cancelar o reinício".

## Tag e versão

- A tag segue o produto: `v4.0.1` (Estúdio V4).
- O pacote tem a sua numeração: `2.0.1` (`package.json`, `app.getVersion()`).
- O app compara sempre a versão do pacote, nunca a tag:
  - Mac e Linux leem a versão do nome dos arquivos da release (`Estudio-Setup-2.0.1.exe`, `Estudio-2.0.1-arm64.dmg`,
    `Estudio-linux-x64-2.0.1.zip`);
  - Windows lê o `version` do `latest.yml`.
- Os nomes dos arquivos são contrato. Não renomeie nada na release. O `scripts/publicar-release.mjs` usa os nomes certos.
- Versão de teste: hífen na tag ou na versão (`v4.0.2-teste.1`, `2.0.2-teste.1`), ou release marcada como pre-release.
  Ninguém a recebe, a não ser no modo de teste.
- Rascunho (draft) nunca conta.

## Publicar uma versão

1. Suba a versão no `package.json` (ex.: `2.0.2`) e faça o commit.
2. Crie e suba a tag: `git tag v4.0.2 && git push origin v4.0.2`. O CI (`build.yml`) roda na tag. Também serve uma
   execução de um branch `ci/*`: nesse caso o script cria a tag no commit que o CI compilou.
3. Espere o CI terminar verde nas quatro linhas. Ache o id: `gh run list --workflow build.yml --limit 5`.
4. Escreva as novidades num arquivo `.md`. É este texto que o app mostra no aviso.
5. Ensaie: `node scripts/publicar-release.mjs --execucao <id> --tag v4.0.2 --notas notas.md --seco`.
6. Publique: o mesmo comando, sem `--seco`.

O script:

- baixa os artifacts com `gh run download` para `out/release/<tag>-artifacts` (no disco: são uns 2 GB);
- junta em `out/release/<tag>` os arquivos da release, com os nomes que o app procura;
- confere o `latest.yml` (versão, nome e `sha512` do instalador, `.blockmap` ao lado);
- gera o `SHA256SUMS.txt` de todos os arquivos;
- confere que a release não existe e que a tag, se já existe, é do commit que o CI compilou;
- roda `gh release create <tag> ... --title ... --notes-file ...`. Pre-release quando a tag ou a versão têm hífen, ou
  com `--pre`.

Usa o `gh` já logado. Nenhum token passa pelo script. `--pasta <pasta>` troca o download por uma pasta de artifacts já
baixada; `--parcial` aceita faltar o arquivo de algum sistema; `--titulo` troca o título padrão (`Estúdio V4 (2.0.2)`).

Arquivos da release (versão 2.0.2 como exemplo):

| Arquivo | De onde vem | Para quê |
|---|---|---|
| `Estudio-Setup-2.0.2.exe` | artifact `estudio-win-x64` | instalador do Windows |
| `Estudio-Setup-2.0.2.exe.blockmap` | artifact `estudio-win-x64` | download diferencial do Windows |
| `latest.yml` | artifact `estudio-win-x64` | atualização do Windows |
| `Estudio-2.0.2-arm64.dmg` | artifact `estudio-mac-arm64` | Mac Apple Silicon |
| `Estudio-2.0.2-x64.dmg` | artifact `estudio-mac-x64` | Mac Intel |
| `Estudio-linux-x64-2.0.2.zip` | artifact `estudio-linux-x64` | Linux, e a troca da pasta |
| `Estudio-2.0.2.mcpb` | artifact `estudio-claude-desktop`, se existir | extensão do Claude Desktop |
| `SHA256SUMS.txt` | gerado pelo script | conferência; o Linux do script exige |

Os zips portáteis do Windows e do Mac ficam de fora, como na v4.0.0. Continuam no artifact da execução (14 dias).

## Testar uma atualização de verdade

O modo de teste aceita pre-releases e versões com hífen. Ligue com `ESTUDIO_ATUALIZACAO_TESTE=1` ao abrir o app
instalado:

- Windows (PowerShell): `$env:ESTUDIO_ATUALIZACAO_TESTE=1; & "$env:LOCALAPPDATA\Programs\Estudio\Estudio.exe"`
- Mac: `ESTUDIO_ATUALIZACAO_TESTE=1 /Applications/Estudio.app/Contents/MacOS/Estudio`
- Linux: `env -u ELECTRON_RUN_AS_NODE ESTUDIO_ATUALIZACAO_TESTE=1 ~/.local/opt/Estudio/Estudio`

Roteiro:

1. Instale a versão atual (ex.: 2.0.1).
2. Num branch, ponha `2.0.2-teste.1` no `package.json` e rode o CI (`git push origin HEAD:ci/teste-atualizacao`).
3. Publique como pre-release: `node scripts/publicar-release.mjs --execucao <id> --tag v4.0.2-teste.1 --notas notas.md`.
4. Abra o app instalado com a variável. Em 15 segundos (ou no "Procurar agora") o aviso aparece.
5. Windows: espere o download, clique em "Reiniciar e atualizar" e confira a versão em Preferências. Linux do script:
   "Atualizar agora" e depois "Reiniciar e atualizar". Mac: "Baixar o DMG" abre o navegador.
6. Feche o app, abra de novo sem a variável e confira que a pre-release não aparece para quem não está testando.
7. Apague o teste: `gh release delete v4.0.2-teste.1 --repo BKM-Advogados/BKM-EDITOR --cleanup-tag`.

No modo de teste, o Windows pega a release mais recente do feed do GitHub (a última criada), e o Mac e o Linux, a de
versão mais alta entre as dez últimas.

## O que só uma máquina real confirma

- **Windows:** o download pelo electron-updater no app empacotado, a instalação em silêncio ao fechar, o "Reiniciar e
  atualizar" com a reabertura, e o antivírus do escritório deixando rodar o instalador baixado (ele derrubava o Squirrel, motivo
  da troca para o NSIS). Também o download diferencial pelo `.blockmap`.
- **Mac:** o aviso e o DMG certo no Apple Silicon e no Intel (Rosetta).
- **Linux do script:** a troca da pasta com o app aberto e a reabertura pelo executável novo.

O que já foi conferido sem essas máquinas:

- o NsisUpdater de verdade (fora do Electron, com HTTP de mentira) lê o `app-update.yml` de `userData`, acha a tag
  `v4.0.1` com o `latest.yml` da 2.0.1 e só vê pre-release no modo de teste;
- o NSIS gerado no Linux (com um `wine` de mentira que extrai o desinstalador como o electron-builder faz no macOS)
  grava o `latest.yml` com `version`, `path` e `sha512` certos e o `.blockmap` ao lado. Sem wine de verdade o NSIS não
  sai no Linux; o CI gera no Windows;
- a troca de pastas do Linux, numa pasta temporária, com SHA errado recusado.

## Privacidade e limites

- A procura do Mac e do Linux manda à API do GitHub só o `User-Agent: Estudio/<versão>`. Nada da pessoa vai junto.
- A API do GitHub sem token aceita 60 pedidos por hora por endereço de IP. Cada app faz uma procura ao abrir e uma a
  cada 6 horas.
- O Windows não usa a API: lê o feed e a página da release no github.com.

## Onde está

- `src/nucleo/atualizacao.ts`: versões, arquivo por sistema, endereços permitidos, `SHA256SUMS.txt`, decisão e procura.
- `src/main/atualizacao.ts`: quando procurar, o estado da tela, o reinício que espera.
- `src/main/atualizacao-windows.ts` e `src/main/atualizacao-linux.ts`: os motores.
- `src/compartilhado/atualizacao.ts`: canais e tipos.
- `src/renderer/componentes/AvisoAtualizacao.tsx` e `src/renderer/estado/ocupado.ts`: o aviso, as Preferências e o
  que segura o reinício.
- `scripts/publicar-release.mjs` e `scripts/conferir-latest-yml.mjs`: a release.
- Testes: `testes/atualizacao.test.ts`, `testes/atualizacao-motores.test.ts`, `testes/publicar-release.test.ts`.
