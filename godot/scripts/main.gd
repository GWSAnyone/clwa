extends Node2D
## Main scene controller — isometric village map with backend sync.

const NpcMarkerScript := preload("res://scripts/npc_marker.gd")
const PlayerScript := preload("res://scripts/player.gd")
const DialogPanelScript := preload("res://scripts/ui/dialog_panel.gd")
const ShopPanelScript := preload("res://scripts/ui/shop_panel.gd")
const DayNightScript := preload("res://scripts/ui/day_night_overlay.gd")
const VignetteScript := preload("res://scripts/ui/vignette.gd")
const ExaminePanelScript := preload("res://scripts/ui/examine_panel.gd")
const JournalPanelScript := preload("res://scripts/ui/journal_panel.gd")
const NotificationManagerScript := preload("res://scripts/ui/notification_manager.gd")
const MapPanelScript := preload("res://scripts/ui/map_panel.gd")
# TileMap scene is added as child node in main.tscn editor

# Location positions — polygon centroids from Tiled zones
const LOCATION_POSITIONS: Dictionary = {
	"Courthouse": Vector2(-1077, -394),
	"Town Gate": Vector2(-1893, 662),
	"Temple of Dawn": Vector2(992, -1145),
	"Market Square": Vector2(2054, -517),
	"Blacksmith": Vector2(2794, 432),
	"Silver Flagon Tavern": Vector2(2023, 1457),
	"Residential Lane": Vector2(-745, 1889),
	"Town Square": Vector2(500, 200),
}


const NPC_COLORS: Dictionary = {
	"ted": Color(0.8, 0.5, 0.2),
	"mark": Color(0.2, 0.7, 0.3),
	"elara": Color(0.7, 0.3, 0.8),
	"garrett": Color(0.3, 0.4, 0.8),
	"aldric": Color(0.9, 0.85, 0.4),
	"hilda": Color(0.7, 0.3, 0.2),
	"bess": Color(0.4, 0.65, 0.65),
	"theron": Color(0.5, 0.35, 0.55),
}

const NPC_NAMES: Dictionary = {
	"ted": "Ted",
	"mark": "Mark",
	"elara": "Elara",
	"garrett": "Garrett",
	"aldric": "Fr. Aldric",
	"hilda": "Hilda",
	"bess": "Old Bess",
	"theron": "Theron",
}

const NPC_ROLES: Dictionary = {
	"ted": "bartender",
	"mark": "merchant",
	"elara": "bard",
	"garrett": "guard",
	"aldric": "priest",
	"hilda": "blacksmith",
	"bess": "herbalist",
	"theron": "judge",
}

# Reverse map: display name -> npc id
var _name_to_id: Dictionary = {}

const NPC_INTERACT_DISTANCE := 150.0
const NPC_HIGHLIGHT_DISTANCE := 200.0
const LOCATION_DETECT_RADIUS := 400.0
const NPC_WALK_SPEED := 350.0  # pixels per second

var _npc_nodes: Dictionary = {}
var _npc_locations: Dictionary = {}
var _npc_tweens: Dictionary = {}  # npc_id -> active Tween
var _zone_polygons: Dictionary = {}  # location_name -> PackedVector2Array (world-space)
var _street_polygons: Dictionary = {}  # street_name -> PackedVector2Array (world-space)
var _nav_region: NavigationRegion2D
var _player: Node2D
var _dialog_panel: PanelContainer
var _chatting_with_npc: String = ""  # NPC id frozen during player conversation
var _shop_panel: PanelContainer
var _examine_panel: PanelContainer
var _journal_panel: PanelContainer
var _prev_highlighted: String = ""
var _player_location: String = ""  # current detected location
var _crime_scene_locations: Dictionary = {}  # location_id -> true (has active crime scene)
var _crime_scene_markers: Dictionary = {}  # location_id -> Node2D (visual marker)
var _map_panel: ColorRect
var _debug_label: Label
var _pos_label: Label
var _debug_lines: Array[String] = []
const DEBUG_MAX_LINES := 6

@onready var _camera: Camera2D = $Camera2D
@onready var _world_container: Node2D = $World


