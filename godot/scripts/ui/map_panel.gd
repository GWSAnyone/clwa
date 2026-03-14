extends ColorRect
## Full-screen map overlay — fog of war, NPC last-known positions.
## Toggle with M key. Zones reveal as player explores them.

const PADDING := 60.0
const PLAYER_DOT_RADIUS := 6.0
const NPC_DOT_RADIUS := 5.0
const LABEL_FONT_SIZE := 11
const LOC_LABEL_FONT_SIZE := 13

# Data set by main.gd
var _zone_polygons: Dictionary = {}       # location_name -> PackedVector2Array (world-space)
var _location_positions: Dictionary = {}  # location_name -> Vector2 (centroids)
var _explored: Dictionary = {}            # location_name -> true
var _player_world_pos := Vector2.ZERO
var _player_location := ""

# NPC known data: npc_id -> {pos: Vector2, name: String, color: Color, fresh: bool, alive: bool, status: String}
var _known_npcs: Dictionary = {}

# Transform: world -> map screen coords
var _map_offset := Vector2.ZERO
var _map_scale := 1.0


func _ready() -> void:
	visible = false
	mouse_filter = Control.MOUSE_FILTER_STOP
	color = Color(0.03, 0.05, 0.03, 0.92)
	anchors_preset = Control.PRESET_FULL_RECT


func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_M:
			visible = not visible
			get_viewport().set_input_as_handled()
		elif event.keycode == KEY_ESCAPE and visible:
			visible = false
			get_viewport().set_input_as_handled()


func setup(zone_polygons: Dictionary, location_positions: Dictionary) -> void:
	_zone_polygons = zone_polygons
	_location_positions = location_positions
	_compute_transform()


func _compute_transform() -> void:
	# Find bounding box of all zone polygons + location positions
	var min_p := Vector2(INF, INF)
	var max_p := Vector2(-INF, -INF)
	for loc_name: String in _zone_polygons:
		var poly: PackedVector2Array = _zone_polygons[loc_name]
		for p: Vector2 in poly:
			min_p = min_p.min(p)
			max_p = max_p.max(p)
	for loc_name: String in _location_positions:
		var p: Vector2 = _location_positions[loc_name]
		min_p = min_p.min(p)
		max_p = max_p.max(p)

	if min_p.x == INF:
		return

	var world_size := max_p - min_p
	var viewport_size := get_viewport_rect().size
	var available := viewport_size - Vector2(PADDING * 2, PADDING * 2)

	_map_scale = minf(available.x / world_size.x, available.y / world_size.y)
	var map_size := world_size * _map_scale
	_map_offset = (viewport_size - map_size) * 0.5 - min_p * _map_scale


func _world_to_map(world_pos: Vector2) -> Vector2:
	return world_pos * _map_scale + _map_offset


func set_explored(location: String) -> void:
	if location != "" and not _explored.has(location):
		_explored[location] = true
		queue_redraw()


func update_player(world_pos: Vector2, location: String) -> void:
	_player_world_pos = world_pos
	_player_location = location
	if visible:
		queue_redraw()


func update_npc(npc_id: String, world_pos: Vector2, npc_name: String, npc_color: Color, is_fresh: bool, alive: bool, status: String) -> void:
	_known_npcs[npc_id] = {
		"pos": world_pos,
		"name": npc_name,
		"color": npc_color,
		"fresh": is_fresh,
		"alive": alive,
		"status": status,
	}
	if visible:
		queue_redraw()


