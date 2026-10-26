"""Measure attachment sockets on the fused body GLBs and write them into public/assets/models/manifest.json.

Run with the Hunyuan 2.1 venv python (has trimesh):
    %USERPROFILE%\Hunyuan3D-2.1\.venv\Scripts\python.exe tools/models/measure-sockets.py

Units are the GLB's own (1 unit = 1 inch, origin at base centre, y up). Fractions of height are taken over the
figure itself, i.e. from the top of the base disc (the 'Cylinder' node) to the top of the mesh.
Right = the figure's right = -x when it faces +Z.

Per-body overrides for the hand band (fractions of figure height) live in HAND_BAND below; edit them after a
visual check in ?gallery (sockets toggle).
"""
import json
import sys
from pathlib import Path

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[2]
BODIES = ROOT / "public" / "assets" / "models" / "bodies"
MANIFEST = ROOT / "public" / "assets" / "models" / "manifest.json"
UNITS = ROOT / "tools" / "local-gen" / "ms_units.json"
# v2 bodies (docs/spec/30-figures.md section 7): dynamic pose, default weapons fused into the mesh. No hand sockets are
# measured for them and the manifest entry gets `weaponsBaked`; VARIANTS lists the other poses of the same archetype.
V2_UNITS = ROOT / "tools" / "local-gen" / "v2_units.json"
VARIANTS: dict[str, list[str]] = {
    "aod-intercessor-warrior": ["aod-intercessor-warrior-kneeling"],
    "kom-boy": ["kom-boy-b", "kom-boy-c"],
    "pf-shasla": ["pf-shasla-b", "pf-shasla-c"],
    "ht-immortal-guardian": ["ht-immortal-guardian-b"],
    "pm-plague-marine-warrior": ["pm-plague-marine-warrior-b"],
    "wb-neophyte-warrior": ["wb-neophyte-warrior-b", "wb-neophyte-warrior-c"],
    "lg-warrior": ["lg-warrior-b"],
    "ha-agent": ["ha-agent-b"],
    "hc-skitarii-ranger-warrior": ["hc-skitarii-ranger-warrior-b"],
    "hc-skitarii-vanguard-warrior": ["hc-skitarii-vanguard-warrior-b"],
    "hc-sicarian-infiltrator-warrior": ["hc-sicarian-infiltrator-warrior-b"],
    "hc-sicarian-ruststalker-warrior": ["hc-sicarian-ruststalker-warrior-b"],
    "hk-warrior": ["hk-warrior-b", "hk-warrior-c"],
    "ks-trooper": ["ks-trooper-b"],
    "nv-purgatus": ["nv-purgatus-b"],
    "ph-infiltrator-warrior": ["ph-infiltrator-warrior-b"],
    "ph-incursor-warrior": ["ph-incursor-warrior-b"],
    "wc-rubric-marine-warrior": ["wc-rubric-marine-warrior-b"],
    "fk-hound": ["fk-hound-b"],
    "nb-armsman": ["nb-armsman-b"],
    "bl-trooper": ["bl-trooper-b"],
    "fg-warrior-bludgeon": ["fg-warrior-bludgeon-b"],
    "fg-warrior-cleaver": ["fg-warrior-cleaver-b"],
    "cc-blessed-blade": ["cc-blessed-blade-b"],
    "cc-devotee": ["cc-devotee-b", "cc-devotee-c"],
    "cc-mutant": ["cc-mutant-b"],
    "cc-torment": ["cc-torment-b"],
    "gm-aspirant": ["gm-aspirant-b", "gm-aspirant-c"],
    "ss-warrior-shotgun": ["ss-warrior-shotgun-b"],
    "ss-warrior-boltgun": ["ss-warrior-boltgun-b"],
    "ss-warrior-bolt-pistol-blade": ["ss-warrior-bolt-pistol-blade-b"],
    "ta-trooper": ["ta-trooper-b", "ta-trooper-c"],
}

DEFAULT_BAND = (0.20, 0.60)  # spec says 35-60%; these hands hang lower, so the band reaches down to the fists
HAND_BAND: dict[str, tuple[float, float]] = {
    # banner poles and a raised bionic arm sit inside the default band; keep the band on the hanging fists
    "pm-plague-marine-icon-bearer": (0.12, 0.36),
    "wb-neophyte-icon-bearer": (0.12, 0.36),
    "pf-blooded": (0.15, 0.42),
    "pm-plague-marine-heavy-gunner": (0.2, 0.32),
}
# wings or cloaks stick out sideways past the arms; ignore vertices wider than this (|x|, inches) when measuring the hands
HAND_XMAX = {"ha-skysplinter-assassin": 0.5}
NO_HANDS = {"kom-bomb-squig"}
# hose loops and pouches pull the measured hand behind the body; force the z of both hands (inches, +Z front)
HAND_Z = {"pm-plague-marine-heavy-gunner": 0.1}
# Facing is +Z by contract; the feet-based vote below is a diagnostic. List a slug here (verified in ?gallery) if
# its mesh really faces -Z. Sockets are then measured on the mesh turned 180 degrees about y, i.e. ALL sockets in
# the manifest are in the displayed +Z-facing frame, and the renderer turns such a body by PI (manifest `facing`).
FACING: dict[str, str] = {}  # all 20 verified +Z in ?gallery (the feet vote wrongly flags 6 of them)


def r3(v):
    return [round(float(x), 3) for x in v]


def load(path: Path):
    sc = trimesh.load(str(path))
    base_top = None
    fig = []
    for name, g in sc.geometry.items():
        if name.lower().startswith("cylinder"):
            base_top = float(g.bounds[1][1])
        else:
            fig.append(g)
    allv = np.vstack([g.vertices for g in fig])
    if base_top is None:
        base_top = 0.0
    return allv, base_top, float(max(g.bounds[1][1] for g in sc.geometry.values()))


