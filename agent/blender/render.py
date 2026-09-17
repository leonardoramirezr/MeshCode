# Runs inside Blender (background mode) and renders a quick Workbench preview of the opened file.
# The file itself is never saved.
# Usage: blender -b file.blend --python render.py -- request.json
import json
import math
import sys

import bpy
from mathutils import Vector

request_path = sys.argv[sys.argv.index("--") + 1]
with open(request_path, encoding="utf-8") as file:
    request = json.load(file)

scene = bpy.context.scene
render = scene.render
render.engine = "BLENDER_WORKBENCH"
render.resolution_x = request["width"]
render.resolution_y = request["height"]
render.resolution_percentage = 100
render.film_transparent = False
render.image_settings.file_format = "JPEG"
render.image_settings.quality = 85
render.filepath = request["output"]

shading = scene.display.shading
shading.light = "STUDIO"
shading.color_type = "MATERIAL"
shading.show_object_outline = True
if scene.world is None:
    # Workbench renders the world color as background, which is black without a world.
    scene.world = bpy.data.worlds.new("MeshCodePreview")
    scene.world.color = (0.2, 0.2, 0.2)

# Nudged off the vertical axis so the camera's up direction stays defined.
DIRECTIONS = {
    "front": (0, -1, 0),
    "back": (0, 1, 0),
    "left": (-1, 0, 0),
    "right": (1, 0, 0),
    "top": (0, -0.001, 1),
    "isometric": (1, -1, 0.8),
}
GEOMETRY_TYPES = {"MESH", "CURVE", "SURFACE", "META", "FONT", "VOLUME", "POINTCLOUD", "CURVES", "GREASEPENCIL"}


def add_camera(location, target, lens=None):
    data = bpy.data.cameras.new("MeshCodePreview")
    camera = bpy.data.objects.new("MeshCodePreview", data)
    scene.collection.objects.link(camera)
    camera.location = location
    camera.rotation_euler = (Vector(target) - Vector(location)).to_track_quat("-Z", "Y").to_euler()
    if lens:
        data.lens = lens
    scene.camera = camera
    return camera


def field_of_view(data):
    """The camera's horizontal and vertical field of view, in radians, as this render frames it."""
    width, height = render.resolution_x, render.resolution_y
    fit = data.sensor_fit
    if fit == "AUTO":
        # The lens angle spans the wider side of the image.
        fit = "HORIZONTAL" if width >= height else "VERTICAL"
    half = math.tan(data.angle / 2)
    if fit == "HORIZONTAL":
        return data.angle, 2 * math.atan(half * height / width)
    return 2 * math.atan(half * width / height), data.angle


def write_camera(path):
    """Reports the camera used, so MeshCode's viewer can show the user the same framing.

    The location and rotation are in Blender's world space; the viewer is always perspective, so an
    orthographic scene camera is approximated by its lens.
    """
    # Evaluated, so the placement of a camera just added counts, as do parents and constraints.
    camera = scene.camera.evaluated_get(bpy.context.evaluated_depsgraph_get())
    location, rotation, _ = camera.matrix_world.decompose()
    fov_x, fov_y = field_of_view(camera.data)
    with open(path, "w", encoding="utf-8") as file:
        # The quaternion goes in x, y, z, w order, as three.js takes it.
        json.dump(
            {
                "location": list(location),
                "rotation": [rotation.x, rotation.y, rotation.z, rotation.w],
                "fovX": fov_x,
                "fovY": fov_y,
            },
            file,
        )


def frame_objects(direction, names):
    focus = set(names or [])
    points = []
    for obj in scene.objects:
        if focus and obj.name not in focus:
            continue
        if obj.type not in GEOMETRY_TYPES or obj.hide_render or not obj.visible_get():
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    missing = focus - {obj.name for obj in scene.objects}
    if missing:
        raise ValueError(f"Objects not found: {', '.join(sorted(missing))}")
    if not points:
        points = [Vector((0, 0, 0))]

    center = sum(points, Vector()) / len(points)
    radius = max(max((point - center).length for point in points), 0.5)
    direction = Vector(direction).normalized()
    rotation = (-direction).to_track_quat("-Z", "Y")
    right, up = rotation @ Vector((1, 0, 0)), rotation @ Vector((0, 1, 0))

    camera = add_camera(center + direction, center)
    data = camera.data
    data.clip_start = radius * 0.001
    data.clip_end = radius * 100
    half_x, half_y = (math.tan(angle / 2) for angle in field_of_view(data))
    # Back away until every bounding box corner projects inside the frame.
    distance = max(
        (point - center).dot(direction) + max(abs((point - center).dot(right)) / half_x, abs((point - center).dot(up)) / half_y)
        for point in points
    )
    camera.location = center + direction * max(distance * 1.08, data.clip_start * 10)


custom = request.get("camera")
if custom:
    add_camera(custom["location"], custom["look_at"], custom.get("lens"))
elif request["view"] != "camera" or scene.camera is None:
    frame_objects(DIRECTIONS.get(request["view"], DIRECTIONS["isometric"]), request.get("focus"))

if request.get("camera_out"):
    write_camera(request["camera_out"])

bpy.ops.render.render(write_still=True)
