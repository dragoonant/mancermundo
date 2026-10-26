"""Finalise raw Hunyuan terrain meshes into public/assets/models/terrain/<slug>.glb and the manifest `terrain` section.

Run with the Hunyuan 2.1 venv python (trimesh, numpy, scipy, PIL, pymeshlab):
    %USERPROFILE%\\Hunyuan3D-2.1\\.venv\\Scripts\\python.exe tools/models/finalize-terrain.py [slug ...] [--qc DIR]

Per slug (config tools/models/terrain.json, rules footprint from src/data/killzones/volkus-*.json):
load ~/Hunyuan3D-2/outputs/<slug>/textured.glb, drop floaters, slice off the wide flat base lip (bottom 3% when a
slab spanning the whole footprint is detected), long axis onto X (+ optional yaw so the front faces +Z), simplify to
about 6000 faces with pymeshlab's UV-preserving quadric decimation, then scale NON-uniformly so x/z equal the piece's
rules footprint bounding box (union of its parts' polygons in the piece-local frame) and y equals the tallest
part height. Origin = footprint centre on the ground (y = 0). Texture re-encoded as 1024 JPEG, metallic flattened.
The footprint of every slug is checked to be the same across all layouts (warns otherwise).
"""
import glob
import io
import json
import math
import os
import sys
import tempfile
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image
from scipy import sparse

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "tools" / "models" / "terrain.json"
OUT = ROOT / "public" / "assets" / "models" / "terrain"
MANIFEST = ROOT / "public" / "assets" / "models" / "manifest.json"
LAYOUTS = sorted(glob.glob(str(ROOT / "src" / "data" / "killzones" / "volkus-*.json")))
HOME = Path(os.path.expanduser("~"))
RAW_DIR = HOME / "Hunyuan3D-2" / "outputs"
FLOATER_AREA_FRAC = 0.01
JPEG_QUALITY = 84
TEX_MAX = 1024
TARGET_FACES = 6000
BASE_CUT_FRAC = 0.03


def load_mesh(path):
    sc = trimesh.load(str(path))
    if isinstance(sc, trimesh.Trimesh):
        return sc
    ms = []
    for node in sc.graph.nodes_geometry:
        mat, gname = sc.graph[node]
        m = sc.geometry[gname].copy()
        m.apply_transform(mat)
        ms.append(m)
    return max(ms, key=lambda m: m.area)


def remove_floaters(mesh, log):
    v = np.asarray(mesh.vertices)
    key = np.round(v / max(1e-9, np.ptp(v, axis=0).max()) * 1e5).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    f = inv[np.asarray(mesh.faces)]
    n = inv.max() + 1
    e = np.vstack([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    g = sparse.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n))
    _, lab = sparse.csgraph.connected_components(g, directed=False)
    flab = lab[f[:, 0]]
    per = np.bincount(flab, weights=mesh.area_faces)
    keep = per >= FLOATER_AREA_FRAC * per.sum()
    if (~keep).any():
        log.append(f"floaters: {int((~keep).sum())} piece(s) / {int((~keep[flab]).sum())} faces")
        mesh.update_faces(keep[flab])
        mesh.remove_unreferenced_vertices()
    return mesh


def cut_base(mesh, log):
    """Like cut_base in stage_shape.py: a wide flat slab in the bottom BASE_CUT_FRAC of the height is the concept's
    base lip. Faces whose centroid lies below the cut are dropped (keeps the UVs exact)."""
    v = mesh.vertices
    lo, hi = v[:, 1].min(), v[:, 1].max()
    h = hi - lo
    cut = lo + BASE_CUT_FRAC * h
    tri = v[np.asarray(mesh.faces)]
    cy = tri[:, :, 1].mean(axis=1)
    low = cy <= cut
    t = tri[low][:, :, [0, 2]]
    area = 0.5 * np.abs((t[:, 1, 0] - t[:, 0, 0]) * (t[:, 2, 1] - t[:, 0, 1]) - (t[:, 2, 0] - t[:, 0, 0]) * (t[:, 1, 1] - t[:, 0, 1])).sum()
    cover = float(area / np.prod(np.ptp(v[:, [0, 2]], axis=0)))  # projected area of the bottom slice vs the footprint bbox
    if cover < 0.45:
        log.append(f"base slab not detected (bottom {BASE_CUT_FRAC:.0%} covers {cover:.0%} of the footprint box)")
        return mesh
    keep = cy > cut
    log.append(f"base lip cut: bottom {BASE_CUT_FRAC:.0%} (covers {cover:.0%} of the footprint box), {int((~keep).sum())} faces")
    mesh.update_faces(keep)
    mesh.remove_unreferenced_vertices()
    return remove_floaters(mesh, log)


