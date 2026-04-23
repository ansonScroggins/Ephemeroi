#!/usr/bin/env python3
"""
ONE-PIECE iPhone SAT benchmark script (no file I/O)

Features:
- RandomWalk vs Greedy(p=0) vs SCM(p=0.16)
- Memory field persistence + auto-curvature
- 0.16 tunneling + Collatz kick
- Vacuum Rail boost (safe "division-by-zero" analog)
- Complex phase-lock (imaginary alignment)
- Lens Controller (VISIBLE/INFRARED/UV/PRISM)
- Digit Lock endgame: use digits 0..9 as 2D phase keys to crack last <=6 clauses
- Live telemetry ("interption") every report_period flips

Paste into a Python runner on iPhone (Pyto / Pythonista / Carnets etc.)
"""

from __future__ import annotations
import time, random, math, io
from typing import List, Tuple, TextIO, Dict, Optional


# -----------------------------
# OPTIONAL: paste DIMACS CNF here (leave "" to generate planted SAT planet)
# -----------------------------
CNF_TEXT_OVERRIDE = ""


# -----------------------------
# DIMACS parsing (in-memory)
# -----------------------------
def parse_dimacs_stream(f: TextIO) -> Tuple[int, List[List[int]]]:
    nvars = 0
    clauses: List[List[int]] = []
    cur: List[int] = []
    for line in f:
        line = line.strip()
        if not line or line.startswith("c"):
            continue
        if line.startswith("p"):
            parts = line.split()
            if len(parts) >= 4 and parts[1] == "cnf":
                nvars = int(parts[2])
            continue
        for tok in line.split():
            lit = int(tok)
            if lit == 0:
                if cur:
                    clauses.append(cur)
                    cur = []
            else:
                cur.append(lit)
    if cur:
        clauses.append(cur)
    if nvars <= 0:
        mx = 0
        for c in clauses:
            for lit in c:
                mx = max(mx, abs(lit))
        nvars = mx
    return nvars, clauses


# -----------------------------
# Planted 3-SAT generator (guaranteed SAT)
# -----------------------------
def gen_planted_3sat(n: int, m: int, seed: int) -> Tuple[List[bool], List[List[int]]]:
    rng = random.Random(seed)
    A = [False] * (n + 1)
    for v in range(1, n + 1):
        A[v] = bool(rng.getrandbits(1))

    clauses: List[List[int]] = []
    while len(clauses) < m:
        vs = rng.sample(range(1, n + 1), 3)
        lits = []
        for v in vs:
            lit = (1 if rng.choice([True, False]) else -1) * v
            lits.append(lit)

        # accept only if satisfied by planted assignment
        ok = False
        for lit in lits:
            v = abs(lit)
            val = A[v]
            if (lit > 0 and val) or (lit < 0 and (not val)):
                ok = True
                break
        if ok:
            clauses.append(lits)

    return A, clauses


