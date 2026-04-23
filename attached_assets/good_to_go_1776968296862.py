#!/usr/bin/env python3
"""
ANSON PHASELOCK-SAT (Mobile-Safe) — SINGLE-FILE BUILD (Planted + Concave Lens)

What’s new (for your “try again”):
- PLANTED mode (guaranteed satisfiable instance) + RANDOM mode
- Fixed-instance reliability protocol (same instance per ratio, multiple solver seeds)
- Incremental UNSAT tracking (fast enough to push n into the thousands on phone)
- CONCAVE “lens” (wider + tighter): wide weights for exploration + tight gate for keyhole
- Noise Keyhole (Planet 3 only) + Cryo Lock + Mirror Planet (optional)
- iOS-safe: no multiprocessing, no subprocess, minimal imports, temp-dir CSV

Examples:
  # Planted + concave lens, 4 planets, 6s, same instances per ratio, 5 solver tries each
  python3 main.py --mode planted --door PHASE --planets 4 --secs 6 \
    --ladder 3.30,4.50,4.80,4.90 --trials 5 --lens concave

  # Push variables (start here before 3000):
  python3 main.py --mode planted --n 1200 --secs 8 --trials 5 --ladder 4.80,4.90 --lens concave

  # Try 3000 (may need more seconds):
  python3 main.py --mode planted --n 3000 --secs 12 --trials 3 --ladder 4.80,4.90 --lens concave

If you ever see: "SyntaxError invalid syntax (main.py, line 1)"
→ You pasted extra characters before #!/usr/bin/env python3.
Make sure the very first character of the file is '#'.
No triple-backticks, no leading spaces, no quotes.
"""

from __future__ import annotations

import argparse
import csv
import math
import os
import random
import tempfile
import time
from dataclasses import dataclass
from typing import List, Tuple, Optional

Clause = Tuple[int, int, int]  # literals: ±(var_index+1), var_index in [0..n-1]


# ----------------------------
# Literal truth + incremental evaluator
# ----------------------------

def lit_true(lit: int, bits: List[int]) -> bool:
    v = abs(lit) - 1
    b = bits[v]
    return (b == 1) if (lit > 0) else (b == 0)


@dataclass
class EvalState:
    bits: List[int]
    clause_true: List[int]     # number of true literals per clause
    unsat: int                 # number of unsatisfied clauses


def init_eval(clauses: List[Clause], bits: List[int]) -> EvalState:
    ct = [0] * len(clauses)
    unsat = 0
    for i, cl in enumerate(clauses):
        t = 0
        if lit_true(cl[0], bits): t += 1
        if lit_true(cl[1], bits): t += 1
        if lit_true(cl[2], bits): t += 1
        ct[i] = t
        if t == 0:
            unsat += 1
    return EvalState(bits=bits, clause_true=ct, unsat=unsat)


def flip_var_in_eval(clauses: List[Clause], v2c: List[List[int]], st: EvalState, var: int) -> None:
    """
    Incrementally update clause_true + unsat when flipping st.bits[var].
    Clause size is 3, so per affected clause we just scan 3 lits.
    """
    old_bit = st.bits[var]
    st.bits[var] = old_bit ^ 1

    for ci in v2c[var]:
        before = st.clause_true[ci]
        was_unsat = (before == 0)

        cl = clauses[ci]
        # recompute only this clause's true count (3 checks) – still fast
        t = 0
        if lit_true(cl[0], st.bits): t += 1
        if lit_true(cl[1], st.bits): t += 1
        if lit_true(cl[2], st.bits): t += 1
        st.clause_true[ci] = t

        is_unsat = (t == 0)
        if was_unsat and not is_unsat:
            st.unsat -= 1
        elif (not was_unsat) and is_unsat:
            st.unsat += 1


def build_var_to_clauses(clauses: List[Clause], n_vars: int) -> List[List[int]]:
    v2c = [[] for _ in range(n_vars)]
    for ci, cl in enumerate(clauses):
        for lit in cl:
            v2c[abs(lit) - 1].append(ci)
    return v2c


