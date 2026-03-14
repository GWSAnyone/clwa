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
	has_sign = building_name in ["Silver Flagon Tavern", "Market Square", "Blacksmith", "Courthouse"]

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

	# Building-specific details
	_draw_building_details(top, right, bottom, left, h, hw, hd)


func _draw_building_details(top: Vector2, right: Vector2, bottom: Vector2, left: Vector2, h: float, hw: float, hd: float) -> void:
	match building_name:
		"Silver Flagon Tavern":
			# Hanging sign on right wall
			var sign_x := (bottom.x + right.x) * 0.7
			var sign_y := (bottom.y + right.y) * 0.7 - h * 0.7
			draw_line(Vector2(sign_x, sign_y), Vector2(sign_x, sign_y + 8), Color(0.3, 0.2, 0.1), 1.5)
			draw_colored_polygon(PackedVector2Array([
				Vector2(sign_x - 8, sign_y + 8), Vector2(sign_x + 8, sign_y + 8),
				Vector2(sign_x + 8, sign_y + 16), Vector2(sign_x - 8, sign_y + 16)
			]), Color(0.45, 0.3, 0.15))
			# Mug symbol on sign
			draw_rect(Rect2(sign_x - 3, sign_y + 10, 6, 4), Color(0.8, 0.7, 0.4, 0.7))

		"Town Gate":
			# Gate arch on right wall
			var gate_cx := (bottom.x + right.x) * 0.5
			var gate_cy := (bottom.y + right.y) * 0.5
			draw_arc(Vector2(gate_cx, gate_cy - h * 0.45), hw * 0.22, PI, TAU, 8, Color(0.3, 0.28, 0.25), 3.0)
			# Torch holders
			draw_circle(Vector2(gate_cx - hw * 0.3, gate_cy - h * 0.3), 2.0, Color(0.7, 0.4, 0.1))
			draw_circle(Vector2(gate_cx + hw * 0.3, gate_cy - h * 0.3), 2.0, Color(0.7, 0.4, 0.1))
			# Flicker
			var flicker := 0.7 + sin(_time * 5.0) * 0.3
			draw_circle(Vector2(gate_cx - hw * 0.3, gate_cy - h * 0.3 - 3), 2.5, Color(0.9, 0.6, 0.2, flicker * 0.5))
			draw_circle(Vector2(gate_cx + hw * 0.3, gate_cy - h * 0.3 - 3), 2.5, Color(0.9, 0.6, 0.2, flicker * 0.5))

		"Market Square":
			# Market stall canopy on right side (outside building)
			var stall_x := right.x + 10
			var stall_y := right.y - h * 0.3
			draw_colored_polygon(PackedVector2Array([
				Vector2(stall_x - 15, stall_y), Vector2(stall_x + 15, stall_y),
				Vector2(stall_x + 12, stall_y - 8), Vector2(stall_x - 12, stall_y - 8)
			]), Color(0.7, 0.4, 0.15, 0.6))
			# Stall posts
			draw_line(Vector2(stall_x - 12, stall_y), Vector2(stall_x - 12, stall_y + 15), Color(0.4, 0.25, 0.15), 2.0)
			draw_line(Vector2(stall_x + 12, stall_y), Vector2(stall_x + 12, stall_y + 15), Color(0.4, 0.25, 0.15), 2.0)
			# Crates
			draw_rect(Rect2(stall_x - 8, stall_y + 3, 7, 7), Color(0.5, 0.35, 0.15))
			draw_rect(Rect2(stall_x + 1, stall_y + 5, 6, 5), Color(0.45, 0.3, 0.12))

		"Temple of Dawn":
			# Pointed roof peak (triangle above flat roof)
			var peak := Vector2(0, -h - 25)
			var roof_l := left + Vector2(0, -h)
			var roof_r := right + Vector2(0, -h)
			draw_colored_polygon(PackedVector2Array([
				roof_l, peak, Vector2(0, -hd - h)
			]), Color(base_color.r + 0.05, base_color.g + 0.05, base_color.b + 0.12, 0.6))
			draw_colored_polygon(PackedVector2Array([
				Vector2(0, -hd - h), peak, roof_r
			]), Color(base_color.r + 0.1, base_color.g + 0.1, base_color.b + 0.18, 0.6))
			# Cross on peak
			draw_line(Vector2(0, -h - 22), Vector2(0, -h - 32), Color(0.9, 0.85, 0.4), 2.0)
			draw_line(Vector2(-4, -h - 28), Vector2(4, -h - 28), Color(0.9, 0.85, 0.4), 2.0)
			# Stained glass window (colored circle)
			var win_cx := (bottom.x + right.x) * 0.5
			var win_cy := (bottom.y + right.y) * 0.5 - h * 0.6
			draw_circle(Vector2(win_cx, win_cy), 5, Color(0.3, 0.4, 0.7, 0.5))
			draw_arc(Vector2(win_cx, win_cy), 5, 0, TAU, 12, Color(0.9, 0.85, 0.4, 0.3), 1.0)

		"Blacksmith":
			# Anvil outside
			var anvil_x := right.x + 15
			var anvil_y := right.y + 5
			draw_colored_polygon(PackedVector2Array([
				Vector2(anvil_x - 6, anvil_y), Vector2(anvil_x + 6, anvil_y),
				Vector2(anvil_x + 4, anvil_y - 5), Vector2(anvil_x - 4, anvil_y - 5)
			]), Color(0.35, 0.35, 0.38))
			draw_colored_polygon(PackedVector2Array([
				Vector2(anvil_x - 7, anvil_y - 5), Vector2(anvil_x + 7, anvil_y - 5),
				Vector2(anvil_x + 5, anvil_y - 8), Vector2(anvil_x - 5, anvil_y - 8)
			]), Color(0.4, 0.4, 0.43))
			# Forge glow from chimney
			if has_chimney:
				var glow_pulse := 0.4 + sin(_time * 3.0) * 0.2
				draw_circle(Vector2(hw * 0.3 + 4, -hd * 0.3 - h + 2), 6, Color(0.9, 0.4, 0.1, glow_pulse * 0.3))

		"Courthouse":
			# Pillars on right wall
			var wall_start := bottom
			var wall_end := right
			for i: int in range(3):
				var t := 0.2 + i * 0.3
				var px: float = lerp(wall_start.x, wall_end.x, t)
				var py: float = lerp(wall_start.y, wall_end.y, t)
				draw_line(Vector2(px, py), Vector2(px, py - h), Color(0.55, 0.52, 0.58), 3.0)
				# Capital
				draw_line(Vector2(px - 3, py - h + 2), Vector2(px + 3, py - h + 2), Color(0.55, 0.52, 0.58), 2.0)
			# Scales of justice on roof center
			var scales_x := 0.0
			var scales_y := -h - 5
			draw_line(Vector2(scales_x, scales_y), Vector2(scales_x, scales_y - 8), Color(0.7, 0.65, 0.4), 1.5)
			draw_line(Vector2(scales_x - 6, scales_y - 5), Vector2(scales_x + 6, scales_y - 5), Color(0.7, 0.65, 0.4), 1.5)
			draw_arc(Vector2(scales_x - 6, scales_y - 3), 3, 0, PI, 6, Color(0.7, 0.65, 0.4), 1.0)
			draw_arc(Vector2(scales_x + 6, scales_y - 3), 3, 0, PI, 6, Color(0.7, 0.65, 0.4), 1.0)

		"Residential Lane":
			# Multiple small houses feel — extra windows, fences
			# Flower box under right window
			var fx := (bottom.x + right.x) * 0.55
			var fy := (bottom.y + right.y) * 0.55 - h * 0.35
			draw_rect(Rect2(fx - 6, fy, 12, 3), Color(0.4, 0.25, 0.15))
			# Flowers
			draw_circle(Vector2(fx - 3, fy - 1), 1.5, Color(0.8, 0.3, 0.3, 0.7))
			draw_circle(Vector2(fx, fy - 2), 1.5, Color(0.9, 0.8, 0.3, 0.7))
			draw_circle(Vector2(fx + 3, fy - 1), 1.5, Color(0.8, 0.4, 0.6, 0.7))
			# Fence near entrance
			var fence_y := bottom.y + 12
			for i: int in range(5):
				var post_x := bottom.x - 15 + i * 7
				draw_line(Vector2(post_x, fence_y), Vector2(post_x, fence_y - 8), Color(0.4, 0.3, 0.2, 0.5), 1.5)
			draw_line(Vector2(bottom.x - 15, fence_y - 6), Vector2(bottom.x + 13, fence_y - 6), Color(0.4, 0.3, 0.2, 0.5), 1.0)
