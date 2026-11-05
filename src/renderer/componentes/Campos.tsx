// Campos do inspector, com cara de editor (Premiere, Resolve, Figma UI3): campo preenchido de 24 px, unidade dentro do
// campo, rótulo amigável e, à esquerda, um ponto quando o valor difere do padrão (clicar nele redefine). Texto e número
// só gravam ao sair do campo ou com Enter (um patch por edição, não por tecla); controles deslizantes mostram o valor ao
// vivo e gravam ao soltar; a cor grava ao fechar o seletor.
import React, {useEffect, useRef, useState} from 'react';
import {ChevronDown, ChevronRight, Ellipsis, Pipette} from 'lucide-react';
import {avisar} from '../estado/loja';
import {BotaoMenu, type ItemMenu} from './Menu';

/** Número no jeito brasileiro (vírgula decimal), sem casas sobrando. */
export const numeroBr = (n: number, casas = 3) => String(Number(n.toFixed(casas))).replace('.', ',');
const lerNumero = (t: string) => Number(t.trim().replace(/\s/g, '').replace(',', '.'));

export const copiar = (texto: string, oQue = 'Copiado') =>
  void navigator.clipboard.writeText(texto).then(() => avisar(`${oQue}.`, 'ok')).catch(() => avisar('Não deu para copiar.', 'erro'));