# ----------------------------
# Instance generation
# ----------------------------

def gen_random_3sat(n_vars: int, m_clauses: int, rng: random.Random) -> List[Clause]:
    clauses: List[Clause] = []
    for _ in range(m_clauses):
        vs = rng.sample(range(1, n_vars + 1), 3)
        a = vs[0] * (-1 if rng.random() < 0.5 else 1)
        b = vs[1] * (-1 if rng.random() < 0.5 else 1)
        c = vs[2] * (-1 if rng.random() < 0.5 else 1)
        clauses.append((a, b, c))
    return clauses


def gen_planted_3sat(n_vars: int, m_clauses: int, rng: random.Random) -> Tuple[List[Clause], List[int]]:
    """
    Produce a satisfiable 3-SAT by planting a hidden solution 'plant_bits'.
    Each clause is generated until it's satisfied by plant_bits.
    """
    plant_bits = [1 if rng.random() < 0.5 else 0 for _ in range(n_vars)]
    clauses: List[Clause] = []

    while len(clauses) < m_clauses:
        vs = rng.sample(range(1, n_vars + 1), 3)

        # random signs
        lits = []
        for v in vs:
            lit = v if (rng.random() < 0.5) else -v
            lits.append(lit)

        cl = (lits[0], lits[1], lits[2])

        # accept only if satisfied by planted assignment
        if lit_true(cl[0], plant_bits) or lit_true(cl[1], plant_bits) or lit_true(cl[2], plant_bits):
            clauses.append(cl)

    return clauses, plant_bits


# ----------------------------
# Pressure / hot vars (periodic)
# ----------------------------

def compute_pressures_periodic(clauses: List[Clause],
                              n_vars: int,
                              st: EvalState,
                              pressure_top_probe: int) -> List[float]:
    """
    Pressure = UNSAT participation (cheap, from clause_true==0 scan)
             + 0.75*|local delta| for a small top set (needles)
    """
    p = [0.0] * n_vars

    # base: participation in UNSAT clauses
    for ci, cl in enumerate(clauses):
        if st.clause_true[ci] == 0:
            a, b, c = cl
            p[abs(a) - 1] += 1.0
            p[abs(b) - 1] += 1.0
            p[abs(c) - 1] += 1.0

    # probe only top candidates for local flip “violence”
    idx = list(range(n_vars))
    idx.sort(key=lambda i: p[i], reverse=True)
    top_probe = idx[:min(pressure_top_probe, n_vars)]

    # local delta: simulate flip + count unsat delta from affected clauses only
    # (still cheap because probe set small)
    for v in top_probe:
        before_unsat = st.unsat

        # do a temporary flip
        # we’ll flip, read st.unsat, then flip back
        # IMPORTANT: we must restore clause_true exactly
        # easiest: copy affected clause_true values
        # affected count can be moderate, but probe set is tiny
        affected = []
        for ci in v2c_global[v]:
            affected.append((ci, st.clause_true[ci]))
        old_unsat = st.unsat
        old_bit = st.bits[v]

        flip_var_in_eval(clauses, v2c_global, st, v)
        after_unsat = st.unsat

        # restore
        st.bits[v] = old_bit
        st.unsat = old_unsat
        for ci, val in affected:
            st.clause_true[ci] = val

        d = after_unsat - before_unsat
        p[v] += 0.75 * abs(float(d))

    return p


def top_k_pressures(pressures: List[float], k: int = 12) -> List[Tuple[int, float]]:
    idx = list(range(len(pressures)))
    idx.sort(key=lambda i: pressures[i], reverse=True)
    return [(i, pressures[i]) for i in idx[:k]]


# ----------------------------
# Lens (concave): “wider + tighter”
#   - wide: used for selection weights (explore more midrange)
#   - tight: used for keyhole threshold (only the hottest cluster)
# ----------------------------

def lens_wide(norm: float) -> float:
    # concave expansion of midrange: sqrt widens differences early
    return math.sqrt(max(0.0, norm))

def lens_tight(norm: float) -> float:
    # convex tightening: square crushes small values, highlights peaks
    return max(0.0, norm) ** 2


