// Ponte entre o monitor 3D e os outros painéis: a câmera de vista (onde a pessoa está olhando agora), para o inspector
// e o botão "Salvar câmera" gravarem em /camera, e o ajuste ao vivo do material enquanto um controle é arrastado.
import type {DocCena3D, OperacaoPatch} from '../../../nucleo/documentos';
import {aplicar, avisar, loja, patchTrocar} from '../../estado/loja';
import {iguaisV} from './comum';

export type CameraDoc = DocCena3D['camera'];
export type AjusteAoVivo = {cor?: string; metalico?: number; rugosidade?: number};

let leitorVista: (() => CameraDoc) | null = null;
let ajustador: ((id: string, a: AjusteAoVivo) => void) | null = null;

/** O monitor registra quem lê a vista e quem ajusta o material; devolve a função que desfaz o registro. */
export const registrarVista = (ler: () => CameraDoc, ajustar: (id: string, a: AjusteAoVivo) => void) => {
  leitorVista = ler;
  ajustador = ajustar;
  return () => {
    if (leitorVista === ler) leitorVista = null;
    if (ajustador === ajustar) ajustador = null;
  };
};

export const lerVista = (): CameraDoc | null => leitorVista?.() ?? null;

/** Mostra um valor no monitor sem gravar (o patch sai ao soltar o controle). */
export const ajustarAoVivo = (id: string, a: AjusteAoVivo) => ajustador?.(id, a);

/** Grava a vista atual do monitor como a câmera do documento (só os campos que mudaram). */
export const usarVistaComoCamera = async (documento: string) => {
  const vista = lerVista();
  if (!vista) return void avisar('Abra o monitor 3D para usar a vista atual.', 'erro');
  const doc = loja.get().docs[documento]?.doc as DocCena3D | undefined;
  if (!doc) return;
  const atual = doc.camera as Partial<CameraDoc> | undefined;
  if (!atual) return void (await aplicar(documento, [{op: 'add', path: '/camera', value: vista}], 'câmera = vista atual'));
  const patch: OperacaoPatch[] = [];
  if (!iguaisV(atual.posicao, vista.posicao)) patch.push(...patchTrocar(doc, '/camera/posicao', vista.posicao));
  if (!iguaisV(atual.alvo, vista.alvo)) patch.push(...patchTrocar(doc, '/camera/alvo', vista.alvo));
  if (atual.fov !== vista.fov) patch.push(...patchTrocar(doc, '/camera/fov', vista.fov));
  if (!patch.length) return void avisar('A câmera do documento já é a vista atual.', 'info');
  if (await aplicar(documento, patch, 'câmera = vista atual')) avisar('Câmera gravada a partir da vista.', 'ok');
};
