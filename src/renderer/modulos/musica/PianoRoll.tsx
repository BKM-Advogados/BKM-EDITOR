// Piano roll do canal de sintetizador (item 17). Arrastar no vazio desenha uma nota (o comprimento acompanha o mouse);
// arrastar uma nota a move no tempo e na altura; a borda direita estica; duplo clique ou botão direito apaga. Com notas
// selecionadas (clique, Shift+clique, Ctrl+A): setas ↑↓ transpõem (Shift: oitava), ←→ andam um passo, Delete apaga,
// Ctrl+D duplica, Q quantiza. O carimbo põe um acorde inteiro com a fundamental onde se clica. Com "Teclado", as teclas
// A W S E D F T G Y H U J K tocam do Dó ao Dó (Z e X mudam a oitava) e, com "Gravar", escrevem no cursor e andam um passo.
// Tudo passa pelas edições de src/nucleo/musica-acoes.ts, as mesmas das ferramentas MCP.
import {comando, comModificador} from '../../teclas';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Keyboard, Stamp, Circle, Shuffle} from 'lucide-react';
import {NOME_PRESET, posicaoEmCompasso, resolverMusica, type DocMusica, type NotaMusica} from '../../../nucleo/musica';
import {carimbarAcorde, editarNotas, escreverNotas, QUALIDADES_CARIMBO, trocarNota, type Edicao, type RefNota} from '../../../nucleo/musica-acoes';
import {escalaDe, nomeDaNotaPt} from '../../../nucleo/musica-teoria';
import {avisar, loja, mensagemDe} from '../../estado/loja';
import {aplicarMusica, musica, selecionarMusica} from './estado';
import {motor} from './motor';
import {novoPadrao} from './acoes';

const ALT = 14; // altura de uma linha (uma nota)
const TECLAS = 'awsedftgyhujk'; // do Dó ao Dó, como um piano no teclado do computador

type Arrasto = {modo: 'desenhar' | 'mover' | 'esticar'; x0: number; y0: number; db: number; dn: number; nota?: NotaMusica; em0: number; altura0: number};

const fazer = async (f: () => Edicao) => {
  try {
    const e = f();
    for (const a of e.avisos ?? []) avisar(a, 'info');
    return (await aplicarMusica(e.patch, e.rotulo)) ? e : null;
  } catch (erro) {
    avisar(mensagemDe(erro), 'erro');
    return null;
  }
};
const ref = (n: NotaMusica): RefNota => ({em: n.em, nota: n.nota});
const igual = (a: RefNota, b: RefNota) => Math.abs(a.em - b.em) < 1e-6 && a.nota === b.nota;