func _ready() -> void:
	RenderingServer.set_default_clear_color(Color(0.08, 0.1, 0.08))

	# Build reverse name map
	for npc_id: String in NPC_NAMES:
		_name_to_id[NPC_NAMES[npc_id]] = npc_id

	# Hide zone debug shapes and parse polygons for random NPC placement
	# Sample is a sibling of World (direct child of Main), not inside World
	var zones_node := get_node_or_null("Sample/Zones")
	if zones_node:
		zones_node.visible = false
		_parse_polygons(zones_node, _zone_polygons)
		print("[Main] Parsed %d zone polygons" % _zone_polygons.size())

	# Parse street polygons for navigation
	var streets_node := get_node_or_null("Sample/Streets")
	if streets_node:
		streets_node.visible = false
		_parse_polygons(streets_node, _street_polygons)
		print("[Main] Parsed %d street polygons" % _street_polygons.size())

	# Build navigation mesh from zones + streets
	_build_navigation()

	# Map panel (full-screen overlay, toggled with M)
	_map_panel = ColorRect.new()
	_map_panel.set_script(MapPanelScript)
	$HUD.add_child(_map_panel)
	_map_panel.setup(_zone_polygons, LOCATION_POSITIONS)

	# Player
	_player = Node2D.new()
	_player.set_script(PlayerScript)
	_player.position = LOCATION_POSITIONS["Town Square"] + Vector2(0, 50)
	_player.interact_requested.connect(_on_interact_requested)
	_player.investigate_requested.connect(_on_investigate_requested)
	_world_container.add_child(_player)

	# Dialog panel
	_dialog_panel = PanelContainer.new()
	_dialog_panel.set_script(DialogPanelScript)
	_dialog_panel.closed.connect(_on_dialog_closed)
	_dialog_panel.action_requested.connect(_on_dialog_action)
	$HUD.add_child(_dialog_panel)

	# Shop panel
	_shop_panel = PanelContainer.new()
	_shop_panel.set_script(ShopPanelScript)
	_shop_panel.closed.connect(func(): _player.movement_locked = false)
	$HUD.add_child(_shop_panel)

	# Examine panel (crime scene)
	_examine_panel = PanelContainer.new()
	_examine_panel.set_script(ExaminePanelScript)
	_examine_panel.closed.connect(func(): _player.movement_locked = false)
	$HUD.add_child(_examine_panel)

	# Journal panel
	_journal_panel = PanelContainer.new()
	_journal_panel.set_script(JournalPanelScript)
	_journal_panel.closed.connect(func(): _player.movement_locked = false)
	$HUD.add_child(_journal_panel)

	# Notification system
	var notifications := CanvasLayer.new()
	notifications.set_script(NotificationManagerScript)
	add_child(notifications)

	# Day/night overlay (separate CanvasLayer so it covers world but not HUD)
	var atmosphere := CanvasLayer.new()
	atmosphere.layer = 5
	add_child(atmosphere)

	var day_night := ColorRect.new()
	day_night.set_script(DayNightScript)
	atmosphere.add_child(day_night)

	var vignette := ColorRect.new()
	vignette.set_script(VignetteScript)
	atmosphere.add_child(vignette)

	# Debug overlay (top-right corner)
	_debug_label = Label.new()
	_debug_label.position = Vector2(0, 0)
	_debug_label.add_theme_font_size_override("font_size", 10)
	_debug_label.add_theme_color_override("font_color", Color(0.6, 0.9, 0.6, 0.7))
	_debug_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	_debug_label.add_theme_constant_override("shadow_offset_x", 1)
	_debug_label.add_theme_constant_override("shadow_offset_y", 1)
	_debug_label.anchors_preset = Control.PRESET_TOP_RIGHT
	_debug_label.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_debug_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_debug_label.text = ""
	$HUD.add_child(_debug_label)

	# Position debug label (bottom-left)
	_pos_label = Label.new()
	_pos_label.add_theme_font_size_override("font_size", 14)
	_pos_label.add_theme_color_override("font_color", Color(1, 1, 0.3))
	_pos_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.9))
	_pos_label.add_theme_constant_override("shadow_offset_x", 1)
	_pos_label.add_theme_constant_override("shadow_offset_y", 1)
	_pos_label.anchors_preset = Control.PRESET_BOTTOM_LEFT
	_pos_label.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_pos_label.text = "Pos: 0, 0"
	$HUD.add_child(_pos_label)

	print("[Main] Isometric scene ready")

	# Backend signals
	Backend.connected.connect(_on_backend_connected)
	Backend.disconnected.connect(_on_backend_disconnected)
	Backend.tick_completed.connect(_on_tick_completed)
	Backend.npc_moved.connect(_on_npc_moved)
	Backend.conversation_line.connect(_on_conversation_line)
	Backend.conversation_complete.connect(_on_conversation_complete)
	Backend.murder_occurred.connect(_on_murder_occurred)
	Backend.shop_opened.connect(_on_shop_opened)
	Backend.crime_scene_created.connect(_on_crime_scene_created)
	Backend.debug_llm.connect(_on_debug_llm)

	if Backend._connected:
		_on_backend_connected()


