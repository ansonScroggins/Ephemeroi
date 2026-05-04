import random
from typing import Dict, List, Optional, Set, Tuple


# ─────────────────────────────────────────────────────────────────────────────
# THE SPLICER — Transit Medium Greedy Repair
# ─────────────────────────────────────────────────────────────────────────────
#
# THEORY: THE 100MB SEA (100-variable, Many-Body SAT field)
#
# The assignment is not a container of truth. It is a medium through which
# constraint-energy flows. A variable CONDUCTS when flipping it routes
# energy toward lower unsat. It RESISTS when locked against the gradient.
# It DAMS when locked AND energy is backing up (backpressure > 0).
#
# The Splicer does not search for the "right" variable.
# It finds the variable with the highest CONDUCTANCE — the one that,
# if moved, routes the most energy toward the attractor.
#
# BIOLOGICAL ANALOGY (The Webbing):
#   Introns  = high-backpressure locked vars (blocking, not coding)
#   Exons    = free vars that when expressed reduce unsat
#   Splicing = removing the intron's blocking influence by routing around it
#              OR by reclassifying it as a candidate for adversarial probe
#
# EPHEMEROI INTEGRATION:
#   - locked_vars: Imperial Decree (backbone nominees, soft-locked ledger vars)
#   - candidate_pool: active soldiers available for movement this cycle
#   - backpressure_map: TransitMonitor's current reading per var
#   - clause_index: var → clause_ids (for local-impact evaluation)
#
# ─────────────────────────────────────────────────────────────────────────────


def evaluate_local_impact(
    var: int,
    assignment: Dict[int, bool],
    clauses: List[List[int]],
    clause_index: Dict[int, List[int]],
) -> int:
    """
    Compute the net unsat count AFTER flipping `var`.

    Only examines clauses containing `var` — O(degree) not O(|F|).
    Returns the number of those local clauses that would be UNSATISFIED
    after the flip. Lower = better conductance.

    TRANSIT READING: this is the local backpressure after the flip.
    If it's lower than before, the flip routes energy forward.
    If it's higher, the flip dams the flow.
    """
    local_clause_ids = clause_index.get(var, [])
    if not local_clause_ids:
        return 0  # var not in any clause — inert, zero resistance

    # Simulate the flip
    flipped = dict(assignment)
    flipped[var] = not flipped[var]

    unsat_after = 0
    for cid in local_clause_ids:
        clause = clauses[cid]
        satisfied = False
        for lit in clause:
            v = abs(lit)
            val = flipped.get(v, False)
            if (lit > 0 and val) or (lit < 0 and not val):
                satisfied = True
                break
        if not satisfied:
            unsat_after += 1

    return unsat_after


def evaluate_local_before(
    var: int,
    assignment: Dict[int, bool],
    clauses: List[List[int]],
    clause_index: Dict[int, List[int]],
) -> int:
    """
    Current unsat count in var's local clause neighborhood (before flip).
    Used to compute conductance gain = before - after.
    """
    local_clause_ids = clause_index.get(var, [])
    unsat_before = 0
    for cid in local_clause_ids:
        clause = clauses[cid]
        satisfied = any(
            (lit > 0 and assignment.get(abs(lit), False)) or
            (lit < 0 and not assignment.get(abs(lit), False))
            for lit in clause
        )
        if not satisfied:
            unsat_before += 1
    return unsat_before


def build_clause_index(n_vars: int, clauses: List[List[int]]) -> Dict[int, List[int]]:
    """
    Build var → [clause_id, ...] index for O(degree) local impact queries.
    Call once at solver init; pass into Splicer each step.
    """
    idx: Dict[int, List[int]] = {v: [] for v in range(1, n_vars + 1)}
    for cid, clause in enumerate(clauses):
        for lit in clause:
            idx[abs(lit)].append(cid)
    return idx


# ─────────────────────────────────────────────────────────────────────────────
# BACKPRESSURE SIGNAL
#
# A variable under Imperial Decree (locked) is still generating backpressure
# if it appears in persistent unsat clauses. High backpressure + high trust =
# deceptive coherence (LedgerHygiene language). The Splicer uses this signal
# to tag dams for adversarial probe rather than routing around them forever.
# ─────────────────────────────────────────────────────────────────────────────

