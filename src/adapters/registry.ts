/**
 * Adapter registry + dispatch resolution (Phase 8 task B2, ADR-034).
 *
 * Dispatch priority is the Adapter contract's own vocabulary
 * (src/adapters/adapter.ts:122-134):
 *   1. explicit flag (highest),
 *   2. manifest signature (middle),
 *   3. file extension (lowest).
 *
 * `resolveAdapter` is PURE: `fsState` is an injected fake
 * (`{ manifestExists: (name) => boolean }`), no clock, no randomness, no
 * hidden mutable state in resolution — the registry itself is only ever
 * mutated via the explicit `register` method. Same inputs -> same outputs.
 *
 * With no adapter matched the result is UNSUPPORTED with a stated reason —
 * never a silent guess (ruling #11: 'a conservative resolution is a stated
 * reason, not a silent pass').
 *
 * Ambiguity rule: if the manifest layer matches MORE THAN ONE registered
 * adapter, the layer is inconclusive and dispatch FALLS THROUGH to the
 * extension layer (and, if that fails, to unsupported) rather than guessing.
 */

import { extname } from 'path';
import type { Adapter } from './adapter';
import { typescriptAdapter } from './typescript/adapter';
import { pythonAdapter } from './python/adapter';

/** Per-call injected filesystem state: which manifest file names exist. */
export interface FsState {
  readonly manifestExists: (name: string) => boolean;
}

/** The dispatch decision: which adapter, which layer decided, or why none. */
export interface AdapterResolution {
  /** The matched adapter id, or null when unsupported. */
  readonly adapterId: string | null;
  /** Which dispatch layer decided: 'flag' | 'manifest' | 'extension' | 'unsupported'. */
  readonly decidedBy: 'flag' | 'manifest' | 'extension' | 'unsupported';
  /** Stated reason; null on a positive match, prose on unsupported. */
  readonly reason: string | null;
}

/** Caller flags. `adapter` names a registered adapter id explicitly. */
export interface DispatchFlags {
  readonly adapter?: string;
}

/** Holds registered adapters under explicit control only. */
export class AdapterRegistry {
  private readonly adapters = new Map<string, Adapter>();

  /** Explicit registration — the only way an adapter enters the registry. */
  register(adapter: Adapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  has(id: string): boolean {
    return this.adapters.has(id);
  }

  get(id: string): Adapter | undefined {
    return this.adapters.get(id);
  }

  /** Registration order is preserved (Map) for deterministic scans. */
  list(): readonly Adapter[] {
    return Array.from(this.adapters.values());
  }
}

/** Default registry: the shipped adapters, explicitly registered. */
export const defaultRegistry = new AdapterRegistry();
defaultRegistry.register(typescriptAdapter);
defaultRegistry.register(pythonAdapter);

/**
 * Pure dispatch: explicit flag > manifest > extension (ADR-034), else
 * unsupported with a stated reason.
 */
export function resolveAdapter(
  filePath: string,
  flags: DispatchFlags,
  fsState: FsState,
  registry: AdapterRegistry = defaultRegistry,
): AdapterResolution {
  // 1. Explicit flag (highest) — but only when it names a REGISTERED adapter;
  //    an unregistered flag id falls through to the structural layers rather
  //    than failing the call.
  if (flags.adapter) {
    if (registry.has(flags.adapter)) {
      return { adapterId: flags.adapter, decidedBy: 'flag', reason: null };
    }
  }

  // 2. Manifest signature (middle): read candidate signatures from the adapter
  //    contract, never a hardcoded language list. More than one candidate ->
  //    inconclusive -> fall through to extension.
  const manifestCandidates = registry
    .list()
    .filter((adapter) => adapter.manifestSignatures.some((name) => fsState.manifestExists(name)));
  if (manifestCandidates.length === 1) {
    return { adapterId: manifestCandidates[0].id, decidedBy: 'manifest', reason: null };
  }

  // 3. Extension match (lowest). Extension is claimed by the adapter contract.
  const extensionCandidates = registry
    .list()
    .filter((adapter) => adapter.extensions.some((ext) => extname(filePath) === ext));
  if (extensionCandidates.length === 1) {
    return { adapterId: extensionCandidates[0].id, decidedBy: 'extension', reason: null };
  }

  // 4. Nothing matched — stated reason, never a silent guess.
  return { adapterId: null, decidedBy: 'unsupported', reason: 'no adapter matched' };
}