func _process(_delta: float) -> void:
	# Camera follows player smoothly
	_camera.position = _camera.position.lerp(_player.position, 0.08)

	# Lock player movement when any panel is open
	_player.movement_locked = _dialog_panel.visible or _shop_panel.visible or _examine_panel.visible or _journal_panel.visible or _map_panel.visible

	# Check nearby NPCs — highlight + interact
	var closest_id := ""
	var closest_dist := NPC_INTERACT_DISTANCE
	for npc_id: String in _npc_nodes:
		var marker: Node2D = _npc_nodes[npc_id]
		if not is_instance_valid(marker):
			continue
		var dist := _player.position.distance_to(marker.position)
		if dist < closest_dist:
			closest_dist = dist
			closest_id = npc_id

	# Update highlights
	if closest_id != _prev_highlighted:
		if _prev_highlighted != "" and _npc_nodes.has(_prev_highlighted):
			var old_marker: Node2D = _npc_nodes[_prev_highlighted]
			if is_instance_valid(old_marker):
				old_marker.set_highlight(false)
		if closest_id != "" and _npc_nodes.has(closest_id):
			_npc_nodes[closest_id].set_highlight(true)
		_prev_highlighted = closest_id

	_player.set_nearby_npc(closest_id)

	# Check nearby crime scenes (only if no NPC is closer)
	var nearest_crime_scene := ""
	if closest_id == "":
		var cs_dist := NPC_INTERACT_DISTANCE
		for loc_id: String in _crime_scene_locations:
			var loc_pos: Vector2 = LOCATION_POSITIONS.get(loc_id, Vector2.ZERO)
			var dist := _player.position.distance_to(loc_pos)
			if dist < cs_dist:
				cs_dist = dist
				nearest_crime_scene = loc_id
	_player.set_nearby_crime_scene(nearest_crime_scene)

	# Detect player's current location and sync to server
	var nearest_loc := ""
	var nearest_loc_dist := LOCATION_DETECT_RADIUS
	for loc_name: String in LOCATION_POSITIONS:
		var loc_pos: Vector2 = LOCATION_POSITIONS[loc_name]
		var dist := _player.position.distance_to(loc_pos)
		if dist < nearest_loc_dist:
			nearest_loc_dist = dist
			nearest_loc = loc_name
	if nearest_loc != _player_location:
		_player_location = nearest_loc
		Backend.update_player_location(nearest_loc)

	# Update map panel
	if _map_panel:
		_map_panel.set_explored(_player_location)
		_map_panel.update_player(_player.position, _player_location)
		# Update NPC known positions: real-time for same location, freeze for others
		for npc_id: String in _npc_nodes:
			var marker: Node2D = _npc_nodes[npc_id]
			if not is_instance_valid(marker):
				continue
			var npc_loc: String = _npc_locations.get(npc_id, "")
			var is_fresh: bool = (npc_loc == _player_location and _player_location != "")
			# Only update position if fresh (same location) or first time seen at explored location
			if is_fresh or not _map_panel._known_npcs.has(npc_id):
				var npc_alive: bool = marker.get("alive") if "alive" in marker else true
				var npc_status: String = marker.get("status") if "status" in marker else "free"
				_map_panel.update_npc(npc_id, marker.position, NPC_NAMES.get(npc_id, npc_id), NPC_COLORS.get(npc_id, Color.WHITE), is_fresh, npc_alive, npc_status)
			elif _map_panel._known_npcs.has(npc_id) and _map_panel._known_npcs[npc_id]["fresh"]:
				# Was fresh, now stale — freeze position
				_map_panel._known_npcs[npc_id]["fresh"] = false



