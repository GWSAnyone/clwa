extends Node
## Autoload singleton: connects to CLWA server via WebSocket + HTTP REST.

signal world_state_updated(data: Dictionary)
signal event_received(event: Dictionary)
signal tick_completed(tick_data: Dictionary)
signal conversation_line(speaker: String, text: String)
signal conversation_complete(initiator: String, responder: String, location: String)
signal npc_moved(npc_id: String, from_loc: String, to_loc: String)
signal chat_token(agent_id: String, token: String)
signal chat_done(agent_id: String, full_reply: String)
signal murder_occurred(killer_name: String, victim_name: String)
signal intent_detected(agent_id: String, intent: String, target_npc: String, trust: int, claims_created: int)
signal shop_opened(agent_id: String, npc_name: String, items: Array)
signal crime_scene_created(location_id: String, crime_type: String, point_count: int)
signal debug_llm(reason: String, target: String)
signal journal_entry_added(entry: Dictionary)
signal npc_approach(npc_id: String, npc_name: String, display_text: String, urgency: float)
signal npc_thought(data: Dictionary)
signal mood_updated(npc_id: String, npc_name: String, old_mood: float, new_mood: float)
signal goal_changed(data: Dictionary)
signal event_cascaded(data: Dictionary)
signal relationship_changed(data: Dictionary)
signal connected
signal disconnected

const BASE_URL := "http://127.0.0.1:3000"
const WS_URL := "ws://127.0.0.1:3000/ws"
const HTTP_TIMEOUT := 120.0  # ticks can be slow due to LLM

var _ws := WebSocketPeer.new()
var _connected := false
var _reconnecting := false

# Cached world state
var agents: Dictionary = {}
var locations: Dictionary = {}
var time_data: Dictionary = {}


func _ready() -> void:
	print("[Backend] Starting, connecting to %s" % WS_URL)
	_connect_ws()


func _process(_delta: float) -> void:
	_ws.poll()
	var state := _ws.get_ready_state()

	match state:
		WebSocketPeer.STATE_OPEN:
			_reconnecting = false
			while _ws.get_available_packet_count() > 0:
				var pkt := _ws.get_packet()
				var text := pkt.get_string_from_utf8()
				_handle_ws_message(text)
			if not _connected:
				_connected = true
				print("[Backend] WebSocket connected!")
				connected.emit()

		WebSocketPeer.STATE_CLOSED:
			if _connected:
				_connected = false
				print("[Backend] WebSocket disconnected")
				disconnected.emit()
			if not _reconnecting:
				_reconnecting = true
				_schedule_reconnect()

		WebSocketPeer.STATE_CONNECTING:
			pass


func _schedule_reconnect() -> void:
	print("[Backend] Reconnecting in 2s...")
	get_tree().create_timer(2.0).timeout.connect(func() -> void:
		_reconnecting = false
		_ws = WebSocketPeer.new()
		_connect_ws()
	, CONNECT_ONE_SHOT)


func _connect_ws() -> void:
	print("[Backend] Attempting WS connect to %s" % WS_URL)
	var err := _ws.connect_to_url(WS_URL)
	if err != OK:
		push_warning("[Backend] WS connect_to_url returned error: %d" % err)
	else:
		print("[Backend] WS connect_to_url OK, waiting for handshake...")


func _handle_ws_message(text: String) -> void:
	var json := JSON.new()
	if json.parse(text) != OK:
		return
	var msg: Dictionary = json.data
	var msg_type: String = msg.get("type", "")
	var raw_data: Variant = msg.get("data", {})

	match msg_type:
		"conversation:line":
			if raw_data is Dictionary:
				var speaker: String = raw_data.get("speakerName", "")
				var line: String = raw_data.get("text", "")
				if speaker != "" and line != "":
					conversation_line.emit(speaker, line)

		"conversation:complete":
			if raw_data is Dictionary:
				var initiator: String = raw_data.get("initiator", "")
				var responder: String = raw_data.get("responder", "")
				var loc: String = raw_data.get("location", "")
				conversation_complete.emit(initiator, responder, loc)

		"tick":
			if raw_data is Dictionary:
				time_data = raw_data.get("time", {})
				tick_completed.emit(raw_data)

		"event":
			if raw_data is Dictionary:
				event_received.emit(raw_data)

		"movement":
			if raw_data is Array:
				print("[Backend] Movement received: %d entries" % raw_data.size())
				for m: Dictionary in raw_data:
					print("[Backend]   %s: %s -> %s" % [m.get("agentName", "?"), m.get("from", "?"), m.get("to", "?")])
					npc_moved.emit(m.get("agentName", ""), m.get("from", ""), m.get("to", ""))

		"goal:action":
			if raw_data is Dictionary:
				var desc: String = raw_data.get("description", "")
				var npc_owner: String = raw_data.get("ownerName", "")
				if desc != "":
					event_received.emit({"type": "goal", "subject": npc_owner, "description": desc})

		"state:update":
			pass

		"chat:token":
			if raw_data is Dictionary:
				chat_token.emit(raw_data.get("agentId", ""), raw_data.get("token", ""))

		"chat:done":
			if raw_data is Dictionary:
				chat_done.emit(raw_data.get("agentId", ""), raw_data.get("fullReply", ""))

		"intent":
			if raw_data is Dictionary:
				intent_detected.emit(
					raw_data.get("agentId", ""),
					raw_data.get("intent", "smalltalk"),
					raw_data.get("targetNpc", ""),
					raw_data.get("trust", 0),
					raw_data.get("claimsCreated", 0)
				)

		"shop:open":
			if raw_data is Dictionary:
				shop_opened.emit(
					raw_data.get("agentId", ""),
					raw_data.get("npcName", ""),
					raw_data.get("items", [])
				)

		"murder":
			if raw_data is Dictionary:
				var killer_name: String = raw_data.get("killerName", "")
				var victim_name: String = raw_data.get("victimName", "")
				murder_occurred.emit(killer_name, victim_name)
				event_received.emit({"type": "MURDER", "subject": killer_name, "object": victim_name})

		"crime:scene":
			if raw_data is Dictionary:
				crime_scene_created.emit(
					raw_data.get("locationId", ""),
					raw_data.get("crimeType", ""),
					raw_data.get("pointCount", 0)
				)

		"journal:entry":
			if raw_data is Dictionary:
				journal_entry_added.emit(raw_data)

		"npc_approach":
			if raw_data is Dictionary:
				npc_approach.emit(
					raw_data.get("npcId", ""),
					raw_data.get("npcName", ""),
					raw_data.get("displayText", ""),
					raw_data.get("urgency", 0.5)
				)

		"debug:llm":
			if raw_data is Dictionary:
				debug_llm.emit(
					raw_data.get("reason", ""),
					raw_data.get("target", "")
				)

		"reflection":
			if raw_data is Dictionary:
				var agent_name: String = raw_data.get("agentName", "")
				var refl_text: String = raw_data.get("text", "")
				event_received.emit({"type": "reflection", "subject": agent_name, "text": refl_text})

		"npc_thought":
			if raw_data is Dictionary:
				npc_thought.emit(raw_data)

		"mood_update":
			if raw_data is Dictionary:
				mood_updated.emit(
					raw_data.get("npcId", ""),
					raw_data.get("npcName", ""),
					raw_data.get("oldMood", 0.0),
					raw_data.get("newMood", 0.0)
				)

		"goal_update":
			if raw_data is Dictionary:
				goal_changed.emit(raw_data)

		"event_cascade":
			if raw_data is Dictionary:
				event_cascaded.emit(raw_data)

		"relationship_change":
			if raw_data is Dictionary:
				relationship_changed.emit(raw_data)


