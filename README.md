# Ephemeroi

Ephemeroi is an always-on cognitive substrate: an autonomous observer + multispectral SAT solver, with a persistent belief system, a Telegram-narrated persona stack (Don / Wife / Son), and a metacognitive search interface. Its operational core is **PHASELOCK‑SAT** — a multispectral local‑search solver with illumination engineering and phase mobility.

> ## Guiding Premise
>
> Understanding the way the outside world works is how we navigate and build the computer world and manage the Internet world.
> This is one of the main beliefs the system strives to act on — *learn more, prove theories.*

The full theoretical framing lives in [`THEORY.md`](./THEORY.md). The algorithm itself is below.

---

## ⭐ PHASELOCK‑SAT — Canonical Algorithm (Implementation‑Ready)

A multispectral local‑search solver with illumination engineering and phase mobility.

---

### 1. Data Structures

```
Assignment A[n]          # current Boolean assignment
Energy E                 # number of unsatisfied clauses
Weights w[m]             # clause weights
Potential φ[n]           # variable potentials
Stagnation s             # flips since last improvement
LensState L              # VISIBLE / IR / UV / PRISM
```

---

### 2. Initialization

```
A ← random assignment
E ← compute_energy(A)
initialize w[i] = 1 for all clauses
initialize φ[v] = 0 for all variables
s ← 0
L ← VISIBLE
```

---

### 3. Main Loop

```
while not timeout:
    if E == 0:
        return A

    update_lens_state(L, φ, w, s)

    if L == VISIBLE:
        v ← pick_random_variable_from_unsat_clause()
    else:
        v ← pick_high_impact_variable(A, w, φ)

    ΔE ← energy_if_flipped(A, v)

    if ΔE <= 0:
        flip(v)
        update_fields(v, w, φ)
        E ← E + ΔE
        s ← 0
        continue

    # uphill move
    if random() < tunneling_probability(s):
        flip(v)
        update_fields(v, w, φ)
        E ← E + ΔE
        s ← s + 1
        continue

    # stagnation handling
    s ← s + 1

    if s > stagnation_threshold:
        collatz_kick(A, w, φ)
        s ← 0
        continue
```

---

### 4. Mechanisms (Canonical Definitions)

#### 4.1 Tunneling Probability (0.16 Spin)

```
p_max = 0.16
p_min = 0.02

tunneling_probability(s):
    return p_min + (p_max - p_min) * (s / (s + τ))
```

This is your bounded uphill acceptance.

---

#### 4.2 Field Updates (Gravity)

```
update_fields(v, w, φ):
    for each clause c_i unsatisfied after flip:
        w[i] ← min(w_max, w[i] + α)
        for each variable u in c_i:
            φ[u] ← min(φ_max, φ[u] + β)
```

This is your learned gravitational field.

---

#### 4.3 Lens Controller (Multispectral Observation)

```
update_lens_state(L, φ, w, s):
    if s < s1:
        L ← VISIBLE
    else if avg(|φ|) > threshold1:
        L ← IR
    else if avg(|w|) > threshold2:
        L ← UV
    else if s > s2:
        L ← PRISM
```

- **VISIBLE** → exploration
- **IR** → gravity‑dominated
- **UV** → phase‑lock
- **PRISM** → stagnation escape

---

#### 4.4 Collatz Kick (Phase Reset)

```
collatz_kick(A, w, φ):
    k = min(k_max, 3*s + 1)
    for i in 1..k:
        v ← biased_pick(A, w, φ)
        flip(v)

    c = v2(k)   # number of trailing zeros in k
    for j in 1..c:
        v ← greedy_pick(A)
        flip(v)
```

This is your structured energy injection.

---

#### 4.5 Vacuum Rail (Freeze‑Breaking Drift)

```
if s > freeze_threshold:
    bias variable selection toward high φ[v]
```

This is your flat‑region traversal.

---

#### 4.6 Digit Lock (Endgame Phase‑Lock)

```
if E <= 6:
    for d in 0..9:
        θ = 2π * d / 10
        apply_phase_bias(cos θ, sin θ)
        attempt_small_burst()
        if E == 0:
            return A
```

