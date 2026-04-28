import os
import sys
import json
import math
import time
import shlex
import random
import hashlib
import statistics
import tempfile
import subprocess
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional, Tuple, Callable


# ============================================================
# PERSISTENT LEARNING CORTEX (wired to a real solver adapter)
# - Multi-parameter learning (p, epsilon, restart, stagnation, max_tunnel)
# - Evolutionary search + bandit-ish selection
# - Curvature / sensitivity memory (finite-diff-ish from history)
# - Transfer learning (global prior + family prior, optional meta-features)
# - Safe persistence with robust fallback paths (no PermissionError crashes)
#
# YOU MUST CONFIGURE SolverAdapter below for your real solver.
# ============================================================


# ----------------------------
# USER CONFIG (edit these)
# ----------------------------

INSTANCE_GLOB_OR_NAME = "v20_c85_a3.0_r*"

# Provide either a list of CNF paths, OR keep None and just use INSTANCE_GLOB_OR_NAME
# Example: INSTANCE_FILES = ["bench/a.cnf", "bench/b.cnf"]
INSTANCE_FILES: Optional[List[str]] = None

PROFILES = {
    "light":  {"time_cap_sec": 0.10, "max_gens": 800,  "runs": 50},
    "medium": {"time_cap_sec": 0.25, "max_gens": 2000, "runs": 100},
    "heavy":  {"time_cap_sec": 0.50, "max_gens": 4000, "runs": 100},
}

PASS_RATE = 0.60

# Parameter bounds for learning
PARAM_BOUNDS = {
    "p":          (0.00, 0.30),   # base tunneling probability
    "epsilon":    (0.00, 0.30),   # exploration / randomness
    "restart_k":  (10,  500),     # restart cadence / scale (int)
    "stagnation": (50,  5000),    # stagnation threshold (int)
    "max_tunnel": (0.00, 0.50),   # hard cap on tunneling probability
}

# Learning controls
POP_SIZE = 10
ELITE_K = 3
GENERATIONS = 6

# Evaluation controls
PAR2_PENALTY_MULT = 2.0
PRINT_PER_PROFILE_DETAIL = True

# Persistence controls
DB_NAME = "brain_db.json"
DB_ENV = "PLC_DB_PATH"  # if set, overrides DB location (recommended)


# ============================================================
# SMALL UTILS
# ============================================================

def clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x

def stable_hash(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]

def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)

def now_ts() -> float:
    return time.time()

def median(xs: List[float]) -> float:
    if not xs:
        return 0.0
    xs = sorted(xs)
    n = len(xs)
    m = n // 2
    return xs[m] if n % 2 else 0.5 * (xs[m - 1] + xs[m])

def percentile(xs: List[float], q: float) -> float:
    if not xs:
        return 0.0
    xs = sorted(xs)
    idx = q * (len(xs) - 1)
    lo = int(math.floor(idx))
    hi = int(math.ceil(idx))
    if lo == hi:
        return xs[lo]
    w = idx - lo
    return xs[lo] * (1.0 - w) + xs[hi] * w


# ============================================================
# SAFE JSON PERSISTENCE (atomic where possible; fallback where not)
# ============================================================

def choose_default_db_path() -> str:
    # Priority:
    # 1) PLC_DB_PATH env var
    # 2) ./demo_brain/brain_db.json (if writable)
    # 3) tempdir/plc_brain/brain_db.json (always writable in most envs)
    env = os.environ.get(DB_ENV)
    if env:
        return env

    cwd = os.getcwd()
    candidate_dir = os.path.join(cwd, "plc_brain")
    try:
        ensure_dir(candidate_dir)
        testfile = os.path.join(candidate_dir, ".write_test")
        with open(testfile, "w") as f:
            f.write("ok")
        os.remove(testfile)
        return os.path.join(candidate_dir, DB_NAME)
    except Exception:
        tmp = tempfile.gettempdir()
        fallback_dir = os.path.join(tmp, "plc_brain")
        ensure_dir(fallback_dir)
        return os.path.join(fallback_dir, DB_NAME)

def safe_load_json(path: str) -> Dict[str, Any]:
    try:
        if not os.path.exists(path):
            return {}
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}

