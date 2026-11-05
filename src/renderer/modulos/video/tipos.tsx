// Tipos de bloco do roteiro: família (texto ou mídia), ícone e nome amigável. A linha do tempo, a lista de cenas e o
// inspector usam a mesma tabela, para o mesmo bloco ter a mesma cara em todo lugar.
import type {LucideIcon} from 'lucide-react';
import {FileText, Hash, Image, List, RectangleHorizontal, Square, StickyNote, Type} from 'lucide-react';

export type Familia = 'texto' | 'midia';

const TIPOS: Record<string, {nome: string; icone: LucideIcon; familia: Familia}> = {
  frase: {nome: 'Frase', icone: Type, familia: 'texto'},
  nota: {nome: 'Nota', icone: StickyNote, familia: 'texto'},
  itens: {nome: 'Itens', icone: List, familia: 'texto'},
  cartao: {nome: 'Cartão', icone: RectangleHorizontal, familia: 'texto'},
  numero: {nome: 'Número', icone: Hash, familia: 'texto'},
  foto: {nome: 'Foto', icone: Image, familia: 'midia'},
  documento: {nome: 'Documento', icone: FileText, familia: 'midia'},
};

export const tipoDe = (tipo: string) => TIPOS[tipo] ?? {nome: tipo.charAt(0).toUpperCase() + tipo.slice(1), icone: Square, familia: 'texto' as Familia};

/** Texto do bloco sem a marcação de destaque (**). */
export const resumoBloco = (b: {texto?: unknown; rotulo?: unknown; titulo?: unknown; de?: unknown; ate?: unknown; sufixo?: unknown; itens?: {texto?: string}[]}, max = 48) => {
  const t = typeof b.texto === 'string' ? b.texto
    : b.ate !== undefined ? `${String(b.ate)}${typeof b.sufixo === 'string' ? b.sufixo : ''}`
    : typeof b.titulo === 'string' ? b.titulo
    : typeof b.rotulo === 'string' ? b.rotulo
    : b.itens?.map((i) => i.texto).filter(Boolean).join(' · ') ?? '';
  return t.replace(/\*\*/g, '').slice(0, max);
};