def hand(v, side, y0, y1, hf):
    """Lowest of the extreme-x vertices in the arm band on one side (side = -1 right, +1 left)."""
    sel = v[(v[:, 1] >= y0) & (v[:, 1] <= y1) & (v[:, 0] * side > 0)]
    if len(sel) == 0:
        return None
    ax = np.abs(sel[:, 0])
    cand = sel[ax >= ax.max() - 0.16 * (ax.max() - 0.0 + 1e-9) * 0.5]
    low = cand[:, 1].min()
    cl = cand[cand[:, 1] <= low + 0.10 * hf]
    return cl.mean(axis=0)


def slice_(v, y, hf, tol=0.03):
    return v[np.abs(v[:, 1] - y) <= tol * hf]


def measure(slug: str):
    v, base_top, top = load(BODIES / f"{slug}.glb")
    hf = float(v[:, 1].max() - base_top)
    at = lambda f: base_top + f * hf
    out = {}
    # facing from the feet: toes protrude to the front
    feet = v[(v[:, 1] >= base_top) & (v[:, 1] <= at(0.14))]
    zc = feet[:, 2]
    vote = "+Z" if zc.max() >= -zc.min() else "-Z"
    facing = FACING.get(slug, "+Z")
    if facing == "-Z":
        v = v * np.array([-1.0, 1.0, -1.0])  # turn the mesh to face +Z so right is -x below
    band = HAND_BAND.get(slug, DEFAULT_BAND)
    if slug not in NO_HANDS and slug not in V2:
        vh = v[np.abs(v[:, 0]) <= HAND_XMAX[slug]] if slug in HAND_XMAX else v
        hr = hand(vh, -1, at(band[0]), at(band[1]), hf)
        hl = hand(vh, +1, at(band[0]), at(band[1]), hf)
        if slug in HAND_Z:
            for h_ in (hr, hl):
                if h_ is not None:
                    h_[2] = HAND_Z[slug]
        if hr is not None:
            out["handR"] = r3(hr)
        if hl is not None:
            out["handL"] = r3(hl)
    sl = slice_(v, at(0.55), hf)
    out["back"] = r3([0.0, at(0.55), sl[:, 2].min()])
    for name, f in (("belt", 0.40), ("shoulder", 0.75)):
        sl = slice_(v, at(f), hf)
        for suf, side in (("R", -1), ("L", 1)):
            side_v = sl[sl[:, 0] * side > 0]
            if len(side_v) == 0:
                side_v = sl  # a leaning pose can put the whole slice on one side of x = 0: use that edge of the body
            if len(side_v):
                x = side_v[:, 0].min() if side < 0 else side_v[:, 0].max()
                near = side_v[np.abs(side_v[:, 0] - x) < 0.04 * hf + 0.02]
                out[f"{name}{suf}"] = r3([x, at(f), np.median(near[:, 2])])
    top_v = v[v[:, 1] >= v[:, 1].max() - 0.04 * hf]
    out["head"] = r3([top_v[:, 0].mean(), v[:, 1].max(), top_v[:, 2].mean()])
    return {
        "heightIn": round(top, 3),
        "figureHeightIn": round(hf, 3),
        "baseTopIn": round(base_top, 3),
        "facing": facing,
        "feetVote": vote,
        "sockets": out,
    }


V2: set[str] = set(json.loads(V2_UNITS.read_text(encoding="utf-8")).keys()) if V2_UNITS.exists() else set()


def main():
    units = json.loads(UNITS.read_text(encoding="utf-8"))
    v2_units = json.loads(V2_UNITS.read_text(encoding="utf-8")) if V2_UNITS.exists() else {}
    man = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}
    man.setdefault("attachments", {})
    bodies = {}
    rows = []
    for f in sorted(BODIES.glob("*.glb")):
        slug = f.stem
        m = measure(slug)
        entry = {
            "file": f"bodies/{slug}.glb",
            "archetype": slug,
            "heightIn": m["heightIn"],
            "figureHeightIn": m["figureHeightIn"],
            "baseTopIn": m["baseTopIn"],
            "baseMm": (v2_units.get(slug) or units.get(slug, {})).get("base"),
            "measured": True,
            "sockets": m["sockets"],
        }
        if slug in V2:
            entry["weaponsBaked"] = True
            if slug in VARIANTS:
                entry["variants"] = [x for x in VARIANTS[slug] if (BODIES / f"{x}.glb").exists()]
        if m["facing"] != "+Z":
            entry["facing"] = m["facing"]
        bodies[slug] = entry
        k = m["sockets"]
        fmt = lambda n: ("%+.2f,%.2f,%+.2f" % tuple(k[n])) if n in k else "-"
        rows.append((slug, m["heightIn"], m["facing"] + ("" if m["feetVote"] == m["facing"] else "?"), fmt("handR"), fmt("handL"), fmt("back"), fmt("head")))
    man["bodies"] = bodies
    MANIFEST.write_text(json.dumps(man, indent=2) + "\n", encoding="utf-8")
    print(f"{'slug':36}{'H':>6} {'face':5} {'handR':>18} {'handL':>18} {'back':>18} {'head':>18}")
    for r in rows:
        print(f"{r[0]:36}{r[1]:6.2f} {r[2]:5} {r[3]:>18} {r[4]:>18} {r[5]:>18} {r[6]:>18}")
    print(f"wrote {MANIFEST} ({len(bodies)} bodies)")


if __name__ == "__main__":
    sys.exit(main())
