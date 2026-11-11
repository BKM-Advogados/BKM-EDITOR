// Arranjo dos painéis de cada área (dockview): o padrão por área, faixa de tela e orientação do vídeo, e o gravado.
import type {DockviewApi} from 'dockview-react';
import type {Area} from '../estado/loja';

// faixas de layout de docs/tela.md: C (compacta) abaixo de 1600x800, P (padrão) acima; cada área x faixa guarda o seu.
// No Vídeo, o arranjo depende também do formato: vertical (V) quer o monitor em coluna, horizontal (H) quer largura.
// A versão na chave sobe quando entra painel novo no arranjo padrão (v6: Pesquisa, v7: Mídia, v8: Claude com largura certa
// na Imagem e no 3D da faixa P; v9: vídeo vertical na faixa C com a lista em grupo próprio e o Claude em até 42%), para os
// layouts gravados o verem. Uma área pode subir sozinha (VERSAO_AREA), sem desfazer o arranjo gravado das outras: a Música
// foi para v10 com o arranjo próprio da faixa C.
export type Faixa = 'C' | 'P';
export type Orientacao = 'V' | 'H';
export const faixaAtual = (): Faixa => (window.innerWidth < 1600 || window.innerHeight < 800 ? 'C' : 'P');
const VERSAO_AREA: Partial<Record<Area, number>> = {musica: 10};
export const CHAVE = (area: Area, faixa: Faixa, o: Orientacao) => `estudio:layout:v${VERSAO_AREA[area] ?? 9}:${area}:${faixa}${area === 'video' ? `:${o}` : ''}`;
export const lerLayout = (area: Area, faixa: Faixa, o: Orientacao) => {
  try {
    const t = localStorage.getItem(CHAVE(area, faixa, o));
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
};
export const gravarLayout = (area: Area, faixa: Faixa, o: Orientacao, api: DockviewApi) => {
  try {
    localStorage.setItem(CHAVE(area, faixa, o), JSON.stringify(api.toJSON()));
  } catch {
    /* sem armazenamento: volta ao arranjo padrão na próxima vez */
  }
};

// O terminal fica sempre na coluna da direita: embaixo é da linha do tempo, e altura é o que falta em notebook.
export const layoutPadrao = (api: DockviewApi, area: Area, faixa: Faixa, o: Orientacao) => {
  const temLinha = area === 'video' || area === 'efeitos' || area === 'musica' || area === 'animacao';
  const W = window.innerWidth;
  const H = window.innerHeight;
  const abasDoInspector = (comLista: boolean) => {
    if (comLista) api.addPanel({id: 'lista', component: 'lista', title: 'Lista', position: {referencePanel: 'inspector', direction: 'within'}});
    api.addPanel({id: 'comentarios', component: 'comentarios', title: 'Comentários', position: {referencePanel: 'inspector', direction: 'within'}});
    api.addPanel({id: 'historico', component: 'historico', title: 'Histórico', position: {referencePanel: 'inspector', direction: 'within'}});
    api.addPanel({id: 'pesquisa', component: 'pesquisa', title: 'Pesquisa', position: {referencePanel: 'inspector', direction: 'within'}});
    api.getPanel('inspector')?.api.setActive();
  };
  api.addPanel({id: 'monitor', component: 'monitor', title: 'Monitor'});
  if (faixa === 'P' && !temLinha) {
    // sem linha do tempo (Imagem, 3D) lista, monitor, propriedades e Claude dividem a mesma fileira; o Claude entra por
    // último, senão a lista e as propriedades nasciam tirando a largura dele (ficava com ~100 px)
    api.addPanel({id: 'lista', component: 'lista', title: 'Lista', position: {referencePanel: 'monitor', direction: 'left'}, initialWidth: 260});
    api.addPanel({id: 'inspector', component: 'inspector', title: 'Propriedades', position: {referencePanel: 'monitor', direction: 'right'}, initialWidth: 310});
    const larguraClaude = Math.min(560, Math.round(W * 0.3));
    api.addPanel({id: 'terminal', component: 'terminal', title: 'Claude', position: {direction: 'right'}, initialWidth: larguraClaude});
    abasDoInspector(false);
    // o dockview reparte a largura entre vizinhos ao montar; cada setSize tira do vizinho da direita (ou da esquerda, no
    // último), então a ordem é: Claude, lista e, por fim, o monitor (o que sobra fica com as propriedades)
    api.getPanel('terminal')?.api.setSize({width: larguraClaude});
    api.getPanel('lista')?.api.setSize({width: 260});
    api.getPanel('monitor')?.api.setSize({width: Math.max(320, W - 260 - 310 - larguraClaude - 8)});
  } else if (faixa === 'P') {
    api.addPanel({id: 'linha', component: 'linha', title: 'Linha do tempo', position: {direction: 'below'}, initialHeight: 260});
    api.addPanel({id: 'terminal', component: 'terminal', title: 'Claude', position: {direction: 'right'}, initialWidth: o === 'H' && area === 'video' ? 480 : 600});
    api.addPanel({id: 'lista', component: 'lista', title: 'Lista', position: {referencePanel: 'monitor', direction: 'left'}, initialWidth: 260});
    api.addPanel({id: 'inspector', component: 'inspector', title: 'Propriedades', position: {referencePanel: 'monitor', direction: 'right'}, initialWidth: 310});
    abasDoInspector(false);
  } else if (area === 'video' && o === 'V') {
    // vídeo vertical na tela pequena: o monitor numa coluna de altura total; à direita, cenas e blocos, propriedades e o
    // Claude (no máximo 42% da largura) em cima e a linha do tempo embaixo. A lista fica num grupo próprio, com nome,
    // em vez de virar um ícone atrás das propriedades
    const larguraClaude = Math.min(Math.round(W * 0.42), 560);
    api.addPanel({id: 'terminal', component: 'terminal', title: 'Claude', position: {direction: 'right'}, initialWidth: Math.max(360, W - 360)});
    api.addPanel({id: 'linha', component: 'linha', title: 'Linha do tempo', position: {referencePanel: 'terminal', direction: 'below'}, initialHeight: Math.max(200, Math.round(H * 0.34))});
    api.addPanel({id: 'inspector', component: 'inspector', title: 'Propriedades', position: {referencePanel: 'terminal', direction: 'left'}, initialWidth: 290});
    api.addPanel({id: 'lista', component: 'lista', title: 'Lista', position: {referencePanel: 'inspector', direction: 'left'}, initialWidth: 210});
    abasDoInspector(false);
    // cada setSize tira do vizinho da direita: lista e propriedades primeiro; o monitor por último acerta o Claude
    api.getPanel('lista')?.api.setSize({width: 200});
    api.getPanel('inspector')?.api.setSize({width: 290});
    api.getPanel('monitor')?.api.setSize({width: Math.max(280, W - 200 - 290 - larguraClaude - 8)});
  } else if (area === 'musica') {
    // Música na tela pequena: os canais numa coluna de altura total à esquerda, ao lado do monitor e da linha do tempo (a
    // lista e o arranjo são os mesmos canais); à direita, Claude em cima e propriedades embaixo, numa coluna estreita
    // (no máximo 28%), para o monitor ficar com a largura e a altura que o mixer e o piano roll pedem
    const larguraLista = 224; // cabem "+ Bateria" e "+ Instrumento" na mesma linha do rodapé
    const larguraDireita = Math.min(400, Math.round(W * 0.28));
    api.addPanel({id: 'linha', component: 'linha', title: 'Linha do tempo', position: {referencePanel: 'monitor', direction: 'below'}, initialHeight: Math.max(200, Math.round(H * 0.34))});
    api.addPanel({id: 'terminal', component: 'terminal', title: 'Claude', position: {direction: 'right'}, initialWidth: larguraDireita});
    api.addPanel({id: 'inspector', component: 'inspector', title: 'Propriedades', position: {referencePanel: 'terminal', direction: 'below'}, initialHeight: Math.round(H * 0.5)});
    api.addPanel({id: 'lista', component: 'lista', title: 'Lista', position: {direction: 'left'}, initialWidth: larguraLista});
    abasDoInspector(false);
    // a lista entra por último e tira do monitor: acerta a lista e depois o monitor (o que sobra fica com a coluna do Claude)
    api.getPanel('lista')?.api.setSize({width: larguraLista});
    api.getPanel('monitor')?.api.setSize({width: Math.max(480, W - larguraLista - larguraDireita - 8)});
  } else {
    // vídeo horizontal, imagem, 3D e efeitos: monitor largo; à direita o terminal em cima e, embaixo dele, lista e propriedades
    if (temLinha) api.addPanel({id: 'linha', component: 'linha', title: 'Linha do tempo', position: {referencePanel: 'monitor', direction: 'below'}, initialHeight: 200});
    api.addPanel({id: 'terminal', component: 'terminal', title: 'Claude', position: {direction: 'right'}, initialWidth: Math.min(620, Math.round(W * 0.42))}); // no máximo 42%
    api.addPanel({id: 'lista', component: 'lista', title: 'Lista', position: {referencePanel: 'terminal', direction: 'below'}, initialHeight: Math.round(H * 0.5)});
    api.addPanel({id: 'inspector', component: 'inspector', title: 'Propriedades', position: {referencePanel: 'lista', direction: 'right'}});
    abasDoInspector(false);
  }
  // frente Casca (rodada 3): o painel de mídia é uma aba ao lado da Lista (nas três disposições a Lista existe); a aba que estava
  // à frente continua à frente
  api.addPanel({id: 'midia', component: 'midia', title: 'Mídia', position: {referencePanel: 'lista', direction: 'within'}});
  api.getPanel('lista')?.api.setActive();
  api.getPanel('inspector')?.api.setActive();
};

