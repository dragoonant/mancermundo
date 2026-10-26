"""Finalise raw Hunyuan attachment meshes into public/assets/models/attachments/<slug>.glb and the manifest.

Run with the Hunyuan 2.1 venv python (has trimesh, numpy, scipy, PIL):
    %USERPROFILE%\\Hunyuan3D-2.1\\.venv\\Scripts\\python.exe tools/models/finalize-attachments.py [slug ...] [--qc DIR]

Per slug (tools/models/attachments.json): load textured.glb, drop floaters (tiny disconnected pieces), turn the
longest axis onto +X, pick the one of the 8 length-on-X rotations whose side silhouette best matches the concept
PNG in art/attachment-concepts (barrel / blade right, grip bottom left), apply optional yaw/pitch/roll tweaks,
scale the X extent to lengthIn, put the origin at the grip point (x = gripFrac of the length from the stock end,
y = bottom of the grip, z = mid depth), flatten the material (metallic 0) and re-encode the texture as JPEG,
and write the manifest `attachments` entry. Raw mesh: tools/models/raw/<slug>.glb (fetched copies, e.g. from
the second PC) when present, else ~/Hunyuan3D-2/outputs/<slug>/textured.glb.
The meshes arrive at 4000 faces (no quadric simplifier with UV support is installed), so no decimation is done.
"""
import io
import json
import os
import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image, ImageDraw
from scipy import ndimage, sparse

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "tools" / "models" / "attachments.json"
RAW_LOCAL = ROOT / "tools" / "models" / "raw"
OUT = ROOT / "public" / "assets" / "models" / "attachments"
MANIFEST = ROOT / "public" / "assets" / "models" / "manifest.json"
CONCEPTS = ROOT / "art" / "attachment-concepts"
HOME = Path(os.path.expanduser("~"))
SRC_DIRS = [HOME / "Hunyuan3D-2" / "outputs"]
FLOATER_AREA_FRAC = 0.015
JPEG_QUALITY = 86
TEX_MAX = 512


def raw_path(slug):
    p = RAW_LOCAL / f"{slug}.glb"
    if p.exists():
        return p
    for d in SRC_DIRS:
        q = d / slug / "textured.glb"
        if q.exists():
            return q
    return None


def load_meshes(path):
    sc = trimesh.load(str(path))
    if isinstance(sc, trimesh.Trimesh):
        return [sc]
    out = []
    for node in sc.graph.nodes_geometry:
        mat, gname = sc.graph[node]
        m = sc.geometry[gname].copy()
        m.apply_transform(mat)
        out.append(m)
    return out


def remove_floaters(mesh, log):
    """Drop connected pieces (welded by position) whose area is < FLOATER_AREA_FRAC of the total."""
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
    area = mesh.area_faces
    per = np.bincount(flab, weights=area)
    keep = per >= FLOATER_AREA_FRAC * per.sum()
    drop = int((~keep).sum())
    if drop:
        log.append(f"floaters removed: {drop} piece(s), {int((~keep[flab]).sum())} faces")
        mesh.update_faces(keep[flab])
        mesh.remove_unreferenced_vertices()
    return mesh


def rot_axis(axis, deg):
    return trimesh.transformations.rotation_matrix(np.radians(deg), axis)


def candidates(mesh):
    """Transforms that put the longest bbox axis on X, then the 8 proper rotations that keep it on X."""
    ext = np.ptp(mesh.vertices, axis=0)
    ax = int(np.argmax(ext))
    base = np.eye(4)
    if ax == 1:
        base = rot_axis([0, 0, 1], -90)
    elif ax == 2:
        base = rot_axis([0, 1, 0], 90)
    out = []
    for flip in (0, 180):
        for roll in (0, 90, 180, 270):
            out.append(rot_axis([1, 0, 0], roll) @ rot_axis([0, 1, 0], flip) @ base)
    return out