def rot_y(deg):
    return trimesh.transformations.rotation_matrix(np.radians(deg), [0, 1, 0])


def long_axis_to_x(mesh, log):
    ext = np.ptp(mesh.vertices[:, [0, 2]], axis=0)
    if ext[1] > ext[0] * 1.02:
        mesh.apply_transform(rot_y(90))
        log.append("rotated 90 about Y (long axis was Z)")
    return mesh


def simplify(mesh, log):
    if len(mesh.faces) <= TARGET_FACES:
        return mesh
    try:
        import pymeshlab

        tex = mesh.visual.material.baseColorTexture
        with tempfile.TemporaryDirectory() as td:
            obj = Path(td) / "m.obj"
            mesh.export(str(obj))
            ms = pymeshlab.MeshSet()
            ms.load_new_mesh(str(obj))
            ms.meshing_decimation_quadric_edge_collapse_with_texture(
                targetfacenum=TARGET_FACES, preserveboundary=True, preservenormal=True
            )
            out = Path(td) / "d.obj"
            ms.save_current_mesh(str(out), save_vertex_normal=False, save_wedge_texcoord=True)
            res = trimesh.load(str(out), process=False, force="mesh")
            if res.visual.uv is None or len(res.faces) < 500:
                raise RuntimeError("decimation lost UVs")
            res.visual = trimesh.visual.TextureVisuals(uv=res.visual.uv, material=trimesh.visual.material.PBRMaterial(baseColorTexture=tex))
        log.append(f"decimated {len(mesh.faces)} -> {len(res.faces)} faces (pymeshlab, UV kept)")
        return res
    except Exception as ex:  # noqa: BLE001
        log.append(f"decimation skipped ({ex})")
        return mesh


def flatten_material(mesh):
    mat = mesh.visual.material
    mat.metallicFactor = 0.0
    mat.roughnessFactor = 0.85
    tex = getattr(mat, "baseColorTexture", None)
    if tex is not None:
        im = tex.convert("RGB")
        if max(im.size) > TEX_MAX:
            r = TEX_MAX / max(im.size)
            im = im.resize((round(im.width * r), round(im.height * r)), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=JPEG_QUALITY)
        buf.seek(0)
        jpg = Image.open(buf)
        jpg.load()
        mat.baseColorTexture = jpg
    return mesh


# ---------- layout footprints ----------
def local_pt(pt, pos, yaw_deg):
    """World point -> piece-local frame (inverse of three.js rotation.y = yaw: world = R(yaw) * local)."""
    y = math.radians(yaw_deg)
    dx, dz = pt["x"] - pos["x"], pt["z"] - pos["z"]
    return (dx * math.cos(y) - dz * math.sin(y), dx * math.sin(y) + dz * math.cos(y))


def layout_footprints(warn):
    """slug -> {w, d, h, cx, cz, n}: local bbox union of all parts, verified identical across every piece and layout."""
    seen = {}
    for lp in LAYOUTS:
        data = json.loads(Path(lp).read_text())
        for pc in data["pieces"]:
            loc = [[local_pt(q, pc["pos"], pc["yaw"]) for q in part["footprint"]] for part in pc["parts"]]
            pts = [p for poly in loc for p in poly]
            xs, zs = [p[0] for p in pts], [p[1] for p in pts]
            h = max(part["height"] for part in pc["parts"])
            floors = [f for part in pc["parts"] for f in part.get("vantageFloors", [])] + [part["height"] for part in pc["parts"] if "vantage" in part["traits"]]
            parts = sorted((part["id"], tuple(sorted((round(a, 2), round(b, 2)) for a, b in poly)), part["height"]) for part, poly in zip(pc["parts"], loc))
            rec = dict(
                w=round(max(xs) - min(xs), 2),
                d=round(max(zs) - min(zs), 2),
                h=h,
                floor=max(floors) if floors else 0,
                cx=round((max(xs) + min(xs)) / 2, 2),
                cz=round((max(zs) + min(zs)) / 2, 2),
            )
            seen.setdefault(pc["model"], []).append((f"{Path(lp).stem}/{pc['id']}", rec, parts))
    out = {}
    for slug, lst in seen.items():
        ref_id, ref, ref_parts = lst[0]
        for pid, rec, parts in lst[1:]:
            if rec != ref:
                warn(f"{slug}: footprint differs {pid} {rec} vs {ref_id} {ref}")
            if parts != ref_parts:
                warn(f"{slug}: part layout in the local frame differs {pid} vs {ref_id} (yaw sign or data)")
        if abs(ref["cx"]) > 0.01 or abs(ref["cz"]) > 0.01:
            warn(f"{slug}: footprint centre is off pos by ({ref['cx']},{ref['cz']}); piece pos is not the footprint centre")
        out[slug] = dict(ref, n=len(lst))
    return out