func _spawn_npcs(agents_data: Dictionary) -> void:
	for id: String in _npc_nodes:
		var node: Node = _npc_nodes[id]
		if is_instance_valid(node):
			node.queue_free()
	_npc_nodes.clear()
	_npc_locations.clear()
	_prev_highlighted = ""

	for npc_id: String in agents_data:
		var data: Dictionary = agents_data[npc_id]
		var marker := Node2D.new()
		marker.set_script(NpcMarkerScript)
		marker.npc_id = npc_id
		marker.npc_name = NPC_NAMES.get(npc_id, npc_id)
		marker.npc_role = NPC_ROLES.get(npc_id, "")
		marker.npc_color = NPC_COLORS.get(npc_id, Color.WHITE)
		_world_container.add_child(marker)
		_npc_nodes[npc_id] = marker

		var loc: String = data.get("location", "Town Square")
		_npc_locations[npc_id] = loc
		_place_npc_at_location(npc_id, loc, true)
		marker.update_from_data(data)

	print("[Main] Spawned %d NPCs" % _npc_nodes.size())


func _update_npcs(agents_data: Dictionary) -> void:
	# Spawn any new NPCs that don't have nodes yet
	for npc_id: String in agents_data:
		if not _npc_nodes.has(npc_id):
			var data: Dictionary = agents_data[npc_id]
			var marker := Node2D.new()
			marker.set_script(NpcMarkerScript)
			marker.npc_id = npc_id
			marker.npc_name = NPC_NAMES.get(npc_id, npc_id)
			marker.npc_role = NPC_ROLES.get(npc_id, "")
			marker.npc_color = NPC_COLORS.get(npc_id, Color.WHITE)
			_world_container.add_child(marker)
			_npc_nodes[npc_id] = marker
			var loc: String = data.get("location", "Town Square")
			_npc_locations[npc_id] = loc
			_place_npc_at_location(npc_id, loc, true)

	# Update existing NPCs
	for npc_id: String in agents_data:
		var data: Dictionary = agents_data[npc_id]
		var marker: Node2D = _npc_nodes.get(npc_id)
		if not marker or not is_instance_valid(marker):
			continue
		marker.update_from_data(data)
		# Check if location changed
		var new_loc: String = data.get("location", "")
		if new_loc != "" and new_loc != _npc_locations.get(npc_id, ""):
			_place_npc_at_location(npc_id, new_loc)


func _place_npc_at_location(npc_id: String, location_id: String, instant: bool = false) -> void:
	var marker: Node2D = _npc_nodes.get(npc_id)
	if not marker:
		return

	# Pick point inside zone polygon — deterministic on spawn, random on move
	var target_pos: Vector2
	if _zone_polygons.has(location_id):
		if instant:
			target_pos = _seeded_point_in_zone(location_id, npc_id)
		else:
			target_pos = _random_point_in_zone(location_id)
	else:
		var base_pos: Vector2 = LOCATION_POSITIONS.get(location_id, Vector2.ZERO)
		target_pos = base_pos + Vector2(randf_range(-150, 150), randf_range(-75, 75))

	var was_different_loc: bool = _npc_locations.get(npc_id, "") != location_id
	_npc_locations[npc_id] = location_id
	_tween_npc_to(npc_id, marker, target_pos, instant, was_different_loc)