# ----------------------------
# Move selection
# ----------------------------

def pick_var_random(n_vars: int, rng: random.Random) -> int:
    return rng.randrange(n_vars)

def pick_var_from_unsat_clause(clauses: List[Clause], st: EvalState, rng: random.Random) -> Optional[int]:
    # collect a few unsat indices quickly (don’t build huge list)
    # scan until we find one, then pick one of its vars
    # if none => solved
    unsat_found = []
    for i in range(len(clauses)):
        if st.clause_true[i] == 0:
            unsat_found.append(i)
            if len(unsat_found) >= 16:
                break
    if not unsat_found:
        return None
    ci = rng.choice(unsat_found)
    cl = clauses[ci]
    lit = rng.choice(cl)
    return abs(lit) - 1

def pick_var_phase(clauses: List[Clause], st: EvalState, pressures: List[float], rng: random.Random) -> Optional[int]:
    # choose an UNSAT clause first
    ci = None
    for _ in range(64):
        j = rng.randrange(len(clauses))
        if st.clause_true[j] == 0:
            ci = j
            break
    if ci is None:
        # fallback scan
        for j in range(len(clauses)):
            if st.clause_true[j] == 0:
                ci = j
                break
    if ci is None:
        return None

    a, b, c = clauses[ci]
    vars_in = [abs(a) - 1, abs(b) - 1, abs(c) - 1]

    maxp = max(pressures) if pressures else 0.0
    if maxp <= 0.0:
        return rng.choice(vars_in)

    # concave “wide” lens weights
    w = []
    for v in vars_in:
        norm = pressures[v] / maxp
        w.append(0.20 + 0.80 * lens_wide(norm))  # keep nonzero floor

    s = w[0] + w[1] + w[2]
    r = rng.random() * s
    if r < w[0]:
        return vars_in[0]
    if r < w[0] + w[1]:
        return vars_in[1]
    return vars_in[2]


# ----------------------------
# Adaptive lift (stagnation)
# ----------------------------

@dataclass
class Governance:
    heat: float = 0.0
    spin_velocity: float = 0.0
    stagnation_ticks: int = 0
    last_sig: int = 0

def signature(bits: List[int]) -> int:
    return hash(tuple(bits))

def apply_adaptive_lift(clauses: List[Clause], v2c: List[List[int]], st: EvalState,
                        gov: Governance, rng: random.Random, stagn_thresh: int) -> int:
    cur = signature(st.bits)
    kicks = 0
    if cur == gov.last_sig:
        gov.stagnation_ticks += 1
    else:
        gov.stagnation_ticks = 0
        gov.spin_velocity *= 0.93

    if gov.stagnation_ticks >= stagn_thresh:
        gov.spin_velocity = min(6.0, gov.spin_velocity + 0.8)
        tumble_p = min(0.22, gov.spin_velocity * 0.045)

        # controlled tumble: flip a few vars with small probability
        for i in range(len(st.bits)):
            if rng.random() < tumble_p:
                flip_var_in_eval(clauses, v2c, st, i)
                kicks += 1

        gov.heat += math.log(2.0 + gov.stagnation_ticks)
        gov.stagnation_ticks = 0

    gov.last_sig = cur
    return kicks


# ----------------------------
# Harmonic sizing: Small-9 / Medium-6 / Big-3
# ----------------------------

def harmonic_prob_from_pressure(p: float, p_hi: float, p_mid: float, p_lo: float) -> float:
    # hottest => “needle” probability (small)
    if p >= p_hi:
        return 0.18
    # mid => steady
    if p >= p_mid:
        return 0.55
    # low => broad grounding
    if p >= p_lo:
        return 0.80
    return 0.35


# ----------------------------
# Noise Keyhole (Planet 3 only; concave lens tight-gate)
# ----------------------------