/** Linha de campo: [ponto "difere do padrão"] [rótulo] [valor]. Toda linha tem as três células. */
export const LinhaCampo: React.FC<{rotulo: React.ReactNode; children: React.ReactNode; difere?: boolean; aoRedefinir?: () => void; padrao?: string;
  como?: 'label' | 'div'; alta?: boolean; dica?: string}> = ({rotulo, children, difere, aoRedefinir, padrao, como = 'label', alta, dica}) => {
  const Tag = como;
  return (
    <Tag className={`linha-campo${alta ? ' alta' : ''}`} title={dica}>
      <span className="cel-ponto">
        {difere && (
          <button type="button" className="difere" title={`Difere do padrão${padrao !== undefined ? ` (${padrao})` : ''}.${aoRedefinir ? ' Clique para redefinir.' : ''}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              aoRedefinir?.();
            }} />
        )}
      </span>
      <span className="rot">{rotulo}</span>
      {children}
    </Tag>
  );
};

export const CampoTexto: React.FC<{rotulo: string; valor: string; aoMudar: (v: string) => void; multilinha?: boolean; dica?: string; invalido?: (v: string) => string | null}> = ({rotulo, valor, aoMudar, multilinha, dica, invalido}) => {
  const [v, setV] = useState(valor);
  useEffect(() => setV(valor), [valor]);
  const erro = invalido?.(v) ?? null;
  const gravar = () => {
    if (v !== valor && !erro) aoMudar(v);
  };
  return (
    <LinhaCampo rotulo={rotulo} dica={dica} alta={multilinha}>
      <div className="valor">
        {multilinha ? (
          <textarea className={`campo${erro ? ' invalido' : ''}`} value={v} rows={2} onChange={(e) => setV(e.target.value)} onBlur={gravar}
            onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && gravar()} />
        ) : (
          <input className={`campo${erro ? ' invalido' : ''}`} value={v} onChange={(e) => setV(e.target.value)} onBlur={gravar} onKeyDown={(e) => e.key === 'Enter' && gravar()} />
        )}
        {erro && <div className="erro-campo">{erro}</div>}
      </div>
    </LinhaCampo>
  );
};

/** Número em campo de texto (sem as setinhas nativas), alinhado à direita, com a unidade dentro do campo. */
export const CampoNumero: React.FC<{rotulo: string; valor: number | undefined; aoMudar: (v: number) => void; passo?: number; padrao?: number; unidade?: string;
  aoRedefinir?: () => void; dica?: string}> = ({rotulo, valor, aoMudar, padrao, unidade, aoRedefinir, dica}) => {
  const texto = valor === undefined ? '' : numeroBr(valor);
  const [v, setV] = useState(texto);
  useEffect(() => setV(texto), [texto]);
  const gravar = () => {
    const n = lerNumero(v);
    if (v.trim() !== '' && Number.isFinite(n) && n !== valor) aoMudar(n);
    else if (!Number.isFinite(n)) setV(texto);
  };
  const difere = padrao !== undefined && valor !== undefined && valor !== padrao;
  return (
    <LinhaCampo rotulo={rotulo} dica={dica} difere={difere} padrao={padrao !== undefined ? `${numeroBr(padrao)}${unidade ? ` ${unidade}` : ''}` : undefined}
      aoRedefinir={aoRedefinir ?? (padrao !== undefined ? () => aoMudar(padrao) : undefined)}>
      <div className="campo num">
        <input type="text" inputMode="decimal" value={v} placeholder={padrao !== undefined ? numeroBr(padrao) : ''} onChange={(e) => setV(e.target.value)}
          onBlur={gravar} onKeyDown={(e) => e.key === 'Enter' && gravar()} />
        {unidade && <span className="u">{unidade}</span>}
      </div>
    </LinhaCampo>
  );
};

export const CampoDeslizante: React.FC<{rotulo: string; valor: number; min: number; max: number; passo: number; unidade?: string; aoMudar: (v: number) => void;
  aoVer?: (v: number) => void; formatar?: (v: number) => string; padrao?: number}> = ({rotulo, valor, min, max, passo, unidade, aoMudar, aoVer, formatar, padrao}) => {
  const [v, setV] = useState(valor);
  useEffect(() => setV(valor), [valor]);
  return (
    <LinhaCampo rotulo={rotulo} difere={padrao !== undefined && valor !== padrao} padrao={padrao !== undefined ? (formatar?.(padrao) ?? numeroBr(padrao, 2)) : undefined}
      aoRedefinir={padrao !== undefined ? () => aoMudar(padrao) : undefined}>
      <div className="desliza valor">
        <input type="range" min={min} max={max} step={passo} value={v} aria-label={rotulo}
          onChange={(e) => {
            setV(Number(e.target.value));
            aoVer?.(Number(e.target.value));
          }}
          onPointerUp={() => v !== valor && aoMudar(v)} onKeyUp={() => v !== valor && aoMudar(v)} />
        <span className="v">{formatar ? formatar(v) : `${numeroBr(v, 2)}${unidade ?? ''}`}</span>
      </div>
    </LinhaCampo>
  );
};

type ConstrutorConta = new () => {open: () => Promise<{sRGBHex: string}>};
const ContaGotas = (window as unknown as {EyeDropper?: ConstrutorConta}).EyeDropper;

/** Cor: amostra pequena (abre o seletor nativo), hex editável e conta-gotas. O seletor só grava no "change" nativo,
 *  quando fecha (o onChange do React dispara a cada movimento, e esse vai para a prévia ao vivo). */
export const CampoCor: React.FC<{rotulo: string; valor: string; aoMudar: (v: string) => void; aoVer?: (v: string) => void; padrao?: string}> = ({rotulo, valor, aoMudar, aoVer, padrao}) => {
  const seletor = useRef<HTMLInputElement>(null);
  const atual = useRef({valor, aoMudar});
  atual.current = {valor, aoMudar};
  const [texto, setTexto] = useState(valor);
  useEffect(() => setTexto(valor), [valor]);
  useEffect(() => {
    const el = seletor.current;
    if (!el) return;
    const fechar = () => {
      if (el.value.toLowerCase() !== atual.current.valor.toLowerCase()) atual.current.aoMudar(el.value.toUpperCase());
    };
    el.addEventListener('change', fechar);
    return () => el.removeEventListener('change', fechar);
  }, []);
  const gravarTexto = () => {
    let t = texto.trim();
    if (/^[0-9a-f]{6}$/i.test(t)) t = `#${t}`;
    if (t && t !== valor && CSS.supports('color', t)) aoMudar(/^#[0-9a-f]{6}$/i.test(t) ? t.toUpperCase() : t);
    else setTexto(valor);
  };
  const hex = [texto, valor].find((v) => /^#[0-9a-f]{6}$/i.test(v)) ?? '#000000';
  const difere = padrao !== undefined && valor.toLowerCase() !== padrao.toLowerCase();
  return (
    <LinhaCampo rotulo={rotulo} como="div" difere={difere} padrao={padrao} aoRedefinir={padrao !== undefined ? () => aoMudar(padrao) : undefined}>
      <div className="campo campo-cor">
        <label className="amostra" title="Escolher a cor">
          <span style={{background: CSS.supports('color', texto) ? texto : valor}} />
          <input ref={seletor} type="color" value={hex.toLowerCase()} aria-label={rotulo} onChange={(e) => {
            setTexto(e.target.value.toUpperCase());
            aoVer?.(e.target.value.toUpperCase());
          }} />
        </label>
        <input className="hex" value={texto.replace(/^#/, '')} aria-label={`${rotulo} em hexadecimal`} onChange={(e) => setTexto(/^[0-9a-f]{0,8}$/i.test(e.target.value) ? `#${e.target.value}` : e.target.value)}
          onBlur={gravarTexto} onKeyDown={(e) => e.key === 'Enter' && gravarTexto()} />
        {ContaGotas && (
          <button type="button" className="gotas" title="Conta-gotas: pegar uma cor da tela"
            onClick={() => void new ContaGotas().open().then((r) => aoMudar(r.sRGBHex.toUpperCase())).catch(() => undefined)}>
            <Pipette className="i14" />
          </button>
        )}
      </div>
    </LinhaCampo>
  );
};

export const CampoSelecao = <T extends string>({rotulo, valor, opcoes, aoMudar, padrao}: {rotulo: string; valor: T; opcoes: [T, string][]; aoMudar: (v: T) => void; padrao?: T}) => (
  <LinhaCampo rotulo={rotulo} difere={padrao !== undefined && valor !== padrao} padrao={opcoes.find(([v]) => v === padrao)?.[1]}
    aoRedefinir={padrao !== undefined ? () => aoMudar(padrao) : undefined}>
    <select className="campo" value={valor} onChange={(e) => e.target.value !== valor && aoMudar(e.target.value as T)}>
      {!opcoes.some(([v]) => v === valor) && <option value={valor}>{valor}</option>}
      {opcoes.map(([v, nome]) => <option key={v} value={v}>{nome}</option>)}
    </select>
  </LinhaCampo>
);

/** Valor só de leitura (duração, contagem). */
export const CampoLeitura: React.FC<{rotulo: string; children: React.ReactNode; dica?: string}> = ({rotulo, children, dica}) => (
  <LinhaCampo rotulo={rotulo} como="div" dica={dica}><span className="ler">{children}</span></LinhaCampo>
);

// seções recolhíveis: o estado de cada uma vale enquanto o app está aberto (por título)
const fechadas = new Map<string, boolean>();

export const Secao: React.FC<{titulo: string; children: React.ReactNode; acao?: React.ReactNode; aoRedefinir?: () => void; chave?: string; fechadaDePadrao?: boolean}> = ({titulo, children, acao, aoRedefinir, chave, fechadaDePadrao}) => {
  const k = chave ?? titulo;
  const [fechada, setFechada] = useState(() => fechadas.get(k) ?? Boolean(fechadaDePadrao));
  const alternar = () => {
    fechadas.set(k, !fechada);
    setFechada(!fechada);
  };
  return (
    <section className={`secao${fechada ? ' fechada' : ''}`}>
      <div className="secao-titulo" role="button" tabIndex={0} aria-expanded={!fechada} onClick={alternar}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), alternar())}>
        {fechada ? <ChevronRight /> : <ChevronDown />}
        {titulo}
        {(acao || aoRedefinir) && (
          <span className="acao-secao" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {acao}
            {aoRedefinir && <button type="button" className="redef" onClick={aoRedefinir} title="Volta os campos desta seção ao padrão">Redefinir</button>}
          </span>
        )}
      </div>
      {!fechada && <div className="secao-corpo">{children}</div>}
    </section>
  );
};

/** Cabeçalho do inspector: ícone na cor da família, nome amigável, linha de apoio e o menu ⋯ (copiar caminho, JSON). */
export const CabecalhoInspector: React.FC<{icone: React.ReactNode; familia?: 'texto' | 'midia' | 'efeito'; nome: string; sub?: string; dica?: string; menu?: ItemMenu[]; extra?: React.ReactNode}> = ({icone, familia, nome, sub, dica, menu, extra}) => (
  <div className="cab-insp" title={dica}>
    <span className={`ico-fam${familia ? ` ${familia}` : ''}`}>{icone}</span>
    <div className="nomes">
      <div className="nome">{nome}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
    {extra}
    {menu && menu.length > 0 && <BotaoMenu titulo="Mais ações" icone={<Ellipsis />} itens={menu} />}
  </div>
);
