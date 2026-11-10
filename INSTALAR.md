# Instalar o Estúdio em outro PC (Windows)

## O que precisa

- **Windows 10 ou 11, 64 bits.** Com 8 GB de RAM funciona; o app usa cerca de 300 MB parado.
- **Claude Code instalado e logado na sua conta**, para conversar com o Claude dentro do app. Para instalar, abra o
  PowerShell e rode o instalador oficial da Anthropic (code.claude.com/docs):

  ```powershell
  irm https://claude.ai/install.ps1 | iex
  ```

  Sem o Claude Code, o Estúdio abre e edita normalmente, só sem o Claude.
- **Git for Windows** (opcional): o Estúdio guarda versões de cada projeto no git. Sem ele, o histórico continua no
  diário do próprio app.

## Instalar

1. Rode o **`Estudio-Setup-0.3.0.exe`**.
2. Na primeira vez, o Windows pode mostrar "O Windows protegeu o computador", porque o app ainda não tem assinatura
   digital. Clique em **Mais informações** e depois em **Executar assim mesmo**.
3. O instalador não pede administrador. Ele instala na sua pasta de usuário (`%LocalAppData%\Programs\Estudio`), cria
   os atalhos na **área de trabalho** e no **menu Iniciar** e abre o app.

## Primeiro uso

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

## Bom saber

- **Exportar vídeo** funciona sem internet: o navegador de render vem dentro do app.
- **Fontes do exemplo:** as composições do exemplo Cliente buscam as fontes no Google Fonts. Na primeira prévia e na
  primeira exportação, o PC precisa estar na internet.
- **Cobrança:** se houver uma `ANTHROPIC_API_KEY` configurada no Windows, o Claude cobra pela API, não pela assinatura.
  O app avisa quando isso acontece.
- **Desinstalar:** Configurações › Aplicativos › Estudio.

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