def safe_atomic_write_json(path: str, obj: Dict[str, Any]) -> bool:
    # Try atomic replace in target dir; if it fails, fallback to best-effort write.
    d = os.path.dirname(path)
    try:
        ensure_dir(d)
        with tempfile.NamedTemporaryFile("w", delete=False, dir=d, suffix=".tmp", encoding="utf-8") as tf:
            json.dump(obj, tf, indent=2, sort_keys=False)
            tf.flush()
            os.fsync(tf.fileno())
            tmp_path = tf.name
        os.replace(tmp_path, path)
        return True
    except Exception:
        # Best-effort fallback: write directly (non-atomic), avoid crashing.
        try:
            ensure_dir(d)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(obj, f, indent=2, sort_keys=False)
            return True
        except Exception:
            return False


# ============================================================
# SCORING
# ============================================================

def par2(times: List[float], limit: float, success_rate: float) -> float:
    successes = [t for t in times if t < limit]
    avg_success = statistics.mean(successes) if successes else 0.0
    penalty = PAR2_PENALTY_MULT * limit * (1.0 - success_rate)
    return avg_success + penalty


# ============================================================
# SOLVER ADAPTER (YOU CONFIGURE THIS)
# ============================================================

@dataclass
class SolveResult:
    success: bool
    elapsed_sec: float
    extra: Dict[str, Any]

class SolverAdapter:
    """
    Two supported modes:
      A) subprocess command
      B) python callable

    You choose ONE:
      - set self.mode = "subprocess" and define self.cmd_template
      - or set self.mode = "callable" and define self.fn

    Subprocess template supports placeholders:
      {instance} {time_cap} {max_gens} {p} {epsilon} {restart_k} {stagnation} {max_tunnel}

    Success detection:
      - exit code 10 typical for SAT, 20 for UNSAT; customize in is_success()
      - or parse stdout (customize parse_output())
    """

    def __init__(
        self,
        mode: str = "subprocess",
        cmd_template: Optional[str] = None,
        fn: Optional[Callable[[str, Dict[str, Any], float, int], SolveResult]] = None,
        cwd: Optional[str] = None,
        timeout_slack: float = 0.05,
    ):
        self.mode = mode
        self.cmd_template = cmd_template
        self.fn = fn
        self.cwd = cwd
        self.timeout_slack = timeout_slack

        if self.mode not in ("subprocess", "callable"):
            raise ValueError("mode must be 'subprocess' or 'callable'")

        if self.mode == "subprocess" and not self.cmd_template:
            # NOTE: You MUST replace this with your real solver command.
            # Example:
            #   self.cmd_template = "kissat {instance} --time={time_cap} --seed=1 --tunnel={p} ..."
            self.cmd_template = "python -c \"import time; time.sleep(0.001); print('SAT')\""

        if self.mode == "callable" and not self.fn:
            raise ValueError("callable mode requires fn")

    def is_success(self, rc: int, stdout: str, stderr: str) -> bool:
        # Customize this for your solver.
        # Common SAT solvers:
        #   SAT return code 10, UNSAT return code 20
        # If your solver prints "SAT"/"UNSAT", check stdout.
        if "SAT" in stdout and "UNSAT" not in stdout:
            return True
        if rc in (10, 20):
            return True
        return False

    def run(self, instance_path: str, params: Dict[str, Any], time_cap_sec: float, max_gens: int) -> SolveResult:
        if self.mode == "callable":
            return self.fn(instance_path, params, time_cap_sec, max_gens)

        # subprocess mode
        fmt = {
            "instance": instance_path,
            "time_cap": time_cap_sec,
            "max_gens": max_gens,
            "p": params["p"],
            "epsilon": params["epsilon"],
            "restart_k": params["restart_k"],
            "stagnation": params["stagnation"],
            "max_tunnel": params["max_tunnel"],
        }
        cmd = self.cmd_template.format(**fmt)
        argv = shlex.split(cmd)

        t0 = time.perf_counter()
        try:
            proc = subprocess.run(
                argv,
                cwd=self.cwd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=(time_cap_sec + self.timeout_slack),
            )
            elapsed = time.perf_counter() - t0
            ok = self.is_success(proc.returncode, proc.stdout, proc.stderr)
            return SolveResult(success=ok, elapsed_sec=elapsed, extra={
                "rc": proc.returncode,
                "stdout": proc.stdout[-5000:],
                "stderr": proc.stderr[-5000:],
            })
        except subprocess.TimeoutExpired as e:
            elapsed = time.perf_counter() - t0
            return SolveResult(success=False, elapsed_sec=min(elapsed, time_cap_sec), extra={
                "timeout": True,
                "stdout": (e.stdout or "")[-5000:] if hasattr(e, "stdout") else "",
                "stderr": (e.stderr or "")[-5000:] if hasattr(e, "stderr") else "",
            })
        except Exception as e:
            # Never crash the cortex because solver crashed.
            return SolveResult(success=False, elapsed_sec=time_cap_sec, extra={"error": repr(e)})


