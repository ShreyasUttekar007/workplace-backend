"""Build compact Punjab AC + village geometry for the proforma 3D map.
Inputs: datta07/INDIAN-SHAPEFILES (PUNJAB_ASSEMBLY / PUNJAB_VILLAGES geojson).
Outputs: acs.json (117 ACs) and villages.json (villages clipped to each AC, keyed by AC no)."""
import json, re, sys
from shapely.geometry import shape, mapping, Polygon, MultiPolygon
from shapely.strtree import STRtree
from shapely.validation import make_valid

SRC, OUT = sys.argv[1], sys.argv[2]
R = lambda v: round(v, 4)   # ~11 m

def clean_name(s):
    s = str(s or "").strip()
    s = re.sub(r"\(\s*S\s*C?\s*\)?$", "(SC)", s)        # "(S", "(SC" -> "(SC)"
    return s
def title(s):
    s = re.sub(r"\s*\*\s*$", "", str(s or "").strip())
    s = clean_name(s)
    return " ".join(w if w.startswith("(") else w.capitalize() for w in s.lower().split()).replace("(sc)", "(SC)")

Q = 10000  # 1e-4 degree units (~11 m)
def enc(coords):
    """Delta-encoded integer ring: [x0, y0, dx1, dy1, ...] in 1e-4 degrees (closing point dropped)."""
    pts = [(round(x * Q), round(y * Q)) for x, y in coords][:-1]
    out, px, py = [], 0, 0
    for i, (x, y) in enumerate(pts):
        if i and x == px and y == py: continue
        out += [x - px, y - py]; px, py = x, y
    return out
def rings(geom):
    polys = [geom] if isinstance(geom, Polygon) else [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon)]
    out = []
    for p in polys:
        if p.is_empty: continue
        e = enc(p.exterior.coords)
        if len(e) >= 6: out.append(e)
    return out

g = json.load(open(f"{SRC}/PUNJAB_ASSEMBLY.geojson"))
acs, shapes = [], {}
for f in g["features"]:
    p = f["properties"]; no = int(p["AC_NO"])
    geom = make_valid(shape(f["geometry"]))
    shapes[no] = geom
    simp = geom.simplify(0.0008, preserve_topology=True)
    c = geom.representative_point()
    acs.append({"no": no, "name": clean_name(p["AC_NAME"]), "district": title(p["DIST_NAME"]),
                "pc": title(p["PC_NAME"]), "c": [R(c.x), R(c.y)], "rings": rings(simp)})
acs.sort(key=lambda a: a["no"])
json.dump({"source": "datta07/INDIAN-SHAPEFILES (PUNJAB_ASSEMBLY)", "q": Q, "acs": acs},
          open(f"{OUT}/acs.json", "w"), separators=(",", ":"))

v = json.load(open(f"{SRC}/PUNJAB_VILLAGES.geojson"))
nos = sorted(shapes); tree = STRtree([shapes[n] for n in nos])
by_ac = {str(n): [] for n in nos}
skipped = 0
for f in v["features"]:
    p = f["properties"]
    try: geom = make_valid(shape(f["geometry"]))
    except Exception: skipped += 1; continue
    if geom.is_empty: skipped += 1; continue
    pt = geom.representative_point()
    hits = [nos[i] for i in tree.query(pt) if shapes[nos[i]].contains(pt)]
    if not hits: skipped += 1; continue
    no = hits[0]
    clip = geom.intersection(shapes[no]).simplify(0.00035, preserve_topology=True)
    rs = rings(clip)
    if not rs: skipped += 1; continue
    name = (p.get("vilnam_soi") or "").strip() or re.sub(r"\s*\(\d+\)\s*$", "", (p.get("vilname11") or "").strip()) or (p.get("gp_name") or "").strip()
    by_ac[str(no)].append({"n": title(name) if name else "", "b": title(p.get("block_name") or p.get("b_pan_name") or ""),
                           "rings": rs})
json.dump({"source": "datta07/INDIAN-SHAPEFILES (PUNJAB_VILLAGES), clipped to AC boundaries", "q": Q, "villages": by_ac},
          open(f"{OUT}/villages.json", "w"), separators=(",", ":"))
counts = sorted(len(x) for x in by_ac.values())
print("ACs:", len(acs), "| villages placed:", sum(counts), "skipped:", skipped, "| per AC min/median/max:", counts[0], counts[len(counts)//2], counts[-1])
