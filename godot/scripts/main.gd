extends Node2D
## Main scene controller — top-down village with Tiny Swords assets + backend sync.

const NpcScene := preload("res://scenes/npc.tscn")

# ─── NPC → Unit mapping (Tiny Swords) ───
const NPC_UNIT_MAP := {
	"ted": { "unit": "Pawn", "color": "Red", "item": " Meat" },
	"mark": { "unit": "Pawn", "color": "Yellow", "item": " Gold" },
	"elara": { "unit": "Monk", "color": "Purple", "item": "" },
	"garrett": { "unit": "Warrior", "color": "Blue", "item": "" },
	"aldric": { "unit": "Monk", "color": "Yellow", "item": "" },
	"hilda": { "unit": "Pawn", "color": "Red", "item": " Hammer" },
	"bess": { "unit": "Monk", "color": "Blue", "item": "" },
	"theron": { "unit": "Warrior", "color": "Purple", "item": "" },
}

# ─── Fallback positions (used if Area2D zone not found in scene) ───
const LOCATION_FALLBACKS := {
	"silver-flagon-tavern": Vector2(250, 480),
	"town-square": Vector2(600, 380),
	"town-gate": Vector2(950, 180),
	"market-square": Vector2(380, 220),
	"blacksmith": Vector2(130, 340),
	"temple-of-dawn": Vector2(820, 480),
	"residential-lane": Vector2(540, 620),
	"courthouse": Vector2(870, 620),
}

var _npc_nodes: Dictionary = {}  # npc_id → NPC node
var _player_node: Node2D = null
var _location_zones: Dictionary = {}  # location_slug → Area2D
var _nav_region: NavigationRegion2D = null
var _sprite_frames_cache: Dictionary = {}  # key → SpriteFrames


func _ready() -> void:
	_find_nav_region()
	_discover_location_zones()
	_connect_backend_signals()
	await _init_world()


func _find_nav_region() -> void:
	# Search for NavigationRegion2D recursively
	_nav_region = _find_child_of_type(self, "NavigationRegion2D") as NavigationRegion2D
	if _nav_region:
		print("[Main] NavigationRegion2D found: %s" % _nav_region.name)
	else:
		print("[Main] WARNING: No NavigationRegion2D — NPC movement will use tween fallback")


func _find_child_of_type(node: Node, type_name: String) -> Node:
	for child: Node in node.get_children():
		if child.get_class() == type_name:
			return child
		var found := _find_child_of_type(child, type_name)
		if found:
			return found
	return null


func _discover_location_zones() -> void:
	## Find all Area2D children in "Locations" node — search recursively
	var locations_node: Node = null
	for child: Node in get_children():
		var found := child.get_node_or_null("Locations")
		if found:
			locations_node = found
			break
	if not locations_node:
		locations_node = get_node_or_null("Locations")
	if not locations_node:
		print("[Main] No 'Locations' node found — using fallback positions")
		return
	for child: Node in locations_node.get_children():
		if child is Area2D:
			_location_zones[child.name] = child
			print("[Main] Zone found: %s at %s" % [child.name, child.global_position])
	print("[Main] Discovered %d location zones" % _location_zones.size())


func _connect_backend_signals() -> void:
	Backend.connected.connect(_on_connected)
	Backend.tick_completed.connect(_on_tick)
	Backend.npc_moved.connect(_on_npc_moved)
	Backend.murder_occurred.connect(_on_murder)
	Backend.event_received.connect(_on_event)
	Backend.conversation_line.connect(_on_conversation_line)
	Backend.conversation_complete.connect(_on_conversation_complete)
	Backend.npc_approach.connect(_on_npc_approach)
	# New overlay signals
	Backend.npc_thought.connect(_on_npc_thought)
	Backend.mood_updated.connect(_on_mood_updated)
	Backend.goal_changed.connect(_on_goal_changed)
	Backend.event_cascaded.connect(_on_event_cascaded)
	Backend.relationship_changed.connect(_on_relationship_changed)


func _on_connected() -> void:
	# _init_world() already called from _ready() — skip duplicate
	pass


# ─── World Init ───