# ============================================================
# PARAM MODEL / MUTATION
# ============================================================

@dataclass
class Params:
    p: float
    epsilon: float
    restart_k: int
    stagnation: int
    max_tunnel: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "p": float(self.p),
            "epsilon": float(self.epsilon),
            "restart_k": int(self.restart_k),
            "stagnation": int(self.stagnation),
            "max_tunnel": float(self.max_tunnel),
        }

def random_params(rng: random.Random, center: Optional[Params] = None, scale: float = 1.0) -> Params:
    def jitter_float(name: str, base: float) -> float:
        lo, hi = PARAM_BOUNDS[name]
        span = (hi - lo)
        # gaussian jitter around base
        v = base + rng.gauss(0.0, 0.15 * span * scale)
        return clamp(v, lo, hi)

    def jitter_int(name: str, base: int) -> int:
        lo, hi = PARAM_BOUNDS[name]
        span = (hi - lo)
        v = int(round(base + rng.gauss(0.0, 0.15 * span * scale)))
        return int(clamp(v, lo, hi))

    if center is None:
        # plain random
        return Params(
            p=rng.uniform(*PARAM_BOUNDS["p"]),
            epsilon=rng.uniform(*PARAM_BOUNDS["epsilon"]),
            restart_k=int(rng.randint(PARAM_BOUNDS["restart_k"][0], PARAM_BOUNDS["restart_k"][1])),
            stagnation=int(rng.randint(PARAM_BOUNDS["stagnation"][0], PARAM_BOUNDS["stagnation"][1])),
            max_tunnel=rng.uniform(*PARAM_BOUNDS["max_tunnel"]),
        )

    return Params(
        p=jitter_float("p", center.p),
        epsilon=jitter_float("epsilon", center.epsilon),
        restart_k=jitter_int("restart_k", center.restart_k),
        stagnation=jitter_int("stagnation", center.stagnation),
        max_tunnel=jitter_float("max_tunnel", center.max_tunnel),
    )

def sanitize_params(p: Params) -> Params:
    # Ensure max_tunnel >= p and respects bounds
    p_lo, p_hi = PARAM_BOUNDS["p"]
    mt_lo, mt_hi = PARAM_BOUNDS["max_tunnel"]
    p.p = clamp(p.p, p_lo, p_hi)
    p.max_tunnel = clamp(p.max_tunnel, mt_lo, mt_hi)
    if p.max_tunnel < p.p:
        p.max_tunnel = p.p
    # ints
    rk_lo, rk_hi = PARAM_BOUNDS["restart_k"]
    st_lo, st_hi = PARAM_BOUNDS["stagnation"]
    p.restart_k = int(clamp(int(p.restart_k), rk_lo, rk_hi))
    p.stagnation = int(clamp(int(p.stagnation), st_lo, st_hi))
    # epsilon
    e_lo, e_hi = PARAM_BOUNDS["epsilon"]
    p.epsilon = clamp(p.epsilon, e_lo, e_hi)
    return p


# ============================================================
# TRANSFER LEARNING / MEMORY
# ============================================================

def instance_family_key(name_or_glob: str, meta: Optional[Dict[str, Any]] = None) -> str:
    # If you have meaningful meta (vars/clauses), include it in the key so similar instances cluster.
    if not meta:
        return f"{name_or_glob}_{stable_hash(name_or_glob)}"
    meta_part = json.dumps(meta, sort_keys=True)
    return f"{name_or_glob}_{stable_hash(name_or_glob + '|' + meta_part)}"

def family_signature(meta: Optional[Dict[str, Any]]) -> str:
    if not meta:
        return "no_meta"
    # coarse bucketing so transfer can work between close sizes
    v = int(meta.get("vars", 0) or 0)
    c = int(meta.get("clauses", 0) or 0)
    if v <= 0 or c <= 0:
        return "meta_partial"
    vb = int(round(math.log2(max(2, v))))
    cb = int(round(math.log2(max(2, c))))
    return f"v2^{vb}_c2^{cb}"


# ============================================================
# CORTEX DB SCHEMA
# ============================================================

