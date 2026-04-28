# ⭐ PHASELOCK‑SAT — Canonical Algorithm (Implementation‑Ready)

A multispectral local‑search solver with illumination engineering and phase mobility.

---

## 1. Data Structures

```
Assignment A[n]          # current Boolean assignment
Energy E                 # number of unsatisfied clauses
Weights w[m]             # clause weights
Potential φ[n]           # variable potentials
Stagnation s             # flips since last improvement
LensState L              # VISIBLE / IR / UV / PRISM
```

---

## 2. Initialization

```
A ← random assignment
E ← compute_energy(A)
initialize w[i] = 1 for all clauses
initialize φ[v] = 0 for all variables
s ← 0
L ← VISIBLE
```

---

## 3. Main Loop

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

## 4. Mechanisms (Canonical Definitions)

### 4.1 Tunneling Probability (0.16 Spin)

```
p_max = 0.16
p_min = 0.02

tunneling_probability(s):
    return p_min + (p_max - p_min) * (s / (s + τ))
```

This is your bounded uphill acceptance.

---

### 4.2 Field Updates (Gravity)

```
update_fields(v, w, φ):
    for each clause c_i unsatisfied after flip:
        w[i] ← min(w_max, w[i] + α)
        for each variable u in c_i:
            φ[u] ← min(φ_max, φ[u] + β)
```

This is your learned gravitational field.

---

### 4.3 Lens Controller (Multispectral Observation)

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

### 4.4 Collatz Kick (Phase Reset)

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

### 4.5 Vacuum Rail (Freeze‑Breaking Drift)

```
if s > freeze_threshold:
    bias variable selection toward high φ[v]
```

This is your flat‑region traversal.

---

### 4.6 Digit Lock (Endgame Phase‑Lock)

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

## ⭐ 5. Output

```
return best_assignment_seen
```