func _init_world() -> void:
	# Clear existing NPCs
	for node: Node2D in _npc_nodes.values():
		node.queue_free()
	_npc_nodes.clear()

	# Fetch agents from server
	var agent_data: Dictionary = await Backend.fetch_agents()
	if agent_data.is_empty():
		print("[Main] No agents received, waiting...")
		return

	print("[Main] Spawning %d NPCs..." % agent_data.size())
	for id: String in agent_data:
		var agent: Dictionary = agent_data[id]
		_spawn_npc(id, agent)

	# Spawn player
	_spawn_player()


func _spawn_npc(id: String, agent: Dictionary) -> void:
	var npc: Node2D = NpcScene.instantiate()
	add_child(npc)

	var display_name: String = agent.get("name", id)
	var location: String = agent.get("location", "town-square")
	var mood: float = agent.get("mood", 0.0)
	var alive: bool = agent.get("alive", true)
	var npc_status: String = agent.get("status", "")

	# Get sprite frames for this NPC type
	var frames := _get_sprite_frames(id)
	npc.setup(id, display_name, frames)

	# Position at location — use zone polygon or fallback
	npc.position = _get_location_point(location)

	# Apply initial state
	npc.update_mood(mood)
	if not alive:
		npc.set_dead()
	elif npc_status != "":
		npc.set_status(npc_status)

	_npc_nodes[id] = npc
	print("[Main] Spawned %s at %s" % [display_name, location])


func _spawn_player() -> void:
	# Reuse NPC scene for player (same visual structure)
	_player_node = NpcScene.instantiate()
	# Replace script with player script
	var player_script := preload("res://scripts/player.gd")
	_player_node.set_script(player_script)
	add_child(_player_node)

	var frames := _get_sprite_frames("player")
	_player_node.setup(frames)
	_player_node.position = LOCATION_FALLBACKS.get("town-square", Vector2(600, 400))
	_player_node.interact_requested.connect(_on_player_interact)

	# Camera follows player
	var camera := Camera2D.new()
	camera.zoom = Vector2(0.8, 0.8)
	camera.position_smoothing_enabled = true
	camera.position_smoothing_speed = 8.0
	_player_node.add_child(camera)
	camera.make_current()


# ─── Sprite Frames ───

func _get_sprite_frames(npc_id: String) -> SpriteFrames:
	var mapping: Dictionary = NPC_UNIT_MAP.get(npc_id, { "unit": "Warrior", "color": "Blue", "item": "" })
	var unit: String = mapping["unit"]
	var color: String = mapping["color"]
	var item: String = mapping.get("item", "")
	var cache_key := "%s_%s%s" % [unit, color, item]

	if _sprite_frames_cache.has(cache_key):
		return _sprite_frames_cache[cache_key]

	var frames := SpriteFrames.new()

	# Build paths based on unit type
	var base_path := "res://assets/tinyswords/Units/%s Units/%s/" % [color, unit]

	# Idle animation
	var idle_name: String
	if unit == "Pawn":
		idle_name = "Pawn_Idle%s.png" % item
	elif unit == "Monk":
		idle_name = "Idle.png"
	else:
		idle_name = "%s_Idle.png" % unit
	_add_sheet_animation(frames, "idle", base_path + idle_name, 192, 8)

	# Run animation
	var run_name: String
	if unit == "Pawn":
		run_name = "Pawn_Run%s.png" % item
	elif unit == "Monk":
		run_name = "Run.png"
	else:
		run_name = "%s_Run.png" % unit
	_add_sheet_animation(frames, "run", base_path + run_name, 192, 10)

	# Remove default animation if it exists
	if frames.has_animation("default"):
		frames.remove_animation("default")

	_sprite_frames_cache[cache_key] = frames
	return frames


func _add_sheet_animation(frames: SpriteFrames, anim_name: String, sheet_path: String, frame_size: int, fps: float) -> void:
	var texture := load(sheet_path) as Texture2D
	if not texture:
		print("[Main] WARNING: Cannot load sprite sheet: %s" % sheet_path)
		return

	frames.add_animation(anim_name)
	frames.set_animation_speed(anim_name, fps)
	frames.set_animation_loop(anim_name, true)

	var sheet_width: int = texture.get_width()
	var frame_count: int = sheet_width / frame_size

	for i: int in range(frame_count):
		var atlas := AtlasTexture.new()
		atlas.atlas = texture
		atlas.region = Rect2(i * frame_size, 0, frame_size, frame_size)
		frames.add_frame(anim_name, atlas)


