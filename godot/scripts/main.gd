extends Node2D
## Main scene controller — isometric village map with backend sync.

const NpcMarkerScript := preload("res://scripts/npc_marker.gd")
const IsoBuildingScript := preload("res://scripts/iso_building.gd")
const IsoGroundScript := preload("res://scripts/iso_ground.gd")
const PlayerScript := preload("res://scripts/player.gd")
const DialogPanelScript := preload("res://scripts/ui/dialog_panel.gd")
const ShopPanelScript := preload("res://scripts/ui/shop_panel.gd")
const DayNightScript := preload("res://scripts/ui/day_night_overlay.gd")
const VignetteScript := preload("res://scripts/ui/vignette.gd")
const ExaminePanelScript := preload("res://scripts/ui/examine_panel.gd")
const JournalPanelScript := preload("res://scripts/ui/journal_panel.gd")

# Location positions — isometric layout (screen coords)
const LOCATION_POSITIONS: Dictionary = {
	"Silver Flagon Tavern": Vector2(-60, 100),
	"Town Square": Vector2(0, -10),
	"Town Gate": Vector2(-280, -40),
	"Market Square": Vector2(250, -50),
	"Blacksmith": Vector2(300, 80),
	"Temple of Dawn": Vector2(60, -180),
	"Residential Lane": Vector2(-250, 80),
}

const BUILDING_CONFIGS: Dictionary = {
	"Silver Flagon Tavern": [Color(0.55, 0.32, 0.15), 100, 70, 55],
	"Town Square": [Color(0.35, 0.38, 0.30), 120, 80, 12],
	"Town Gate": [Color(0.4, 0.38, 0.35), 60, 50, 70],
	"Market Square": [Color(0.55, 0.48, 0.22), 90, 65, 35],
	"Blacksmith": [Color(0.45, 0.25, 0.2), 80, 60, 45],
	"Temple of Dawn": [Color(0.5, 0.5, 0.58), 90, 70, 65],
	"Residential Lane": [Color(0.38, 0.42, 0.35), 100, 65, 40],
}

const NPC_COLORS: Dictionary = {
	"ted": Color(0.8, 0.5, 0.2),
	"mark": Color(0.2, 0.7, 0.3),
	"elara": Color(0.7, 0.3, 0.8),
	"garrett": Color(0.3, 0.4, 0.8),
	"aldric": Color(0.9, 0.85, 0.4),
	"hilda": Color(0.7, 0.3, 0.2),
	"bess": Color(0.4, 0.65, 0.65),
}

const NPC_NAMES: Dictionary = {
	"ted": "Ted",
	"mark": "Mark",
	"elara": "Elara",
	"garrett": "Garrett",
	"aldric": "Fr. Aldric",
	"hilda": "Hilda",
	"bess": "Old Bess",
}

const NPC_ROLES: Dictionary = {
	"ted": "bartender",
	"mark": "merchant",
	"elara": "bard",
	"garrett": "guard",
	"aldric": "priest",
	"hilda": "blacksmith",
	"bess": "herbalist",
}

# Reverse map: display name -> npc id
var _name_to_id: Dictionary = {}

const NPC_INTERACT_DISTANCE := 60.0
const NPC_HIGHLIGHT_DISTANCE := 80.0
const LOCATION_DETECT_RADIUS := 100.0

var _npc_nodes: Dictionary = {}
var _npc_locations: Dictionary = {}
var _player: Node2D
var _dialog_panel: PanelContainer
var _shop_panel: PanelContainer
var _examine_panel: PanelContainer
var _journal_panel: PanelContainer
var _prev_highlighted: String = ""
var _player_location: String = ""  # current detected location
var _crime_scene_locations: Dictionary = {}  # location_id -> true (has active crime scene)
var _crime_scene_markers: Dictionary = {}  # location_id -> Node2D (visual marker)
var _debug_label: Label
var _debug_lines: Array[String] = []
const DEBUG_MAX_LINES := 6

@onready var _camera: Camera2D = $Camera2D
@onready var _world_container: Node2D = $World