def compute_backpressure(
    var: int,
    assignment: Dict[int, bool],
    clauses: List[List[int]],
    clause_index: Dict[int, List[int]],
) -> float:
    """
    Backpressure = fraction of var's local clauses currently unsatisfied.
    Range [0.0, 1.0].

    0.0 = var is conducting freely (all local clauses satisfied)
    1.0 = var is a complete dam (all local clauses unsatisfied)

    A locked var with backpressure > BACKPRESSURE_DAM_THRESHOLD
    is a false channel — it should be flagged for squirrel probe,
    not treated as confirmed backbone.
    """
    local_ids = clause_index.get(var, [])
    if not local_ids:
        return 0.0
    unsat = evaluate_local_before(var, assignment, clauses, clause_index)
    return unsat / len(local_ids)


BACKPRESSURE_DAM_THRESHOLD = 0.5  # >50% of local clauses unsat = dam


# ─────────────────────────────────────────────────────────────────────────────
# THE SPLICER — main function
# ─────────────────────────────────────────────────────────────────────────────

def greedy_repair_step(
    assignment: Dict[int, bool],
    clauses: List[List[int]],
    clause_index: Dict[int, List[int]],
    locked_vars: Dict[int, bool],           # var → locked value
    candidate_pool: List[int],
    backpressure_map: Optional[Dict[int, float]] = None,
    rng: Optional[random.Random] = None,
    dam_report: Optional[List[int]] = None,  # OUT: dams detected this step
) -> Optional[int]:
    """
    The Splicer: single high-pressure repair step.

    Finds the free soldier in candidate_pool with highest CONDUCTANCE —
    the flip that routes the most constraint-energy toward lower unsat.

    CONDUCTANCE SCORE = local_unsat_before - local_unsat_after
    (positive = energy moves forward; zero = neutral; negative = dam)

    Additionally:
    - Scans locked vars for DAM CONDITION (high backpressure despite lock)
    - Reports dams via dam_report for TransitMonitor / adversarial probe

    Returns: var to flip (best conductor), or None if pool is empty.

    DOES NOT flip. The solver loop owns the flip decision.
    The Splicer is a routing advisor, not an executor.
    """
    if rng is None:
        rng = random.Random()

    # ── 1. Scan locked vars for dam condition ────────────────────────────────
    # The Splicer sees through Imperial Decree.
    # A dam is a locked var with high backpressure — wrong lock, wrong basin.
    # Flag it. Don't route around it forever.
    if dam_report is not None:
        for var, locked_val in locked_vars.items():
            bp = (
                backpressure_map.get(var, 0.0)
                if backpressure_map
                else compute_backpressure(var, assignment, clauses, clause_index)
            )
            if bp > BACKPRESSURE_DAM_THRESHOLD:
                dam_report.append(var)

    # ── 2. Filter to free soldiers ───────────────────────────────────────────
    available = [v for v in candidate_pool if v not in locked_vars]

    if not available:
        return None

    # ── 3. Score by conductance ──────────────────────────────────────────────
    # conductance_gain = local_unsat_before - local_unsat_after
    # We want maximum gain (most energy routed forward).
    # Ties broken stochastically to prevent soft attractor formation.

    best_var: Optional[int] = None
    best_gain: float = float('-inf')

    for var in available:
        before = evaluate_local_before(var, assignment, clauses, clause_index)
        after  = evaluate_local_impact(var, assignment, clauses, clause_index)
        gain   = before - after

        if gain > best_gain:
            best_gain = gain
            best_var = var
        elif gain == best_gain:
            # Stochastic tie-breaking: prevents basin lock on flat landscape
            # (The original intuition was correct; now grounded in theory)
            if rng.random() > 0.5:
                best_var = var

    # ── 4. Zero-gain guard ───────────────────────────────────────────────────
    # If best_gain <= 0, no soldier in the pool improves local flow.
    # The pool itself may be stale (wrong soldiers for this basin).
    # Return None as a signal — don't make a neutral or harmful flip.
    # Let the caller decide: resample pool, trigger escape, or random walk.
    if best_gain <= 0:
        return None  # Signal: pool is stagnant, escalate

    return best_var


