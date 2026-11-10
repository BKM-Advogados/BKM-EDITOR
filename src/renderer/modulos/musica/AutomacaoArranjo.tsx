// Automação de volume desenhada no arranjo (item 22): uma linha no pé do arranjo com a curva do master ou de uma faixa.
// Clicar no vazio põe um ponto; arrastar um ponto muda o instante (encaixa em 1/4 de batida; Alt, livre) e o volume;
// duplo clique ou botão direito tira o ponto. Enquanto houver pontos a curva vale no lugar do fader. Os mesmos pontos
// aparecem como lista no inspetor (AutomacaoVolume) e pelo MCP (`automacoes` do documento).
import React, {useMemo, useState} from 'react';
import {ChevronDown, ChevronRight} from 'lucide-react';
import {posicaoEmCompasso, resolverMusica, type DocMusica} from '../../../nucleo/musica';
import {useMusica, musica} from './estado';
import {pontosDeAutomacao} from './acoes';
import {numeroBr} from '../../componentes/Campos';

export const ALTURA_AUTOMACAO = 76;
const FOLGA = 8;
const DB_MIN = -40;
const DB_MAX = 6;
type Ponto = {em: number; db: number};

const yDe = (db: number) => FOLGA + (1 - (Math.max(DB_MIN, Math.min(DB_MAX, db)) - DB_MIN) / (DB_MAX - DB_MIN)) * (ALTURA_AUTOMACAO - 2 * FOLGA);
const dbDe = (y: number) => Math.round((DB_MAX - ((y - FOLGA) / (ALTURA_AUTOMACAO - 2 * FOLGA)) * (DB_MAX - DB_MIN)) * 2) / 2;

export const pontosDoAlvo = (doc: DocMusica, alvo: string): Ponto[] => [...((doc.automacoes ?? []).find((a) => a.alvo === alvo)?.pontos ?? [])].sort((a, b) => a.em - b.em);

/** Volume que se ouve em `b` batidas: a curva, ou o fader sem pontos. */
export const valorDaCurva = (pontos: Ponto[], b: number, fader: number) => {
  if (!pontos.length) return fader;
  if (b <= pontos[0].em) return pontos[0].db;
  const k = pontos.findIndex((p, i) => i === pontos.length - 1 || pontos[i + 1].em > b);
  const a = pontos[k];
  const z = pontos[k + 1];
  return z ? a.db + ((z.db - a.db) * (b - a.em)) / Math.max(1e-9, z.em - a.em) : a.db;
};

const alvos = (m: ReturnType<typeof resolverMusica>['musica']) => [{id: 'master', nome: 'Master', fader: m.master.volume_db}, ...m.faixas.map((f) => ({id: f.id, nome: f.nome, fader: f.volume_db}))];

/** Cabeçalho da linha: abre e fecha, e escolhe o que se automatiza. */
export const CabecaAutomacao: React.FC<{doc: DocMusica}> = ({doc}) => {
  const aberta = useMusica((e) => e.autoAberta ?? false);
  const alvo = useMusica((e) => e.autoAlvo ?? 'master');
  const m = useMemo(() => resolverMusica(doc).musica, [doc]);
  const lista = alvos(m);
  const nPontos = (doc.automacoes ?? []).reduce((s, a) => s + a.pontos.length, 0);
  return (
    <div className="cab-auto" style={{height: aberta ? ALTURA_AUTOMACAO : 24}}>
      <button className="cab-auto-alternar" title="Desenhar o volume sobre o arranjo: clique no vazio para pôr um ponto, arraste os pontos"
        onClick={() => musica.definir({autoAberta: !aberta})}>
        {aberta ? <ChevronDown size={12} /> : <ChevronRight size={12} />}Volume{!aberta && nPontos > 0 ? ` · ${nPontos} pt` : ''}
      </button>
      {aberta && (
        <>
          <select className="campo" value={alvo} onChange={(e) => musica.definir({autoAlvo: e.target.value})} title="O que a curva controla">
            {lista.map((x) => <option key={x.id} value={x.id}>{x.nome}{pontosDoAlvo(doc, x.id).length ? ' ●' : ''}</option>)}
          </select>
          <span className="dica">clique no vazio: ponto</span>
        </>
      )}
    </div>
  );
};

