// Rodapé: último aviso, memória do app (medida, não estimada) e se o Claude está instalado.
import React, {useEffect, useState} from 'react';
import {useLoja} from '../estado/loja';

export const Rodape: React.FC = () => {
  const aviso = useLoja((e) => e.aviso);
  const info = useLoja((e) => e.info);
  const abertos = useLoja((e) => e.comentarios.filter((c) => c.estado === 'aberto').length);
  const [memoria, setMemoria] = useState<number | null>(null);
  useEffect(() => {
    const medir = () => void window.estudio.metricas().then((m) => setMemoria(m.memoria_mb));
    medir();
    const t = setInterval(medir, 5000);
    return () => clearInterval(t);
  }, []);
  const cor = aviso?.tipo === 'erro' ? 'var(--erro)' : aviso?.tipo === 'ok' ? 'var(--ok)' : undefined;
  return (
    <footer className="rodape">
      <span className="aviso" style={{color: cor}}>{aviso?.texto ?? 'pronto'}</span>
      <span className="dir">
        <span>{abertos} comentário(s) aberto(s)</span>
        <span title="memória de todos os processos do app">{memoria !== null ? `${memoria} MB` : '…'}</span>
        <span>{info ? (info.claude ? 'Claude instalado' : 'Claude não encontrado') : ''}</span>
        <span title={info?.raiz}>{info?.raiz ?? ''}</span>
      </span>
    </footer>
  );
};