export const PianoRoll: React.FC<{doc: DocMusica; padrao: string; agora_bat: number | null}> = ({doc, padrao, agora_bat}) => {
  const m = useMemo(() => resolverMusica(doc).musica, [doc]);
  const p = doc.padroes.find((x) => x.id === padrao)!;
  const pp = m.padroes[padrao];
  const canal = m.canais.find((c) => c.id === p.canal)!;
  const passo = pp.dur / pp.passos;
  const pcs = escalaDe(doc.tom, doc.escala);
  const notas = p.notas.filter((n): n is NotaMusica & {nota: number} => typeof n.nota === 'number');
  // faixa fixa (do Dó1 ao Dó7): a grade não pula quando as notas mudam; ao abrir o padrão, rola até as notas dele
  const base = 24;
  const topo = 96;
  const linhas = Array.from({length: topo - base + 1}, (_, k) => topo - k);
  const corpo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = corpo.current;
    if (!el) return;
    const alturas = notas.map((n) => n.nota);
    const centro = alturas.length ? (Math.min(...alturas) + Math.max(...alturas)) / 2 : 60;
    el.scrollTop = Math.max(0, (topo - centro) * ALT - el.clientHeight / 2);
  }, [padrao]); // eslint-disable-line react-hooks/exhaustive-deps
  const [px, setPx] = useState(64); // pixels por batida
  const [sel, setSel] = useState<RefNota[]>([]);
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  const [durUltima, setDurUltima] = useState(passo);
  const [carimbo, setCarimbo] = useState<string | null>(null);
  const [teclado, setTeclado] = useState(false);
  const [gravar, setGravar] = useState(false);
  const [oitava, setOitava] = useState(4);
  const [cursor, setCursor] = useState(0);
  const area = useRef<HTMLDivElement>(null);
  const doCanal = doc.padroes.filter((x) => x.canal === p.canal);

  // o piano roll tem o foco das teclas enquanto há notas selecionadas ou o teclado está ligado (o arranjo cede)
  useEffect(() => {
    musica.definir({focoNotas: sel.length > 0 || teclado});
    return () => musica.definir({focoNotas: false});
  }, [sel.length, teclado]);
  useEffect(() => setSel((s) => s.filter((r) => notas.some((n) => igual(r, ref(n))))), [doc]); // eslint-disable-line react-hooks/exhaustive-deps

  const pos = (e: {clientX: number; clientY: number}) => {
    const r = area.current!.getBoundingClientRect();
    const bat = Math.max(0, (e.clientX - r.left) / px);
    const nota = topo - Math.floor((e.clientY - r.top) / ALT);
    return {bat, nota};
  };
  const grade = (b: number, livre: boolean) => (livre ? Math.round(b * 960) / 960 : Math.floor(b / passo + 1e-9) * passo);
  const tocar = (nota: number) => motor.tocarNota(nota, canal.preset, canal.macros, Math.min(1, durUltima * m.seg_por_batida));

  const pegarVazio = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.pr-nota')) return;
    const {bat, nota} = pos(e);
    if (bat >= pp.dur) return;
    if (teclado && gravar) return setCursor(grade(bat, false));
    if (carimbo !== null) {
      tocar(nota);
      return void fazer(() => carimbarAcorde(doc, padrao, {raiz: nota, qualidade: carimbo, em: grade(bat, e.altKey), dur: Math.max(durUltima, 1)}));
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    tocar(nota);
    setSel([]);
    setArrasto({modo: 'desenhar', x0: e.clientX, y0: e.clientY, db: 0, dn: 0, em0: grade(bat, e.altKey), altura0: nota});
  };
  const pegarNota = (e: React.PointerEvent, n: NotaMusica & {nota: number}, modo: 'mover' | 'esticar') => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const r = ref(n);
    setSel((s) => (e.shiftKey ? (s.some((x) => igual(x, r)) ? s.filter((x) => !igual(x, r)) : [...s, r]) : s.some((x) => igual(x, r)) ? s : [r]));
    if (modo === 'mover') tocar(n.nota);
    setArrasto({modo, x0: e.clientX, y0: e.clientY, db: 0, dn: 0, nota: n, em0: n.em, altura0: n.nota});
  };
  const mover = (e: React.PointerEvent) => {
    if (!arrasto) return;
    setArrasto({...arrasto, db: (e.clientX - arrasto.x0) / px, dn: -Math.round((e.clientY - arrasto.y0) / ALT)});
  };
  const soltar = (e: React.PointerEvent) => {
    const a = arrasto;
    setArrasto(null);
    if (!a) return;
    const livre = e.altKey;
    if (a.modo === 'desenhar') {
      const dur = Math.max(passo, grade(a.em0 + a.db, livre) - a.em0 + (livre ? 0 : passo));
      const durFinal = Math.abs(a.db) * px < 4 ? durUltima : dur;
      setDurUltima(durFinal);
      return void fazer(() => escreverNotas(doc, {padrao, notas: [{nota: a.altura0, em: a.em0, dur: Math.min(durFinal, pp.dur - a.em0)}]}));
    }
    const n = a.nota!;
    const altura = n.nota ?? a.altura0;
    if (a.modo === 'esticar') {
      const dur = Math.max(1 / 16, (n.dur ?? passo) + (livre ? a.db : Math.round(a.db / passo) * passo));
      setDurUltima(dur);
      return void fazer(() => trocarNota(doc, padrao, ref(n), {dur}));
    }
    const db = livre ? a.db : Math.round(a.db / passo) * passo;
    if (Math.abs(db) < 1e-6 && a.dn === 0) return;
    if (a.dn) tocar(altura + a.dn);
    void fazer(() => trocarNota(doc, padrao, ref(n), {em: n.em + db, nota: altura + a.dn})).then((ok) => ok && setSel([{em: Math.max(0, n.em + db), nota: altura + a.dn}]));
  };
  const apagar = (refs: RefNota[]) => refs.length && void fazer(() => editarNotas(doc, {padrao, acao: 'apagar', selecao: {notas: refs}})).then(() => setSel([]));

  // teclas: na captura, antes do arranjo (que também usa Delete, S e L) e da casca (1 a 5)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (loja.get().area !== 'musica') return;
      const alvo = e.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT/.test(alvo.tagName) || alvo.isContentEditable || alvo.closest?.('.xterm') || document.querySelector('.dialogo-fundo')) return;
      const k = e.key.toLowerCase();
      const feito = () => (e.preventDefault(), e.stopImmediatePropagation());
      if (teclado && !comModificador(e)) {
        const i = TECLAS.indexOf(k);
        if (k === 'z' || k === 'x') return (feito(), setOitava((o) => Math.min(8, Math.max(1, o + (k === 'x' ? 1 : -1)))));
        if (i >= 0) {
          feito();
          if (e.repeat) return;
          const nota = (oitava + 1) * 12 + i;
          tocar(nota);
          if (gravar && cursor < pp.dur) {
            void fazer(() => escreverNotas(doc, {padrao, notas: [{nota, em: cursor, dur: passo}]}));
            setCursor((c) => (c + passo >= pp.dur - 1e-9 ? 0 : c + passo));
          }
          return;
        }
      }
      if (!sel.length) return;
      if (e.key === 'Delete' || e.key === 'Backspace') return (feito(), apagar(sel));
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        feito();
        const v = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
        return void fazer(() => editarNotas(doc, {padrao, acao: 'transpor', valor: v, selecao: {notas: sel}})).then((ok) => ok && setSel(sel.map((r) => ({...r, nota: (r.nota ?? 0) + v}))));
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && sel.length === 1) {
        feito();
        const n = notas.find((x) => igual(ref(x), sel[0]));
        if (!n) return;
        const em = Math.max(0, n.em + (e.key === 'ArrowRight' ? passo : -passo));
        return void fazer(() => trocarNota(doc, padrao, sel[0], {em})).then((ok) => ok && setSel([{em, nota: n.nota}]));
      }
      if (comando(e) && k === 'd') return (feito(), void fazer(() => editarNotas(doc, {padrao, acao: 'duplicar', selecao: {notas: sel}})));
      if (comando(e) && k === 'a') return (feito(), setSel(notas.map(ref)));
      if (!comModificador(e) && k === 'q') return (feito(), void fazer(() => editarNotas(doc, {padrao, acao: 'quantizar', selecao: {notas: sel}})));
      if (e.key === 'Escape') return setSel([]);
    };
    window.addEventListener('keydown', tecla, true);
    return () => window.removeEventListener('keydown', tecla, true);
  });

  // o que o arrasto em curso mostra antes de soltar
  const comoFica = (n: NotaMusica & {nota: number}) => {
    const a = arrasto;
    if (!a || !a.nota || !igual(ref(a.nota), ref(n))) return {em: n.em, nota: n.nota, dur: n.dur ?? passo};
    if (a.modo === 'esticar') return {em: n.em, nota: n.nota, dur: Math.max(1 / 16, (n.dur ?? passo) + Math.round(a.db / passo) * passo)};
    return {em: Math.max(0, n.em + Math.round(a.db / passo) * passo), nota: n.nota + a.dn, dur: n.dur ?? passo};
  };
  const largura = pp.dur * px;
  const fundo = `repeating-linear-gradient(90deg, #3a3a3a 0 1px, transparent 1px ${px}px), repeating-linear-gradient(90deg, #262626 0 1px, transparent 1px ${passo * px}px)`;

  return (
    <div className="piano-roll">
      <div className="passos-topo">
        <select className="campo" value={p.id} onChange={(e) => selecionarMusica({tipo: 'padrao', id: e.target.value})} title="Padrão do canal">
          {doCanal.map((x) => <option key={x.id} value={x.id}>{x.nome ?? x.id}</option>)}
        </select>
        <button className="bt" onClick={() => void novoPadrao(p.canal)}>+ Padrão</button>
        <button className="bt" onClick={() => void novoPadrao(p.canal, {clonar: p.id})}>Clonar</button>
        <button className="bt" title="Cópia com mudanças pequenas (notas vizinhas da escala, forças)" onClick={() => void novoPadrao(p.canal, {variar: p.id})}><Shuffle size={14} />Variação</button>
        <span className="sep" />
        <button className={`bt${carimbo !== null ? ' ligado' : ''}`} title="Carimbo: clicar põe o acorde inteiro com a fundamental ali"
          onClick={() => setCarimbo((c) => (c === null ? '' : null))}><Stamp size={14} />Carimbo</button>
        {carimbo !== null && (
          <select className="campo" value={carimbo} onChange={(e) => setCarimbo(e.target.value)} title="Tipo de acorde">
            {QUALIDADES_CARIMBO.map((q) => <option key={q.id} value={q.id}>{q.nome}</option>)}
          </select>
        )}
        <button className={`bt${teclado ? ' ligado' : ''}`} title="O teclado do computador toca: A W S E D F T G Y H U J K (Z e X: oitava)"
          onClick={() => (setTeclado((t) => !t), setGravar(false))}><Keyboard size={14} />Teclado{teclado ? ` · Dó${oitava}` : ''}</button>
        {teclado && <button className={`bt${gravar ? ' ligado' : ''}`} title="Cada tecla escreve a nota no cursor e anda um passo; clique na grade para mudar o cursor"
          onClick={() => setGravar((g) => !g)}><Circle size={12} />Gravar</button>}
        <span className="ler" title="Tom e escala no inspetor da música">{doc.tom ?? 'C'} {doc.escala ?? 'maior'} · {NOME_PRESET[canal.preset]}{sel.length ? ` · ${sel.length} selecionada(s)` : ''}</span>
      </div>
      <div className="pr-corpo" ref={corpo}>
        <div className="pr-teclas" style={{height: linhas.length * ALT}}>
          {linhas.map((n) => {
            const fora = !pcs.includes(((n % 12) + 12) % 12);
            return <span key={n} className={`pr-tecla${fora ? ' fora' : ''}${n % 12 === 0 ? ' do' : ''}`} style={{height: ALT}} onPointerDown={() => tocar(n)}>{nomeDaNotaPt(n)}</span>;
          })}
        </div>
        <div className="pr-area" ref={area} onWheel={(e) => e.ctrlKey && (e.preventDefault(), setPx((v) => Math.min(240, Math.max(16, v * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))))}>
          <div className="pr-tela" style={{width: largura, height: linhas.length * ALT, backgroundImage: fundo}}
            onPointerDown={pegarVazio} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={() => setArrasto(null)}
            onContextMenu={(e) => e.preventDefault()}>
            {linhas.map((n, k) => (pcs.includes(((n % 12) + 12) % 12) ? null : <span key={n} className="pr-linha-fora" style={{top: k * ALT, height: ALT}} />))}
            {notas.map((n) => {
              const c = comoFica(n);
              const s = sel.some((r) => igual(r, ref(n)));
              return (
                <div key={`${n.em}:${n.nota}`} className={`pr-nota${s ? ' sel' : ''}`} style={{left: c.em * px, top: (topo - c.nota) * ALT + 1, width: Math.max(4, c.dur * px - 1), height: ALT - 2,
                  opacity: 0.45 + 0.55 * ((n.forca ?? 100) / 127)}}
                  title={`${nomeDaNotaPt(c.nota)} · ${posicaoEmCompasso(c.em, doc.compasso)} · força ${n.forca ?? 100}`}
                  onPointerDown={(e) => pegarNota(e, n, 'mover')} onPointerMove={mover} onPointerUp={soltar}
                  onDoubleClick={() => apagar([ref(n)])} onContextMenu={(e) => (e.preventDefault(), apagar([ref(n)]))}>
                  <span className="pr-borda" onPointerDown={(e) => pegarNota(e, n, 'esticar')} />
                </div>
              );
            })}
            {arrasto?.modo === 'desenhar' && (
              <div className="pr-nota nova" style={{left: arrasto.em0 * px, top: (topo - arrasto.altura0) * ALT + 1, height: ALT - 2,
                width: Math.max(passo * px, (Math.max(passo, grade(arrasto.em0 + arrasto.db, false) - arrasto.em0 + passo)) * px) - 1}} />
            )}
            {teclado && gravar && <span className="pr-cursor" style={{left: cursor * px}} />}
            {agora_bat !== null && <span className="pr-agora" style={{left: agora_bat * px}} />}
          </div>
        </div>
      </div>
    </div>
  );
};