func _draw() -> void:
	if not visible:
		return

	_compute_transform()
	var font: Font = ThemeDB.fallback_font

	# Draw zone polygons
	for loc_name: String in _zone_polygons:
		var poly: PackedVector2Array = _zone_polygons[loc_name]
		var map_poly := PackedVector2Array()
		for p: Vector2 in poly:
			map_poly.append(_world_to_map(p))

		if _explored.has(loc_name):
			# Explored: colored fill + border
			draw_colored_polygon(map_poly, Color(0.15, 0.22, 0.15, 0.7))
			for i: int in range(map_poly.size()):
				var a: Vector2 = map_poly[i]
				var b: Vector2 = map_poly[(i + 1) % map_poly.size()]
				draw_line(a, b, Color(0.4, 0.6, 0.35, 0.8), 1.5)
		else:
			# Unexplored: dark silhouette with "?"
			draw_colored_polygon(map_poly, Color(0.08, 0.08, 0.08, 0.5))
			for i: int in range(map_poly.size()):
				var a: Vector2 = map_poly[i]
				var b: Vector2 = map_poly[(i + 1) % map_poly.size()]
				draw_line(a, b, Color(0.2, 0.2, 0.2, 0.4), 1.0)

	# Draw location labels
	for loc_name: String in _location_positions:
		var pos: Vector2 = _location_positions[loc_name]
		var map_pos: Vector2 = _world_to_map(pos)
		if _explored.has(loc_name):
			draw_string(font, map_pos + Vector2(-40, -12), loc_name, HORIZONTAL_ALIGNMENT_CENTER, 80, LOC_LABEL_FONT_SIZE, Color(0.7, 0.8, 0.6, 0.9))
		else:
			draw_string(font, map_pos + Vector2(-5, 5), "?", HORIZONTAL_ALIGNMENT_CENTER, 10, LOC_LABEL_FONT_SIZE, Color(0.4, 0.4, 0.4, 0.6))

	# Draw NPCs (only those seen at explored locations)
	for npc_id: String in _known_npcs:
		var data: Dictionary = _known_npcs[npc_id]
		var map_pos: Vector2 = _world_to_map(data["pos"])
		var col: Color = data["color"]
		var alive: bool = data["alive"]
		var status: String = data["status"]
		var fresh: bool = data["fresh"]

		if not alive:
			# Dead: X marker
			var x_col := Color(0.8, 0.2, 0.15, 0.7 if fresh else 0.4)
			draw_line(map_pos + Vector2(-4, -4), map_pos + Vector2(4, 4), x_col, 2.0)
			draw_line(map_pos + Vector2(4, -4), map_pos + Vector2(-4, 4), x_col, 2.0)
			draw_string(font, map_pos + Vector2(-20, 12), data["name"], HORIZONTAL_ALIGNMENT_CENTER, 40, LABEL_FONT_SIZE, Color(0.6, 0.3, 0.3, 0.5))
		elif status == "exiled" or status == "fled":
			continue
		elif status == "detained":
			var det_col := Color(col.r, col.g, col.b, 0.5 if fresh else 0.3)
			draw_circle(map_pos, NPC_DOT_RADIUS, det_col)
			draw_arc(map_pos, NPC_DOT_RADIUS + 2, 0, TAU, 8, Color(0.9, 0.5, 0.2, 0.6), 1.5)
			draw_string(font, map_pos + Vector2(-20, 12), data["name"], HORIZONTAL_ALIGNMENT_CENTER, 40, LABEL_FONT_SIZE, det_col)
		else:
			var alpha := 0.9 if fresh else 0.4
			var dot_col := Color(col.r, col.g, col.b, alpha)
			draw_circle(map_pos, NPC_DOT_RADIUS, dot_col)
			var label_col := Color(0.85, 0.85, 0.85, alpha)
			draw_string(font, map_pos + Vector2(-20, 12), data["name"], HORIZONTAL_ALIGNMENT_CENTER, 40, LABEL_FONT_SIZE, label_col)
			if not fresh:
				# Last known indicator
				draw_string(font, map_pos + Vector2(-5, -8), "~", HORIZONTAL_ALIGNMENT_CENTER, 10, 9, Color(0.6, 0.6, 0.5, 0.5))

	# Draw player
	var player_map_pos: Vector2 = _world_to_map(_player_world_pos)
	draw_circle(player_map_pos, PLAYER_DOT_RADIUS, Color(1, 0.85, 0.3, 0.95))
	draw_arc(player_map_pos, PLAYER_DOT_RADIUS + 1, 0, TAU, 12, Color(1, 0.9, 0.4, 0.5), 1.5)
	draw_string(font, player_map_pos + Vector2(-12, -10), "You", HORIZONTAL_ALIGNMENT_CENTER, 24, LABEL_FONT_SIZE, Color(1, 0.9, 0.4, 0.9))