# -----------------------------
# Lens Controller (multispectral)
# -----------------------------
class LensController:
    """
    Lenses:
      - VISIBLE: more exploratory noise ("get footing")
      - INFRARED: gravity/potential dominated
      - UV: phase-lock dominated (coherence up, noise down)
      - PRISM: near stagnation threshold: ramped kick probability
    """

    def __init__(
        self,
        enabled: bool = True,
        phase_on: float = 0.18,
        phase_strong: float = 0.45,
        pot_high: float = 0.22,
        ramp_start_frac: float = 0.35,
        ramp_full_frac: float = 1.00,
        noise_boost_visible: float = 1.25,
        noise_cut_uv: float = 0.55,
        coherence_boost_uv: float = 1.35,
        coherence_cut_visible: float = 0.75,
        kick_mult_prism: float = 1.45,
        p_rw_max_min: float = 0.20,
        p_rw_max_max: float = 0.90,
        p_rw_min_min: float = 0.001,
        p_rw_min_max: float = 0.20,
        coh_min: float = 0.05,
        coh_max: float = 1.50,
    ):
        self.enabled = bool(enabled)
        self.phase_on = float(phase_on)
        self.phase_strong = float(phase_strong)
        self.pot_high = float(pot_high)
        self.ramp_start_frac = float(ramp_start_frac)
        self.ramp_full_frac = float(ramp_full_frac)
        self.noise_boost_visible = float(noise_boost_visible)
        self.noise_cut_uv = float(noise_cut_uv)
        self.coherence_boost_uv = float(coherence_boost_uv)
        self.coherence_cut_visible = float(coherence_cut_visible)
        self.kick_mult_prism = float(kick_mult_prism)
        self.p_rw_max_min = float(p_rw_max_min)
        self.p_rw_max_max = float(p_rw_max_max)
        self.p_rw_min_min = float(p_rw_min_min)
        self.p_rw_min_max = float(p_rw_min_max)
        self.coh_min = float(coh_min)
        self.coh_max = float(coh_max)
        self.last_lens = "VISIBLE"

    @staticmethod
    def _clamp(x: float, lo: float, hi: float) -> float:
        return lo if x < lo else (hi if x > hi else x)

    def prism_ramp(self, stagn: int, stagn_trigger: int) -> float:
        if stagn_trigger <= 0:
            return 0.0
        s0 = self.ramp_start_frac * stagn_trigger
        s1 = self.ramp_full_frac * stagn_trigger
        if stagn <= s0:
            return 0.0
        if stagn >= s1:
            return 1.0
        return (stagn - s0) / (s1 - s0)

    def choose_lens(self, avg_phase: float, avg_pot: float, stagn: int, stagn_trigger: int, vacuum: float) -> str:
        if not self.enabled:
            return "VISIBLE"
        ramp = self.prism_ramp(stagn, stagn_trigger)
        if ramp >= 0.65 or vacuum >= 1.25:
            return "PRISM"
        if avg_phase >= self.phase_strong:
            return "UV"
        if avg_pot >= self.pot_high and avg_phase < self.phase_on:
            return "INFRARED"
        return "VISIBLE"

    def apply(self, solver, flip_i: int, avg_phase: float, avg_pot: float, stagn: int) -> str:
        if not self.enabled:
            solver._lens_active = "VISIBLE"
            solver._lens_ramp = 0.0
            solver._lens_kick_mult = 1.0
            solver._lens_p_rw_max = solver.cur_p_rw_max
            solver._lens_p_rw_min = solver.cur_p_rw_min
            return "VISIBLE"

        lens = self.choose_lens(avg_phase, avg_pot, stagn, solver.stagnation_trigger, solver._vacuum_current)
        ramp = self.prism_ramp(stagn, solver.stagnation_trigger)

        pmax = solver.cur_p_rw_max
        pmin = solver.cur_p_rw_min
        coh = solver.coherence_gain
        kick_mult = 1.0

        if lens == "VISIBLE":
            pmax *= self.noise_boost_visible
            pmin *= self.noise_boost_visible
            coh *= self.coherence_cut_visible
        elif lens == "INFRARED":
            pmax *= 0.95
            pmin *= 0.85
            coh *= 1.00
        elif lens == "UV":
            pmax *= self.noise_cut_uv
            pmin *= self.noise_cut_uv
            coh *= self.coherence_boost_uv
        elif lens == "PRISM":
            pmax *= 1.05
            pmin *= 1.05
            coh *= 1.10
            kick_mult = 1.0 + ramp * (self.kick_mult_prism - 1.0)

        pmax = self._clamp(pmax, self.p_rw_max_min, self.p_rw_max_max)
        pmin = self._clamp(pmin, self.p_rw_min_min, self.p_rw_min_max)
        if pmin > pmax:
            pmin = pmax * 0.5

        coh = self._clamp(coh, self.coh_min, self.coh_max)

        solver._lens_active = lens
        solver._lens_ramp = ramp
        solver._lens_kick_mult = kick_mult
        solver._lens_p_rw_max = pmax
        solver._lens_p_rw_min = pmin
        solver.coherence_gain = coh

        self.last_lens = lens
        return lens


