class_name CharacterViewport
extends Node2D
## Renders a 3D KayKit character model inside a SubViewport, displayed as a 2D sprite.
## Isometric camera angle matches the tilemap. Shadow catcher plane for grounding.

const MODEL_BASE := "res://assets/kaykit/KayKit_Adventurers_2.0_FREE/Characters/gltf/"
const ANIM_BASE := "res://assets/kaykit/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium/"

const VIEWPORT_W := 500
const VIEWPORT_H := 666
const ROTATION_LERP := 10.0

# Camera: isometric angle matching 2:1 tilemap (~30° elevation)
const CAM_ORTHO_SIZE := 3.5
const CAM_POS := Vector3(0, 2.2, 2.2)
const CAM_ROT := Vector3(-30, 0, 0)

# Shadow catcher shader — invisible plane that only shows shadow
const SHADOW_SHADER_CODE := """
shader_type spatial;
render_mode blend_mix, cull_disabled, diffuse_lambert, specular_disabled;

void fragment() {
	ALBEDO = vec3(0.0);
	ALPHA = 0.001;
}

void light() {
	float shadow = 1.0 - ATTENUATION;
	DIFFUSE_LIGHT = vec3(0.0);
	ALPHA = max(ALPHA, shadow * 0.4);
}
"""

var _viewport: SubViewport
var _sprite: Sprite2D
var _model: Node3D
var _skeleton: Skeleton3D
var _anim_player: AnimationPlayer
var _target_rot_y := 0.0
var _current_anim := ""


func get_display_sprite() -> Sprite2D:
	return _sprite


func setup(model_file: String, sprite_scale: float = 0.3, offset_y: float = -96.0) -> void:
	# --- SubViewport (transparent, isolated 3D world) ---
	_viewport = SubViewport.new()
	_viewport.size = Vector2i(VIEWPORT_W, VIEWPORT_H)
	_viewport.transparent_bg = true
	_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_viewport.gui_disable_input = true
	_viewport.msaa_3d = Viewport.MSAA_DISABLED
	_viewport.world_3d = World3D.new()
	add_child(_viewport)

	# --- Environment ---
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0, 0, 0, 0)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.55, 0.5, 0.45)
	env.ambient_light_energy = 0.8
	var world_env := WorldEnvironment.new()
	world_env.environment = env
	_viewport.add_child(world_env)

	# --- Camera (isometric angle) ---
	var camera := Camera3D.new()
	camera.projection = Camera3D.PROJECTION_ORTHOGONAL
	camera.size = CAM_ORTHO_SIZE
	camera.position = CAM_POS
	camera.rotation_degrees = CAM_ROT
	_viewport.add_child(camera)

	# --- Lighting (with shadow for ground plane) ---
	var key_light := DirectionalLight3D.new()
	key_light.rotation_degrees = Vector3(-50, -30, 0)
	key_light.light_energy = 1.2
	key_light.shadow_enabled = true
	key_light.shadow_bias = 0.03
	_viewport.add_child(key_light)

	var fill_light := DirectionalLight3D.new()
	fill_light.rotation_degrees = Vector3(-20, 150, 0)
	fill_light.light_energy = 0.3
	fill_light.shadow_enabled = false
	_viewport.add_child(fill_light)

	# --- Shadow catcher ground plane ---
	var ground := MeshInstance3D.new()
	var plane_mesh := PlaneMesh.new()
	plane_mesh.size = Vector2(3, 3)
	ground.mesh = plane_mesh
	ground.position = Vector3(0, 0.001, 0)
	ground.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var shadow_shader := Shader.new()
	shadow_shader.code = SHADOW_SHADER_CODE
	var shadow_mat := ShaderMaterial.new()
	shadow_mat.shader = shadow_shader
	ground.material_override = shadow_mat
	_viewport.add_child(ground)

	# --- Load 3D model ---
	var path := MODEL_BASE + model_file
	var packed := load(path) as PackedScene
	if packed:
		_model = packed.instantiate() as Node3D
		_model.position = Vector3.ZERO
		_viewport.add_child(_model)
		_skeleton = _find_child_of_type(_model, "Skeleton3D") as Skeleton3D
	else:
		push_warning("[CharacterViewport] Failed to load model: " + path)

	# --- Load animations ---
	_load_animations("Rig_Medium_MovementBasic.glb")
	_load_animations("Rig_Medium_General.glb")

	# Set looping on movement animations
	if _anim_player:
		for anim_name: String in ["Idle_A", "Idle_B", "Walking_A", "Walking_B", "Walking_C", "Running_A", "Running_B"]:
			_set_loop(anim_name)

	# --- Display sprite ---
	_sprite = Sprite2D.new()
	_sprite.texture = _viewport.get_texture()
	_sprite.scale = Vector2(sprite_scale, sprite_scale)
	_sprite.offset = Vector2(0, offset_y)
	add_child(_sprite)

	play_animation("Idle")


