# Runs inside Blender (background mode): executes Python code against the opened file (or a new,
# empty one) and optionally saves it.
# Usage: blender -b [file.blend] --python run.py -- request.json
import contextlib
import io
import json
import sys
import traceback

import bpy

request_path = sys.argv[sys.argv.index("--") + 1]
with open(request_path, encoding="utf-8") as file:
    request = json.load(file)

if request["new_file"]:
    bpy.ops.wm.read_factory_settings(use_empty=True)

MAX_OUTPUT = 20000
output = io.StringIO()
result = {"error": None, "saved": False}

try:
    with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
        exec(compile(request["code"], "<code>", "exec"), {"__name__": "__main__", "bpy": bpy})
except BaseException as error:  # noqa: BLE001 - report SystemExit too instead of silently skipping the save
    # Skip this script's own frame so the traceback starts in the submitted code.
    frames = error.__traceback__.tb_next if error.__traceback__ else None
    result["error"] = "".join(traceback.format_exception(type(error), error, frames))

if result["error"] is None and request["save"]:
    try:
        bpy.ops.wm.save_as_mainfile(filepath=request["file"])
        result["saved"] = True
    except Exception:  # noqa: BLE001
        result["error"] = traceback.format_exc()

text = output.getvalue()
result["output"] = text if len(text) <= MAX_OUTPUT else "…(truncated)\n" + text[-MAX_OUTPUT:]

with open(request["result"], "w", encoding="utf-8") as file:
    json.dump(result, file, ensure_ascii=False)