# --- REST API ---

func fetch_agents() -> Dictionary:
	print("[Backend] Fetching agents...")
	var result: Variant = await _http_get("/api/agents")
	if result is Array and result.size() > 0:
		agents = {}
		for agent_data: Dictionary in result:
			var id: String = agent_data.get("id", "")
			agents[id] = agent_data
		print("[Backend] Got %d agents" % agents.size())
		world_state_updated.emit(agents)
	return agents


func fetch_locations() -> Dictionary:
	var result: Variant = await _http_get("/api/locations")
	if result is Array and result.size() > 0:
		locations = {}
		for loc_data: Dictionary in result:
			var id: String = loc_data.get("id", "")
			locations[id] = loc_data
	return locations


func fetch_time() -> Dictionary:
	var result: Variant = await _http_get("/api/time")
	if result is Dictionary:
		time_data = result
	return time_data


func fetch_shop(npc_id: String) -> Dictionary:
	var result: Variant = await _http_get("/api/shop/%s" % npc_id)
	if result is Dictionary:
		return result
	return {}


func post_tick() -> Dictionary:
	return await _http_post("/api/tick")


func post_day() -> Dictionary:
	return await _http_post("/api/day")


func post_save() -> Dictionary:
	return await _http_post("/api/save")


func post_auto(seconds: int = 8) -> Dictionary:
	return await _http_post("/api/auto", {"seconds": seconds})


func post_kill(npc_id: String) -> Dictionary:
	return await _http_post("/api/kill/%s" % npc_id)


func fetch_crime_scene(location_id: String) -> Dictionary:
	var result: Variant = await _http_get("/api/crime-scene/%s" % location_id.uri_encode())
	if result is Dictionary:
		return result
	return {}


func examine_point(location_id: String, point_id: String) -> Dictionary:
	return await _http_post("/api/examine/%s/%s" % [location_id.uri_encode(), point_id])


func fetch_journal() -> Array:
	var result: Variant = await _http_get("/api/journal")
	if result is Array:
		return result
	return []


func update_player_location(location: String) -> void:
	# Fire and forget — don't need to await
	_http_post("/api/player/location", {"location": location})


func send_chat(npc_id: String, message: String) -> void:
	if _ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		var payload := JSON.stringify({"type": "chat", "agentId": npc_id, "message": message})
		_ws.send_text(payload)
	else:
		push_warning("[Backend] Cannot send chat — WS not connected")


# --- HTTP helpers ---

func _http_request(method: HTTPClient.Method, path: String, body_str: String = "") -> Variant:
	var http := HTTPRequest.new()
	http.timeout = HTTP_TIMEOUT
	add_child(http)
	var url := BASE_URL + path
	var headers := PackedStringArray(["Content-Type: application/json"])
	var err := http.request(url, headers, method, body_str)
	if err != OK:
		push_warning("[Backend] HTTP %s failed: %s" % [path, err])
		http.queue_free()
		return {}
	var response: Array = await http.request_completed
	http.queue_free()
	var response_code: int = response[1]
	var body: PackedByteArray = response[3]
	if response_code != 200:
		push_warning("[Backend] HTTP %d: %s" % [response_code, path])
		return {}
	var json_parser := JSON.new()
	if json_parser.parse(body.get_string_from_utf8()) != OK:
		return {}
	return json_parser.data


func _http_get(path: String) -> Variant:
	return await _http_request(HTTPClient.METHOD_GET, path)


func _http_post(path: String, req_data: Dictionary = {}) -> Dictionary:
	var body_str := JSON.stringify(req_data) if req_data.size() > 0 else ""
	var result: Variant = await _http_request(HTTPClient.METHOD_POST, path, body_str)
	return result if result is Dictionary else {}
