# Runs inside Blender (background mode) and exports the opened .blend to GLB.
# Usage: blender -b file.blend --python-expr <this script> -- output.glb
import sys

import bpy

output = sys.argv[sys.argv.index("--") + 1]

if not bpy.data.filepath:
    raise RuntimeError("Blender could not open the file")

export = bpy.ops.export_scene.gltf
# Exporter options change between Blender versions, so only pass the ones this version knows.
available = set(export.get_rna_type().properties.keys())
options = {
    "filepath": output,
    "export_format": "GLB",
    "export_apply": True,
    "use_visible": True,
    "export_cameras": False,
    "export_lights": False,
    "export_animations": False,
    "export_extras": False,
}
result = export(**{key: value for key, value in options.items() if key in available})
if "FINISHED" not in result:
    raise RuntimeError(f"glTF export failed: {result}")