func _tween_npc_to(npc_id: String, marker: Node2D, target_pos: Vector2, instant: bool = false, use_nav: bool = false) -> void:
	# Don't move NPC while player is talking to them
	if npc_id == _chatting_with_npc:
		return
	# Kill any existing tween for this NPC
	if _npc_tweens.has(npc_id):
		var old_tween: Tween = _npc_tweens[npc_id]
		if old_tween and old_tween.is_valid():
			old_tween.kill()
		_npc_tweens.erase(npc_id)

	if instant or marker.position == Vector2.ZERO:
		marker.position = target_pos
		return

	var distance := marker.position.distance_to(target_pos)
	if distance < 10.0:
		marker.position = target_pos
		return

	var path: PackedVector2Array
	if use_nav and distance > 200.0:
		var nav_map: RID = get_world_2d().navigation_map
		path = NavigationServer2D.map_get_path(nav_map, marker.position, target_pos, true)
		if path.size() < 2:
			path = PackedVector2Array([marker.position, target_pos])
	else:
		path = PackedVector2Array([marker.position, target_pos])

	# Build chained tween along path segments
	var tween := create_tween()
	for i: int in range(1, path.size()):
		var seg_dir := (path[i] - path[i - 1]).normalized()
		tween.tween_callback(marker.start_moving.bind(seg_dir))
		var seg_dist := path[i - 1].distance_to(path[i])
		tween.tween_property(marker, "position", path[i], seg_dist / NPC_WALK_SPEED)

	tween.tween_callback(marker.stop_moving)
	tween.tween_callback(func(): _npc_tweens.erase(npc_id))
	_npc_tweens[npc_id] = tween


func _parse_polygons(parent_node: Node2D, target_dict: Dictionary) -> void:
	var parent_pos: Vector2 = parent_node.position
	var sample_node: Node2D = parent_node.get_parent()
	var sample_pos: Vector2 = sample_node.position if sample_node else Vector2.ZERO

	for sb: Node in parent_node.get_children():
		if not sb is StaticBody2D:
			continue
		var sb_pos: Vector2 = (sb as StaticBody2D).position
		for child: Node in sb.get_children():
			if child is CollisionPolygon2D:
				var poly: CollisionPolygon2D = child as CollisionPolygon2D
				var poly_name: String = poly.name.replace("_", " ")
				var world_poly := PackedVector2Array()
				var offset: Vector2 = sample_pos + parent_pos + sb_pos
				for point: Vector2 in poly.polygon:
					world_poly.append(point + offset)
				target_dict[poly_name] = world_poly


func _build_navigation() -> void:
	_nav_region = NavigationRegion2D.new()

	# Collect all walkable polygons
	var all_polys: Array[PackedVector2Array] = []
	for poly: PackedVector2Array in _zone_polygons.values():
		if poly.size() >= 3:
			all_polys.append(poly)
	for poly: PackedVector2Array in _street_polygons.values():
		if poly.size() >= 3:
			all_polys.append(poly)

	if all_polys.is_empty():
		add_child(_nav_region)
		print("[Main] Navigation: no polygons found")
		return

	# Slightly inflate each polygon so touching edges overlap for merging
	var inflated: Array[PackedVector2Array] = []
	for poly: PackedVector2Array in all_polys:
		var grown: Array[PackedVector2Array] = Geometry2D.offset_polygon(poly, 5.0)
		if grown.size() > 0:
			inflated.append(grown[0])
		else:
			inflated.append(poly)

	# Merge overlapping polygons into combined walkable areas
	var merged := _merge_walkable_polys(inflated)
	print("[Main] Merged %d polygons into %d walkable areas" % [all_polys.size(), merged.size()])

	# Shrink merged polygons so paths stay near center of roads
	var shrunk: Array[PackedVector2Array] = []
	for poly: PackedVector2Array in merged:
		var s: Array[PackedVector2Array] = Geometry2D.offset_polygon(poly, -25.0)
		if s.size() > 0:
			shrunk.append(s[0])
		else:
			shrunk.append(poly)

	var nav_poly := NavigationPolygon.new()
	for poly: PackedVector2Array in shrunk:
		# NavigationPolygon expects CCW outlines
		if Geometry2D.is_polygon_clockwise(poly):
			poly.reverse()
		nav_poly.add_outline(poly)

	nav_poly.make_polygons_from_outlines()
	_nav_region.navigation_polygon = nav_poly
	add_child(_nav_region)
	await get_tree().process_frame
	print("[Main] Navigation built OK")


