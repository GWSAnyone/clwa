extends Node2D
## Isometric building — colored cuboid with windows, door, and optional chimney.

@export var building_name: String = ""
@export var base_color: Color = Color(0.4, 0.4, 0.4)
@export var building_width: float = 80.0
@export var building_depth: float = 60.0
@export var building_height: float = 50.0
@export var has_chimney: bool = false
@export var has_sign: bool = false

var _label: Label
var _time: float = 0.0


func _ready() -> void:
	# Auto-detect features
	has_chimney = building_name in ["Silver Flagon Tavern", "Blacksmith"]
	has_sign = building_name in ["Silver Flagon Tavern", "Market Square", "Blacksmith"]

	_label = Label.new()
	_label.text = building_name
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.position = Vector2(-70, -building_height - 30)
	_label.size = Vector2(140, 20)
	_label.add_theme_font_size_override("font_size", 11)
	_label.add_theme_color_override("font_color", Color(0.95, 0.93, 0.85))
	_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	_label.add_theme_constant_override("shadow_offset_x", 1)
	_label.add_theme_constant_override("shadow_offset_y", 1)
	add_child(_label)
	queue_redraw()


func _process(delta: float) -> void:
	_time += delta
	if has_chimney:
		queue_redraw()  # animate smoke


func _draw() -> void:
	var hw: float = building_width / 2.0
	var hd: float = building_depth / 2.0
	var h: float = building_height

	# Base corners
	var top := Vector2(0, -hd)
	var right := Vector2(hw, 0)
	var bottom := Vector2(0, hd)
	var left := Vector2(-hw, 0)

	# Colors
	var top_color := Color(base_color.r + 0.15, base_color.g + 0.15, base_color.b + 0.15)
	var right_color := base_color
	var left_color := Color(base_color.r - 0.1, base_color.g - 0.1, base_color.b - 0.1)

	# Ground shadow
	var shadow_offset := Vector2(8, 6)
	draw_colored_polygon(PackedVector2Array([
		top + shadow_offset, right + shadow_offset,
		bottom + shadow_offset, left + shadow_offset
	]), Color(0, 0, 0, 0.15))

	# Left wall
	draw_colored_polygon(PackedVector2Array([
		left, bottom, bottom + Vector2(0, -h), left + Vector2(0, -h)
	]), left_color)

	# Right wall
	draw_colored_polygon(PackedVector2Array([
		bottom, right, right + Vector2(0, -h), bottom + Vector2(0, -h)
	]), right_color)

	# Roof
	draw_colored_polygon(PackedVector2Array([
		top + Vector2(0, -h), right + Vector2(0, -h),
		bottom + Vector2(0, -h), left + Vector2(0, -h)
	]), top_color)

	# --- Details ---

	# Windows on right wall
	if building_height > 20:
		var win_color := Color(0.9, 0.85, 0.5, 0.7)  # warm light
		var win_y := -h * 0.55
		var win_w := hw * 0.2
		var win_h := h * 0.2
		# Two windows
		for i: int in range(2):
			var wx: float = bottom.x + (right.x - bottom.x) * (0.3 + i * 0.35)
			var wy: float = bottom.y + (right.y - bottom.y) * (0.3 + i * 0.35)
			draw_rect(Rect2(wx - win_w/2, wy + win_y - win_h/2, win_w, win_h), win_color)

	# Windows on left wall
	if building_height > 20:
		var win_color := Color(0.85, 0.8, 0.45, 0.6)
		var win_y := -h * 0.55
		var win_w := hw * 0.18
		var win_h := h * 0.2
		for i: int in range(2):
			var wx: float = left.x + (bottom.x - left.x) * (0.3 + i * 0.35)
			var wy: float = left.y + (bottom.y - left.y) * (0.3 + i * 0.35)
			draw_rect(Rect2(wx - win_w/2, wy + win_y - win_h/2, win_w, win_h), win_color)

	# Door on right wall (center bottom)
	if building_height > 25:
		var door_color := Color(base_color.r - 0.2, base_color.g - 0.2, base_color.b - 0.15)
		var mid_x: float = (bottom.x + right.x) * 0.5
		var mid_y: float = (bottom.y + right.y) * 0.5
		var dw: float = hw * 0.18
		var dh: float = h * 0.35
		draw_rect(Rect2(mid_x - dw/2, mid_y - dh, dw, dh), door_color)

	# Edges
	var edge_color := Color(0, 0, 0, 0.25)
	draw_line(top + Vector2(0, -h), right + Vector2(0, -h), edge_color, 1.0)
	draw_line(right + Vector2(0, -h), bottom + Vector2(0, -h), edge_color, 1.0)
	draw_line(bottom + Vector2(0, -h), left + Vector2(0, -h), edge_color, 1.0)
	draw_line(left + Vector2(0, -h), top + Vector2(0, -h), edge_color, 1.0)
	draw_line(left, left + Vector2(0, -h), edge_color, 1.0)
	draw_line(bottom, bottom + Vector2(0, -h), edge_color, 1.0)
	draw_line(right, right + Vector2(0, -h), edge_color, 1.0)
	draw_line(left, bottom, edge_color, 1.0)
	draw_line(bottom, right, edge_color, 1.0)

	# Chimney + smoke
	if has_chimney:
		var chimney_base := Vector2(hw * 0.3, -hd * 0.3 - h)
		var ch_w := 8.0
		var ch_h := 15.0
		draw_colored_polygon(PackedVector2Array([
			chimney_base, chimney_base + Vector2(ch_w, 0),
			chimney_base + Vector2(ch_w, -ch_h), chimney_base + Vector2(0, -ch_h)
		]), Color(0.35, 0.3, 0.25))

		# Smoke particles (animated circles)
		for i: int in range(4):
			var t := fmod(_time * 0.4 + i * 0.7, 3.0)
			var smoke_x := chimney_base.x + ch_w/2 + sin(_time + i) * 3.0
			var smoke_y := chimney_base.y - ch_h - t * 15.0
			var alpha := 0.3 * (1.0 - t / 3.0)
			var radius := 3.0 + t * 2.5
			draw_circle(Vector2(smoke_x, smoke_y), radius, Color(0.6, 0.6, 0.6, alpha))
