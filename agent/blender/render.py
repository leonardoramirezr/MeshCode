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
    # The camera angle spans the wider side of the image.
    width, height = render.resolution_x, render.resolution_y
    half_wide = math.tan(data.angle / 2)
    half_x = half_wide if width >= height else half_wide * width / height
    half_y = half_wide if height >= width else half_wide * height / width
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

bpy.ops.render.render(write_still=True)