class PersistentLearningCortex:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.db = safe_load_json(db_path)
        self.db.setdefault("version", 1)
        self.db.setdefault("global", {
            "best": None,         # best params overall
            "best_score": None,   # best total_par2 overall
            "history": [],        # global history
        })
        self.db.setdefault("families", {})   # family_key -> {best, best_score, history, sensitivities}
        self.db.setdefault("signatures", {}) # signature -> {best, best_score, history}

    def _family(self, fam_key: str) -> Dict[str, Any]:
        fams = self.db["families"]
        if fam_key not in fams:
            fams[fam_key] = {
                "best": None,
                "best_score": None,
                "history": [],
                "sensitivities": {},  # param -> sensitivity estimate
            }
        return fams[fam_key]

    def _signature(self, sig: str) -> Dict[str, Any]:
        sigs = self.db["signatures"]
        if sig not in sigs:
            sigs[sig] = {"best": None, "best_score": None, "history": []}
        return sigs[sig]

    def get_priors(self, fam_key: str, sig: str) -> Tuple[Optional[Params], Optional[Params], Optional[Params]]:
        fam = self._family(fam_key)
        sigdb = self._signature(sig)
        g = self.db["global"]

        fam_best = Params(**fam["best"]) if fam.get("best") else None
        sig_best = Params(**sigdb["best"]) if sigdb.get("best") else None
        glob_best = Params(**g["best"]) if g.get("best") else None
        return fam_best, sig_best, glob_best

    def record_eval(self, fam_key: str, sig: str, params: Params, total_par2: float, detail: Dict[str, Any]) -> None:
        entry = {
            "ts": now_ts(),
            "params": params.to_dict(),
            "total_par2": float(total_par2),
            "detail": detail,
        }

        fam = self._family(fam_key)
        fam["history"].append(entry)
        sigdb = self._signature(sig)
        sigdb["history"].append(entry)
        self.db["global"]["history"].append(entry)

        # updates
        self._update_best(fam, params, total_par2)
        self._update_best(sigdb, params, total_par2)
        self._update_best(self.db["global"], params, total_par2)

        # update curvature/sensitivity memory for the family
        self._update_sensitivities(fam)

        safe_atomic_write_json(self.db_path, self.db)

    def _update_best(self, scope: Dict[str, Any], params: Params, score: float) -> None:
        if scope.get("best_score") is None or score < scope["best_score"]:
            scope["best_score"] = float(score)
            scope["best"] = params.to_dict()

    def _update_sensitivities(self, fam: Dict[str, Any]) -> None:
        # crude sensitivity: for each param, look at small deltas in history and estimate |dscore/dparam|
        hist = fam.get("history", [])
        if len(hist) < 8:
            return

        # take recent window
        window = hist[-60:] if len(hist) > 60 else hist[:]
        pairs = []
        for i in range(len(window)):
            for j in range(i + 1, len(window)):
                pi = window[i]["params"]
                pj = window[j]["params"]
                si = window[i]["total_par2"]
                sj = window[j]["total_par2"]
                pairs.append((pi, pj, abs(sj - si)))

        sens = {}
        for name in ["p", "epsilon", "restart_k", "stagnation", "max_tunnel"]:
            grads = []
            for pi, pj, ds in pairs:
                di = pi[name]
                dj = pj[name]
                dd = abs(float(dj) - float(di))
                if dd <= 0:
                    continue
                grads.append(ds / dd)
            if grads:
                # robust estimate
                sens[name] = float(percentile(sorted(grads), 0.5))  # median grad magnitude

        fam["sensitivities"] = sens


# ============================================================
# EVALUATION LOOP
# ============================================================