# -----------------------------
# Gravity SAT Solver
# -----------------------------
class GravitySATSolver:
    def __init__(
        self,
        nvars: int,
        clauses: List[List[int]],
        seed: int,

        # Footing
        p_rw_max: float,
        p_rw_min: float,

        # Tunneling
        tunnel_cap: float,
        tunnel_base: float = 0.01,
        tunnel_tau: float = 2500.0,

        # Gravity
        clause_weight_inc: int = 1,
        weight_cap: int = 80,
        var_pot_inc: float = 0.10,
        var_pot_decay: float = 0.9995,
        var_pot_cap: float = 8.0,

        # Memory
        memory_enabled: bool = True,
        memory_try_decay: float = 0.90,
        potential_try_decay: float = 0.90,

        # Auto-curvature
        auto_curvature: bool = True,
        curvature_update_period: int = 200,
        curvature_window: int = 2000,

        # Kick
        stagnation_trigger: int = 6000,
        kick_kmax: int = 220,

        # Freeze
        freeze_enabled: bool = True,
        freeze_check_period: int = 300,
        freeze_stagnation: int = 2500,
        freeze_noise_max: float = 0.025,
        freeze_avg_weight_min: float = 6.0,
        freeze_kick_multiplier: float = 1.8,
        freeze_micro_restart_after: int = 2,

        # Complex phase-lock
        complex_enabled: bool = True,
        phase_lr: float = 0.12,
        phase_decay: float = 0.9992,
        phase_cap: float = 12.0,
        clause_phase_mode: str = "hash",
        coherence_gain: float = 0.35,

        rebuild_period: int = 25,

        # Telemetry
        report_period: int = 0,
        report_label: str = "",

        # Vacuum rail
        vacuum_enabled: bool = True,
        vacuum_eps: float = 1.0,
        vacuum_gain: float = 120.0,
        vacuum_cap: float = 3.0,

        # Lens
        lens_enabled: bool = True,

        # Digit lock endgame
        digit_lock_enabled: bool = True,
        digit_lock_k: int = 6,
        digit_lock_steps: int = 30,
    ):
        self.n = nvars
        self.clauses = clauses
        self.m = len(clauses)
        self.rng = random.Random(seed)

        # base knobs
        self.base_p_rw_max = float(p_rw_max)
        self.base_p_rw_min = float(p_rw_min)

        # tunneling
        self.tunnel_cap = min(float(tunnel_cap), 0.16) if tunnel_cap > 0 else 0.0
        self.tunnel_base = max(0.0, min(float(tunnel_base), self.tunnel_cap))
        self.tunnel_tau = max(1.0, float(tunnel_tau))

        # gravity
        self.clause_weight_inc = max(1, int(clause_weight_inc))
        self.weight_cap = max(1, int(weight_cap))
        self.var_pot_inc = float(var_pot_inc)
        self.var_pot_decay = float(var_pot_decay)
        self.var_pot_cap = float(var_pot_cap)

        # memory
        self.memory_enabled = bool(memory_enabled)
        self.memory_try_decay = float(memory_try_decay)
        self.potential_try_decay = float(potential_try_decay)

        # auto-curvature
        self.auto_curvature = bool(auto_curvature)
        self.curvature_update_period = max(10, int(curvature_update_period))
        self.curvature_window = max(200, int(curvature_window))

        # kick
        self.stagnation_trigger = int(stagnation_trigger)
        self.kick_kmax = int(kick_kmax)

        # freeze
        self.freeze_enabled = bool(freeze_enabled)
        self.freeze_check_period = max(50, int(freeze_check_period))
        self.freeze_stagnation = max(200, int(freeze_stagnation))
        self.freeze_noise_max = float(freeze_noise_max)
        self.freeze_avg_weight_min = float(freeze_avg_weight_min)
        self.freeze_kick_multiplier = float(freeze_kick_multiplier)
        self.freeze_micro_restart_after = max(1, int(freeze_micro_restart_after))

        # complex phase
        self.complex_enabled = bool(complex_enabled)
        self.phase_lr = float(phase_lr)
        self.phase_decay = float(phase_decay)
        self.phase_cap = float(phase_cap)
        self.clause_phase_mode = str(clause_phase_mode)
        self.coherence_gain = float(coherence_gain)

        self.rebuild_period = max(1, int(rebuild_period))

        # telemetry
        self.report_period = max(0, int(report_period))
        self.report_label = str(report_label)

        # vacuum rail
        self.vacuum_enabled = bool(vacuum_enabled)
        self.vacuum_eps = float(vacuum_eps)
        self.vacuum_gain = float(vacuum_gain)
        self.vacuum_cap = float(vacuum_cap)
        self._vacuum_current = 1.0

        # lens controller
        self.lens = LensController(enabled=bool(lens_enabled))
        self._lens_active = "VISIBLE"
        self._lens_ramp = 0.0
        self._lens_kick_mult = 1.0
        self._lens_p_rw_max = self.base_p_rw_max
        self._lens_p_rw_min = self.base_p_rw_min

        # digit lock endgame
        self.digit_lock_enabled = bool(digit_lock_enabled)
        self.digit_lock_k = max(1, int(digit_lock_k))
        self.digit_lock_steps = max(1, int(digit_lock_steps))
        self._digit_lock_last_digit: Optional[int] = None
        self._digit_lock_trials = 0

        # instrumentation
        self.kick_count = 0
        self.freeze_actions = 0
        self.digit_lock_calls = 0
        self.digit_lock_success = 0

        self.max_stagnation_seen = 0
        self.flips_used = 0
        self.best_unsat_ever = 10**18

        # occurrences
        self.pos_occ = [[] for _ in range(self.n + 1)]
        self.neg_occ = [[] for _ in range(self.n + 1)]
        for ci, c in enumerate(self.clauses):
            for lit in c:
                v = abs(lit)
                (self.pos_occ if lit > 0 else self.neg_occ)[v].append(ci)

        # state
        self.assign = [False] * (self.n + 1)
        self.phase_save = [False] * (self.n + 1)
        self.sat_count = [0] * self.m
        self.unsat_list: List[int] = []
        self.unsat_pos = [-1] * self.m

        # field
        self.clause_w = [1] * self.m
        self.var_pot = [0.0] * (self.n + 1)
        self.var_phase = [0.0] * (self.n + 1)

        # clause phase vectors
        self.clause_sin = [0.0] * self.m
        self.clause_cos = [0.0] * self.m
        if self.complex_enabled:
            self._build_clause_phases()

        # break/make
        self.break_count = [0] * (self.n + 1)
        self.make_count = [0] * (self.n + 1)

        # trackers
        self.max_unsat_seen = 1
        self.best_unsat = 10**18
        self.last_improve_flip = 0
        self._window_start_flip = 0
        self._window_start_best = 10**18
        self._freeze_hits = 0

        # dynamic knobs
        self.cur_p_rw_max = self.base_p_rw_max
        self.cur_p_rw_min = self.base_p_rw_min
        self.cur_tunnel_tau = self.tunnel_tau
        self.cur_weight_inc = self.clause_weight_inc
        self.cur_var_pot_inc = self.var_pot_inc

        self._solve_start_time = 0.0

    def _build_clause_phases(self) -> None:
        for ci, clause in enumerate(self.clauses):
            if self.clause_phase_mode == "len":
                frac = (len(clause) * 0.61803398875) % 1.0
            else:
                h = 1469598103934665603
                for lit in clause:
                    h ^= (lit & 0xFFFFFFFFFFFFFFFF)
                    h *= 1099511628211
                    h &= 0xFFFFFFFFFFFFFFFF
                frac = (h % 1000003) / 1000003.0
            theta = 2.0 * math.pi * frac
            self.clause_sin[ci] = math.sin(theta)
            self.clause_cos[ci] = math.cos(theta)

    # ---- vacuum rail ----
    def vacuum_boost(self, flip_i: int) -> float:
        if not self.vacuum_enabled:
            return 1.0
        stagn = max(0, flip_i - self.last_improve_flip)
        b = 1.0 + (self.vacuum_gain / (self.vacuum_eps + stagn))
        maxb = 1.0 + self.vacuum_cap
        if b > maxb:
            return maxb
        if b < 1.0:
            return 1.0
        return b

    # ---- helpers ----
    def lit_is_true(self, lit: int) -> bool:
        v = abs(lit)
        val = self.assign[v]
        return val if lit > 0 else (not val)

    def _unsat_add(self, ci: int) -> None:
        if self.unsat_pos[ci] != -1:
            return
        self.unsat_pos[ci] = len(self.unsat_list)
        self.unsat_list.append(ci)

    def _unsat_remove(self, ci: int) -> None:
        pos = self.unsat_pos[ci]
        if pos == -1:
            return
        last = self.unsat_list[-1]
        self.unsat_list[pos] = last
        self.unsat_pos[last] = pos
        self.unsat_list.pop()
        self.unsat_pos[ci] = -1

    def rebuild_clause_satisfaction(self) -> None:
        self.unsat_list.clear()
        for ci, clause in enumerate(self.clauses):
            cnt = 0
            for lit in clause:
                if self.lit_is_true(lit):
                    cnt += 1
            self.sat_count[ci] = cnt
            if cnt == 0:
                self._unsat_add(ci)
            else:
                self.unsat_pos[ci] = -1

    def current_unsat(self) -> int:
        return len(self.unsat_list)

    def init_assignment(self) -> None:
        use_phase = (self.rng.random() < 0.35)
        for v in range(1, self.n + 1):
            self.assign[v] = self.phase_save[v] if use_phase else bool(self.rng.getrandbits(1))

    def apply_memory_decay_new_try(self) -> None:
        if not self.memory_enabled:
            for ci in range(self.m):
                self.clause_w[ci] = 1
            for v in range(1, self.n + 1):
                self.var_pot[v] = 0.0
                self.var_phase[v] = 0.0
            return
        for ci in range(self.m):
            w = int(self.clause_w[ci] * self.memory_try_decay)
            self.clause_w[ci] = 1 if w < 1 else w
        for v in range(1, self.n + 1):
            self.var_pot[v] *= self.potential_try_decay
            self.var_phase[v] *= self.potential_try_decay

    def gravity_step(self) -> None:
        for v in range(1, self.n + 1):
            self.var_pot[v] *= self.var_pot_decay
            if self.complex_enabled:
                self.var_phase[v] *= self.phase_decay

    def deepen_wells_on_unsat(self) -> None:
        inc = self.cur_weight_inc
        for ci in self.unsat_list:
            w = self.clause_w[ci] + inc
            self.clause_w[ci] = self.weight_cap if w > self.weight_cap else w
            for lit in self.clauses[ci]:
                v = abs(lit)
                nv = self.var_pot[v] + self.cur_var_pot_inc
                self.var_pot[v] = self.var_pot_cap if nv > self.var_pot_cap else nv
                if self.complex_enabled:
                    ph = self.var_phase[v] + self.phase_lr * self.clause_sin[ci]
                    if ph > self.phase_cap:
                        ph = self.phase_cap
                    elif ph < -self.phase_cap:
                        ph = -self.phase_cap
                    self.var_phase[v] = ph

    def rebuild_break_make(self) -> None:
        for v in range(1, self.n + 1):
            self.break_count[v] = 0
            self.make_count[v] = 0
        for ci, clause in enumerate(self.clauses):
            w = self.clause_w[ci]
            sc = self.sat_count[ci]
            if sc == 0:
                for lit in clause:
                    if not self.lit_is_true(lit):
                        self.make_count[abs(lit)] += w
            elif sc == 1:
                for lit in clause:
                    if self.lit_is_true(lit):
                        self.break_count[abs(lit)] += w
                        break

    def flip_var(self, v: int) -> None:
        old_val = self.assign[v]
        new_val = not old_val
        self.assign[v] = new_val

        for ci in self.pos_occ[v]:
            was_true = old_val
            now_true = new_val
            if was_true and not now_true:
                self.sat_count[ci] -= 1
                if self.sat_count[ci] == 0:
                    self._unsat_add(ci)
            elif (not was_true) and now_true:
                if self.sat_count[ci] == 0:
                    self._unsat_remove(ci)
                self.sat_count[ci] += 1

        for ci in self.neg_occ[v]:
            was_true = (not old_val)
            now_true = (not new_val)
            if was_true and not now_true:
                self.sat_count[ci] -= 1
                if self.sat_count[ci] == 0:
                    self._unsat_add(ci)
            elif (not was_true) and now_true:
                if self.sat_count[ci] == 0:
                    self._unsat_remove(ci)
                self.sat_count[ci] += 1

        self.phase_save[v] = self.assign[v]

    # ---- probabilities ----
    def p_random_walk(self) -> float:
        u = self.current_unsat()
        denom = max(1, self.max_unsat_seen)
        ratio = u / denom
        pmax = self._lens_p_rw_max
        pmin = self._lens_p_rw_min
        p = pmin + (pmax - pmin) * ratio
        if p < 0.0:
            return 0.0
        if p > 1.0:
            return 1.0
        return p

    def p_tunnel(self, stagnation_len: int) -> float:
        if self.tunnel_cap <= 0.0:
            return 0.0
        s = max(0, stagnation_len)
        tau = max(1.0, self.cur_tunnel_tau)
        ramp = s / (s + tau)
        p = self.tunnel_base + (self.tunnel_cap - self.tunnel_base) * ramp
        p *= self._vacuum_current
        if p > self.tunnel_cap:
            p = self.tunnel_cap
        return p

    # ---- selection ----
    def pick_unsat_clause(self) -> int:
        total = 0
        for ci in self.unsat_list:
            total += self.clause_w[ci]
        r = self.rng.randrange(total)
        acc = 0
        for ci in self.unsat_list:
            acc += self.clause_w[ci]
            if acc > r:
                return ci
        return self.unsat_list[-1]

    def clause_vars_unique(self, ci: int) -> List[int]:
        seen = set()
        out = []
        for lit in self.clauses[ci]:
            v = abs(lit)
            if v not in seen:
                seen.add(v)
                out.append(v)
        return out

    def score_var(self, v: int) -> float:
        base = (self.break_count[v] - self.make_count[v]) + self.var_pot[v]
        if (not self.complex_enabled) or (not self.unsat_list):
            return base

        k = 6 if len(self.unsat_list) > 6 else len(self.unsat_list)
        if self._lens_active in ("VISIBLE", "INFRARED"):
            k = 3 if k > 3 else k

        acc = 0.0
        for _ in range(k):
            ci = self.unsat_list[self.rng.randrange(len(self.unsat_list))]
            # only count if v is in clause
            if not any(abs(lit) == v for lit in self.clauses[ci]):
                continue
            acc += (self.var_phase[v] * self.clause_sin[ci]) * self.clause_w[ci]

        bonus = self.coherence_gain * (acc / (k + 1e-9))
        return base - bonus

    def best_var_in_clause(self, ci: int) -> int:
        vs = self.clause_vars_unique(ci)
        best = vs[0]
        best_s = self.score_var(best)
        for v in vs[1:]:
            s = self.score_var(v)
            if s < best_s:
                best, best_s = v, s
        return best

    def should_accept(self, v: int, stagnation_len: int) -> bool:
        delta = self.break_count[v] - self.make_count[v]
        if delta <= 0:
            return True
        return self.rng.random() < self.p_tunnel(stagnation_len)

    # ---- auto-curvature ----
    def curvature_update(self, flip_i: int) -> None:
        if not self.auto_curvature:
            return
        if flip_i - self._window_start_flip < self.curvature_window:
            return

        start_best = self._window_start_best
        end_best = self.best_unsat
        improvement = max(0, start_best - end_best)
        rate = improvement / max(1, start_best)
        stagn = flip_i - self.last_improve_flip

        if rate < 0.01:
            self.cur_p_rw_max = min(0.70, self.cur_p_rw_max + 0.03)
            self.cur_p_rw_min = min(0.12, self.cur_p_rw_min + 0.01)
            self.cur_tunnel_tau = max(300.0, self.cur_tunnel_tau * 0.85)
            self.cur_weight_inc = min(6, self.cur_weight_inc + 1)
            self.cur_var_pot_inc = min(0.60, self.cur_var_pot_inc + 0.05)
            if stagn > self.stagnation_trigger // 2:
                self.cur_p_rw_min = min(0.15, self.cur_p_rw_min + 0.02)
                self.cur_tunnel_tau = max(200.0, self.cur_tunnel_tau * 0.80)

        elif rate > 0.05:
            self.cur_p_rw_max = max(0.30, self.cur_p_rw_max - 0.03)
            self.cur_p_rw_min = max(0.005, self.cur_p_rw_min - 0.01)
            self.cur_tunnel_tau = min(10000.0, self.cur_tunnel_tau * 1.15)
            self.cur_weight_inc = max(1, self.cur_weight_inc - 1)
            self.cur_var_pot_inc = max(0.05, self.cur_var_pot_inc - 0.05)

        self._window_start_flip = flip_i
        self._window_start_best = self.best_unsat

    # ---- collatz kick ----
    @staticmethod
    def trailing_zeros(x: int) -> int:
        return (x & -x).bit_length() - 1

    def collatz_kick(self, flip_i: int, k_mult: float = 1.0) -> None:
        k_mult *= self._vacuum_current
        k_mult *= self._lens_kick_mult

        self.kick_count += 1
        n = max(1, flip_i - self.last_improve_flip)
        k = int((3 * n + 1) * k_mult)
        if k > self.kick_kmax:
            k = self.kick_kmax
        if k < 1:
            k = 1

        # pulse
        for _ in range(k):
            if not self.unsat_list:
                return
            ci = self.pick_unsat_clause()
            vs = self.clause_vars_unique(ci)
            v = vs[self.rng.randrange(len(vs))]
            stagn = flip_i - self.last_improve_flip
            if self.should_accept(v, stagn):
                self.flip_var(v)
            if self.unsat_list:
                self.deepen_wells_on_unsat()
            self.gravity_step()
            self.rebuild_break_make()

        # compression
        h = self.trailing_zeros(k)
        for _ in range(h):
            if not self.unsat_list:
                return
            ci = self.pick_unsat_clause()
            v = self.best_var_in_clause(ci)
            self.flip_var(v)
            if self.unsat_list:
                self.deepen_wells_on_unsat()
            self.gravity_step()
            self.rebuild_break_make()

    # ---- freeze ----
    def avg_clause_weight(self) -> float:
        return sum(self.clause_w) / max(1, len(self.clause_w))

    def avg_abs_potential(self) -> float:
        return sum(abs(x) for x in self.var_pot[1:]) / max(1, self.n)

    def avg_abs_phase(self) -> float:
        return sum(abs(x) for x in self.var_phase[1:]) / max(1, self.n)

    def freeze_check_and_act(self, flip_i: int) -> bool:
        if not self.freeze_enabled:
            return False
        stagn = flip_i - self.last_improve_flip
        if stagn < self.freeze_stagnation:
            return False
        if self.p_random_walk() > self.freeze_noise_max:
            return False
        if self.avg_clause_weight() < self.freeze_avg_weight_min:
            return False

        self.freeze_actions += 1
        self._freeze_hits += 1

        if self._freeze_hits <= self.freeze_micro_restart_after:
            self.collatz_kick(flip_i, k_mult=self.freeze_kick_multiplier)
            self.last_improve_flip = flip_i
            self.best_unsat = self.current_unsat()
            return True

        # micro-restart, keep field
        self.init_assignment()
        self.rebuild_clause_satisfaction()
        self.rebuild_break_make()
        self.last_improve_flip = flip_i
        self.best_unsat = self.current_unsat()
        return True

    # ---- Digit Lock endgame ----
    def _digit_from_state(self, flip_i: int) -> int:
        # deterministic digit derived from solver state
        u = self.current_unsat()
        d = (flip_i + 7 * self.kick_count + 3 * self.freeze_actions + 10 * u) % 10
        return int(d)

    def _align_score_endgame(self, v: int, U: List[int], cos_t: float, sin_t: float) -> float:
        """
        Lower score is better.
        Combine:
          - break/make (classic)
          - potential (gravity)
          - phase alignment to remaining unsat clause phases using digit key (cos_t,sin_t)
        """
        base = (self.break_count[v] - self.make_count[v]) + 0.75 * self.var_pot[v]

        if not self.complex_enabled:
            return base

        # clause average phase vector over remaining unsatisfied set
        # and digit key biases direction.
        acc = 0.0
        for ci in U:
            # only clauses containing v matter
            if not any(abs(lit) == v for lit in self.clauses[ci]):
                continue
            # dot between (cos_t,sin_t) and clause phase
            dot = cos_t * self.clause_cos[ci] + sin_t * self.clause_sin[ci]
            acc += dot * self.clause_w[ci]

        # variable phase wants to match digit + clause dot
        # subtracting alignment encourages "lock-in"
        align = (self.var_phase[v] * acc)
        return base - 0.25 * align

    def digit_lock_endgame(self, flip_i: int) -> bool:
        """
        Attempt to crack last <= digit_lock_k unsatisfied clauses using digits 0..9 as phase keys.
        Bounded attempts; if solved returns True.
        """
        if not self.digit_lock_enabled:
            return False
        u = self.current_unsat()
        if u == 0:
            return True
        if u > self.digit_lock_k:
            return False

        self.digit_lock_calls += 1
        U = list(self.unsat_list)

        # Snapshot for rollback (small system, safe)
        snap_assign = self.assign[:]
        snap_sat = self.sat_count[:]
        snap_unsat_list = self.unsat_list[:]
        snap_unsat_pos = self.unsat_pos[:]

        best_u = u
        best_state = None  # (assign, sat_count, unsat_list, unsat_pos)

        steps = self.digit_lock_steps
        for j in range(steps):
            # rotate digits: try current digit and then walk forward
            d0 = self._digit_from_state(flip_i + j)
            d = (d0 + j) % 10
            self._digit_lock_last_digit = d
            self._digit_lock_trials += 1

            theta = 2.0 * math.pi * (d / 10.0)
            cos_t, sin_t = math.cos(theta), math.sin(theta)

            # build candidate var set from remaining unsat clauses
            cand = []
            seen = set()
            for ci in self.unsat_list:
                for lit in self.clauses[ci]:
                    v = abs(lit)
                    if v not in seen:
                        seen.add(v)
                        cand.append(v)

            if not cand:
                break

            # score candidates
            bestv = cand[0]
            bests = self._align_score_endgame(bestv, self.unsat_list, cos_t, sin_t)
            for v in cand[1:]:
                s = self._align_score_endgame(v, self.unsat_list, cos_t, sin_t)
                if s < bests:
                    bests, bestv = s, v

            # perform flip (accept even if uphill: endgame is combinational)
            self.flip_var(bestv)

            # local rebuild for accuracy
            self.rebuild_break_make()

            u_now = self.current_unsat()
            if u_now == 0:
                self.digit_lock_success += 1
                return True

            if u_now < best_u:
                best_u = u_now
                best_state = (self.assign[:], self.sat_count[:], self.unsat_list[:], self.unsat_pos[:])

        # If improved, keep improved state, else rollback
        if best_state is not None:
            self.assign, self.sat_count, self.unsat_list, self.unsat_pos = best_state
            self.rebuild_break_make()
        else:
            self.assign = snap_assign
            self.sat_count = snap_sat
            self.unsat_list = snap_unsat_list
            self.unsat_pos = snap_unsat_pos
            self.rebuild_break_make()

        return False

    # ---- telemetry ----
    def report(self, flip_i: int) -> None:
        if self.report_period <= 0:
            return
        if flip_i % self.report_period != 0:
            return
        t = time.time() - self._solve_start_time
        cur_uns = self.current_unsat()
        stagn = flip_i - self.last_improve_flip
        self.max_stagnation_seen = max(self.max_stagnation_seen, stagn)

        avgw = self.avg_clause_weight()
        avgp = self.avg_abs_potential()
        avgph = self.avg_abs_phase() if self.complex_enabled else 0.0
        vb = self._vacuum_current
        dig = "-" if self._digit_lock_last_digit is None else str(self._digit_lock_last_digit)

        print(
            f"c [{self.report_label}] t={t:6.2f}s flip={flip_i:8d} "
            f"unsat={cur_uns:6d} best={self.best_unsat_ever:6d} stagn={stagn:6d} "
            f"avgw={avgw:6.2f} avg|pot|={avgp:6.3f} avg|phase|={avgph:6.3f} "
            f"vac={vb:4.2f} lens={self._lens_active:<7} ramp={self._lens_ramp:4.2f} "
            f"dig={dig} kicks={self.kick_count:4d} freezes={self.freeze_actions:3d} "
            f"dl={self.digit_lock_calls:3d}/{self.digit_lock_success:3d}"
        )

    # ---- solve ----
    def solve(self, tries: int, max_flips: int, time_limit_s: float) -> bool:
        self._solve_start_time = time.time()
        self.kick_count = 0
        self.freeze_actions = 0
        self.digit_lock_calls = 0
        self.digit_lock_success = 0
        self.max_stagnation_seen = 0
        self.flips_used = 0
        self.best_unsat_ever = 10**18
        self._digit_lock_last_digit = None
        self._digit_lock_trials = 0

        for _attempt in range(1, tries + 1):
            self.apply_memory_decay_new_try()

            # reset knobs
            self.cur_p_rw_max = self.base_p_rw_max
            self.cur_p_rw_min = self.base_p_rw_min
            self.cur_tunnel_tau = self.tunnel_tau
            self.cur_weight_inc = self.clause_weight_inc
            self.cur_var_pot_inc = self.var_pot_inc
            self._freeze_hits = 0

            # lens reset
            self._lens_active = "VISIBLE"
            self._lens_ramp = 0.0
            self._lens_kick_mult = 1.0
            self._lens_p_rw_max = self.cur_p_rw_max
            self._lens_p_rw_min = self.cur_p_rw_min

            self.init_assignment()
            self.rebuild_clause_satisfaction()
            self.rebuild_break_make()

            u0 = self.current_unsat()
            self.max_unsat_seen = max(self.max_unsat_seen, u0)
            self.best_unsat = u0
            self.best_unsat_ever = min(self.best_unsat_ever, u0)
            self.last_improve_flip = 0
            self._window_start_flip = 0
            self._window_start_best = u0

            if u0 == 0:
                return True

            for flip_i in range(1, max_flips + 1):
                self.flips_used += 1
                if (time.time() - self._solve_start_time) >= time_limit_s:
                    return False

                cur_uns = self.current_unsat()
                if cur_uns == 0:
                    self.report(flip_i)
                    return True

                # record best
                if cur_uns < self.best_unsat:
                    self.best_unsat = cur_uns
                    self.best_unsat_ever = min(self.best_unsat_ever, cur_uns)
                    self.last_improve_flip = flip_i

                stagn = flip_i - self.last_improve_flip
                self.max_stagnation_seen = max(self.max_stagnation_seen, stagn)

                # update vacuum
                self._vacuum_current = self.vacuum_boost(flip_i)

                # lens controller update
                avgp = self.avg_abs_potential()
                avgph = self.avg_abs_phase() if self.complex_enabled else 0.0
                self.lens.apply(self, flip_i, avgph, avgp, stagn)

                # report
                self.report(flip_i)

                # endgame digit-lock attempt
                if self.digit_lock_endgame(flip_i):
                    return True

                # freeze check
                if self.freeze_enabled and (flip_i % self.freeze_check_period == 0):
                    if self.freeze_check_and_act(flip_i):
                        continue

                # auto-curvature
                if self.auto_curvature and (flip_i % self.curvature_update_period == 0):
                    self.curvature_update(flip_i)

                # smooth PRISM ramp: early kick chance
                if self._lens_ramp > 0.0:
                    p_early = 0.02 + 0.25 * self._lens_ramp
                    if self.rng.random() < p_early:
                        self.collatz_kick(flip_i, k_mult=1.0)
                        self.last_improve_flip = flip_i
                        self.best_unsat = self.current_unsat()
                        continue

                # hard kick safety net
                if stagn >= self.stagnation_trigger:
                    self.collatz_kick(flip_i, k_mult=1.0)
                    self.last_improve_flip = flip_i
                    self.best_unsat = self.current_unsat()
                    continue

                # field evolution
                if flip_i % 50 == 0:
                    self.deepen_wells_on_unsat()
                self.gravity_step()

                # select move
                ci = self.pick_unsat_clause()
                if self.rng.random() < self.p_random_walk():
                    vs = self.clause_vars_unique(ci)
                    v = vs[self.rng.randrange(len(vs))]
                else:
                    v = self.best_var_in_clause(ci)

                if self.should_accept(v, stagn):
                    self.flip_var(v)

                if flip_i % self.rebuild_period == 0:
                    self.rebuild_break_make()

        return False