func _merge_walkable_polys(polys: Array[PackedVector2Array]) -> Array[PackedVector2Array]:
	var result: Array[PackedVector2Array] = [polys[0]]

	# First pass: try to merge each poly into existing results
	for i: int in range(1, polys.size()):
		var to_merge: PackedVector2Array = polys[i]
		var did_merge := false
		for j: int in range(result.size()):
			var union: Array[PackedVector2Array] = Geometry2D.merge_polygons(result[j], to_merge)
			if union.size() == 1:
				result[j] = union[0]
				did_merge = true
				break
		if not did_merge:
			result.append(to_merge)

	# Multiple passes for transitive merges (A+B didn't merge, but A+C did, now AC+B might)
	var changed := true
	while changed:
		changed = false
		for i: int in range(result.size()):
			for j: int in range(i + 1, result.size()):
				var union: Array[PackedVector2Array] = Geometry2D.merge_polygons(result[i], result[j])
				if union.size() == 1:
					result[i] = union[0]
					result.remove_at(j)
					changed = true
					break
			if changed:
				break

	return result


func _seeded_point_in_zone(location_id: String, npc_id: String) -> Vector2:
	# Deterministic position based on npc_id + location — same every restart
	var old_state := randi()
	seed(npc_id.hash() ^ location_id.hash())
	var result := _random_point_in_zone(location_id)
	seed(old_state)
	return result


func _random_point_in_zone(location_id: String) -> Vector2:
	var poly: PackedVector2Array = _zone_polygons[location_id]
	var center := _centroid(poly)

	# Shrink polygon toward center by 15% to avoid edges
	var shrunk := PackedVector2Array()
	for p: Vector2 in poly:
		shrunk.append(p.lerp(center, 0.15))

	# Triangulate and pick random triangle weighted by area
	var indices: PackedInt32Array = Geometry2D.triangulate_polygon(shrunk)
	if indices.size() < 3:
		# Fallback: random offset around centroid
		return center + Vector2(randf_range(-80, 80), randf_range(-40, 40))

	# Compute triangle areas
	@warning_ignore("integer_division")
	var tri_count: int = indices.size() / 3
	var areas: Array[float] = []
	var total_area := 0.0
	for i: int in range(tri_count):
		var p0: Vector2 = shrunk[indices[i * 3]]
		var p1: Vector2 = shrunk[indices[i * 3 + 1]]
		var p2: Vector2 = shrunk[indices[i * 3 + 2]]
		var area := absf((p1 - p0).cross(p2 - p0)) * 0.5
		areas.append(area)
		total_area += area

	if total_area < 1.0:
		return center + Vector2(randf_range(-80, 80), randf_range(-40, 40))

	# Weighted random triangle selection
	var r := randf() * total_area
	var accum := 0.0
	var tri_idx := 0
	for i: int in range(tri_count):
		accum += areas[i]
		if accum >= r:
			tri_idx = i
			break

	# Random point in selected triangle (barycentric coordinates)
	var t0: Vector2 = shrunk[indices[tri_idx * 3]]
	var t1: Vector2 = shrunk[indices[tri_idx * 3 + 1]]
	var t2: Vector2 = shrunk[indices[tri_idx * 3 + 2]]
	var u := randf()
	var v := randf()
	if u + v > 1.0:
		u = 1.0 - u
		v = 1.0 - v
	return t0 + (t1 - t0) * u + (t2 - t0) * v


func _centroid(poly: PackedVector2Array) -> Vector2:
	var sum := Vector2.ZERO
	for p: Vector2 in poly:
		sum += p
	return sum / poly.size() if poly.size() > 0 else Vector2.ZERO