def qc_sheet(slug, mesh, d):
    """Textured point-splat views (front looking -Z, side, top) for orientation checks."""
    d.mkdir(parents=True, exist_ok=True)
    pts, fi = trimesh.sample.sample_surface(mesh, 120000)
    tri = mesh.faces[fi]
    bary = trimesh.triangles.points_to_barycentric(mesh.triangles[fi], pts)
    uv = (mesh.visual.uv[tri] * bary[:, :, None]).sum(axis=1)
    tex = np.array(mesh.visual.material.baseColorTexture.convert("RGB"))
    th, tw = tex.shape[:2]
    col = tex[np.clip(((1 - uv[:, 1]) * (th - 1)).astype(int), 0, th - 1), np.clip((uv[:, 0] * (tw - 1)).astype(int), 0, tw - 1)]
    ext = np.ptp(pts, axis=0)
    S = 260 / max(ext[0], ext[1] + 0.1, ext[2])
    W, H = 300, 300
    ims = []
    for name in ("front", "side", "top"):
        if name == "front":  # camera at +Z looking -Z: nearer = larger z drawn last
            order = np.argsort(pts[:, 2])
            px = W // 2 + pts[order, 0] * S
            py = H - 20 - pts[order, 1] * S
        elif name == "side":  # camera at +X looking -X: right of image = -Z... use +Z to the right
            order = np.argsort(pts[:, 0])
            px = W // 2 + pts[order, 2] * S
            py = H - 20 - pts[order, 1] * S
        else:  # top: +X right, +Z down (front at bottom)
            order = np.argsort(pts[:, 1])
            px = W // 2 + pts[order, 0] * S
            py = H // 2 + pts[order, 2] * S
        img = np.full((H, W, 3), 245, np.uint8)
        px, py = px.astype(int), py.astype(int)
        ok = (px >= 0) & (px < W - 1) & (py >= 0) & (py < H - 1)
        for dx in (0, 1):
            for dy in (0, 1):
                img[py[ok] + dy, px[ok] + dx] = col[order][ok]
        ims.append(img)
    Image.fromarray(np.hstack(ims)).save(d / f"{slug}.png")


def warp_deck(mesh, floor, H, log):
    """The layout's Vantage floor (e.g. 3 in) is where an operative stands; the generated mesh puts its roof deck
    elsewhere (about 0.9 of the height). Find the dominant up-facing flat surface in the upper part of the mesh and
    remap y piecewise-linearly so that surface sits exactly at `floor` (the very top stays at H)."""
    v = np.array(mesh.vertices)
    tri = v[np.asarray(mesh.faces)]
    nrm = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    ar = np.linalg.norm(nrm, axis=1)
    up = nrm[:, 1] / np.maximum(ar, 1e-12) > 0.9
    cy = tri[:, :, 1].mean(axis=1)
    sel = up & (cy > 0.55 * H) & (cy < 0.97 * H)
    if not sel.any():
        log.append("deck not found, no vertical warp")
        return mesh
    bins = np.arange(0.55 * H, 0.97 * H + 0.05, 0.05)
    hist, _ = np.histogram(cy[sel], bins=bins, weights=ar[sel])
    pk = bins[int(np.argmax(hist))] + 0.025
    near = sel & (np.abs(cy - pk) < 0.12)
    order = np.argsort(cy[near])
    cum = np.cumsum(ar[near][order])
    dk = float(cy[near][order][np.searchsorted(cum, cum[-1] / 2)])
    y = v[:, 1]
    v[:, 1] = np.where(y <= dk, y * floor / dk, floor + (y - dk) * (H - floor) / (H - dk))
    mesh.vertices = v
    log.append(f"deck found at y={dk:.2f} of {H}, warped to the Vantage floor {floor}")
    return mesh


