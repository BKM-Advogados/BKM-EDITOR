// Rodapé: as teclas que valem na área atual e, por 4 s, o último aviso no lugar delas; à direita, os comentários
// abertos e a memória do app (medida, não estimada). "Claude não encontrado" só aparece quando falta.
import React, {useEffect, useState} from 'react';
import {CircleAlert, CircleCheck, Info} from 'lucide-react';
import {useLoja, type Area} from '../estado/loja';

const DICAS: Record<Area, [string[], string][]> = {
  video: [[['V'], 'seleção'], [['M'], 'comentar'], [['Espaço'], 'tocar'], [['←', '→'], 'quadro'], [['J', 'K', 'L'], 'velocidade']],
  imagem: [[['V'], 'mover'], [['H'], 'mão'], [['T'], 'texto'], [['U'], 'forma'], [['M'], 'comentar']],
  '3d': [[['Q'], 'seleção'], [['W'], 'mover'], [['E'], 'girar'], [['R'], 'escala'], [['M'], 'comentar']],
  efeitos: [[['Espaço'], 'tocar'], [['M'], 'comentar'], [['Ctrl', 'Z'], 'desfazer']],
};
const AVISO_MS = 4000;

export const Rodape: React.FC = () => {
  const aviso = useLoja((e) => e.aviso);
  const area = useLoja((e) => e.area);
  const info = useLoja((e) => e.info);
  const abertos = useLoja((e) => e.comentarios.filter((c) => c.estado === 'aberto').length);
  const [memoria, setMemoria] = useState<number | null>(null);
  const [, tique] = useState(0);
  useEffect(() => {
    const medir = () => void window.estudio.metricas().then((m) => setMemoria(m.memoria_mb));
    medir();
    const t = setInterval(medir, 5000);
    return () => clearInterval(t);
  }, []);
  // redesenha quando o aviso vence, para as dicas voltarem
  useEffect(() => {
    if (!aviso) return;
    const resta = AVISO_MS - (Date.now() - aviso.em);
    if (resta <= 0) return;
    const t = setTimeout(() => tique((x) => x + 1), resta + 20);
    return () => clearTimeout(t);
  }, [aviso]);
  const avisoVivo = aviso && Date.now() - aviso.em < AVISO_MS ? aviso : null;
  const icone = avisoVivo?.tipo === 'erro' ? <CircleAlert /> : avisoVivo?.tipo === 'ok' ? <CircleCheck /> : <Info />;
  return (
    <footer className="rodape">
      {avisoVivo ? (
        <span className={`aviso ${avisoVivo.tipo}`} title={avisoVivo.texto}>{icone}{avisoVivo.texto}</span>
      ) : (
        <span className="dicas">
          {DICAS[area].map(([teclas, o]) => <span key={o}>{teclas.map((t) => <kbd key={t}>{t}</kbd>)} {o}</span>)}
        </span>
      )}
      <span className="dir">
        {abertos > 0 && <span className="cmt"><span className="ponto-c" />{abertos === 1 ? '1 comentário aberto' : `${abertos} comentários abertos`}</span>}
        {info && !info.claude && <span className="falta" title="Instale o Claude Code (claude.ai/install) para conversar com o Claude">Claude não encontrado</span>}
        <span title="memória de todos os processos do app (conjunto de trabalho); o Claude de cada aba soma à parte">{memoria !== null ? `${memoria} MB` : '…'}</span>
      </span>
    </footer>
  );
};