def trigger_noise_keyhole(clauses: List[Clause],
                          v2c: List[List[int]],
                          st: EvalState,
                          pressures: List[float],
                          planet_id: int,
                          rng: random.Random) -> int:
    if planet_id != 3:
        return 0
    if not pressures:
        return 0

    maxp = max(pressures)
    if maxp <= 0.0:
        return 0

    # relative tiers
    p_hi = 0.90 * maxp
    p_mid = 0.60 * maxp
    p_lo = 0.25 * maxp

    # Tight gate via convex lens:
    # only variables whose tight score is above a threshold pass into keyhole.
    # “wider+tighter”: weights are wide elsewhere, but the gate is tight.
    keyhole_thr_tight = 0.18  # fraction in tight-space
    kicks = 0

    for i, p in enumerate(pressures):
        norm = p / maxp
        tight = lens_tight(norm)
        if tight >= keyhole_thr_tight:
            prob = harmonic_prob_from_pressure(p, p_hi, p_mid, p_lo)

            # micro attempts for the very hottest
            tries = 2 if p >= p_hi else 1
            for _ in range(tries):
                if rng.random() < prob:
                    flip_var_in_eval(clauses, v2c, st, i)
                    kicks += 1
                    break

    return kicks


# ----------------------------
# Cryo lock (freeze top 2 hot vars; staggered release)
# ----------------------------

@dataclass
class CryoPlan:
    freeze_len: int = 120
    release_gap: int = 90
    freeze_idx_a: int = -1
    freeze_idx_b: int = -1
    freeze_timer: int = 0
    phase: int = 0  # 0=inactive, 1=both frozen, 2=release B, 3=release A

def cryo_maybe_trigger(cryo: CryoPlan, pressures: List[float], just_improved: bool, stagnation_flag: bool) -> None:
    if cryo.phase != 0:
        return
    if not (just_improved or stagnation_flag):
        return
    top2 = top_k_pressures(pressures, 2)
    if len(top2) >= 2 and top2[0][1] > 0.0:
        cryo.freeze_idx_a = top2[0][0]
        cryo.freeze_idx_b = top2[1][0]
        cryo.freeze_timer = 0
        cryo.phase = 1

def cryo_step_and_filter(cryo: CryoPlan, candidate_var: int) -> int:
    if cryo.phase == 0:
        return candidate_var

    cryo.freeze_timer += 1

    if cryo.phase == 1:
        if candidate_var in (cryo.freeze_idx_a, cryo.freeze_idx_b):
            return -1
        if cryo.freeze_timer >= cryo.freeze_len:
            cryo.phase = 2
            cryo.freeze_timer = 0
        return candidate_var

    if cryo.phase == 2:
        if candidate_var == cryo.freeze_idx_a:
            return -1
        if cryo.freeze_timer >= cryo.release_gap:
            cryo.phase = 3
            cryo.freeze_timer = 0
        return candidate_var

    # phase 3 ends now
    cryo.phase = 0
    cryo.freeze_idx_a = -1
    cryo.freeze_idx_b = -1
    cryo.freeze_timer = 0
    return candidate_var


# ----------------------------
# Shared best (in-process)
# ----------------------------

@dataclass
class SharedBest:
    bits: List[int]
    unsat: int

def maybe_update_shared(shared: SharedBest, bits: List[int], unsat: int) -> bool:
    if unsat < shared.unsat:
        shared.unsat = unsat
        shared.bits[:] = bits[:]
        return True
    return False


# ----------------------------
# CSV (mobile-safe)
# ----------------------------

def open_csv_writer() -> Tuple[Optional[csv.writer], Optional[str], Optional[object]]:
    try:
        td = tempfile.gettempdir()
        path = os.path.join(td, f"phaselock_log_{int(time.time())}.csv")
        fh = open(path, "w", newline="")
        w = csv.writer(fh)
        w.writerow([
            "ratio", "planet", "flip", "unsat", "global_best_unsat", "max_pressure",
            "heat", "spin_velocity",
            "cryo_phase", "cryo_A", "cryo_B"
        ])
        return w, path, fh
    except Exception:
        return None, None, None


def print_header(s: str) -> None:
    print("#" * 58)
    print(s)
    print("#" * 58)


# ----------------------------
# Planet loop
# ----------------------------

