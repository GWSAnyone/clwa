"""
CLWA Visual Overhaul — Blender Render Passes Script
====================================================
Renders isometric passes from a block-in scene for the AI paintover pipeline.

Usage:
  1. Open your block-in .blend file in Blender
  2. Open this script in Blender's Text Editor (or Scripting workspace)
  3. Click "Run Script"
  4. Outputs saved to //renders/ folder next to the .blend file

Outputs:
  - color.png      — Shaded render (img2img input for SD)
  - depth.png      — Depth pass (ControlNet Depth input)
  - normal.png     — Normal pass (optional, for ControlNet Normal)
  - ao.png         — Ambient Occlusion (optional reference)
  - occlusion_mask.png — Objects tagged as occluders (white on black)
  - walkable_mask.png  — Floor surfaces only, top-down (white on black)

Configuration:
  Change SETTINGS below to adjust resolution, camera angle, output path.
"""

import bpy
import os
import math
from pathlib import Path

# ============================================================
# SETTINGS — adjust these
# ============================================================

SETTINGS = {
    # Output resolution (for the full scene render)
    "resolution_x": 8192,
    "resolution_y": 6144,

    # Isometric camera angle (degrees from horizontal)
    # 35 = DE-like, shows more walls. 45 = classic isometric. 60 = more top-down.
    "camera_angle_deg": 35,

    # Camera rotation around Z axis (degrees). 45 = classic diamond isometric.
    "camera_rotation_deg": 45,

    # Orthographic scale — controls how much of the scene is visible.
    # Increase if your scene is cut off. For a 12x8m tavern, 14-16 works well.
    "ortho_scale": 15,

    # Output directory (relative to .blend file)
    "output_dir": "//renders",

    # Render engine: 'EEVEE' (fast) or 'CYCLES' (better quality, slower)
    "engine": "EEVEE",

    # Samples (for EEVEE: 64 is fine. For Cycles: 128-256)
    "samples": 64,

    # Collection names for special masks.
    # Tag objects in Blender by moving them to these collections:
    #   "Occluders" — objects that should hide the player (bar counter, pillars, walls)
    #   "Walkable"  — floor surfaces
    # If collections don't exist, mask passes are skipped.
    "occluder_collection": "Occluders",
    "walkable_collection": "Walkable",
}

# ============================================================
# IMPLEMENTATION — don't edit below unless you know what you do
# ============================================================


def setup_output_dir():
    """Create output directory next to .blend file."""
    blend_path = bpy.data.filepath
    if not blend_path:
        # File not saved — use temp
        out = os.path.join(os.path.expanduser("~"), "clwa_renders")
    else:
        out = bpy.path.abspath(SETTINGS["output_dir"])
    os.makedirs(out, exist_ok=True)
    return out


def setup_camera():
    """Create or reuse an orthographic isometric camera."""
    cam_name = "CLWA_Isometric_Camera"

    # Remove old camera if exists
    if cam_name in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[cam_name], do_unlink=True)

    # Create camera data
    cam_data = bpy.data.cameras.new(cam_name)
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = SETTINGS["ortho_scale"]
    cam_data.clip_start = 0.1
    cam_data.clip_end = 500

    # Create camera object
    cam_obj = bpy.data.objects.new(cam_name, cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)

    # Position camera for isometric view
    angle_rad = math.radians(SETTINGS["camera_angle_deg"])
    rot_rad = math.radians(SETTINGS["camera_rotation_deg"])
    distance = 50  # Far enough for ortho (doesn't affect ortho size)

    cam_obj.location = (
        distance * math.cos(angle_rad) * math.cos(rot_rad),
        distance * math.cos(angle_rad) * math.sin(rot_rad),
        distance * math.sin(angle_rad),
    )

    # Point camera at origin (center of scene)
    cam_obj.rotation_euler = (
        math.radians(90) - angle_rad,  # Tilt
        0,
        rot_rad + math.radians(90),    # Rotation
    )

    # Use track-to constraint for precise aiming
    constraint = cam_obj.constraints.new(type='TRACK_TO')
    # Create empty at scene center as target
    target_name = "CLWA_Camera_Target"
    if target_name in bpy.data.objects:
        target = bpy.data.objects[target_name]
    else:
        target = bpy.data.objects.new(target_name, None)
        bpy.context.scene.collection.objects.link(target)
    target.location = (0, 0, 0)
    constraint.target = target
    constraint.track_axis = 'TRACK_NEGATIVE_Z'
    constraint.up_axis = 'UP_Y'

    # Set as active camera
    bpy.context.scene.camera = cam_obj

    return cam_obj