def finalize(slug, cfg, foot, qc_dir, warn):
    log = []
    path = RAW_DIR / slug / "textured.glb"
    if not path.exists():
        return None, [f"missing raw mesh {path}"]
    mesh = load_mesh(path)
    mesh = remove_floaters(mesh, log)
    mesh = long_axis_to_x(mesh, log)
    if cfg.get("yaw"):
        mesh.apply_transform(rot_y(cfg["yaw"]))
    if cfg.get("cutBase", True):
        mesh = cut_base(mesh, log)
    mesh = simplify(mesh, log)
    f = foot.get(slug)
    if f is None:
        cf = cfg.get("footprint")
        if not cf:
            return None, ["no layout use and no footprint in terrain.json"]
        f = dict(w=cf["w"], d=cf["d"], h=cf["h"], n=0)
        log.append("footprint from terrain.json (not in any layout)")
    v = np.array(mesh.vertices)
    lo, hi = v.min(axis=0), v.max(axis=0)
    c = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
    v -= c
    v *= np.array([f["w"] / (hi[0] - lo[0]), f["h"] / (hi[1] - lo[1]), f["d"] / (hi[2] - lo[2])])
    mesh.vertices = v
    if f.get("floor"):
        mesh = warp_deck(mesh, f["floor"], f["h"], log)
    mesh = flatten_material(mesh)
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"{slug}.glb"
    mesh.export(str(out))
    b = mesh.bounds
    kb = out.stat().st_size / 1024
    if kb > 1200:
        warn(f"{slug}: {kb:.0f} KB exceeds 1.2 MB")
    log.append(f"faces {len(mesh.faces)}, x[{b[0][0]:.2f},{b[1][0]:.2f}] y[{b[0][1]:.2f},{b[1][1]:.2f}] z[{b[0][2]:.2f},{b[1][2]:.2f}], {kb:.0f} KB")
    if qc_dir:
        qc_sheet(slug, mesh, Path(qc_dir))
    entry = {
        "file": f"terrain/{slug}.glb",
        "footprint": {"w": f["w"], "d": f["d"]},
        "heightIn": f["h"],
        "origin": "centre-ground",
    }
    return (entry, len(mesh.faces), kb, f["n"]), log


def main():
    args = sys.argv[1:]
    qc_dir = None
    if "--qc" in args:
        i = args.index("--qc")
        qc_dir = args[i + 1]
        del args[i : i + 2]
    warnings = []

    def warn(m):
        warnings.append(m)
        print("WARNING " + m)

    cfgs = {k: v for k, v in json.loads(CONFIG.read_text()).items() if not k.startswith("_")}
    foot = layout_footprints(warn)
    for s in foot:
        if s not in cfgs:
            warn(f"layout slug {s} has no terrain.json entry")
    slugs = args or list(cfgs)
    results = {}
    for slug in slugs:
        res, log = finalize(slug, cfgs[slug], foot, qc_dir, warn)
        print(f"{slug}: " + "; ".join(log))
        if res:
            results[slug] = res
    man = json.loads(MANIFEST.read_text())  # re-read just before writing: other agents edit other sections
    man.setdefault("terrain", {})
    for slug, (entry, *_rest) in results.items():
        man["terrain"][slug] = entry
    MANIFEST.write_text(json.dumps(man, indent=2) + "\n")
    print(f"\n{'slug':16} {'faces':>6} {'KB':>5}  footprint (w x d x h)   uses")
    for slug, (entry, faces, kb, n) in results.items():
        fp = entry["footprint"]
        print(f"{slug:16} {faces:6d} {kb:5.0f}  {fp['w']} x {fp['d']} x {entry['heightIn']}   {n}")
    print(f"{len(warnings)} warning(s)")


if __name__ == "__main__":
    main()
