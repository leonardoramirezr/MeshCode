# Runs inside Blender (background mode) and writes a JSON summary of the opened .blend.
# Usage: blender -b file.blend --python inspect.py -- request.json
import json
import math
import sys

import bpy

request_path = sys.argv[sys.argv.index("--") + 1]
with open(request_path, encoding="utf-8") as file:
    request = json.load(file)

MAX_OBJECTS = request.get("max_objects", 400)


def rounded(values, digits=4):
    return [round(value, digits) for value in values]


def custom_properties(datablock):
    return {key: str(datablock[key]) for key in datablock.keys() if not key.startswith("_")}


def object_info(obj):
    info = {
        "name": obj.name,
        "type": obj.type,
        "parent": obj.parent.name if obj.parent else None,
        "collections": [collection.name for collection in obj.users_collection],
        "location": rounded(obj.location),
        "rotation_mode": obj.rotation_mode,
        "rotation_euler_degrees": rounded((math.degrees(angle) for angle in obj.rotation_euler), 2),
        "scale": rounded(obj.scale),
        "dimensions": rounded(obj.dimensions),
        "hide_viewport": obj.hide_viewport,
        "hide_render": obj.hide_render,
    }
    if obj.data is not None:
        info["data"] = obj.data.name
    if obj.modifiers:
        info["modifiers"] = [{"name": modifier.name, "type": modifier.type} for modifier in obj.modifiers]
    if obj.material_slots:
        info["materials"] = [slot.material.name if slot.material else None for slot in obj.material_slots]
    if obj.type == "MESH":
        mesh = obj.data
        info["mesh"] = {"vertices": len(mesh.vertices), "faces": len(mesh.polygons)}
    elif obj.type == "LIGHT":
        light = obj.data
        info["light"] = {"type": light.type, "energy": light.energy, "color": rounded(light.color, 3)}
    elif obj.type == "CAMERA":
        camera = obj.data
        info["camera"] = {"type": camera.type, "lens_mm": round(camera.lens, 2)}
    properties = custom_properties(obj)
    if properties:
        info["custom_properties"] = properties
    return info


def collection_tree(collection):
    return {
        "name": collection.name,
        "objects": len(collection.objects),
        "children": [collection_tree(child) for child in collection.children],
    }


def material_info(material):
    info = {"name": material.name, "users": material.users}
    principled = None
    if material.node_tree:
        principled = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    if principled:
        for key, socket in (("base_color", "Base Color"), ("metallic", "Metallic"), ("roughness", "Roughness")):
            value = principled.inputs[socket]
            if value.is_linked:
                info[key] = "linked"
            elif key == "base_color":
                info[key] = rounded(value.default_value, 3)
            else:
                info[key] = round(value.default_value, 3)
    else:
        info["diffuse_color"] = rounded(material.diffuse_color, 3)
    return info


scenes = []
for scene in bpy.data.scenes:
    objects = list(scene.objects)
    scenes.append(
        {
            "name": scene.name,
            "active_camera": scene.camera.name if scene.camera else None,
            "frame_range": [scene.frame_start, scene.frame_end],
            "fps": scene.render.fps,
            "render_engine": scene.render.engine,
            "unit_system": scene.unit_settings.system,
            "unit_scale": scene.unit_settings.scale_length,
            "world": scene.world.name if scene.world else None,
            "collections": collection_tree(scene.collection),
            "object_count": len(objects),
            "objects": [object_info(obj) for obj in objects[:MAX_OBJECTS]],
            "objects_truncated": len(objects) > MAX_OBJECTS,
        }
    )

summary = {
    "blender_version": bpy.app.version_string,
    "file": bpy.data.filepath,
    "scenes": scenes,
    "materials": [material_info(material) for material in bpy.data.materials],
    "images": [{"name": image.name, "filepath": image.filepath, "packed": image.packed_file is not None} for image in bpy.data.images],
    "node_groups": [group.name for group in bpy.data.node_groups],
    "actions": [action.name for action in bpy.data.actions],
}

with open(request["output"], "w", encoding="utf-8") as file:
    json.dump(summary, file, ensure_ascii=False)