# -----------------------------
# Benchmark utilities
# -----------------------------
def run_config(name: str, solver: GravitySATSolver, tries: int, max_flips: int, time_limit: float) -> Dict:
    t0 = time.time()
    sat = False
    interrupted = False
    try:
        sat = solver.solve(tries=tries, max_flips=max_flips, time_limit_s=time_limit)
    except KeyboardInterrupt:
        interrupted = True
    dt = time.time() - t0
    return {
        "name": name,
        "sat": sat,
        "time": dt,
        "flips": solver.flips_used,
        "best_unsat": solver.best_unsat_ever,
        "max_stagn": solver.max_stagnation_seen,
        "kicks": solver.kick_count,
        "freezes": solver.freeze_actions,
        "digit_lock_calls": solver.digit_lock_calls,
        "digit_lock_success": solver.digit_lock_success,
        "interrupted": interrupted,
    }


def print_results(results: List[Dict]) -> None:
    print("\nc ===== SCM BENCHMARK =====")
    print("c name              sat   time(s)    flips   best_unsat  max_stagn  kicks freezes  dl_calls dl_succ  note")
    for r in results:
        note = "INTERRUPT" if r["interrupted"] else ""
        print(
            f"c {r['name']:<17} "
            f"{'SAT' if r['sat'] else 'NO ':<4} "
            f"{r['time']:>8.3f} "
            f"{r['flips']:>8} "
            f"{r['best_unsat']:>10} "
            f"{r['max_stagn']:>9} "
            f"{r['kicks']:>6} "
            f"{r['freezes']:>6} "
            f"{r['digit_lock_calls']:>8} "
            f"{r['digit_lock_success']:>7}  "
            f"{note}"
        )

    print("\nc Stagnation bars (relative):")
    mx = max(1, max(r["max_stagn"] for r in results))
    for r in results:
        bar = "#" * int(40 * r["max_stagn"] / mx)
        print(f"c {r['name']:<17} |{bar}")