# ─── Backend Event Handlers ───

func _on_tick(_data: Dictionary) -> void:
	pass  # HUD updates handled by hud.gd


func _on_npc_moved(npc_name: String, _from: String, to_loc: String) -> void:
	var target := _get_location_point(to_loc)
	print("[Main] NPC MOVED signal: %s -> %s target=%s" % [npc_name, to_loc, target])
	for id: String in _npc_nodes:
		var npc: Node2D = _npc_nodes[id]
		if npc.npc_name == npc_name:
			print("[Main]   Found NPC %s at pos=%s, moving to %s" % [npc_name, npc.position, target])
			npc.move_to_position(target)
			break


func _on_murder(killer_name: String, victim_name: String) -> void:
	for id: String in _npc_nodes:
		var npc: Node2D = _npc_nodes[id]
		if npc.npc_name == victim_name:
			npc.set_dead()
			break


func _on_event(event: Dictionary) -> void:
	var event_type: String = event.get("type", "")
	var subject: String = event.get("subject", "")

	# Update NPC status on status-changing events
	match event_type:
		"NPC_ARRESTED":
			_set_npc_status_by_name(event.get("object", ""), "detained")
		"NPC_SENTENCED":
			var verdict: String = event.get("payload", {}).get("verdict", "")
			if verdict == "exile":
				_set_npc_status_by_name(event.get("object", ""), "exiled")
			elif verdict == "release":
				_set_npc_status_by_name(event.get("object", ""), "")
		"NPC_FLED":
			_set_npc_status_by_name(subject, "fled")


func _on_conversation_line(speaker: String, text: String) -> void:
	# Show speech bubble on NPC
	for id: String in _npc_nodes:
		var npc: Node2D = _npc_nodes[id]
		if npc.npc_name == speaker:
			npc.show_thought(text, "", "", 3.0)
			break


func _on_conversation_complete(initiator_name: String, responder_name: String, _loc: String) -> void:
	# Move NPCs toward each other when conversation starts
	var init_node: Node2D = null
	var resp_node: Node2D = null
	for id: String in _npc_nodes:
		var npc: Node2D = _npc_nodes[id]
		if npc.npc_name == initiator_name:
			init_node = npc
		elif npc.npc_name == responder_name:
			resp_node = npc
	if init_node and resp_node:
		# Move toward midpoint between them
		var mid := (init_node.global_position + resp_node.global_position) / 2.0
		init_node.move_to_position(mid + Vector2(-20, 0))
		resp_node.move_to_position(mid + Vector2(20, 0))


func _on_npc_approach(_npc_id: String, npc_name: String, text: String, _urgency: float) -> void:
	print("[Main] %s approaches: %s" % [npc_name, text])


# ─── New Overlay Handlers ───

func _on_npc_thought(data: Dictionary) -> void:
	var npc_id: String = data.get("npcId", "")
	if _npc_nodes.has(npc_id):
		var npc: Node2D = _npc_nodes[npc_id]
		var action: String = data.get("action", "")
		var reason: String = data.get("reason", "")
		var tier: String = data.get("instinctTier", "")
		npc.show_thought(action, reason, tier)


func _on_mood_updated(npc_id: String, _npc_name: String, _old_mood: float, new_mood: float) -> void:
	if _npc_nodes.has(npc_id):
		_npc_nodes[npc_id].update_mood(new_mood)


func _on_goal_changed(data: Dictionary) -> void:
	var npc_id: String = data.get("npcId", "")
	if not _npc_nodes.has(npc_id):
		return
	var npc: Node2D = _npc_nodes[npc_id]
	var goal_status: String = data.get("status", "")
	match goal_status:
		"created":
			npc.show_goal(data.get("goalType", ""))
		"completed", "failed":
			npc.hide_goal()


func _on_event_cascaded(data: Dictionary) -> void:
	# TODO: feed to EventFeed panel
	var trigger_type: String = data.get("triggerType", "")
	var consequences: Array = data.get("consequences", [])
	print("[Cascade] %s → %d consequences" % [trigger_type, consequences.size()])