def silhouette(verts, faces, width=240):
    """Side (XY) silhouette of the triangles, cropped to its bbox, as a bool array [rows, cols]."""
    xy = verts[:, :2]
    lo = xy.min(axis=0)
    ext = xy.max(axis=0) - lo
    s = (width - 1) / ext[0]
    h = int(np.ceil(ext[1] * s)) + 1
    img = Image.new("L", (width, h), 0)
    d = ImageDraw.Draw(img)
    px = (xy - lo) * s
    px[:, 1] = (h - 1) - px[:, 1]
    for f in faces:
        d.polygon([tuple(px[i]) for i in f], fill=255)
    return np.array(img) > 0


def concept_mask(slug):
    p = CONCEPTS / f"{slug}.png"
    if not p.exists():
        return None
    a = np.array(Image.open(p).convert("RGB")).astype(int)
    m = (255 - a.min(axis=2)) > 28
    m = ndimage.binary_opening(m, iterations=1)
    m = ndimage.binary_fill_holes(m)
    lab, n = ndimage.label(m)
    if n > 1:
        sizes = ndimage.sum(m, lab, range(1, n + 1))
        keep = [i + 1 for i, s in enumerate(sizes) if s > 0.01 * sizes.max()]
        m = np.isin(lab, keep)
    ys, xs = np.where(m)
    return m[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def on_canvas(mask, size=200):
    """Width-normalised mask centred on a size x size canvas (keeps the aspect ratio)."""
    h, w = mask.shape
    img = Image.fromarray((mask * 255).astype(np.uint8)).resize((size, max(1, round(h * size / w))))
    arr = np.array(img) > 127
    canvas = np.zeros((size, size), bool)
    hh = min(size, arr.shape[0])
    y0 = (size - hh) // 2
    canvas[y0 : y0 + hh] = arr[:hh]
    return canvas


def iou(a, b):
    return float((a & b).sum()) / max(1, float((a | b).sum()))


def right_mass(m):
    return float(m[:, m.shape[1] // 2 :].sum()) / max(1, float(m.sum()))


def pick_orientation(mesh, slug, log):
    cm = concept_mask(slug)
    cands = candidates(mesh)
    if cm is None:
        log.append("no concept png: orientation unchecked")
        t = cands[0]
        mesh = mesh.copy()
        mesh.apply_transform(t)
        return mesh
    cc = on_canvas(cm)
    scores = []
    for t in cands:
        v = trimesh.transform_points(mesh.vertices, t)
        scores.append(iou(on_canvas(silhouette(v, mesh.faces)), cc))
    i = int(np.argmax(scores))
    if scores[0] >= scores[i] - 0.03:
        i = 0  # near-ties (symmetric parts) keep the generator's own orientation, which already follows the concept
    log.append(f"orientation #{i} IoU {scores[i]:.2f} (#0 {scores[0]:.2f})")
    mesh = mesh.copy()
    mesh.apply_transform(cands[i])
    sil = silhouette(mesh.vertices, mesh.faces)
    log.append(f"right-half mass: mesh {right_mass(sil):.2f} concept {right_mass(cm):.2f}")
    if scores[i] < 0.5:
        log.append("WARNING low silhouette match, check by eye")
    return mesh


def flatten_material(mesh):
    mat = mesh.visual.material
    try:
        mat.metallicFactor = 0.0
        mat.roughnessFactor = 0.75
    except Exception:
        pass
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


def finalize(slug, cfg, qc_dir):
    log = []
    path = raw_path(slug)
    if path is None:
        return None, [f"missing raw mesh for {slug}"]
    parts = load_meshes(path)
    mesh = max(parts, key=lambda m: m.area) if len(parts) > 1 else parts[0]
    if len(parts) > 1:
        log.append(f"{len(parts)} geometries in file; using the largest")
    mesh = remove_floaters(mesh, log)
    mesh = pick_orientation(mesh, slug, log)
    t = np.eye(4)
    if cfg.get("roll"):
        t = rot_axis([1, 0, 0], cfg["roll"]) @ t
    if cfg.get("pitch"):
        t = rot_axis([0, 0, 1], cfg["pitch"]) @ t
    if cfg.get("yaw"):
        t = rot_axis([0, 1, 0], cfg["yaw"]) @ t
    if not np.allclose(t, np.eye(4)):
        mesh.apply_transform(t)
    length = float(cfg["lengthIn"])
    ext = np.ptp(mesh.vertices, axis=0)
    mesh.apply_scale(length / ext[0])
    v = mesh.vertices
    lo = v.min(axis=0)
    grip_frac = float(cfg.get("gripFrac", 0.22))
    gx = lo[0] + grip_frac * length
    win = np.abs(v[:, 0] - gx) <= 0.06 * length
    gy = float(v[win, 1].min()) if win.any() else float(lo[1])
    gz = float((v[:, 2].min() + v[:, 2].max()) / 2)
    mesh.apply_translation([-gx, -gy, -gz])
    mesh = flatten_material(mesh)
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"{slug}.glb"
    mesh.export(str(out))
    b = mesh.bounds
    entry = {
        "file": f"attachments/{slug}.glb",
        "holdClass": cfg["holdClass"],
        "lengthIn": length,
        "grip": {"x": 0, "y": 0, "z": 0},
        "scale": 1,
    }
    if cfg["holdClass"] in ("long", "heavy"):
        sx = float(cfg.get("supportFrac", 0.6)) * length - grip_frac * length
        w2 = np.abs(mesh.vertices[:, 0] - sx) <= 0.05 * length
        sy = float(mesh.vertices[w2, 1].min()) if w2.any() else 0.0
        entry["support"] = {"x": round(sx, 3), "y": round(sy, 3), "z": 0}
    kb = out.stat().st_size // 1024
    log.append(f"faces {len(mesh.faces)}, x[{b[0][0]:.2f},{b[1][0]:.2f}] y[{b[0][1]:.2f},{b[1][1]:.2f}] z[{b[0][2]:.2f},{b[1][2]:.2f}], {kb} KB")
    if qc_dir:
        qc(slug, mesh, Path(qc_dir))
    return entry, log


def qc(slug, mesh, d):
    """Side-by-side concept | final silhouette (grip origin ringed in red) for a quick look."""
    d.mkdir(parents=True, exist_ok=True)
    W, H = 512, 256
    sheet = Image.new("RGB", (W * 2, H), (255, 255, 255))
    p = CONCEPTS / f"{slug}.png"
    if p.exists():
        c = Image.open(p).convert("RGB")
        c.thumbnail((W, H))
        sheet.paste(c, (0, 0))
    v = mesh.vertices
    sil = silhouette(v, mesh.faces, 480)
    img = Image.fromarray((~sil * 255).astype(np.uint8)).convert("RGB")
    lo = v[:, :2].min(axis=0)
    s = 479 / (v[:, 0].max() - lo[0])
    h = img.height
    dr = ImageDraw.Draw(img)
    ox, oy = (0 - lo[0]) * s, (h - 1) - (0 - lo[1]) * s
    dr.ellipse([ox - 6, oy - 6, ox + 6, oy + 6], outline=(255, 0, 0), width=3)
    img.thumbnail((W - 10, H - 10))
    sheet.paste(img, (W + 10, 10))
    sheet.save(d / f"{slug}.png")


def main():
    args = sys.argv[1:]
    qc_dir = None
    if "--qc" in args:
        i = args.index("--qc")
        qc_dir = args[i + 1]
        del args[i : i + 2]
    cfgs = {k: v for k, v in json.loads(CONFIG.read_text()).items() if not k.startswith("_")}
    slugs = args or list(cfgs)
    man = json.loads(MANIFEST.read_text())
    man.setdefault("attachments", {})
    for slug in slugs:
        entry, log = finalize(slug, cfgs[slug], qc_dir)
        print(f"{slug}: " + "; ".join(log))
        if entry:
            man["attachments"][slug] = entry
    MANIFEST.write_text(json.dumps(man, indent=2) + "\n")


if __name__ == "__main__":
    main()