def setup_render_settings():
    """Configure render settings."""
    scene = bpy.context.scene

    scene.render.resolution_x = SETTINGS["resolution_x"]
    scene.render.resolution_y = SETTINGS["resolution_y"]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_depth = '16'
    scene.render.film_transparent = False

    if SETTINGS["engine"] == "CYCLES":
        scene.render.engine = 'CYCLES'
        scene.cycles.samples = SETTINGS["samples"]
        scene.cycles.device = 'GPU'
    else:
        scene.render.engine = 'BLENDER_EEVEE_NEXT'
        scene.eevee.taa_render_samples = SETTINGS["samples"]


def render_color(output_dir):
    """Render the standard shaded color pass."""
    print("Rendering: color pass...")
    scene = bpy.context.scene
    scene.render.filepath = os.path.join(output_dir, "color.png")
    scene.render.film_transparent = False

    # Enable all collections
    for layer_col in bpy.context.view_layer.layer_collection.children:
        layer_col.exclude = False

    bpy.ops.render.render(write_still=True)
    print(f"  Saved: {scene.render.filepath}")


def render_depth(output_dir):
    """Render depth pass using compositor."""
    print("Rendering: depth pass...")
    scene = bpy.context.scene

    # Enable Z pass
    bpy.context.view_layer.use_pass_z = True

    # Setup compositor for depth output
    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()

    # Render layers node
    rl_node = tree.nodes.new('CompositorNodeRLayers')

    # Normalize depth
    normalize = tree.nodes.new('CompositorNodeNormalize')
    tree.links.new(rl_node.outputs['Depth'], normalize.inputs[0])

    # Invert (close = white, far = black — standard for ControlNet)
    invert = tree.nodes.new('CompositorNodeInvert')
    tree.links.new(normalize.outputs[0], invert.inputs['Color'])

    # Output
    output = tree.nodes.new('CompositorNodeOutputFile')
    output.base_path = output_dir
    output.file_slots[0].path = "depth"
    output.format.file_format = 'PNG'
    output.format.color_depth = '16'
    output.format.color_mode = 'BW'
    tree.links.new(invert.outputs[0], output.inputs[0])

    # Also need composite output for render to work
    composite = tree.nodes.new('CompositorNodeComposite')
    tree.links.new(rl_node.outputs['Image'], composite.inputs[0])

    scene.render.filepath = os.path.join(output_dir, "_temp_depth")
    bpy.ops.render.render(write_still=False)

    # Clean up compositor
    tree.nodes.clear()
    scene.use_nodes = False

    print(f"  Saved: {output_dir}/depth*.png")


def render_normal(output_dir):
    """Render normal pass."""
    print("Rendering: normal pass...")
    scene = bpy.context.scene

    bpy.context.view_layer.use_pass_normal = True

    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()

    rl_node = tree.nodes.new('CompositorNodeRLayers')

    # Normals are in -1..1 range, map to 0..1 for image
    map_range = tree.nodes.new('CompositorNodeMapRange')
    map_range.inputs['From Min'].default_value = -1.0
    map_range.inputs['From Max'].default_value = 1.0
    map_range.inputs['To Min'].default_value = 0.0
    map_range.inputs['To Max'].default_value = 1.0
    tree.links.new(rl_node.outputs['Normal'], map_range.inputs[0])

    output = tree.nodes.new('CompositorNodeOutputFile')
    output.base_path = output_dir
    output.file_slots[0].path = "normal"
    output.format.file_format = 'PNG'
    output.format.color_depth = '16'
    tree.links.new(map_range.outputs[0], output.inputs[0])

    composite = tree.nodes.new('CompositorNodeComposite')
    tree.links.new(rl_node.outputs['Image'], composite.inputs[0])

    scene.render.filepath = os.path.join(output_dir, "_temp_normal")
    bpy.ops.render.render(write_still=False)

    tree.nodes.clear()
    scene.use_nodes = False

    print(f"  Saved: {output_dir}/normal*.png")


