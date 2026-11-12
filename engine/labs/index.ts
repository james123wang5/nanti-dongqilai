// 实验室入口：场景里写了哪种实验室，就交给对应模块。
import type { SimResult } from '../sim.ts';
import { labResult } from './common.ts';
import { optics, type OpticsSpec } from './optics.ts';
import { gas, type GasSpec } from './gas.ts';
import { wave, type WaveSpec } from './wave.ts';
import { electro, type ElectroSpec } from './electro.ts';
import { atom, type AtomSpec } from './atom.ts';
import { ac, type AcSpec } from './ac.ts';
import { induction, type InductionSpec } from './induction.ts';
import { gravity, type GravitySpec } from './gravity.ts';
import { experiment, type ExperimentSpec } from './experiment.ts';
import { particle, type ParticleSpec } from './particle.ts';
import { ode, type OdeSpec } from './ode.ts';
import { statics, type StaticsSpec } from './statics.ts';
import { nuclear, type NuclearSpec } from './nuclear.ts';
import { slit, type SlitSpec } from './slit.ts';
import { lc, type LcSpec } from './lc.ts';

export type LabSpecs = { optics?: OpticsSpec; gas?: GasSpec; wave?: WaveSpec; electro?: ElectroSpec; atom?: AtomSpec; ac?: AcSpec; induction?: InductionSpec; gravity?: GravitySpec; experiment?: ExperimentSpec; particle?: ParticleSpec; ode?: OdeSpec; statics?: StaticsSpec; nuclear?: NuclearSpec; slit?: SlitSpec; lc?: LcSpec };
export const LAB_KEYS = ['optics', 'gas', 'wave', 'electro', 'atom', 'ac', 'induction', 'gravity', 'experiment', 'particle', 'ode', 'statics', 'nuclear', 'slit', 'lc'] as const;
export const labOf = (sc: LabSpecs) => LAB_KEYS.find((k) => sc[k]);
export function simulateLab(sc: LabSpecs, vars: Record<string, number>, opt: { sample?: number; times?: number[] } = {}): SimResult {
  const o = sc.optics ? optics(sc.optics, vars) : sc.gas ? gas(sc.gas, vars) : sc.wave ? wave(sc.wave, vars) : sc.electro ? electro(sc.electro, vars) : sc.atom ? atom(sc.atom, vars) : sc.ac ? ac(sc.ac, vars) : sc.induction ? induction(sc.induction, vars) : sc.gravity ? gravity(sc.gravity, vars) : sc.particle ? particle(sc.particle, vars) : sc.ode ? ode(sc.ode, vars) : sc.statics ? statics(sc.statics, vars) : sc.nuclear ? nuclear(sc.nuclear, vars) : sc.slit ? slit(sc.slit, vars) : sc.lc ? lc(sc.lc, vars) : experiment(sc.experiment!, vars);
  const r = labResult(o, opt); (r as { vars?: Record<string, number> }).vars = vars; return r;
}
