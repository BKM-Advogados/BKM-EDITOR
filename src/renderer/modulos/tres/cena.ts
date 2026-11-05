// Cena do Three.js montada a partir do documento 3D. Quando o documento muda (pela interface ou pelo agente), a cena é
// atualizada no lugar, por id: malhas e luzes são reaproveitadas, criadas ou descartadas. É dona de tudo que pede dispose().
import {
  AmbientLight, BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, DoubleSide, FrontSide, Light,
  Mesh, MeshStandardMaterial, PlaneGeometry, PointLight, Raycaster, Scene, SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import type {DocCena3D, Luz3D, Vetor3} from '../../../nucleo/documentos';
import {GRAU, luzesDe, objetosDe, PADRAO_METALICO, PADRAO_RUGOSIDADE, vetor, type TipoObjeto} from './comum';
import type {AjusteAoVivo} from './vista';

type Malha = Mesh<BufferGeometry, MeshStandardMaterial>;
type DadosMalha = {id: string; base: Vetor3; giro: Vetor3; gira?: Vetor3};

// medidas padrão do Three.js (raio 1, altura 1, lado 1): a escala do documento faz o resto
const criarGeometria = (tipo: TipoObjeto): BufferGeometry => {
  switch (tipo) {
    case 'esfera': return new SphereGeometry(1, 48, 24);
    case 'cilindro': return new CylinderGeometry(1, 1, 1, 48);
    case 'cone': return new ConeGeometry(1, 1, 48);
    case 'toro': return new TorusGeometry(1, 0.4, 24, 96);
    case 'plano': return new PlaneGeometry(1, 1);
    default: return new BoxGeometry(1, 1, 1);
  }
};

const criarLuz = (tipo: Luz3D['tipo']): Light =>
  tipo === 'ambiente' ? new AmbientLight() : tipo === 'direcional' ? new DirectionalLight() : new PointLight(0xffffff, 1, 0, 2);

const dados = (m: Malha) => m.userData as DadosMalha;

export class CenaDoc {
  readonly cena = new Scene();
  private readonly fundo = new Color('#000000');
  private readonly malhas = new Map<string, Malha>();
  private readonly luzes = new Map<string, {tipo: Luz3D['tipo']; luz: Light}>();
  private readonly geometrias = new Map<TipoObjeto, BufferGeometry>();

  constructor() {
    this.cena.background = this.fundo;
  }

  private geometria(tipo: TipoObjeto) {
    let g = this.geometrias.get(tipo);
    if (!g) this.geometrias.set(tipo, (g = criarGeometria(tipo)));
    return g;
  }

  malha(id: string | null | undefined) {
    return id ? this.malhas.get(id) : undefined;
  }

  /** Atualiza a cena para o documento. `fixa` é a malha em arrasto no gizmo, que não volta ao valor do disco no meio do gesto. */
  sincronizar(doc: DocCena3D, fixa?: Malha | null) {
    if (typeof doc.fundo === 'string') this.fundo.set(doc.fundo);
    const vistos = new Set<string>();
    for (const o of objetosDe(doc)) {
      if (!o || typeof o.id !== 'string' || vistos.has(o.id)) continue;
      vistos.add(o.id);
      let m = this.malhas.get(o.id);
      if (!m) {
        m = new Mesh(this.geometria(o.tipo), new MeshStandardMaterial());
        m.userData = {id: o.id, base: [0, 0, 0], giro: [0, 0, 0]} satisfies DadosMalha;
        this.malhas.set(o.id, m);
        this.cena.add(m);
      }
      m.name = o.nome ?? o.id;
      m.geometry = this.geometria(o.tipo);
      m.visible = o.visivel !== false;
      const mat = m.material;
      mat.color.set(typeof o.cor === 'string' ? o.cor : '#808080');
      mat.metalness = o.metalico ?? PADRAO_METALICO;
      mat.roughness = o.rugosidade ?? PADRAO_RUGOSIDADE;
      const lado = o.tipo === 'plano' ? DoubleSide : FrontSide;
      if (mat.side !== lado) {
        mat.side = lado;
        mat.needsUpdate = true;
      }
      const d = dados(m);
      d.gira = o.gira ? vetor(o.gira, [0, 0, 0]) : undefined;
      d.base = vetor(o.rotacao, [0, 0, 0]).map((g) => g * GRAU) as Vetor3;
      if (m === fixa) continue;
      m.position.set(...vetor(o.posicao, [0, 0, 0]));
      m.scale.set(...vetor(o.escala, [1, 1, 1]));
      this.aplicarRotacao(m);
    }
    for (const [id, m] of this.malhas) {
      if (vistos.has(id)) continue;
      this.cena.remove(m);
      m.material.dispose();
      this.malhas.delete(id);
    }

    const luzesVistas = new Set<string>();
    for (const l of luzesDe(doc)) {
      if (!l || typeof l.id !== 'string' || luzesVistas.has(l.id)) continue;
      luzesVistas.add(l.id);
      let item = this.luzes.get(l.id);
      if (item && item.tipo !== l.tipo) {
        this.cena.remove(item.luz);
        item.luz.dispose();
        item = undefined;
      }
      if (!item) {
        item = {tipo: l.tipo, luz: criarLuz(l.tipo)};
        this.luzes.set(l.id, item);
        this.cena.add(item.luz);
      }
      item.luz.color.set(typeof l.cor === 'string' ? l.cor : '#ffffff');
      item.luz.intensity = typeof l.intensidade === 'number' ? l.intensidade : 1;
      if (l.tipo !== 'ambiente') item.luz.position.set(...vetor(l.posicao, [0, 5, 0]));
    }
    for (const [id, item] of this.luzes) {
      if (luzesVistas.has(id)) continue;
      this.cena.remove(item.luz);
      item.luz.dispose();
      this.luzes.delete(id);
    }
  }

  private aplicarRotacao(m: Malha) {
    const {base, giro} = dados(m);
    m.rotation.set(base[0] + giro[0], base[1] + giro[1], base[2] + giro[2]);
  }

  /** Avança a prévia animada pelo campo `gira` (graus por segundo). */
  girar(dt: number) {
    for (const m of this.malhas.values()) {
      const d = dados(m);
      if (!d.gira) continue;
      for (let i = 0; i < 3; i++) d.giro[i] = (d.giro[i] + d.gira[i] * GRAU * dt) % (Math.PI * 2);
      this.aplicarRotacao(m);
    }
  }

  /** Volta tudo à rotação do documento. */
  pararGiro() {
    for (const m of this.malhas.values()) {
      dados(m).giro = [0, 0, 0];
      this.aplicarRotacao(m);
    }
  }

  ajustar(id: string, a: AjusteAoVivo) {
    const m = this.malhas.get(id);
    if (!m) return;
    if (a.cor !== undefined) m.material.color.set(a.cor);
    if (a.metalico !== undefined) m.material.metalness = a.metalico;
    if (a.rugosidade !== undefined) m.material.roughness = a.rugosidade;
  }

  /** Malha visível mais próxima no raio (o Raycaster não olha `visible` sozinho). */
  tocar(raio: Raycaster): {id: string; ponto: Vector3} | null {
    const visiveis = [...this.malhas.values()].filter((m) => m.visible);
    const [acerto] = raio.intersectObjects(visiveis, false);
    return acerto ? {id: dados(acerto.object as Malha).id, ponto: acerto.point.clone()} : null;
  }

  descartar() {
    for (const m of this.malhas.values()) m.material.dispose();
    for (const g of this.geometrias.values()) g.dispose();
    for (const {luz} of this.luzes.values()) luz.dispose();
    this.malhas.clear();
    this.geometrias.clear();
    this.luzes.clear();
    this.cena.clear();
  }
}