def render_mask(output_dir, collection_name, filename):
    """Render a mask: only objects in the given collection, white on black."""
    if collection_name not in bpy.data.collections:
        print(f"  Skipping {filename}: collection '{collection_name}' not found")
        return

    print(f"Rendering: {filename}...")
    scene = bpy.context.scene

    # Store original visibility
    original_visibility = {}
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            original_visibility[obj.name] = obj.hide_render

    # Hide everything
    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            obj.hide_render = True

    # Show only target collection objects
    target_collection = bpy.data.collections[collection_name]
    for obj in target_collection.objects:
        if obj.type == 'MESH':
            obj.hide_render = False

    # Override materials to white emission
    override_mat = bpy.data.materials.new(name="_CLWA_Mask_White")
    override_mat.use_nodes = True
    nodes = override_mat.node_tree.nodes
    nodes.clear()
    emission = nodes.new('ShaderNodeEmission')
    emission.inputs['Color'].default_value = (1, 1, 1, 1)
    emission.inputs['Strength'].default_value = 1.0
    output_node = nodes.new('ShaderNodeOutputMaterial')
    override_mat.node_tree.links.new(emission.outputs[0], output_node.inputs[0])

    # Store and replace materials
    original_materials = {}
    for obj in target_collection.objects:
        if obj.type == 'MESH':
            original_materials[obj.name] = list(obj.data.materials)
            obj.data.materials.clear()
            obj.data.materials.append(override_mat)

    # Black background
    scene.render.film_transparent = False
    old_world = scene.world
    black_world = bpy.data.worlds.new("_CLWA_Black")
    black_world.use_nodes = True
    bg_node = black_world.node_tree.nodes.get("Background")
    if bg_node:
        bg_node.inputs['Color'].default_value = (0, 0, 0, 1)
        bg_node.inputs['Strength'].default_value = 1.0
    scene.world = black_world

    # Render
    scene.render.filepath = os.path.join(output_dir, filename + ".png")
    bpy.ops.render.render(write_still=True)

    # Restore everything
    scene.world = old_world
    bpy.data.worlds.remove(black_world)

    for obj_name, mats in original_materials.items():
        obj = bpy.data.objects[obj_name]
        obj.data.materials.clear()
        for mat in mats:
            obj.data.materials.append(mat)

    for obj_name, hidden in original_visibility.items():
        if obj_name in bpy.data.objects:
            bpy.data.objects[obj_name].hide_render = hidden

    bpy.data.materials.remove(override_mat)

    print(f"  Saved: {scene.render.filepath}")


def main():
    print("\n" + "=" * 60)
    print("CLWA Visual Overhaul — Render Passes")
    print("=" * 60)

    output_dir = setup_output_dir()
    print(f"Output directory: {output_dir}")

    setup_camera()
    print("Camera set up: orthographic isometric")

    setup_render_settings()
    print(f"Engine: {SETTINGS['engine']}, Resolution: {SETTINGS['resolution_x']}x{SETTINGS['resolution_y']}")

    # Render passes
    render_color(output_dir)
    render_depth(output_dir)
    render_normal(output_dir)

    # Render masks (if collections exist)
    render_mask(output_dir, SETTINGS["occluder_collection"], "occlusion_mask")
    render_mask(output_dir, SETTINGS["walkable_collection"], "walkable_mask")

    print("\n" + "=" * 60)
    print("DONE! All passes rendered.")
    print(f"Check: {output_dir}")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