func _ready() -> void:
	RenderingServer.set_default_clear_color(Color(0.08, 0.1, 0.08))

	# Build reverse name map
	for npc_id: String in NPC_NAMES:
		_name_to_id[NPC_NAMES[npc_id]] = npc_id

	# Ground
	var ground := Node2D.new()
	ground.set_script(IsoGroundScript)
	_world_container.add_child(ground)

	_build_roads()
	_build_locations()

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

	print("[Main] Isometric scene ready")

	# Backend signals
	Backend.connected.connect(_on_backend_connected)
	Backend.disconnected.connect(_on_backend_disconnected)
	Backend.tick_completed.connect(_on_tick_completed)
	Backend.npc_moved.connect(_on_npc_moved)
	Backend.conversation_line.connect(_on_conversation_line)
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
	_player.movement_locked = _dialog_panel.visible or _shop_panel.visible or _examine_panel.visible or _journal_panel.visible

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


func _build_locations() -> void:
	for loc_name: String in LOCATION_POSITIONS:
		var pos: Vector2 = LOCATION_POSITIONS[loc_name]
		var config: Array = BUILDING_CONFIGS.get(loc_name, [Color(0.4, 0.4, 0.4), 80, 60, 40])

		var building := Node2D.new()
		building.set_script(IsoBuildingScript)
		building.position = pos
		building.building_name = loc_name
		building.base_color = config[0]
		building.building_width = config[1]
		building.building_depth = config[2]
		building.building_height = config[3]
		_world_container.add_child(building)


func _build_roads() -> void:
	var roads: Array[Array] = [
		["Town Square", "Silver Flagon Tavern"],
		["Town Square", "Town Gate"],
		["Town Square", "Market Square"],
		["Town Square", "Temple of Dawn"],
		["Town Square", "Residential Lane"],
		["Market Square", "Blacksmith"],
	]
	for road: Array in roads:
		var from_pos: Vector2 = LOCATION_POSITIONS[road[0]]
		var to_pos: Vector2 = LOCATION_POSITIONS[road[1]]
		var line := Line2D.new()
		line.add_point(from_pos)
		line.add_point(to_pos)
		line.width = 2.5
		line.default_color = Color(0.4, 0.35, 0.25, 0.4)
		line.z_index = -5
		_world_container.add_child(line)


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
		_place_npc_at_location(npc_id, loc)
		marker.update_from_data(data)

	print("[Main] Spawned %d NPCs" % _npc_nodes.size())


func _place_npc_at_location(npc_id: String, location_id: String) -> void:
	var marker: Node2D = _npc_nodes.get(npc_id)
	if not marker:
		return
	var base_pos: Vector2 = LOCATION_POSITIONS.get(location_id, Vector2.ZERO)

	var npc_index := 0
	for id: String in _npc_locations:
		if _npc_locations[id] == location_id:
			if id == npc_id:
				break
			npc_index += 1

	var angle := -PI * 0.3 + npc_index * PI * 0.2
	var offset := Vector2(cos(angle) * 45, sin(angle) * 20 + 40)
	marker.position = base_pos + offset
	_npc_locations[npc_id] = location_id


func _on_interact_requested(npc_id: String) -> void:
	var npc_name: String = NPC_NAMES.get(npc_id, npc_id)
	print("[Main] Interacting with %s" % npc_name)
	_dialog_panel.open_dialog(npc_id, npc_name)


func _on_dialog_closed() -> void:
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
	# Show speech bubble above the speaking NPC
	var npc_id: String = _name_to_id.get(speaker, "")
	if npc_id != "" and _npc_nodes.has(npc_id):
		var marker: Node2D = _npc_nodes[npc_id]
		if is_instance_valid(marker):
			# Truncate long text for bubble
			var short_text: String = text.substr(0, 80)
			if text.length() > 80:
				short_text += "..."
			marker.show_bubble(short_text)


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
		_spawn_npcs(agents_data)


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
			_camera.zoom = _camera.zoom.clamp(Vector2(0.3, 0.3), Vector2(3.0, 3.0))
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_camera.zoom /= 1.1
			_camera.zoom = _camera.zoom.clamp(Vector2(0.3, 0.3), Vector2(3.0, 3.0))
