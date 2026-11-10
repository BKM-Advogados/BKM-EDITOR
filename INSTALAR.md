# Instalar o Estúdio em outro PC

Windows, Mac e Linux. O que já foi testado em cada sistema e o que falta conferir está em `docs/portes.md`: os pacotes de
Windows e de Mac desta versão foram gerados, mas ainda não foram abertos num Windows nem num Mac.

## Windows

### O que precisa

- **Windows 10 ou 11, 64 bits.** Com 8 GB de RAM funciona; o app usa cerca de 300 MB parado.
- **Claude Code instalado e logado na sua conta**, para conversar com o Claude dentro do app. Para instalar, abra o
  PowerShell e rode o instalador oficial da Anthropic (code.claude.com/docs):

  ```powershell
  irm https://claude.ai/install.ps1 | iex
  ```

  Sem o Claude Code, o Estúdio abre e edita normalmente, só sem o Claude.
- **Git for Windows** (opcional): o Estúdio guarda versões de cada projeto no git. Sem ele, o histórico continua no
  diário do próprio app.

### Instalar

1. Rode o **`Estudio-Setup-<versão>.exe`** (gerado por `npm run instalador:win` num Windows, ou baixado do CI: Actions ›
   Build › artifact `estudio-win-x64`). Sem instalador, o `.zip` portátil também serve: descompacte e abra o
   `Estudio.exe`.
2. Na primeira vez, o Windows pode mostrar "O Windows protegeu o computador", porque o app ainda não tem assinatura
   digital. Clique em **Mais informações** e depois em **Executar assim mesmo**.
3. O instalador não pede administrador. Ele instala na sua pasta de usuário (`%LocalAppData%\Programs\Estudio`), cria
   os atalhos na **área de trabalho** e no **menu Iniciar** e abre o app.

### Primeiro uso

1. O app abre na **tela inicial**. Para começar do zero: em **Novo**, escolha o formato pelo destino (Reels 9:16,
   YouTube 16:9…) e clique em **Em branco**. Os projetos ficam em `%USERPROFILE%\Estudio` (dá para trocar em
   Preferências). Para ver um vídeo pronto, clique em **Ver um pronto**: o app copia o carrossel C2 da Cliente.
2. **Login do Claude, uma vez só:**
   - no painel **Claude**, à direita, clique em **Abrir terminal**;
   - digite `/login` e entre com a sua conta;
   - o login é feito pela Anthropic, no navegador; o Estúdio não vê nem guarda a sua senha;
   - volte à aba da conversa e clique em **Já entrei**.
3. Peça o que quiser na caixa de pedido, ou já na tela inicial, em **Começar conversando**. O Claude vê o que você selecionou e o comentário aberto, e cada mudança dele
   aparece num cartão com **Ver** e **Reverter**.

### Bom saber

- **Exportar vídeo** funciona sem internet: o navegador de render vem dentro do app.
- **Fontes do exemplo:** as composições do exemplo Cliente buscam as fontes no Google Fonts. Na primeira prévia e na
  primeira exportação, o PC precisa estar na internet.
- **Cobrança:** se houver uma `ANTHROPIC_API_KEY` configurada no Windows, o Claude cobra pela API, não pela assinatura.
  O app avisa quando isso acontece.
- **Desinstalar:** Configurações › Aplicativos › Estudio.
- **Microfone (gravar narração):** se o Windows bloquear, libere em Configurações › Privacidade e segurança › Microfone,
  "Permitir que aplicativos da área de trabalho acessem o microfone".
- **Abrir um projeto direto:** arraste a pasta do projeto sobre o atalho do Estúdio.

## Mac (Apple Silicon e Intel)

### O que precisa

- **macOS 12 (Monterey) ou mais novo.** Há um pacote para cada processador: `arm64` (M1, M2, M3, M4…) e `x64` (Intel).
  Em "Sobre este Mac", "Chip Apple" é arm64; "Processador Intel" é x64.
- **Claude Code**, para conversar com o Claude dentro do app. No Terminal: `curl -fsSL https://claude.ai/install.sh | bash`.
- **Para transcrever a fala** (legendas): o pacote feito pelo CI já traz o whisper. Se o painel de legendas pedir, instale
  pelo Homebrew: `brew install whisper-cpp`.
- **Git** (opcional): vem com as ferramentas de linha de comando do Xcode (`xcode-select --install`) ou pelo Homebrew.
  Sem ele o app funciona e não cria pontos de restauração.

### Instalar

1. Descompacte o `Estudio-darwin-<arm64|x64>-<versão>.zip` (ou abra o DMG) e **arraste o `Estudio.app` para
   Aplicativos antes de abrir**.
2. O app ainda não tem assinatura da Apple, então o macOS bloqueia a primeira abertura. No Terminal:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Estudio.app
   ```

   ou abra uma vez, vá em **Ajustes do Sistema › Privacidade e Segurança** e clique em **Abrir mesmo assim**.
   Se o pacote foi gerado no Linux e o app não abrir num Mac Apple Silicon, assine ad hoc (o `codesign` vem no macOS):
   `codesign --force --deep --sign - /Applications/Estudio.app`.
3. Na primeira gravação de narração, o macOS pede o microfone; se negar sem querer, libere em Ajustes do Sistema ›
   Privacidade e Segurança › Microfone.
4. As chaves de IA ficam no Keychain. Enquanto o app não tiver assinatura, a cada versão nova o macOS pergunta se o
   Estúdio pode usar o item "Estudio Safe Storage": digite a senha do Mac e clique em **Sempre permitir**.

Os projetos ficam em `~/Estudio`. Os atalhos usam ⌘ no lugar do Ctrl (⌘N, ⌘O, ⌘S, ⌘W, ⌘Z, ⇧⌘E), e a tecla delete
apaga a seleção. Arrastar a pasta de um projeto no ícone do Estúdio no Dock abre o projeto.

## Linux (Omarchy e outros)

Precisa do Node e do npm (no Omarchy já vêm pelo mise) e, para o Claude dentro do app, do Claude Code no PATH. Na pasta
do código:

```bash
npm install
bash scripts/instalar-linux.sh
```

O script empacota o app, copia para `~/.local/opt/Estudio` e cria o atalho **Estúdio** no lançador de aplicativos
(Super+Espaço no Omarchy). Não pede root. Para atualizar depois de mudar o código, rode o script de novo. Os projetos
ficam em `~/Estudio`.
