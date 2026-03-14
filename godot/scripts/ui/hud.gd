extends CanvasLayer
## HUD — time display, tick/day buttons, connection status, event log.

@onready var _status_label: Label = $StatusLabel
@onready var _tick_btn: Button = $Buttons/TickBtn
@onready var _day_btn: Button = $Buttons/DayBtn
@onready var _save_btn: Button = $Buttons/SaveBtn
@onready var _event_log: RichTextLabel = $EventLog

var _tick_in_progress := false


func _ready() -> void:
	_tick_btn.pressed.connect(_on_tick)
	_day_btn.pressed.connect(_on_day)
	_save_btn.pressed.connect(_on_save)

	Backend.connected.connect(func() -> void:
		_status_label.text = "Connected"
		_status_label.add_theme_color_override("font_color", Color.GREEN)
	)
	Backend.disconnected.connect(func() -> void:
		_status_label.text = "Disconnected"
		_status_label.add_theme_color_override("font_color", Color.RED)
	)

	# All WS events
	Backend.conversation_line.connect(_on_conversation_line)
	Backend.event_received.connect(_on_event)
	Backend.tick_completed.connect(_on_tick_done)
	Backend.npc_moved.connect(_on_npc_moved)


func _on_tick() -> void:
	if _tick_in_progress:
		return
	_tick_in_progress = true
	_tick_btn.disabled = true
	_tick_btn.text = "Ticking..."
	var result: Dictionary = await Backend.post_tick()
	if result.is_empty():
		# Tick failed (409 mutex or timeout) — reset, WS tick event will handle if it was just slow
		_append_log("[color=red]Tick request failed — server may be busy[/color]")
		_reset_tick_btn()


func _on_tick_done(tick_data: Dictionary) -> void:
	_reset_tick_btn()
	# Update time from tick data
	var time: Dictionary = tick_data.get("time", {})
	if not time.is_empty():
		var tick: int = time.get("tickInDay", 0)
		var period: String = time.get("period", "")
		var day: int = tick_data.get("gameDay", 1)
		var hour: String = time.get("hour", "")
		$TimeLabel.text = "Day %d | %s (%s) | Tick %d" % [day, hour, period, tick]
	_append_log("[color=gray]--- Tick %d ---[/color]" % tick_data.get("tickNumber", 0))


func _reset_tick_btn() -> void:
	_tick_in_progress = false
	_tick_btn.disabled = false
	_tick_btn.text = "Tick"


func _on_day() -> void:
	_day_btn.disabled = true
	_day_btn.text = "..."
	await Backend.post_day()
	_day_btn.disabled = false
	_day_btn.text = "Day"


func _on_save() -> void:
	_save_btn.disabled = true
	await Backend.post_save()
	_save_btn.disabled = false
	_append_log("[color=gray]State saved[/color]")


func _on_conversation_line(speaker: String, text: String) -> void:
	_append_log("[color=cyan]%s[/color]: %s" % [speaker, text])


func _on_npc_moved(npc_name: String, from_loc: String, to_loc: String) -> void:
	_append_log("[color=#888]%s: %s → %s[/color]" % [npc_name, from_loc, to_loc])


func _on_event(event: Dictionary) -> void:
	var event_type: String = event.get("type", "")
	var text: String = ""

	var subject: String = event.get("subject", "")

	match event_type:
		"KILL", "NPC_KILLED", "MURDER":
			text = "[color=red]KILL — %s[/color]" % subject
		"BODY_DISCOVERED":
			text = "[color=orange]BODY FOUND — %s[/color]" % subject
		"WANTED_STATUS":
			text = "[color=red]WANTED — %s[/color]" % subject
		"NPC_ARRESTED":
			text = "[color=#e88030]ARRESTED — %s[/color]" % subject
		"NPC_SENTENCED":
			var verdict: String = event.get("verdict", "")
			text = "[color=#9070c0]SENTENCED — %s (%s)[/color]" % [subject, verdict]
		"NPC_FLED":
			text = "[color=#c06060]FLED — %s[/color]" % subject
		"WITNESS_MEMORY":
			text = "[color=#8a8]WITNESS — %s[/color]" % subject
		"RUMOR_SPREAD":
			text = "[color=#888]RUMOR — %s[/color]" % subject
		"THEFT_DISCOVERED":
			text = "[color=#cc9930]THEFT — %s[/color]" % subject
		"goal":
			var desc: String = event.get("description", "")
			text = "[color=#aa8]%s: %s[/color]" % [subject, desc]
		"reflection":
			var refl: String = event.get("text", "")
			text = "[color=#a8a]%s reflects: %s[/color]" % [subject, refl]
		_:
			text = "[color=yellow]%s — %s[/color]" % [event_type, subject]

	if text != "":
		_append_log(text)


func _append_log(bbcode: String) -> void:
	_event_log.append_text(bbcode + "\n")
	await get_tree().process_frame
	_event_log.scroll_to_line(_event_log.get_line_count() - 1)