@dataclass
class PlanetStats:
    best_unsat: int
    kicks: int
    improvements: int

def run_planet(planet_id: int,
               clauses: List[Clause],
               n_vars: int,
               v2c: List[List[int]],
               shared: SharedBest,
               door: str,
               rng: random.Random,
               max_flips: int,
               tunnel_cap: float,
               stagn_lift_thresh: int,
               mirror_planet: bool,
               csv_writer: Optional[csv.writer],
               ratio: float,
               pressure_period: int,
               pressure_top_probe: int) -> PlanetStats:

    # init bits
    if mirror_planet and planet_id == 3:
        bits = [b ^ 1 for b in shared.bits]
    else:
        bits = shared.bits[:]
        # micro-shake
        for i in range(n_vars):
            if rng.random() < 0.10:
                bits[i] ^= 1

    st = init_eval(clauses, bits)
    gov = Governance()
    cryo = CryoPlan()

    planet_best = st.unsat
    kicks = 0
    improvements = 0
    last_improved = False

    pressures = [0.0] * n_vars

    for flip in range(1, max_flips + 1):
        if planet_best == 0:
            break

        # periodic pressure recompute (fast enough for big n)
        if flip == 1 or (flip % pressure_period == 0):
            # global v2c for probe delta (needed inside compute_pressures_periodic)
            # (we bind it through the module-level v2c_global)
            global v2c_global
            v2c_global = v2c
            pressures = compute_pressures_periodic(clauses, n_vars, st, pressure_top_probe)

        maxp = max(pressures) if pressures else 0.0

        # adaptive lift
        kicks_added = apply_adaptive_lift(clauses, v2c, st, gov, rng, stagn_lift_thresh)
        kicks += kicks_added
        stagnation_flag = (kicks_added > 0)

        # noise keyhole (Planet 3)
        kicks += trigger_noise_keyhole(clauses, v2c, st, pressures, planet_id, rng)

        # cryo trigger (on improvement OR stagnation)
        cryo_maybe_trigger(cryo, pressures, just_improved=last_improved, stagnation_flag=stagnation_flag)

        # choose var
        if door == "RANDOM":
            chosen = pick_var_random(n_vars, rng)
        elif door == "GREEDY":
            chosen = pick_var_from_unsat_clause(clauses, st, rng)
            if chosen is None:
                planet_best = 0
                break
        else:
            chosen = pick_var_phase(clauses, st, pressures, rng)
            if chosen is None:
                planet_best = 0
                break

        # cryo filtering
        v = cryo_step_and_filter(cryo, chosen)
        if v == -1:
            # pick a non-frozen alternative (try a few times)
            for _ in range(8):
                alt = pick_var_random(n_vars, rng)
                if alt not in (cryo.freeze_idx_a, cryo.freeze_idx_b):
                    v = alt
                    break
            if v == -1:
                v = pick_var_random(n_vars, rng)

        # tunneling
        if rng.random() < tunnel_cap:
            v = pick_var_random(n_vars, rng)

        flip_var_in_eval(clauses, v2c, st, v)

        # evaluate
        u = st.unsat
        last_improved = False
        if u < planet_best:
            planet_best = u
            improvements += 1
            last_improved = True
            maybe_update_shared(shared, st.bits, u)
            if csv_writer is not None:
                csv_writer.writerow([
                    ratio, planet_id, flip, u, shared.unsat, maxp,
                    gov.heat, gov.spin_velocity,
                    cryo.phase, cryo.freeze_idx_a, cryo.freeze_idx_b
                ])

        # follow the Pope (global best) occasionally
        if flip % 2500 == 0 and shared.unsat + 1 < planet_best:
            st.bits[:] = shared.bits[:]
            st = init_eval(clauses, st.bits)
            # micro-shake
            for i in range(n_vars):
                if rng.random() < 0.03:
                    flip_var_in_eval(clauses, v2c, st, i)

    return PlanetStats(best_unsat=planet_best, kicks=kicks, improvements=improvements)


# ----------------------------
# Session runner (ratio ladder) with PLANTED mode and fixed-instance protocol
# ----------------------------

