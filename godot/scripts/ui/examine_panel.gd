extends PanelContainer
## Crime scene examination panel — lists points of interest for the player to inspect.

signal closed
signal clue_found(clue_text: String)

var _location_id: String = ""
var _title_label: Label
var _point_container: VBoxContainer
var _detail_label: RichTextLabel
var _close_btn: Button


func _ready() -> void:
	visible = false
	custom_minimum_size = Vector2(400, 360)
	anchors_preset = Control.PRESET_CENTER

	# Style — dark, slightly reddish tint for crime scene
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.14, 0.08, 0.08, 0.95)
	style.border_color = Color(0.7, 0.25, 0.2, 0.8)
	style.border_width_bottom = 2
	style.border_width_top = 2
	style.border_width_left = 2
	style.border_width_right = 2
	style.corner_radius_top_left = 6
	style.corner_radius_top_right = 6
	style.corner_radius_bottom_left = 6
	style.corner_radius_bottom_right = 6
	style.content_margin_left = 14
	style.content_margin_right = 14
	style.content_margin_top = 12
	style.content_margin_bottom = 12
	add_theme_stylebox_override("panel", style)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 8)
	add_child(vbox)

	# Title
	_title_label = Label.new()
	_title_label.add_theme_font_size_override("font_size", 15)
	_title_label.add_theme_color_override("font_color", Color(0.9, 0.4, 0.3))
	_title_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(_title_label)

	# Separator
	var sep := HSeparator.new()
	vbox.add_child(sep)

	# Scrollable point list
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.custom_minimum_size.y = 140
	vbox.add_child(scroll)

	_point_container = VBoxContainer.new()
	_point_container.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_point_container.add_theme_constant_override("separation", 4)
	scroll.add_child(_point_container)

	# Detail area — shows clue text after examining a point
	var detail_sep := HSeparator.new()
	vbox.add_child(detail_sep)

	_detail_label = RichTextLabel.new()
	_detail_label.bbcode_enabled = true
	_detail_label.fit_content = true
	_detail_label.custom_minimum_size.y = 60
	_detail_label.add_theme_font_size_override("normal_font_size", 12)
	_detail_label.add_theme_color_override("default_color", Color(0.85, 0.8, 0.65))
	_detail_label.text = ""
	vbox.add_child(_detail_label)

	# Close button
	_close_btn = Button.new()
	_close_btn.text = "Leave"
	_close_btn.pressed.connect(_on_close)
	vbox.add_child(_close_btn)


func open_scene(location_id: String, scene_data: Dictionary) -> void:
	_location_id = location_id
	var crime_type: String = scene_data.get("crimeType", "crime")
	var victim: String = scene_data.get("victim", "")

	var title := "Crime Scene"
	if victim != "":
		title = "Crime Scene — %s" % victim
	_title_label.text = title

	_detail_label.text = ""

	# Clear old points
	for child in _point_container.get_children():
		child.queue_free()

	var points: Array = scene_data.get("points", [])
	if points.is_empty():
		var empty := Label.new()
		empty.text = "Nothing to examine."
		empty.add_theme_color_override("font_color", Color(0.5, 0.5, 0.5))
		_point_container.add_child(empty)
	else:
		for point: Dictionary in points:
			var btn := _create_point_button(point)
			_point_container.add_child(btn)

	visible = true


func _create_point_button(point: Dictionary) -> Button:
	var btn := Button.new()
	var examined: bool = point.get("examined", false)
	var desc: String = point.get("description", "???")
	var point_id: String = point.get("id", "")

	if examined:
		btn.text = "[Examined] %s" % desc
		btn.disabled = true
		btn.add_theme_color_override("font_color", Color(0.4, 0.4, 0.38))
		btn.add_theme_color_override("font_disabled_color", Color(0.4, 0.4, 0.38))
	else:
		btn.text = "[Examine] %s" % desc

	btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
	btn.add_theme_font_size_override("font_size", 11)
	btn.autowrap_mode = TextServer.AUTOWRAP_WORD

	if not examined:
		btn.pressed.connect(_on_examine_point.bind(point_id, btn))

	return btn


func _on_examine_point(point_id: String, btn: Button) -> void:
	btn.disabled = true
	btn.text = btn.text.replace("[Examine]", "[...]")

	var result: Dictionary = await Backend.examine_point(_location_id, point_id)
	if result.has("clueText"):
		var clue: String = result.get("clueText", "")
		_detail_label.text = "[color=#d4c89a][b]Clue found:[/b][/color] %s" % clue
		btn.text = "[Examined] %s" % result.get("description", btn.text)
		btn.add_theme_color_override("font_color", Color(0.4, 0.4, 0.38))
		btn.add_theme_color_override("font_disabled_color", Color(0.4, 0.4, 0.38))
		clue_found.emit(clue)
	else:
		btn.text = btn.text.replace("[...]", "[Examine]")
		btn.disabled = false
		_detail_label.text = "[color=#aa4444]Could not examine this.[/color]"


func _on_close() -> void:
	visible = false
	closed.emit()


func _unhandled_input(event: InputEvent) -> void:
	if visible and event is InputEventKey and event.pressed:
		if event.keycode == KEY_ESCAPE:
			_on_close()
			get_viewport().set_input_as_handled()