# ─────────────────────────────────────────────────────────────────────────────
# SPLICER COORDINATOR — multi-step repair with dam detection
# ─────────────────────────────────────────────────────────────────────────────

class Splicer:
    """
    Wraps greedy_repair_step with:
    - persistent dam tracking (vars consistently flagged across steps)
    - conductance history (which vars have been productive conductors)
    - stagnation detection (pool returns None N times in a row)

    The Splicer does not retain truth. It retains FLOW HISTORY.
    Which paths have moved energy. Which have dammed it.
    That is the only memory worth keeping.
    """

    DAM_CONFIRM_THRESHOLD = 3    # flag N times → confirmed dam, escalate
    STAGNATION_LIMIT      = 5    # N consecutive None returns → pool is dead

    def __init__(self, n_vars: int, clauses: List[List[int]]):
        self.n_vars       = n_vars
        self.clauses      = clauses
        self.clause_index = build_clause_index(n_vars, clauses)

        # Dam tracking: var → consecutive detection count
        self.dam_counts: Dict[int, int] = {}
        self.confirmed_dams: Set[int]   = set()

        # Flow history: var → times it was the best conductor
        self.conductor_log: Dict[int, int] = {}

        # Stagnation
        self.stagnation_streak = 0
        self.total_repairs     = 0
        self.null_returns      = 0

    def step(
        self,
        assignment: Dict[int, bool],
        locked_vars: Dict[int, bool],
        candidate_pool: List[int],
        backpressure_map: Optional[Dict[int, float]] = None,
        rng: Optional[random.Random] = None,
    ) -> Tuple[Optional[int], List[int]]:
        """
        Run one repair step.

        Returns:
          (best_var, confirmed_dams_this_step)

          best_var: variable to flip, or None if pool is stagnant
          confirmed_dams: locked vars that have hit DAM_CONFIRM_THRESHOLD
        """
        self.total_repairs += 1
        dam_report: List[int] = []

        best_var = greedy_repair_step(
            assignment      = assignment,
            clauses         = self.clauses,
            clause_index    = self.clause_index,
            locked_vars     = locked_vars,
            candidate_pool  = candidate_pool,
            backpressure_map= backpressure_map,
            rng             = rng,
            dam_report      = dam_report,
        )

        # Update dam counts
        flagged_this_step = set(dam_report)
        for var in list(self.dam_counts):
            if var not in flagged_this_step:
                # Dam cleared — backpressure dropped
                self.dam_counts[var] = max(0, self.dam_counts[var] - 1)
        for var in flagged_this_step:
            self.dam_counts[var] = self.dam_counts.get(var, 0) + 1

        # Promote to confirmed dam
        newly_confirmed = []
        for var, count in self.dam_counts.items():
            if count >= self.DAM_CONFIRM_THRESHOLD and var not in self.confirmed_dams:
                self.confirmed_dams.add(var)
                newly_confirmed.append(var)

        # Track stagnation
        if best_var is None:
            self.stagnation_streak += 1
            self.null_returns += 1
        else:
            self.stagnation_streak = 0
            self.conductor_log[best_var] = self.conductor_log.get(best_var, 0) + 1

        return best_var, newly_confirmed

    @property
    def is_stagnant(self) -> bool:
        return self.stagnation_streak >= self.STAGNATION_LIMIT

    def top_conductors(self, n: int = 5) -> List[Tuple[int, int]]:
        """Variables that have most frequently been the best conductor."""
        return sorted(self.conductor_log.items(), key=lambda x: x[1], reverse=True)[:n]

    def log(self) -> str:
        return (
            f"[SPLICER repairs={self.total_repairs} "
            f"nulls={self.null_returns} "
            f"dams={len(self.confirmed_dams)} "
            f"stagnation_streak={self.stagnation_streak}]"
        )
