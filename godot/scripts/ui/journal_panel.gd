extends PanelContainer
## Player investigation journal — collects clues, testimonies, observations.

signal closed

var _title_label: Label
var _filter_container: HBoxContainer
var _entry_container: VBoxContainer
var _entries: Array = []
var _current_filter: String = "all"

const TYPE_ICONS: Dictionary = {
	"clue": "[C]",
	"testimony": "[T]",
	"observation": "[O]",
}

const TYPE_COLORS: Dictionary = {
	"clue": Color(0.9, 0.75, 0.3),
	"testimony": Color(0.5, 0.8, 0.9),
	"observation": Color(0.7, 0.9, 0.5),
}


func _ready() -> void:
	visible = false
	custom_minimum_size = Vector2(440, 400)
	anchors_preset = Control.PRESET_CENTER

	# Style — parchment-like
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.12, 0.11, 0.09, 0.95)
	style.border_color = Color(0.55, 0.45, 0.3, 0.8)
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
	_title_label.text = "Investigation Journal"
	_title_label.add_theme_font_size_override("font_size", 16)
	_title_label.add_theme_color_override("font_color", Color(0.9, 0.8, 0.55))
	_title_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(_title_label)

	# Filter buttons
	_filter_container = HBoxContainer.new()
	_filter_container.alignment = BoxContainer.ALIGNMENT_CENTER
	_filter_container.add_theme_constant_override("separation", 6)
	vbox.add_child(_filter_container)

	for filter_name: String in ["all", "clue", "testimony", "observation"]:
		var btn := Button.new()
		btn.text = filter_name.capitalize()
		btn.add_theme_font_size_override("font_size", 11)
		btn.toggle_mode = true
		btn.button_pressed = (filter_name == "all")
		btn.pressed.connect(_on_filter_pressed.bind(filter_name))
		_filter_container.add_child(btn)

	# Separator
	var sep := HSeparator.new()
	vbox.add_child(sep)

	# Scrollable entry list
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.custom_minimum_size.y = 250
	vbox.add_child(scroll)

	_entry_container = VBoxContainer.new()
	_entry_container.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_entry_container.add_theme_constant_override("separation", 6)
	scroll.add_child(_entry_container)

	# Close button
	var close_btn := Button.new()
	close_btn.text = "Close [J]"
	close_btn.pressed.connect(_on_close)
	vbox.add_child(close_btn)

	# Listen for new journal entries
	Backend.journal_entry_added.connect(_on_journal_entry)


func toggle() -> void:
	if visible:
		_on_close()
	else:
		open_journal()


func open_journal() -> void:
	# Fetch latest entries from server
	_entries = await Backend.fetch_journal()
	_rebuild_list()
	visible = true


func add_entry(entry: Dictionary) -> void:
	_entries.append(entry)
	if visible:
		_rebuild_list()


func _on_journal_entry(entry: Dictionary) -> void:
	add_entry(entry)


func _on_filter_pressed(filter_name: String) -> void:
	_current_filter = filter_name
	# Update toggle states
	for btn: Button in _filter_container.get_children():
		btn.button_pressed = (btn.text.to_lower() == filter_name)
	_rebuild_list()


func _rebuild_list() -> void:
	for child in _entry_container.get_children():
		child.queue_free()

	var filtered := _entries
	if _current_filter != "all":
		filtered = _entries.filter(func(e: Dictionary) -> bool:
			return e.get("type", "") == _current_filter
		)

	if filtered.is_empty():
		var empty := Label.new()
		empty.text = "No entries yet."
		empty.add_theme_color_override("font_color", Color(0.5, 0.5, 0.5))
		empty.add_theme_font_size_override("font_size", 12)
		_entry_container.add_child(empty)
		return

	# Show newest first
	var sorted := filtered.duplicate()
	sorted.reverse()

	for entry: Dictionary in sorted:
		var row := _create_entry_row(entry)
		_entry_container.add_child(row)


func _create_entry_row(entry: Dictionary) -> VBoxContainer:
	var row := VBoxContainer.new()
	row.add_theme_constant_override("separation", 2)

	var entry_type: String = entry.get("type", "clue")
	var icon: String = TYPE_ICONS.get(entry_type, "[?]")
	var color: Color = TYPE_COLORS.get(entry_type, Color.WHITE)

	# Header: icon + source + day
	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 6)

	var icon_label := Label.new()
	icon_label.text = icon
	icon_label.add_theme_font_size_override("font_size", 11)
	icon_label.add_theme_color_override("font_color", color)
	header.add_child(icon_label)

	var source_label := Label.new()
	var source: String = entry.get("source", "")
	source_label.text = source
	source_label.add_theme_font_size_override("font_size", 11)
	source_label.add_theme_color_override("font_color", Color(0.7, 0.65, 0.55))
	source_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(source_label)

	var day_label := Label.new()
	day_label.text = "Day %d" % entry.get("gameDay", 0)
	day_label.add_theme_font_size_override("font_size", 10)
	day_label.add_theme_color_override("font_color", Color(0.5, 0.5, 0.45))
	header.add_child(day_label)

	row.add_child(header)

	# Content text
	var text_label := Label.new()
	text_label.text = entry.get("text", "")
	text_label.add_theme_font_size_override("font_size", 11)
	text_label.add_theme_color_override("font_color", Color(0.82, 0.78, 0.68))
	text_label.autowrap_mode = TextServer.AUTOWRAP_WORD
	text_label.custom_minimum_size.x = 380
	row.add_child(text_label)

	# Bottom separator
	var sep := HSeparator.new()
	sep.add_theme_constant_override("separation", 4)
	row.add_child(sep)

	return row


func _on_close() -> void:
	visible = false
	closed.emit()


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode == KEY_J:
			toggle()
			get_viewport().set_input_as_handled()
		elif visible and event.keycode == KEY_ESCAPE:
			_on_close()
			get_viewport().set_input_as_handled()
