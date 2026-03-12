extends Node2D
## Visual representation of an NPC — isometric character with idle animation.

const SpeechBubbleScript := preload("res://scripts/speech_bubble.gd")

@export var npc_id: String = ""
@export var npc_name: String = ""
@export var npc_role: String = ""
@export var npc_color: Color = Color.WHITE

var _label: Label
var _bob_time: float = 0.0
var _bob_offset: float = 0.0  # randomize per NPC
var _highlight := false

# NPC data from backend
var mood: float = 0.0
var alive: bool = true
var current_activity: String = ""


func _ready() -> void:
	_bob_offset = randf() * TAU  # desync bob animation

	# Name label above head
	_label = Label.new()
	_label.text = npc_name
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.position = Vector2(-40, -58)
	_label.size = Vector2(80, 20)
	_label.add_theme_font_size_override("font_size", 11)
	_label.add_theme_color_override("font_color", Color.WHITE)
	_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.9))
	_label.add_theme_constant_override("shadow_offset_x", 1)
	_label.add_theme_constant_override("shadow_offset_y", 1)
	add_child(_label)
	queue_redraw()


func _process(delta: float) -> void:
	if not alive:
		return
	_bob_time += delta
	var bob := sin(_bob_time * 2.0 + _bob_offset) * 1.5
	# Only redraw if bob changed significantly
	queue_redraw()


func _draw() -> void:
	var bob := sin(_bob_time * 2.0 + _bob_offset) * 1.5 if alive else 0.0

	if not alive:
		# Dead — body on ground
		_draw_ellipse(Vector2(0, 2), 14, 6, Color(0.3, 0.1, 0.1, 0.5))
		draw_line(Vector2(-8, -2), Vector2(8, 2), Color.RED, 2.5)
		draw_line(Vector2(8, -2), Vector2(-8, 2), Color.RED, 2.5)
		return

	# Highlight ring when player is nearby
	if _highlight:
		_draw_ellipse(Vector2(0, 4), 18, 9, Color(1, 0.85, 0.3, 0.2))

	# Shadow on ground
	_draw_ellipse(Vector2(2, 4), 10, 5, Color(0, 0, 0, 0.3))

	# Legs
	var body_dark := Color(npc_color.r * 0.5, npc_color.g * 0.5, npc_color.b * 0.5)
	draw_colored_polygon(PackedVector2Array([
		Vector2(-5, 2 + bob), Vector2(5, 2 + bob),
		Vector2(4, -10 + bob), Vector2(-4, -10 + bob)
	]), body_dark)

	# Torso
	draw_colored_polygon(PackedVector2Array([
		Vector2(-7, -10 + bob), Vector2(7, -10 + bob),
		Vector2(6, -28 + bob), Vector2(-6, -28 + bob)
	]), npc_color)

	# Arms (slight offset for idle feel)
	var arm_swing := sin(_bob_time * 2.0 + _bob_offset + 1.0) * 2.0
	draw_line(Vector2(-7, -22 + bob), Vector2(-11, -12 + bob + arm_swing), body_dark, 3.0)
	draw_line(Vector2(7, -22 + bob), Vector2(11, -12 + bob - arm_swing), body_dark, 3.0)

	# Head
	draw_circle(Vector2(0, -34 + bob), 7, Color(0.85, 0.72, 0.6))
	# Hair/hat
	draw_arc(Vector2(0, -34 + bob), 7, PI * 0.8, PI * 2.2, 12, npc_color, 3.0)

	# Mood dot
	var mood_color := Color(0.3, 0.8, 0.3) if mood > 0.2 else (Color(0.8, 0.8, 0.3) if mood > -0.2 else Color(0.8, 0.3, 0.3))
	draw_circle(Vector2(9, -40 + bob), 3, mood_color)

	# Update label position with bob
	if _label:
		_label.position.y = -58 + bob


func _draw_ellipse(center: Vector2, rx: float, ry: float, color: Color) -> void:
	var points := PackedVector2Array()
	for i: int in range(16):
		var angle := TAU * i / 16.0
		points.append(center + Vector2(cos(angle) * rx, sin(angle) * ry))
	draw_colored_polygon(points, color)


func update_from_data(data: Dictionary) -> void:
	mood = data.get("mood", 0.0)
	alive = data.get("alive", true)
	current_activity = data.get("currentActivity", "")
	if _label:
		_label.modulate.a = 1.0 if alive else 0.4
	queue_redraw()


func set_highlight(on: bool) -> void:
	_highlight = on


func show_bubble(text: String) -> void:
	# Remove old bubble if exists
	for child: Node in get_children():
		if child.has_method("setup"):
			child.queue_free()
	var bubble := Node2D.new()
	bubble.set_script(SpeechBubbleScript)
	add_child(bubble)
	bubble.setup(text)
