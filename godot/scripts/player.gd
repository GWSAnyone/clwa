extends Node2D
## Player character — WASD movement with 3D KayKit model.

signal interact_requested(npc_id: String)
signal investigate_requested(location_id: String)

const SPEED := 300.0
const SPRINT_SPEED := 550.0
const SPRITE_SCALE := 0.45
const PLAYER_MODEL := "Knight.glb"

var _char_view: CharacterViewport
var _label: Label
var _nearby_npc: String = ""
var _nearby_crime_scene: String = ""
var _is_moving := false
var movement_locked := false


func _ready() -> void:
	z_index = 10

	# 3D character viewport
	_char_view = CharacterViewport.new()
	add_child(_char_view)
	_char_view.setup(PLAYER_MODEL)
	# Slight blue tint to distinguish from NPCs
	_char_view.set_modulate_color(Color(0.85, 0.9, 1.0))

	# "You" label
	_label = Label.new()
	_label.text = "You"
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.position = Vector2(-30, -62)
	_label.size = Vector2(60, 20)
	_label.add_theme_font_size_override("font_size", 12)
	_label.add_theme_color_override("font_color", Color(1, 0.85, 0.3))
	_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.9))
	_label.add_theme_constant_override("shadow_offset_x", 1)
	_label.add_theme_constant_override("shadow_offset_y", 1)
	add_child(_label)


func _process(delta: float) -> void:
	_is_moving = false

	if not movement_locked:
		var dir := Vector2.ZERO
		if Input.is_action_pressed("ui_up") or Input.is_key_pressed(KEY_W):
			dir.y -= 1
		if Input.is_action_pressed("ui_down") or Input.is_key_pressed(KEY_S):
			dir.y += 1
		if Input.is_action_pressed("ui_left") or Input.is_key_pressed(KEY_A):
			dir.x -= 1
		if Input.is_action_pressed("ui_right") or Input.is_key_pressed(KEY_D):
			dir.x += 1

		if dir != Vector2.ZERO:
			dir = dir.normalized()
			var sprinting := Input.is_key_pressed(KEY_SHIFT)
			var spd := SPRINT_SPEED if sprinting else SPEED
			# Squish vertical for isometric feel (tiles are ~2:1 ratio)
			position += Vector2(dir.x, dir.y * 0.5) * spd * delta
			_is_moving = true
			_char_view.face_direction(Vector2(dir.x, dir.y * 0.5))
			if sprinting:
				_char_view.play_animation("Run")
				_char_view.set_anim_speed(1.2)
			else:
				_char_view.play_animation("Walk")
				_char_view.set_anim_speed(1.4)
		else:
			_char_view.stop_animation()

	queue_redraw()


func _unhandled_key_input(event: InputEvent) -> void:
	if movement_locked:
		return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_E or event.keycode == KEY_ENTER:
			if _nearby_npc != "":
				interact_requested.emit(_nearby_npc)
			elif _nearby_crime_scene != "":
				investigate_requested.emit(_nearby_crime_scene)


func _draw() -> void:
	# Interact hints
	if _nearby_npc != "" and not movement_locked:
		draw_string(ThemeDB.fallback_font, Vector2(-20, 10), "[E] Talk", HORIZONTAL_ALIGNMENT_CENTER, 40, 11, Color(1, 0.85, 0.3, 0.9))
	elif _nearby_crime_scene != "" and not movement_locked:
		draw_string(ThemeDB.fallback_font, Vector2(-35, 10), "[E] Investigate", HORIZONTAL_ALIGNMENT_CENTER, 70, 11, Color(0.9, 0.35, 0.3, 0.9))


func set_nearby_npc(npc_id: String) -> void:
	if npc_id != _nearby_npc:
		_nearby_npc = npc_id
		queue_redraw()


func set_nearby_crime_scene(location_id: String) -> void:
	if location_id != _nearby_crime_scene:
		_nearby_crime_scene = location_id
		queue_redraw()
