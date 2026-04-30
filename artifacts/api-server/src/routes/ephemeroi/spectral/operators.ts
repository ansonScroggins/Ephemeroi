/**
 * Thin compatibility layer over the SpectralRegistry. The HTTP routes
 * still call `getOperator(name)` / `listOperators()`; both delegate to
 * the registry singleton initialised in `./registry.ts` from the
 * manifest in `./skills/index.ts`.
 *
 * To add or remove an operator, edit `./skills/index.ts` — do not edit
 * this file.
 */
import type { SpectralOperator } from "./types";
import { spectralRegistry } from "./registry";

export function getOperator(name: string): SpectralOperator | undefined {
  return spectralRegistry.getSkill(name);
}

export function listOperators(): SpectralOperator[] {
  return spectralRegistry.list();
}

/**
 * Alias kept for backwards compatibility with anything that imported the
 * array directly. Implemented as a getter so it is evaluated lazily —
 * eager evaluation at module-load can deadlock with the
 * registry/router cycle on cold start.
 */
export const SPECTRAL_OPERATORS: readonly SpectralOperator[] = new Proxy(
  [] as SpectralOperator[],
  {
    get(_target, prop) {
      const arr = spectralRegistry.list();
      const v = (arr as unknown as Record<string | symbol, unknown>)[prop];
      return typeof v === "function" ? v.bind(arr) : v;
    },
  },
);