func _set_loop(anim_name: String) -> void:
	if _anim_player and _anim_player.has_animation(anim_name):
		_anim_player.get_animation(anim_name).loop_mode = Animation.LOOP_LINEAR


func _load_animations(anim_file: String) -> void:
	if not _model or not _skeleton:
		return
	var packed := load(ANIM_BASE + anim_file) as PackedScene
	if not packed:
		return

	var anim_scene: Node3D = packed.instantiate() as Node3D
	if not anim_scene:
		return

	var source_player: AnimationPlayer = _find_child_of_type(anim_scene, "AnimationPlayer") as AnimationPlayer
	if not source_player:
		anim_scene.queue_free()
		return

	if not _anim_player:
		_anim_player = AnimationPlayer.new()
		_anim_player.name = "AnimationPlayer"
		_model.add_child(_anim_player)

	var target_lib: AnimationLibrary
	if _anim_player.has_animation_library(&""):
		target_lib = _anim_player.get_animation_library(&"")
	else:
		target_lib = AnimationLibrary.new()
		_anim_player.add_animation_library(&"", target_lib)

	for lib_name: StringName in source_player.get_animation_library_list():
		var lib: AnimationLibrary = source_player.get_animation_library(lib_name)
		for anim_name: StringName in lib.get_animation_list():
			if not target_lib.has_animation(anim_name):
				target_lib.add_animation(anim_name, lib.get_animation(anim_name).duplicate())

	anim_scene.queue_free()


func _find_child_of_type(node: Node, type_name: String) -> Node:
	if node.get_class() == type_name:
		return node
	for child: Node in node.get_children():
		var found := _find_child_of_type(child, type_name)
		if found:
			return found
	return null


func face_direction(dir: Vector2) -> void:
	if dir.length_squared() > 0.01:
		_target_rot_y = atan2(dir.x, dir.y)


const ANIM_MAP: Dictionary = {
	"Idle": "Idle_A",
	"Walk": "Walking_A",
	"Run": "Running_A",
	"Death": "Death_A",
	"Hit": "Hit_A",
	"Interact": "Interact",
	"Pickup": "PickUp",
}

func play_animation(anim_name: String) -> void:
	if not _anim_player:
		return
	if _current_anim == anim_name:
		return
	var resolved: String = ANIM_MAP.get(anim_name, anim_name)
	if _anim_player.has_animation(resolved):
		_anim_player.play(resolved, 0.3)
		_current_anim = anim_name
	elif _anim_player.has_animation(anim_name):
		_anim_player.play(anim_name, 0.3)
		_current_anim = anim_name


func set_anim_speed(spd_scale: float) -> void:
	if _anim_player:
		_anim_player.speed_scale = spd_scale


func stop_animation() -> void:
	play_animation("Idle")
	set_anim_speed(1.0)


func set_modulate_color(color: Color) -> void:
	if _sprite:
		_sprite.modulate = color


func set_alpha(alpha: float) -> void:
	if _sprite:
		_sprite.modulate.a = alpha


func _process(delta: float) -> void:
	if _model:
		_model.rotation.y = lerp_angle(_model.rotation.y, _target_rot_y, delta * ROTATION_LERP)