func _on_interact_requested(npc_id: String) -> void:
	var npc_name: String = NPC_NAMES.get(npc_id, npc_id)
	print("[Main] Interacting with %s" % npc_name)
	_chatting_with_npc = npc_id
	_dialog_panel.open_dialog(npc_id, npc_name)


func _on_dialog_closed() -> void:
	_chatting_with_npc = ""
	_player.movement_locked = false


func _on_dialog_action(action: String, npc_id: String) -> void:
	match action:
		"shop":
			# Fetch shop data and open panel
			var npc_name: String = NPC_NAMES.get(npc_id, npc_id)
			var data: Dictionary = await Backend.fetch_shop(npc_id)
			if data.has("items"):
				_shop_panel.open_shop(data.get("npcName", npc_name), data.get("items", []))
		"accuse":
			print("[Main] Accuse action — not yet implemented")


func _on_conversation_line(speaker: String, text: String) -> void:
	var npc_id: String = _name_to_id.get(speaker, "")
	if npc_id == "" or not _npc_nodes.has(npc_id):
		return
	var marker: Node2D = _npc_nodes[npc_id]
	if not is_instance_valid(marker):
		return

	# Walk speaker toward nearest NPC at same location (if far away)
	var speaker_loc: String = _npc_locations.get(npc_id, "")
	if speaker_loc != "":
		var closest_npc: Node2D = null
		var closest_dist := 999999.0
		for other_id: String in _npc_locations:
			if other_id == npc_id:
				continue
			if _npc_locations[other_id] == speaker_loc:
				var other_marker: Node2D = _npc_nodes.get(other_id)
				if other_marker and is_instance_valid(other_marker):
					var dist := marker.position.distance_to(other_marker.position)
					if dist < closest_dist:
						closest_dist = dist
						closest_npc = other_marker
		if closest_npc:
			# Turn the listener to face the speaker
			closest_npc.face_toward(marker.position)
			if closest_dist > 80.0:
				# Walk toward the other NPC, stop 60px away
				var dir := (closest_npc.position - marker.position).normalized()
				var meet_pos := closest_npc.position - dir * 60.0
				_tween_npc_to(npc_id, marker, meet_pos)

	# Show speech bubble
	var short_text: String = text.substr(0, 80)
	if text.length() > 80:
		short_text += "..."
	marker.show_bubble(short_text)


func _on_conversation_complete(initiator_id: String, responder_id: String, _location: String) -> void:
	# After conversation ends, scatter both NPCs back to random positions in their zones
	for npc_id: String in [initiator_id, responder_id]:
		if npc_id == "":
			continue
		var marker: Node2D = _npc_nodes.get(npc_id)
		if not marker or not is_instance_valid(marker):
			continue
		var loc: String = _npc_locations.get(npc_id, "")
		if loc != "" and _zone_polygons.has(loc):
			var new_pos: Vector2 = _random_point_in_zone(loc)
			_tween_npc_to(npc_id, marker, new_pos)


func _on_backend_connected() -> void:
	print("[Main] Backend connected, fetching state...")
	await Backend.fetch_time()
	await Backend.fetch_locations()
	var agents_data: Dictionary = await Backend.fetch_agents()
	if agents_data.size() > 0:
		_spawn_npcs(agents_data)
	var time: Dictionary = Backend.time_data
	if not time.is_empty():
		var tick: int = time.get("tickInDay", 0)
		var period: String = time.get("period", "")
		var day: int = time.get("gameDay", 1)
		var hour: String = time.get("hour", "")
		$HUD/TimeLabel.text = "Day %d | %s (%s) | Tick %d" % [day, hour, period, tick]


func _on_backend_disconnected() -> void:
	print("[Main] Backend disconnected")


func _on_tick_completed(_tick_data: Dictionary) -> void:
	var agents_data: Dictionary = await Backend.fetch_agents()
	if agents_data.size() > 0:
		_update_npcs(agents_data)


func _on_shop_opened(_agent_id: String, npc_name: String, items: Array) -> void:
	# Shop data received via WS — can be used as fallback or cache
	print("[Main] Shop data received: %s (%d items)" % [npc_name, items.size()])