func _on_relationship_changed(data: Dictionary) -> void:
	# TODO: feed to RelationshipOverlay
	pass


func _on_player_interact(npc_id: String) -> void:
	# TODO: open dialog panel
	print("[Main] Player interacts with %s" % npc_id)


# ─── Helpers ───

func _get_location_point(location_slug: String) -> Vector2:
	## Get random point inside location zone polygon, or fallback to center
	if _location_zones.has(location_slug):
		var zone: Area2D = _location_zones[location_slug]
		for child: Node in zone.get_children():
			if child is CollisionPolygon2D:
				var col := child as CollisionPolygon2D
				var offset: Vector2 = zone.global_position + col.position
				var shrunk := _shrink_polygon(col.polygon, 40.0)
				return _random_point_in_polygon(shrunk, offset)
		# Area2D without polygon — use polygon centroid fallback
		return zone.global_position + Vector2(randf_range(-20, 20), randf_range(-20, 20))
	return LOCATION_FALLBACKS.get(location_slug, Vector2(400, 400))


func _random_point_in_polygon(polygon: PackedVector2Array, offset: Vector2) -> Vector2:
	## Random point inside a convex/concave polygon via triangle decomposition
	if polygon.size() < 3:
		return offset
	# Triangulate
	var indices := Geometry2D.triangulate_polygon(polygon)
	if indices.is_empty():
		# Fallback: random point in bounding rect
		var rect := _polygon_bounds(polygon)
		return offset + Vector2(randf_range(rect.position.x, rect.end.x), randf_range(rect.position.y, rect.end.y))

	# Pick random triangle weighted by area
	var tri_count: int = indices.size() / 3
	var areas: Array[float] = []
	var total_area := 0.0
	for i: int in range(tri_count):
		var a: Vector2 = polygon[indices[i * 3]]
		var b: Vector2 = polygon[indices[i * 3 + 1]]
		var c: Vector2 = polygon[indices[i * 3 + 2]]
		var area: float = absf((b - a).cross(c - a)) * 0.5
		areas.append(area)
		total_area += area

	var r := randf() * total_area
	var cumulative := 0.0
	var tri_idx := 0
	for i: int in range(tri_count):
		cumulative += areas[i]
		if cumulative >= r:
			tri_idx = i
			break

	# Random point in selected triangle (barycentric)
	var a: Vector2 = polygon[indices[tri_idx * 3]]
	var b: Vector2 = polygon[indices[tri_idx * 3 + 1]]
	var c: Vector2 = polygon[indices[tri_idx * 3 + 2]]
	var u := randf()
	var v := randf()
	if u + v > 1.0:
		u = 1.0 - u
		v = 1.0 - v
	return offset + a + u * (b - a) + v * (c - a)


func _polygon_bounds(polygon: PackedVector2Array) -> Rect2:
	var min_p := polygon[0]
	var max_p := polygon[0]
	for p: Vector2 in polygon:
		min_p = Vector2(minf(min_p.x, p.x), minf(min_p.y, p.y))
		max_p = Vector2(maxf(max_p.x, p.x), maxf(max_p.y, p.y))
	return Rect2(min_p, max_p - min_p)


func _shrink_polygon(polygon: PackedVector2Array, margin: float) -> PackedVector2Array:
	## Shrink polygon inward by margin pixels using Geometry2D offset
	var results := Geometry2D.offset_polygon(polygon, -margin)
	if results.size() > 0 and results[0].size() >= 3:
		return results[0]
	# Fallback: shrink toward centroid manually
	var cx := 0.0
	var cy := 0.0
	for p: Vector2 in polygon:
		cx += p.x
		cy += p.y
	cx /= polygon.size()
	cy /= polygon.size()
	var center := Vector2(cx, cy)
	var shrunk := PackedVector2Array()
	for p: Vector2 in polygon:
		shrunk.append(p.move_toward(center, margin))
	return shrunk


func _set_npc_status_by_name(npc_name: String, new_status: String) -> void:
	for id: String in _npc_nodes:
		var npc: Node2D = _npc_nodes[id]
		if npc.npc_name == npc_name:
			npc.set_status(new_status)
			break