# -----------------------------
# MAIN
# -----------------------------
def main():
    SEED = 7

    # iPhone-safe default (increase gradually: 2000 -> 5000 -> 10000)
    n = 2000
    ratio = 4.3
    m = int(ratio * n)

    tries = 3
    max_flips = 300_000
    time_limit = 8.0  # seconds per config

    report_period = 20_000  # telemetry frequency

    if CNF_TEXT_OVERRIDE.strip():
        print("c Using CNF_TEXT_OVERRIDE (in-memory)")
        nvars, clauses = parse_dimacs_stream(io.StringIO(CNF_TEXT_OVERRIDE))
        n = nvars
        m = len(clauses)
    else:
        print(f"c Generating planted 3-SAT planet: n={n}, m={m}, seed={SEED}")
        _, clauses = gen_planted_3sat(n=n, m=m, seed=SEED)

    print("c Running 3 configs on identical CNF...\n")

    results: List[Dict] = []

    # 1) Random Walk
    rw = GravitySATSolver(
        nvars=n, clauses=clauses, seed=SEED,
        p_rw_max=1.0, p_rw_min=1.0,
        tunnel_cap=0.0,
        memory_enabled=False,
        auto_curvature=False,
        freeze_enabled=False,
        complex_enabled=False,
        stagnation_trigger=10**9,
        report_period=report_period,
        report_label="RandomWalk",
        vacuum_enabled=False,
        lens_enabled=False,
        digit_lock_enabled=False,
    )
    results.append(run_config("RandomWalk", rw, tries, max_flips, time_limit))

    # 2) Greedy (p=0)
    greedy = GravitySATSolver(
        nvars=n, clauses=clauses, seed=SEED,
        p_rw_max=0.05, p_rw_min=0.005,
        tunnel_cap=0.0,
        memory_enabled=True,
        auto_curvature=True,
        freeze_enabled=True,
        complex_enabled=False,
        report_period=report_period,
        report_label="Greedy(p=0)",
        vacuum_enabled=True,
        vacuum_eps=1.0,
        vacuum_gain=120.0,
        vacuum_cap=3.0,
        lens_enabled=True,
        digit_lock_enabled=True,
        digit_lock_k=6,
        digit_lock_steps=30,
    )
    results.append(run_config("Greedy(p=0)", greedy, tries, max_flips, time_limit))

    # 3) SCM (0.16)
    scm = GravitySATSolver(
        nvars=n, clauses=clauses, seed=SEED,
        p_rw_max=0.55, p_rw_min=0.03,
        tunnel_cap=0.16,
        memory_enabled=True,
        auto_curvature=True,
        freeze_enabled=True,
        complex_enabled=True,
        report_period=report_period,
        report_label="SCM(p=0.16)",
        vacuum_enabled=True,
        vacuum_eps=1.0,
        vacuum_gain=120.0,
        vacuum_cap=3.0,
        lens_enabled=True,
        digit_lock_enabled=True,
        digit_lock_k=6,
        digit_lock_steps=30,
    )
    results.append(run_config("SCM(p=0.16)", scm, tries, max_flips, time_limit))

    print_results(results)

    print("\nc Tips:")
    print("c - More live updates? report_period=5000.")
    print("c - Heavier planet? set n=5000 then 10000.")
    print("c - Digit lock tuning: digit_lock_steps=60, digit_lock_k=8 if it stalls at 6.")
    print("c - Earlier prism: in LensController lower ramp_start_frac (e.g. 0.25).")


if __name__ == "__main__":
    main()