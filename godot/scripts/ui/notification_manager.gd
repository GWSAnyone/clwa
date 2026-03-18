extends CanvasLayer
## Notification system — floating popups for key world events.

var _container: VBoxContainer
var _active_count: int = 0
const MAX_NOTIFICATIONS := 5
const NOTIFICATION_DURATION := 6.0


func _ready() -> void:
	layer = 10  # Above everything

	_container = VBoxContainer.new()
	_container.anchor_left = 0.3
	_container.anchor_right = 0.7
	_container.anchor_top = 0.0
	_container.anchor_bottom = 0.0
	_container.offset_top = 60
	_container.add_theme_constant_override("separation", 6)
	add_child(_container)

	# Connect to backend signals
	Backend.murder_occurred.connect(_on_murder)
	Backend.event_received.connect(_on_event)
	Backend.crime_scene_created.connect(_on_crime_scene)
	Backend.npc_approach.connect(_on_npc_approach)


func _on_murder(killer_name: String, victim_name: String) -> void:
	_show("MURDER", "%s killed %s!" % [killer_name, victim_name], Color(0.9, 0.15, 0.1), Color(0.95, 0.2, 0.15))


func _on_crime_scene(location_id: String, _crime_type: String, _point_count: int) -> void:
	_show("CRIME SCENE", "Evidence found at %s" % location_id, Color(0.7, 0.25, 0.2), Color(0.8, 0.3, 0.25))


func _on_event(event: Dictionary) -> void:
	var event_type: String = event.get("type", "")
	var subject: String = event.get("subject", "")
	var _object_name: String = event.get("object", "")

	match event_type:
		"BODY_DISCOVERED":
			_show("BODY FOUND", "%s discovered a body!" % subject, Color(0.8, 0.5, 0.1), Color(0.9, 0.6, 0.2))
		"NPC_ARRESTED":
			_show("ARREST", "%s has been arrested" % subject, Color(0.8, 0.4, 0.1), Color(0.9, 0.5, 0.2))
		"NPC_SENTENCED":
			var verdict: String = event.get("verdict", "")
			var detail := "%s sentenced" % subject
			if verdict != "":
				detail = "%s: %s" % [subject, verdict.to_upper()]
			_show("VERDICT", detail, Color(0.5, 0.35, 0.6), Color(0.6, 0.4, 0.7))
		"NPC_FLED":
			_show("ESCAPE", "%s fled the village!" % subject, Color(0.6, 0.3, 0.3), Color(0.7, 0.35, 0.35))
		"WANTED_STATUS":
			_show("WANTED", "%s is now wanted" % subject, Color(0.85, 0.2, 0.15), Color(0.9, 0.25, 0.2))
		"THEFT_DISCOVERED":
			_show("THEFT", "Stolen goods discovered!" , Color(0.7, 0.55, 0.2), Color(0.8, 0.65, 0.3))


func _on_npc_approach(_npc_id: String, npc_name: String, display_text: String, urgency: float) -> void:
	var color := Color(0.2, 0.6, 0.8) if urgency < 0.7 else Color(0.85, 0.65, 0.2)
	_show("APPROACH", display_text if display_text != "" else "%s wants to talk" % npc_name, color, color.lightened(0.2))


func _show(title: String, message: String, bg_color: Color, border_color: Color) -> void:
	if _active_count >= MAX_NOTIFICATIONS:
		# Remove oldest
		if _container.get_child_count() > 0:
			_container.get_child(0).queue_free()
			_active_count -= 1

	var panel := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(bg_color.r * 0.3, bg_color.g * 0.3, bg_color.b * 0.3, 0.92)
	style.border_color = border_color
	style.border_width_bottom = 2
	style.border_width_top = 2
	style.border_width_left = 3
	style.border_width_right = 1
	style.corner_radius_top_left = 4
	style.corner_radius_top_right = 4
	style.corner_radius_bottom_left = 4
	style.corner_radius_bottom_right = 4
	style.content_margin_left = 12
	style.content_margin_right = 12
	style.content_margin_top = 8
	style.content_margin_bottom = 8
	panel.add_theme_stylebox_override("panel", style)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 2)
	panel.add_child(vbox)

	var title_label := Label.new()
	title_label.text = title
	title_label.add_theme_font_size_override("font_size", 13)
	title_label.add_theme_color_override("font_color", border_color)
	title_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(title_label)

	var msg_label := Label.new()
	msg_label.text = message
	msg_label.add_theme_font_size_override("font_size", 11)
	msg_label.add_theme_color_override("font_color", Color(0.85, 0.82, 0.75))
	msg_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	msg_label.autowrap_mode = TextServer.AUTOWRAP_WORD
	vbox.add_child(msg_label)

	_container.add_child(panel)
	_active_count += 1

	# Animate in
	panel.modulate.a = 0.0
	var tween := create_tween()
	tween.tween_property(panel, "modulate:a", 1.0, 0.3)
	tween.tween_interval(NOTIFICATION_DURATION)
	tween.tween_property(panel, "modulate:a", 0.0, 0.5)
	tween.tween_callback(func() -> void:
		panel.queue_free()
		_active_count -= 1
	)