/** A linha da curva, na largura do arranjo. */
export const LinhaAutomacao: React.FC<{doc: DocMusica; px: number; largura: number}> = ({doc, px, largura}) => {
  const aberta = useMusica((e) => e.autoAberta ?? false);
  const alvoSel = useMusica((e) => e.autoAlvo ?? 'master');
  const cabeca = useMusica((e) => e.cabeca_s);
  const m = useMemo(() => resolverMusica(doc).musica, [doc]);
  const alvo = alvos(m).some((x) => x.id === alvoSel) ? alvoSel : 'master';
  const fader = alvos(m).find((x) => x.id === alvo)?.fader ?? 0;
  const salvos = useMemo(() => pontosDoAlvo(doc, alvo), [doc, alvo]);
  const [arrasto, setArrasto] = useState<{i: number; x0: number; y0: number; em: number; db: number} | null>(null);
  if (!aberta) return <div style={{height: 24}} />;

  const pontos = arrasto ? salvos.map((p, i) => (i === arrasto.i ? {em: arrasto.em, db: arrasto.db} : p)).sort((a, b) => a.em - b.em) : salvos;
  const batida = (clientX: number, el: Element, livre: boolean) => {
    const b = Math.max(0, (clientX - el.getBoundingClientRect().left) / px);
    return livre ? Math.round(b * 960) / 960 : Math.round(b * 4) / 4;
  };
  const noVazio = (e: React.MouseEvent<SVGSVGElement>) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const em = batida(e.clientX, e.currentTarget, e.altKey);
    const db = dbDe(e.clientY - r.top);
    if (salvos.some((p) => Math.abs(p.em - em) < 1e-3)) return;
    // o primeiro ponto longe do começo leva um parceiro no começo, no volume do fader: assim um clique no fim já faz um fade
    const base = !salvos.length && em > 0.5 ? [{em: 0, db: Math.round(fader * 10) / 10}] : [];
    void pontosDeAutomacao(alvo, [...salvos, ...base, {em, db}].sort((a, b) => a.em - b.em));
  };
  const pegar = (e: React.PointerEvent<SVGCircleElement>, i: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setArrasto({i, x0: e.clientX, y0: e.clientY, em: salvos[i].em, db: salvos[i].db});
  };
  const mover = (e: React.PointerEvent<SVGCircleElement>) => {
    if (!arrasto) return;
    const svg = e.currentTarget.ownerSVGElement!;
    const r = svg.getBoundingClientRect();
    const em = batida(e.clientX, svg, e.altKey);
    setArrasto({...arrasto, em, db: dbDe(e.clientY - r.top)});
  };
  const soltar = () => {
    const a = arrasto;
    setArrasto(null);
    if (!a) return;
    const antes = salvos[a.i];
    if (Math.abs(antes.em - a.em) < 1e-6 && Math.abs(antes.db - a.db) < 1e-6) return;
    void pontosDeAutomacao(alvo, salvos.map((p, i) => (i === a.i ? {em: a.em, db: a.db} : p)));
  };
  const tirar = (e: React.SyntheticEvent, i: number) => {
    e.preventDefault();
    e.stopPropagation();
    void pontosDeAutomacao(alvo, salvos.length > 1 ? salvos.filter((_, j) => j !== i) : null);
  };

  const linha = pontos.length
    ? [[0, pontos[0].db], ...pontos.map((p) => [p.em, p.db]), [largura / px, pontos[pontos.length - 1].db]] as [number, number][]
    : [[0, fader], [largura / px, fader]] as [number, number][];
  return (
    <svg className="auto-lane" width={largura} height={ALTURA_AUTOMACAO} onClick={noVazio} onContextMenu={(e) => e.preventDefault()}>
      <title>{`Volume de ${alvos(m).find((x) => x.id === alvo)?.nome ?? alvo}: clique no vazio para pôr um ponto`}</title>
      {[6, 0, -12, -24, -40].map((db) => (
        <g key={db}>
          <line x1={0} x2={largura} y1={yDe(db)} y2={yDe(db)} className={db === 0 ? 'zero' : 'regua-db'} />
          <text x={3} y={yDe(db) - 2} className="rotulo-db">{db > 0 ? `+${db}` : db}</text>
        </g>
      ))}
      <polyline points={linha.map(([b, db]) => `${b * px},${yDe(db)}`).join(' ')} className={`curva${pontos.length ? '' : ' fader'}`} />
      <line x1={(cabeca / m.seg_por_batida) * px} x2={(cabeca / m.seg_por_batida) * px} y1={0} y2={ALTURA_AUTOMACAO} className="cab" />
      {pontos.map((p, i) => {
        const k = arrasto ? i : i;
        const ativo = arrasto && Math.abs(p.em - arrasto.em) < 1e-9 && Math.abs(p.db - arrasto.db) < 1e-9;
        return (
          <g key={`${k}`}>
            <circle cx={p.em * px} cy={yDe(p.db)} r={5} className={`ponto${ativo ? ' ativo' : ''}`}
              onPointerDown={(e) => pegar(e, salvos.findIndex((q) => Math.abs(q.em - p.em) < 1e-9 && Math.abs(q.db - p.db) < 1e-9))}
              onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar} onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => tirar(e, salvos.findIndex((q) => Math.abs(q.em - p.em) < 1e-9 && Math.abs(q.db - p.db) < 1e-9))}
              onContextMenu={(e) => tirar(e, salvos.findIndex((q) => Math.abs(q.em - p.em) < 1e-9 && Math.abs(q.db - p.db) < 1e-9))}>
              <title>{`${posicaoEmCompasso(p.em, m.compasso)} · ${numeroBr(p.db, 1)} dB (arraste; duplo clique tira)`}</title>
            </circle>
            {ativo && <text x={Math.min(largura - 60, p.em * px + 8)} y={Math.max(12, yDe(p.db) - 8)} className="rotulo-ponto">{numeroBr(p.db, 1)} dB</text>}
          </g>
        );
      })}
    </svg>
  );
};
