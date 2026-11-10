// Menu do app no Mac. No Windows e no Linux a janela não tem barra de menu (a casca desenha a dela) e o menu padrão do
// Electron fica escondido. No Mac a barra de menu é do sistema e sempre aparece: sem um menu Editar com os papéis de
// copiar e colar, o Cmd+C e o Cmd+V não funcionam nos campos de texto. Os atalhos do app (Cmd+N, Cmd+O, Cmd+S, Cmd+Z
// fora de campo...) são da casca, no renderer, que recebe a tecla antes do menu. Fora daqui ficam o Recarregar (Cmd+R
// derrubaria os terminais e as conversas abertas) e o Fechar janela no Cmd+W (o Cmd+W da casca fecha o projeto).
// Só dados: o vitest confere o modelo; o main.ts monta com Menu.buildFromTemplate.
import type {MenuItemConstructorOptions} from 'electron';

export const NOME_DO_APP = 'Estúdio';

export const modeloDoMenuDoMac = (o: {desenvolvimento: boolean}): MenuItemConstructorOptions[] => [
  {
    label: NOME_DO_APP,
    submenu: [
      {role: 'about', label: `Sobre o ${NOME_DO_APP}`},
      {type: 'separator'},
      {role: 'services', label: 'Serviços'},
      {type: 'separator'},
      {role: 'hide', label: `Ocultar o ${NOME_DO_APP}`},
      {role: 'hideOthers', label: 'Ocultar os outros'},
      {role: 'unhide', label: 'Mostrar tudo'},
      {type: 'separator'},
      {role: 'quit', label: `Sair do ${NOME_DO_APP}`},
    ],
  },
  {
    label: 'Editar',
    submenu: [
      {role: 'undo', label: 'Desfazer'},
      {role: 'redo', label: 'Refazer'},
      {type: 'separator'},
      {role: 'cut', label: 'Recortar'},
      {role: 'copy', label: 'Copiar'},
      {role: 'paste', label: 'Colar'},
      {role: 'pasteAndMatchStyle', label: 'Colar sem formatação'},
      {role: 'delete', label: 'Apagar'},
      {role: 'selectAll', label: 'Selecionar tudo'},
    ],
  },
  {
    label: 'Visualizar',
    submenu: [
      {role: 'togglefullscreen', label: 'Tela cheia'},
      ...(o.desenvolvimento ? [{type: 'separator' as const}, {role: 'toggleDevTools' as const, label: 'Ferramentas do desenvolvedor'}] : []),
    ],
  },
  {
    role: 'window',
    label: 'Janela',
    submenu: [
      {role: 'minimize', label: 'Minimizar'},
      {role: 'zoom', label: 'Zoom'},
      {type: 'separator'},
      {role: 'front', label: 'Trazer tudo para a frente'},
    ],
  },
  // o macOS põe a busca nos menus dentro do Ajuda
  {role: 'help', label: 'Ajuda', submenu: []},
];
