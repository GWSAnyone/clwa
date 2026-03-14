extends Node2D
## Visual representation of an NPC — 3D KayKit model with idle/walk animations and status overlays.

const SpeechBubbleScript := preload("res://scripts/speech_bubble.gd")

# NPC -> KayKit model file mapping
const NPC_MODEL_MAP: Dictionary = {
	"ted": "Rogue.glb",
	"mark": "Mage.glb",
	"elara": "Rogue_Hooded.glb",
	"garrett": "Knight.glb",
	"aldric": "Mage.glb",
	"hilda": "Barbarian.glb",
	"bess": "Ranger.glb",
	"theron": "Knight.glb",
}

const SPRITE_SCALE := 0.45

@export var npc_id: String = ""
@export var npc_name: String = ""
@export var npc_role: String = ""
@export var npc_color: Color = Color.WHITE

var _char_view: CharacterViewport
var _label: Label
var _role_label: Label
var _highlight := false
var _is_moving := false

# NPC data from backend
var mood: float = 0.0
var alive: bool = true
var status: String = "free"
var current_activity: String = ""


func _ready() -> void:
	z_index = 10

	# 3D character viewport
	_char_view = CharacterViewport.new()
	add_child(_char_view)
	var model_file: String = NPC_MODEL_MAP.get(npc_id, "Rogue.glb")
	_char_view.setup(model_file)

	# Apply NPC color tint
	_char_view.set_modulate_color(Color(
		lerp(1.0, npc_color.r, 0.3),
		lerp(1.0, npc_color.g, 0.3),
		lerp(1.0, npc_color.b, 0.3),
	))

	# Name label
	_label = Label.new()
	_label.text = npc_name
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.position = Vector2(-50, -62)
	_label.size = Vector2(100, 20)
	_label.add_theme_font_size_override("font_size", 12)
	_label.add_theme_color_override("font_color", Color.WHITE)
	_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.9))
	_label.add_theme_constant_override("shadow_offset_x", 1)
	_label.add_theme_constant_override("shadow_offset_y", 1)
	add_child(_label)

	# Role label (smaller, below name)
	_role_label = Label.new()
	_role_label.text = npc_role
	_role_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_role_label.position = Vector2(-50, -50)
	_role_label.size = Vector2(100, 16)
	_role_label.add_theme_font_size_override("font_size", 9)
	_role_label.add_theme_color_override("font_color", Color(0.7, 0.65, 0.55))
	_role_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	_role_label.add_theme_constant_override("shadow_offset_x", 1)
	_role_label.add_theme_constant_override("shadow_offset_y", 1)
	add_child(_role_label)


func _process(_delta: float) -> void:
	if not alive or status == "exiled" or status == "fled":
		return
	queue_redraw()


func _draw() -> void:
	if not alive:
		# Dead body marker on ground
		_draw_ellipse(Vector2(0, 2), 16, 8, Color(0.4, 0.1, 0.1, 0.5))
		draw_line(Vector2(-10, -3), Vector2(10, 3), Color(0.9, 0.15, 0.1), 3.0)
		draw_line(Vector2(10, -3), Vector2(-10, 3), Color(0.9, 0.15, 0.1), 3.0)
		return

	if status == "exiled" or status == "fled":
		var gone_text := "EXILED" if status == "exiled" else "FLED"
		draw_string(ThemeDB.fallback_font, Vector2(-18, -50), gone_text, HORIZONTAL_ALIGNMENT_CENTER, 36, 9, Color(0.7, 0.3, 0.3, 0.6))
		return

	# Mood indicator
	var mood_color := Color(0.3, 0.85, 0.3) if mood > 0.2 else (Color(0.85, 0.85, 0.3) if mood > -0.2 else Color(0.85, 0.25, 0.25))
	draw_circle(Vector2(14, -36), 3, mood_color)
	draw_arc(Vector2(14, -36), 3, 0, TAU, 8, Color(0, 0, 0, 0.3), 0.7)

	# Detained overlay
	if status == "detained":
		var chain_col := Color(0.6, 0.5, 0.3, 0.8)
		draw_line(Vector2(-14, -25), Vector2(14, -25), chain_col, 2.5)
		for i: int in range(-12, 14, 3):
			draw_circle(Vector2(i, -25), 2.0, chain_col)
		draw_string(ThemeDB.fallback_font, Vector2(-24, -90), "DETAINED", HORIZONTAL_ALIGNMENT_CENTER, 48, 9, Color(0.9, 0.5, 0.2, 0.85))

	# Highlight ring
	if _highlight:
		_draw_ellipse(Vector2(0, -2), 22, 11, Color(1, 0.85, 0.3, 0.25))
		_draw_ellipse(Vector2(0, -2), 18, 9, Color(1, 0.85, 0.3, 0.12))


func _draw_ellipse(center: Vector2, rx: float, ry: float, color: Color) -> void:
	var points := PackedVector2Array()
	for i: int in range(20):
		var angle := TAU * i / 20.0
		points.append(center + Vector2(cos(angle) * rx, sin(angle) * ry))
	draw_colored_polygon(points, color)


func update_from_data(data: Dictionary) -> void:
	mood = data.get("mood", 0.0)
	alive = data.get("alive", true)
	status = data.get("status", "free")
	current_activity = data.get("currentActivity", "")

	if _char_view:
		if not alive:
			_char_view.visible = false
		elif status == "exiled" or status == "fled":
			_char_view.set_alpha(0.15)
		elif status == "detained":
			_char_view.set_alpha(0.7)
		else:
			# Re-apply color tint at full alpha
			_char_view.set_modulate_color(Color(
				lerp(1.0, npc_color.r, 0.3),
				lerp(1.0, npc_color.g, 0.3),
				lerp(1.0, npc_color.b, 0.3),
			))

	if _label:
		if not alive:
			_label.modulate.a = 0.4
		elif status == "exiled" or status == "fled":
			_label.modulate.a = 0.3
		elif status == "detained":
			_label.modulate.a = 0.7
		else:
			_label.modulate.a = 1.0

	if _role_label:
		_role_label.modulate.a = _label.modulate.a if _label else 1.0

	queue_redraw()


func set_highlight(on: bool) -> void:
	_highlight = on
	queue_redraw()


func start_moving(direction: Vector2) -> void:
	_is_moving = true
	if _char_view:
		_char_view.face_direction(direction)
		_char_view.play_animation("Walk")
		_char_view.set_anim_speed(1.4)


func stop_moving() -> void:
	_is_moving = false
	if _char_view:
		_char_view.stop_animation()


func face_toward(target_pos: Vector2) -> void:
	if _char_view:
		var dir := (target_pos - position).normalized()
		_char_view.face_direction(dir)


func show_bubble(text: String) -> void:
	# Remove old bubbles (but NOT CharacterViewport which also has "setup")
	for child: Node in get_children():
		if child is CharacterViewport:
			continue
		if child.has_method("setup"):
			child.queue_free()
	var bubble := Node2D.new()
	bubble.set_script(SpeechBubbleScript)
	add_child(bubble)
	bubble.setup(text)