This is your endgame rotor.

---

### ⭐ 5. Output

```
return best_assignment_seen
```

---

## Mechanism Deep Dives

### 4.3 Collatz Kick: Structured Energy Injection for Stagnation Escape

The Collatz Kick is the central stagnation‑breaking mechanism in PHASELOCK‑SAT.
It is inspired by the dynamical structure of the Collatz map, not its number‑theoretic conjecture.
The solver does not rely on the truth of the Collatz Conjecture; instead, it adopts the shape of Collatz dynamics:

> Chaotic exploration under simple local rules, followed by deterministic collapse into a single global attractor.

This pattern mirrors the behavior PHASELOCK‑SAT requires when the search enters a low‑illumination region where local flips fail to produce meaningful descent.

---

#### 4.3.1 Motivation

Local‑search SAT solvers stagnate when:

- illumination density is low,
- phase mobility collapses,
- the local energy gradient becomes flat,
- or the solver cycles through a small set of assignments.

Traditional perturbation methods (e.g., random walks, noise injection) break stagnation but do so unstructuredly, often destroying useful partial structure.

PHASELOCK‑SAT instead uses a deterministic, structured perturbation that:

1. injects energy,
2. preserves partial structure,
3. forces the system into a new basin,
4. and guarantees eventual collapse back toward the attractor.

This is the role of the Collatz Kick.

---

#### 4.3.2 Definition

Let $s$ denote the stagnation length (number of flips since last improvement).
The Collatz Kick consists of two phases:

**Phase 1 — Expansion Step (3n + 1 analogue)**

A burst of $k = \min(k_{\max}, 3s + 1)$ flips is applied.
Each flip is chosen by a biased selector that prefers variables with:

- high potential $\phi[v]$,
- high clause weight influence,
- or high illumination gradient.

This corresponds to the "chaotic expansion" phase of Collatz trajectories.

**Phase 2 — Contraction Step (division by 2 analogue)**

Let $v_2(k)$ be the number of trailing zeros in the binary representation of $k$.
PHASELOCK‑SAT performs $v_2(k)$ greedy flips, each chosen to minimize energy.

This models the "collapse toward the attractor" phase.

---

#### 4.3.3 Interpretation

The Collatz Kick is not random noise.
It is a two‑phase dynamical operator:

- **Expansion** explores a new region of the landscape.
- **Contraction** re‑aligns the solver with the global attractor (the phase‑lock basin).

This mirrors the Collatz dynamic:

$$n \rightarrow 3n + 1 \rightarrow \frac{n}{2^m} \rightarrow 1$$

PHASELOCK‑SAT uses this structure to ensure that even large perturbations eventually collapse back into a stable descent trajectory.

---

#### 4.3.4 Effect on Illumination and Phase Mobility

The Collatz Kick increases:

- **illumination density**, by forcing the solver into regions with new clause interactions,
- **phase mobility**, by breaking cycles and flat basins,
- **ergodicity**, by ensuring the solver does not remain confined to a low‑visibility region.

Unlike random restarts, the Collatz Kick preserves partial structure accumulated before stagnation, allowing the solver to resume descent with improved visibility.

---

#### 4.3.5 Theoretical Role in Expected Apple Descent

In the Expected Apple Descent framework, the Collatz Kick ensures:

- the solver cannot remain indefinitely in a dark region,
- bounded tunneling remains effective,
- illumination density eventually becomes positive on a non‑zero measure subset,
- and the system re‑enters a regime where expected descent is polynomial.

Thus, the Collatz Kick is the structured perturbation operator that maintains the conditions required for the Expected Apple Descent theorem.

---

#### 4.3.6 Summary

The Collatz Kick provides PHASELOCK‑SAT with:

- deterministic stagnation escape,
- structured exploration,
- guaranteed re‑alignment with the attractor,
- preservation of useful structure,
- and improved illumination for subsequent descent.

It is the mechanism that transforms PHASELOCK‑SAT from a local‑search algorithm into a multispectral dynamical system capable of navigating complex SAT landscapes with high robustness.
