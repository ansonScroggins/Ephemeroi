import json
import os
import time
import hashlib

BRAIN_DB_PATH = "brain_db.json"

def _load_brain_db():
    if os.path.exists(BRAIN_DB_PATH):
        try:
            with open(BRAIN_DB_PATH, "r") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def _save_brain_db(db):
    try:
        with open(BRAIN_DB_PATH, "w") as f:
            json.dump(db, f, indent=2)
        return True
    except Exception:
        return False

def fingerprint_instance(clauses, n_vars):
    h = hashlib.sha256()
    h.update(str(n_vars).encode())
    h.update(str(len(clauses)).encode())
    # lightweight structural fingerprint (no clause content leak)
    h.update(str([len(c) for c in clauses[:32]]).encode())
    return h.hexdigest()[:16]

class BrainController:
    def __init__(self, default_params=None):
        self.db = _load_brain_db()
        self.default_params = default_params or {
            "base_tunnel": 0.16,
            "stagnation_boost": True,
            "mini_learner": True
        }

    def get_params(self, fingerprint):
        if fingerprint in self.db:
            print(f"[brain] Found memory for {fingerprint}")
            return self.db[fingerprint]["best_params"]
        print("[brain] No DB entry yet. Using defaults.")
        return dict(self.default_params)

    def update_best(self, fingerprint, params, score):
        entry = self.db.get(fingerprint)
        if entry is None or score < entry.get("best_score", float("inf")):
            self.db[fingerprint] = {
                "best_params": params,
                "best_score": score,
                "updated_at": time.time()
            }
            ok = _save_brain_db(self.db)
            print(f"[brain] DB updated: {ok}")
        else:
            print("[brain] Existing memory is better. No update.")

# Example glue call (call this from your solver entrypoint)
def run_with_brain(clauses, n_vars, run_solver_fn, score_fn):
    """
    clauses: CNF clauses
    n_vars: number of variables
    run_solver_fn(params) -> solver result
    score_fn(result) -> numeric score (lower is better)
    """
    brain = BrainController()
    fp = fingerprint_instance(clauses, n_vars)
    params = brain.get_params(fp)

    print(f"[brain] Instance fingerprint: {fp}")
    print(f"[brain] Using params: {params}")

    result = run_solver_fn(params)
    score = score_fn(result)

    brain.update_best(fp, params, score)
    return result