func _on_investigate_requested(location_id: String) -> void:
	print("[Main] Investigating crime scene at %s" % location_id)
	var scene_data: Dictionary = await Backend.fetch_crime_scene(location_id)
	if scene_data.has("points"):
		_examine_panel.open_scene(location_id, scene_data)


func _on_crime_scene_created(location_id: String, crime_type: String, point_count: int) -> void:
	print("[Main] Crime scene: %s at %s (%d points)" % [crime_type, location_id, point_count])
	_crime_scene_locations[location_id] = true
	_spawn_crime_scene_marker(location_id)


func _spawn_crime_scene_marker(location_id: String) -> void:
	# Remove old marker if exists
	if _crime_scene_markers.has(location_id):
		var old: Node2D = _crime_scene_markers[location_id]
		if is_instance_valid(old):
			old.queue_free()

	var pos: Vector2 = LOCATION_POSITIONS.get(location_id, Vector2.ZERO)
	var marker := Node2D.new()
	marker.position = pos + Vector2(0, -10)
	marker.z_index = 10

	# Simple pulsing red circle indicator
	var script_text := '
extends Node2D
var _time: float = 0.0
func _process(delta: float) -> void:
	_time += delta
	queue_redraw()
func _draw() -> void:
	var pulse := 0.5 + sin(_time * 3.0) * 0.3
	draw_circle(Vector2.ZERO, 8, Color(0.8, 0.15, 0.1, pulse))
	draw_arc(Vector2.ZERO, 12, 0, TAU, 24, Color(0.9, 0.2, 0.15, pulse * 0.6), 1.5)
	draw_string(ThemeDB.fallback_font, Vector2(-10, -16), "!", HORIZONTAL_ALIGNMENT_CENTER, 20, 14, Color(0.95, 0.3, 0.2, pulse + 0.2))
'
	var gd_script := GDScript.new()
	gd_script.source_code = script_text
	gd_script.reload()
	marker.set_script(gd_script)

	_world_container.add_child(marker)
	_crime_scene_markers[location_id] = marker


func _on_murder_occurred(killer_name: String, victim_name: String) -> void:
	print("[Main] MURDER: %s killed %s!" % [killer_name, victim_name])
	# Mark victim as dead visually
	var victim_id: String = _name_to_id.get(victim_name, "")
	if victim_id != "" and _npc_nodes.has(victim_id):
		var marker: Node2D = _npc_nodes[victim_id]
		if is_instance_valid(marker):
			marker.alive = false
			marker.queue_redraw()


func _on_debug_llm(reason: String, target: String) -> void:
	var line := "[LLM] %s" % reason
	if target != "":
		line += " | %s" % target
	_debug_lines.append(line)
	if _debug_lines.size() > DEBUG_MAX_LINES:
		_debug_lines = _debug_lines.slice(-DEBUG_MAX_LINES)
	_debug_label.text = "\n".join(_debug_lines)

	# Auto-clear after 8 seconds
	get_tree().create_timer(8.0).timeout.connect(func() -> void:
		if _debug_lines.size() > 0:
			_debug_lines.remove_at(0)
			_debug_label.text = "\n".join(_debug_lines)
	, CONNECT_ONE_SHOT)


func _on_npc_moved(npc_name: String, _from_loc: String, to_loc: String) -> void:
	var npc_id: String = _name_to_id.get(npc_name, "")
	if npc_id != "":
		_place_npc_at_location(npc_id, to_loc)


func _unhandled_input(event: InputEvent) -> void:
	if _dialog_panel.visible or _examine_panel.visible or _shop_panel.visible or _journal_panel.visible:
		return
	if event is InputEventMouseMotion and event.button_mask & MOUSE_BUTTON_MASK_MIDDLE:
		_camera.position -= event.relative / _camera.zoom
	elif event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			_camera.zoom *= 1.1
			_camera.zoom = _camera.zoom.clamp(Vector2(0.1, 0.1), Vector2(3.0, 3.0))
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_camera.zoom /= 1.1
			_camera.zoom = _camera.zoom.clamp(Vector2(0.1, 0.1), Vector2(3.0, 3.0))