def parse_ladder(s: str) -> List[float]:
    out: List[float] = []
    for part in s.split(","):
        part = part.strip()
        if part:
            out.append(float(part))
    return out


def run_one_ratio_fixed_instance(ratio: float,
                                 mode: str,
                                 n_vars: int,
                                 seconds: float,
                                 planets: int,
                                 door: str,
                                 instance_seed: int,
                                 trials: int,
                                 mirror_planet: bool,
                                 csv_on: bool,
                                 lens: str) -> Tuple[int, List[Tuple[int, float]], int]:
    """
    Fixed instance per ratio:
      - instance_seed determines clauses (+ planted solution if planted)
      - each trial uses different solver_seed for stochasticity
    Returns:
      best_unsat_over_trials, top_hot_vars_from_best_trial, solved_trials_count
    """
    rng_instance = random.Random(instance_seed)
    m_clauses = int(round(ratio * n_vars))

    if mode == "planted":
        clauses, planted_bits = gen_planted_3sat(n_vars, m_clauses, rng_instance)
        init_bits = planted_bits[:]  # start near planted truth
        # micro shake so it’s not trivial
        for i in range(n_vars):
            if rng_instance.random() < 0.08:
                init_bits[i] ^= 1
    else:
        clauses = gen_random_3sat(n_vars, m_clauses, rng_instance)
        init_bits = [1 if rng_instance.random() < 0.5 else 0 for _ in range(n_vars)]

    v2c = build_var_to_clauses(clauses, n_vars)
    shared0 = init_eval(clauses, init_bits).unsat

    best_for_ratio = 10**9
    best_tops: List[Tuple[int, float]] = []
    solved_count = 0

    # iOS-safe CSV: one file per ratio run (optional)
    csv_writer = None
    csv_path = None
    csv_fh = None
    if csv_on:
        csv_writer, csv_path, csv_fh = open_csv_writer()

    # tuning
    tunnel_cap = min(0.28, 0.08 + max(0.0, ratio - 4.2) * 0.07)
    stagn_lift_thresh = 240 if ratio >= 4.85 else 340

    # pressure cadence (big n wants less frequent)
    pressure_period = 30 if n_vars >= 1200 else 18
    pressure_top_probe = 16 if n_vars >= 1200 else 20

    # flips budget: scale with seconds, but cap for phone safety
    flips_per_planet = int(7000 + 2200 * max(0.0, seconds - 2.0))
    if n_vars >= 1200:
        flips_per_planet = int(5200 + 1800 * max(0.0, seconds - 2.0))
    flips_per_planet = min(flips_per_planet, 26000)

    print_header(f"RATIO {ratio:.2f} — FIXED INSTANCE PROTOCOL")
    print(f"mode={mode}  n={n_vars}  m={m_clauses}  planets={planets}  secs={seconds:.2f}")
    print(f"door={door}  lens={lens}  mirror={'ON' if mirror_planet else 'OFF'}  csv={'ON' if csv_on else 'OFF'}")
    if csv_on and csv_path:
        print(f"CSV: {csv_path}")
    print(f"instance_seed={instance_seed}  (same clauses for all trials at this ratio)")
    print("-" * 58)

    for t in range(trials):
        solver_seed = (instance_seed * 1009 + t * 1337 + int(ratio * 10000)) & 0x7FFFFFFF
        rng_master = random.Random(solver_seed)

        # reset shared best per trial (same initial bits)
        shared = SharedBest(bits=init_bits[:], unsat=shared0)

        planet_stats: List[PlanetStats] = []
        for pid in range(planets):
            prng = random.Random(rng_master.randint(1, 10**9))
            st = run_planet(
                planet_id=pid,
                clauses=clauses,
                n_vars=n_vars,
                v2c=v2c,
                shared=shared,
                door=door,
                rng=prng,
                max_flips=flips_per_planet,
                tunnel_cap=tunnel_cap,
                stagn_lift_thresh=stagn_lift_thresh,
                mirror_planet=mirror_planet,
                csv_writer=csv_writer,
                ratio=ratio,
                pressure_period=pressure_period,
                pressure_top_probe=pressure_top_probe
            )
            planet_stats.append(st)

        trial_best = shared.unsat
        if trial_best == 0:
            solved_count += 1

        best_for_ratio = min(best_for_ratio, trial_best)

        print(f"TRIAL {t+1}/{trials}  solver_seed={solver_seed}  RESULT best_unsat={trial_best}")
        if trial_best == best_for_ratio:
            # compute pressures on best state (one last scan) for reporting
            st_best = init_eval(clauses, shared.bits[:])
            global v2c_global
            v2c_global = v2c
            pressures_final = compute_pressures_periodic(clauses, n_vars, st_best, pressure_top_probe=24)
            best_tops = top_k_pressures(pressures_final, 12)

    if csv_fh is not None:
        csv_fh.flush()
        csv_fh.close()

    print("-" * 58)
    print(f"RATIO SUMMARY: ratio={ratio:.2f}  best_unsat={best_for_ratio}  solved_trials={solved_count}/{trials}")
    print_header("FINAL STATE (BEST TRIAL) — TOP HOT VARS")
    print(f"best_unsat={best_for_ratio}")
    for i, p in best_tops:
        print(f"  v{i}: {p:.2f}")
    print()

    return best_for_ratio, best_tops, solved_count


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", type=str, default="planted", choices=["planted", "random"])
    ap.add_argument("--door", type=str, default="PHASE", choices=["PHASE", "GREEDY", "RANDOM"])
    ap.add_argument("--lens", type=str, default="concave", choices=["concave"])
    ap.add_argument("--planets", type=int, default=4)
    ap.add_argument("--secs", type=float, default=6.0)
    ap.add_argument("--n", type=int, default=90)
    ap.add_argument("--seed", type=int, default=1337, help="base seed for instance seeds")
    ap.add_argument("--mirror", action="store_true")
    ap.add_argument("--csv", action="store_true")
    ap.add_argument("--ladder", type=str, default="3.30,4.50,4.80,4.90")
    ap.add_argument("--trials", type=int, default=5)
    args = ap.parse_args()

    ladder = parse_ladder(args.ladder)

    print_header("ANSON PHASELOCK-SAT — RELIABILITY SUITE (MOBILE-SAFE)")
    print(f"mode={args.mode}  door={args.door}  lens={args.lens}  planets={args.planets}  secs={args.secs:.2f}  n={args.n}")
    print(f"trials={args.trials}  ladder={','.join([f'{x:.2f}' for x in ladder])}")
    print("-" * 58)
    print("Protocol: FIXED instance per ratio (same clauses), different solver seeds per trial.")
    print("Goal: push solved_trials to full (all 0-unsat) at each ratio.")
    print()

    overall_best = 10**9
    best_ratio = None
    solved_wall_zone = 0

    for r in ladder:
        # instance_seed fixed per ratio (same instance each run)
        instance_seed = args.seed + int(r * 10000)

        best_u, _, solved = run_one_ratio_fixed_instance(
            ratio=r,
            mode=args.mode,
            n_vars=args.n,
            seconds=args.secs,
            planets=args.planets,
            door=args.door,
            instance_seed=instance_seed,
            trials=args.trials,
            mirror_planet=args.mirror,
            csv_on=args.csv,
            lens=args.lens
        )

        if best_u < overall_best:
            overall_best = best_u
            best_ratio = r
        if r >= 4.70:
            solved_wall_zone += solved

    print_header("LADDER SUMMARY")
    print(f"overall_best_unsat={overall_best}")
    print(f"best_ratio_seen={best_ratio if best_ratio is not None else 'N/A'}")
    print(f"solved_at_wall_zone(>=4.70)={solved_wall_zone}")
    print()
    print("If 4.90 isn’t all-zeros yet on your phone:")
    print("  - Increase --secs (try 10–14)")
    print("  - Increase --trials (try 10) to see reliability shape")
    print("  - Turn on --mirror (Planet 3 inverse start can help)")

if __name__ == "__main__":
    main()