def evaluate_params(
    adapter: SolverAdapter,
    instances: List[str],
    params: Params,
) -> Tuple[float, Dict[str, Any]]:
    # Evaluate across profiles; total score is sum of profile PAR-2 over instance set.
    detail: Dict[str, Any] = {"profiles": {}}
    total = 0.0

    p_dict = sanitize_params(params).to_dict()

    for prof_name, prof in PROFILES.items():
        time_cap = float(prof["time_cap_sec"])
        max_gens = int(prof["max_gens"])
        runs = int(prof["runs"])

        times: List[float] = []
        solved = 0
        timeouts = 0

        # run on (instance, run_id) pairs
        # If multiple instances provided, we rotate through them.
        for r in range(runs):
            inst = instances[r % len(instances)]
            res = adapter.run(inst, p_dict, time_cap, max_gens)
            t = float(res.elapsed_sec)

            # treat >= time_cap as timeout
            if res.success and t < time_cap:
                solved += 1
                times.append(t)
            else:
                timeouts += 1
                times.append(time_cap)

        rate = solved / runs if runs else 0.0
        score = par2(times, time_cap, rate)
        total += score

        prof_detail = {
            "runs": runs,
            "solved": solved,
            "solve_rate": rate,
            "timeouts": timeouts,
            "par2_sec": score,
            "median_sec": median(times),
            "p90_sec": percentile(times, 0.90),
            "p95_sec": percentile(times, 0.95),
            "max_sec": max(times) if times else 0.0,
            "status": "PASS" if rate >= PASS_RATE else "FAIL",
        }
        detail["profiles"][prof_name] = prof_detail

    return float(total), detail


# ============================================================
# POPULATION-BASED LEARNING (evolution + priors + sensitivities)
# ============================================================

def seed_population(
    rng: random.Random,
    fam_best: Optional[Params],
    sig_best: Optional[Params],
    glob_best: Optional[Params],
    fam_sens: Optional[Dict[str, float]],
) -> List[Params]:
    pop: List[Params] = []

    # Pick a center in this order: family > signature > global > random
    center = fam_best or sig_best or glob_best
    if center:
        center = sanitize_params(center)
        pop.append(center)

    # Use sensitivities to adapt mutation scale:
    # higher sensitivity -> smaller mutations
    # lower sensitivity -> larger mutations
    base_scale = 1.0
    if fam_sens:
        med_sens = percentile(sorted([v for v in fam_sens.values() if v > 0] or [1.0]), 0.5)
        # if very sensitive, reduce scale
        base_scale = clamp(1.0 / math.sqrt(max(1e-9, med_sens)), 0.35, 1.25)

    while len(pop) < POP_SIZE:
        if center:
            # mostly around center
            scale = base_scale * (1.0 + 0.25 * rng.random())
            cand = random_params(rng, center=center, scale=scale)
        else:
            cand = random_params(rng, center=None)
        pop.append(sanitize_params(cand))

    return pop


def evolve(
    rng: random.Random,
    pop: List[Params],
    scored: List[Tuple[float, Params]],
    fam_sens: Optional[Dict[str, float]],
) -> List[Params]:
    scored_sorted = sorted(scored, key=lambda x: x[0])
    elites = [p for _, p in scored_sorted[:ELITE_K]]

    # determine mutation scale from sensitivity
    base_scale = 1.0
    if fam_sens:
        med_sens = percentile(sorted([v for v in fam_sens.values() if v > 0] or [1.0]), 0.5)
        base_scale = clamp(1.0 / math.sqrt(max(1e-9, med_sens)), 0.30, 1.10)

    new_pop: List[Params] = []
    new_pop.extend(elites)

    # crossover-ish: average two elites + jitter
    while len(new_pop) < POP_SIZE:
        a = rng.choice(elites)
        b = rng.choice(elites)
        mix = Params(
            p=0.5 * (a.p + b.p),
            epsilon=0.5 * (a.epsilon + b.epsilon),
            restart_k=int(round(0.5 * (a.restart_k + b.restart_k))),
            stagnation=int(round(0.5 * (a.stagnation + b.stagnation))),
            max_tunnel=0.5 * (a.max_tunnel + b.max_tunnel),
        )
        cand = random_params(rng, center=sanitize_params(mix), scale=base_scale * (0.8 + 0.6 * rng.random()))
        new_pop.append(sanitize_params(cand))

    return new_pop[:POP_SIZE]


# ============================================================
# MAIN
# ============================================================

def resolve_instances() -> List[str]:
    # Keep simple: if INSTANCE_FILES provided, use those; else treat INSTANCE_GLOB_OR_NAME as a “family name”.
    # For subprocess solver usage, you probably want real file paths.
    if INSTANCE_FILES and len(INSTANCE_FILES) > 0:
        return INSTANCE_FILES[:]

    # If you didn't supply files, we still need something to pass the adapter.
    # Use a placeholder path; your real integration should pass actual CNF paths.
    return [INSTANCE_GLOB_OR_NAME]

