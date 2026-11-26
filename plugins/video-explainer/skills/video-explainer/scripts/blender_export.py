"""Reusable Headless Blender Mesh & Fracture Exporter for /video-explainer (Mode: 3d).
Run inside Blender:
  blender -b -P my_meshes.py
where my_meshes.py imports blender_export (via sys.path.append(SCRIPTS_DIR)) and calls
write_studio_assets({"hero": pack_object(obj), ...}, "$P/media/studio_assets.js").
Outputs synchronous base64 IEEE-754 Float32 / Uint16 / Uint32 buffers for Studio3D.loadAsset()."""
import base64, json, math, os, random, struct

import bmesh
import bpy
from mathutils import Vector


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def new_mesh_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    return obj


def add_rounded_rect_prism(bm, width, height, depth, radius, corner_segs=10, center=(0.0, 0.0, 0.0)):
    hw, hh, hd = width * 0.5, height * 0.5, depth * 0.5
    r = min(radius, hw - 1e-4, hh - 1e-4)
    cx, cy, cz = center
    pts = []
    corners = [
        (hw - r, hh - r, 0.0, math.pi * 0.5),
        (-hw + r, hh - r, math.pi * 0.5, math.pi),
        (-hw + r, -hh + r, math.pi, math.pi * 1.5),
        (hw - r, -hh + r, math.pi * 1.5, math.pi * 2.0),
    ]
    for ox, oy, a0, a1 in corners:
        for i in range(corner_segs):
            ang = a0 + (a1 - a0) * (i / corner_segs)
            pts.append((cx + ox + math.cos(ang) * r, cy + oy + math.sin(ang) * r))
    bot = [bm.verts.new((px, py, cz - hd)) for (px, py) in pts]
    top = [bm.verts.new((px, py, cz + hd)) for (px, py) in pts]
    n = len(pts)
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([bot[i], bot[j], top[j], top[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def apply_bevel(obj, width=0.024, segs=3, split_deg=40.0):
    bpy.context.view_layer.objects.active = obj
    if width > 0 and segs > 0:
        bev = obj.modifiers.new(name="Bevel", type="BEVEL")
        bev.width = width
        bev.segments = segs
        bev.limit_method = "ANGLE"
        bev.angle_limit = math.radians(32.0)
        bev.miter_outer = "MITER_ARC"
    for poly in obj.data.polygons:
        poly.use_smooth = True
    es = obj.modifiers.new(name="EdgeSplit", type="EDGE_SPLIT")
    es.use_edge_angle = True
    es.split_angle = math.radians(split_deg)
    return obj


def _bisect_solid(bm_chunk, plane_co, plane_no):
    out = []
    for sign in (1.0, -1.0):
        c = bm_chunk.copy()
        geom = c.verts[:] + c.edges[:] + c.faces[:]
        res = bmesh.ops.bisect_plane(
            c, geom=geom, dist=1e-5, plane_co=plane_co,
            plane_no=(plane_no[0] * sign, plane_no[1] * sign, plane_no[2] * sign),
            clear_outer=True, clear_inner=False,
        )
        cuts = [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
        if cuts:
            bmesh.ops.holes_fill(c, edges=cuts, sides=0)
        bmesh.ops.recalc_face_normals(c, faces=c.faces)
        if len(c.verts) < 4 or len(c.faces) < 4:
            c.free()
            for prev in out:
                prev.free()
            return None
        out.append(c)
    bm_chunk.free()
    return out


def fracture_solid(bm_initial, count=24, seed=42, bevel_width=0.008):
    """Deterministically fracture a closed bmesh into `count` solid local-origin shards with centroids."""
    rng = random.Random(seed)
    chunks = [bm_initial]
    attempts = 0
    while len(chunks) < count and attempts < count * 6:
        attempts += 1
        chunks.sort(
            key=lambda b: (max(v.co.x for v in b.verts) - min(v.co.x for v in b.verts))
            * (max(v.co.y for v in b.verts) - min(v.co.y for v in b.verts)),
            reverse=True,
        )
        victim = chunks[0]
        cx = sum(v.co.x for v in victim.verts) / len(victim.verts) + rng.uniform(-0.1, 0.1)
        cy = sum(v.co.y for v in victim.verts) / len(victim.verts) + rng.uniform(-0.15, 0.15)
        cz = sum(v.co.z for v in victim.verts) / len(victim.verts)
        ang = rng.uniform(0.0, math.pi * 2.0)
        no = Vector((math.cos(ang), math.sin(ang), rng.uniform(-0.35, 0.35))).normalized()
        split = _bisect_solid(victim, (cx, cy, cz), no)
        if split:
            chunks.pop(0)
            chunks.extend(split)

    shards = []
    for idx, ch in enumerate(chunks):
        centroid = sum((v.co.copy() for v in ch.verts), Vector((0.0, 0.0, 0.0))) / len(ch.verts)
        for v in ch.verts:
            v.co -= centroid
        obj = new_mesh_obj(f"shard_{idx}", ch)
        if bevel_width > 0:
            apply_bevel(obj, width=bevel_width, segs=2, split_deg=42.0)
        spec = pack_object(obj)
        spec["centroid"] = [round(centroid.x, 5), round(centroid.y, 5), round(centroid.z, 5)]
        shards.append(spec)
    return shards


def pack_object(obj, uv_bounds=None):
    """Evaluate modifiers, triangulate with corner normals, and return base64 typed-array spec."""
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    mesh = ev.to_mesh()
    mesh.calc_loop_triangles()

    xs = [v.co.x for v in mesh.vertices] or [-1.0, 1.0]
    ys = [v.co.y for v in mesh.vertices] or [-1.0, 1.0]
    min_x, max_x, min_y, max_y = uv_bounds if uv_bounds else (min(xs), max(xs), min(ys), max(ys))
    span_x, span_y = max(max_x - min_x, 1e-5), max(max_y - min_y, 1e-5)
    c_normals = mesh.corner_normals

    vert_map, positions, normals, uvs, indices = {}, [], [], [], []
    for tri in mesh.loop_triangles:
        for loop_idx in tri.loops:
            co = mesh.vertices[mesh.loops[loop_idx].vertex_index].co
            no = c_normals[loop_idx].vector
            key = (round(co.x, 5), round(co.y, 5), round(co.z, 5), round(no.x, 4), round(no.y, 4), round(no.z, 4))
            out_idx = vert_map.get(key)
            if out_idx is None:
                out_idx = len(positions) // 3
                vert_map[key] = out_idx
                positions.extend((co.x, co.y, co.z))
                normals.extend((no.x, no.y, no.z))
                uvs.extend(((co.x - min_x) / span_x, (co.y - min_y) / span_y))
            indices.append(out_idx)
    ev.to_mesh_clear()

    v_count = len(positions) // 3
    idx_fmt, idx_type = ("I", "u32") if v_count > 65535 else ("H", "u16")
    return {
        "vertexCount": v_count,
        "triCount": len(indices) // 3,
        "indexType": idx_type,
        "positions": base64.b64encode(struct.pack(f"<{len(positions)}f", *positions)).decode("ascii"),
        "normals": base64.b64encode(struct.pack(f"<{len(normals)}f", *normals)).decode("ascii"),
        "uvs": base64.b64encode(struct.pack(f"<{len(uvs)}f", *uvs)).decode("ascii"),
        "indices": base64.b64encode(struct.pack(f"<{len(indices)}{idx_fmt}", *indices)).decode("ascii"),
    }


def write_studio_assets(assets_dict, out_js_path, namespace=None):
    """Write synchronous window.STUDIO_ASSETS assignment so HyperFrames loads meshes with zero async lag."""
    os.makedirs(os.path.dirname(os.path.abspath(out_js_path)), exist_ok=True)
    payload = json.dumps(assets_dict, separators=(",", ":"))
    if namespace:
        js = f"window.STUDIO_ASSETS=window.STUDIO_ASSETS||{{}};window.STUDIO_ASSETS[{json.dumps(namespace)}]={payload};\n"
    else:
        js = f"window.STUDIO_ASSETS=Object.assign(window.STUDIO_ASSETS||{{}},{payload});\n"
    with open(out_js_path, "w", encoding="utf-8") as fh:
        fh.write(js)
    print(f"Exported {len(assets_dict)} Blender assets -> {out_js_path}")
