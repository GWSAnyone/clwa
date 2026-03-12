extends Node2D
## Player character — WASD movement, isometric style, idle animation.

signal interact_requested(npc_id: String)
signal investigate_requested(location_id: String)

const SPEED := 120.0

var _label: Label
var _nearby_npc: String = ""
var _nearby_crime_scene: String = ""  # location_id of nearby crime scene
var _bob_time: float = 0.0
var movement_locked := false  # set by main when dialog is open


func _ready() -> void:
	z_index = 1
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
	queue_redraw()


func _process(delta: float) -> void:
	_bob_time += delta

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
			position += dir * SPEED * delta

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
	var bob := sin(_bob_time * 2.5) * 1.5

	# Shadow
	_draw_ellipse(Vector2(2, 4), 12, 6, Color(0, 0, 0, 0.35))

	# Legs
	draw_colored_polygon(PackedVector2Array([
		Vector2(-6, 2 + bob), Vector2(6, 2 + bob),
		Vector2(5, -12 + bob), Vector2(-5, -12 + bob)
	]), Color(0.2, 0.2, 0.3))

	# Torso
	draw_colored_polygon(PackedVector2Array([
		Vector2(-7, -12 + bob), Vector2(7, -12 + bob),
		Vector2(6, -28 + bob), Vector2(-6, -28 + bob)
	]), Color(0.25, 0.45, 0.65))

	# Arms
	var arm_swing := sin(_bob_time * 2.5 + 1.0) * 2.0
	draw_line(Vector2(-7, -22 + bob), Vector2(-11, -12 + bob + arm_swing), Color(0.2, 0.35, 0.5), 3.0)
	draw_line(Vector2(7, -22 + bob), Vector2(11, -12 + bob - arm_swing), Color(0.2, 0.35, 0.5), 3.0)

	# Head
	draw_circle(Vector2(0, -34 + bob), 7, Color(0.88, 0.75, 0.62))

	# Interact hint
	if _nearby_npc != "" and not movement_locked:
		draw_string(ThemeDB.fallback_font, Vector2(-20, 20), "[E] Talk", HORIZONTAL_ALIGNMENT_CENTER, 40, 10, Color(1, 0.85, 0.3, 0.8))
	elif _nearby_crime_scene != "" and not movement_locked:
		draw_string(ThemeDB.fallback_font, Vector2(-30, 20), "[E] Investigate", HORIZONTAL_ALIGNMENT_CENTER, 60, 10, Color(0.9, 0.35, 0.3, 0.8))

	# Label bob
	if _label:
		_label.position.y = -62 + bob


func _draw_ellipse(center: Vector2, rx: float, ry: float, color: Color) -> void:
	var points := PackedVector2Array()
	for i: int in range(16):
		var angle := TAU * i / 16.0
		points.append(center + Vector2(cos(angle) * rx, sin(angle) * ry))
	draw_colored_polygon(points, color)


func set_nearby_npc(npc_id: String) -> void:
	if npc_id != _nearby_npc:
		_nearby_npc = npc_id
		queue_redraw()


func set_nearby_crime_scene(location_id: String) -> void:
	if location_id != _nearby_crime_scene:
		_nearby_crime_scene = location_id
		queue_redraw()