def print_eval(params: Params, total: float, detail: Dict[str, Any]) -> None:
    print("\n" + "-" * 72)
    print("Params:", params.to_dict())
    for pname, pd in detail["profiles"].items():
        if PRINT_PER_PROFILE_DETAIL:
            print(
                f"{pname:6s} | rate={pd['solve_rate']:.2f} | par2={pd['par2_sec']:.6f} | "
                f"median={pd['median_sec']:.6g} | p95={pd['p95_sec']:.6g} | {pd['status']}"
            )
    print(f"TOTAL_PAR2_SUM = {total:.6f}")
    print("-" * 72)

def main():
    rng = random.Random(1337)

    db_path = choose_default_db_path()
    cortex = PersistentLearningCortex(db_path=db_path)

    # Optional meta-features (put real vars/clauses here if you have them)
    # Example: META = {"vars": 100000, "clauses": 420000}
    META: Optional[Dict[str, Any]] = None

    fam_key = instance_family_key(INSTANCE_GLOB_OR_NAME, META)
    sig = family_signature(META)

    fam_db = cortex._family(fam_key)
    fam_sens = fam_db.get("sensitivities", {})

    fam_best, sig_best, glob_best = cortex.get_priors(fam_key, sig)

    print("=" * 72)
    print("Persistent Learning Cortex")
    print("DB path:", db_path)
    print("Family:", fam_key)
    print("Signature:", sig)
    print("Family best:", fam_best.to_dict() if fam_best else None)
    print("Signature best:", sig_best.to_dict() if sig_best else None)
    print("Global best:", glob_best.to_dict() if glob_best else None)
    print("Family sensitivities:", fam_sens if fam_sens else None)
    print("=" * 72)

    # ------------------------------------------------------------
    # CONFIGURE YOUR REAL SOLVER HERE:
    #
    # Option A: subprocess
    #   adapter = SolverAdapter(
    #       mode="subprocess",
    #       cmd_template="kissat {instance} --time={time_cap} --seed=1 "
    #                    "--tunnel_base={p} --tunnel_cap={max_tunnel} "
    #                    "--epsilon={epsilon} --restart={restart_k} --stagnation={stagnation}"
    #   )
    #
    # Option B: python callable:
    #   def my_solver_fn(instance, params, time_cap, max_gens)->SolveResult: ...
    #   adapter = SolverAdapter(mode="callable", fn=my_solver_fn)
    # ------------------------------------------------------------

    adapter = SolverAdapter(
        mode="subprocess",
        # REPLACE THIS with your solver invocation:
        # cmd_template="your_solver {instance} --time={time_cap} --gens={max_gens} --p={p} ..."
        cmd_template="python -c \"import time,random; time.sleep(random.random()*0.002); print('SAT')\""
    )

    instances = resolve_instances()

    # seed initial population from priors (transfer learning)
    pop = seed_population(rng, fam_best, sig_best, glob_best, fam_sens)

    # evolutionary learning loop
    best_overall: Optional[Tuple[float, Params, Dict[str, Any]]] = None

    for gen in range(GENERATIONS):
        print(f"\n\n=== GENERATION {gen+1}/{GENERATIONS} ===")
        scored: List[Tuple[float, Params]] = []
        details_map: Dict[str, Dict[str, Any]] = {}

        for i, cand in enumerate(pop):
            total, detail = evaluate_params(adapter, instances, cand)
            scored.append((total, cand))
            details_map[stable_hash(json.dumps(cand.to_dict(), sort_keys=True))] = detail

            print(f"[{i+1:02d}/{len(pop):02d}] total={total:.6f} params={cand.to_dict()}")

            if best_overall is None or total < best_overall[0]:
                best_overall = (total, cand, detail)

        scored_sorted = sorted(scored, key=lambda x: x[0])
        gen_best_score, gen_best_params = scored_sorted[0]

        # record gen-best into cortex (persistent learning)
        gen_best_detail = details_map[stable_hash(json.dumps(gen_best_params.to_dict(), sort_keys=True))]
        cortex.record_eval(fam_key, sig, gen_best_params, gen_best_score, gen_best_detail)

        print("\n--- GEN BEST ---")
        print_eval(gen_best_params, gen_best_score, gen_best_detail)

        # evolve population using updated sensitivity memory
        fam_sens = cortex._family(fam_key).get("sensitivities", {})
        pop = evolve(rng, pop, scored, fam_sens)

    if best_overall:
        total, params, detail = best_overall
        print("\n\n" + "=" * 72)
        print("FINAL BEST (across all generations)")
        print_eval(params, total, detail)
        print("DB UPDATED ✅")
        print("=" * 72)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted.")
        sys.exit(130)