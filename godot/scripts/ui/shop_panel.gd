extends PanelContainer
## Simple shop panel — shows NPC's wares when trade intent is detected.

signal closed

var _npc_name: String = ""
var _items: Array = []
var _title_label: Label
var _item_container: VBoxContainer
var _close_btn: Button


func _ready() -> void:
	visible = false
	custom_minimum_size = Vector2(340, 300)
	anchors_preset = Control.PRESET_CENTER

	# Style
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.12, 0.1, 0.08, 0.95)
	style.border_color = Color(0.6, 0.5, 0.3, 0.8)
	style.border_width_bottom = 2
	style.border_width_top = 2
	style.border_width_left = 2
	style.border_width_right = 2
	style.corner_radius_top_left = 6
	style.corner_radius_top_right = 6
	style.corner_radius_bottom_left = 6
	style.corner_radius_bottom_right = 6
	style.content_margin_left = 12
	style.content_margin_right = 12
	style.content_margin_top = 10
	style.content_margin_bottom = 10
	add_theme_stylebox_override("panel", style)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 8)
	add_child(vbox)

	# Title
	_title_label = Label.new()
	_title_label.add_theme_font_size_override("font_size", 16)
	_title_label.add_theme_color_override("font_color", Color(0.9, 0.8, 0.5))
	_title_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vbox.add_child(_title_label)

	# Separator
	var sep := HSeparator.new()
	vbox.add_child(sep)

	# Scrollable item list
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.custom_minimum_size.y = 180
	vbox.add_child(scroll)

	_item_container = VBoxContainer.new()
	_item_container.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_item_container.add_theme_constant_override("separation", 6)
	scroll.add_child(_item_container)

	# Close button
	_close_btn = Button.new()
	_close_btn.text = "Close"
	_close_btn.pressed.connect(_on_close)
	vbox.add_child(_close_btn)


func open_shop(npc_name: String, items: Array) -> void:
	_npc_name = npc_name
	_items = items
	_title_label.text = "%s's Wares" % npc_name

	# Clear old items
	for child in _item_container.get_children():
		child.queue_free()

	if items.is_empty():
		var empty_label := Label.new()
		empty_label.text = "Nothing for sale."
		empty_label.add_theme_color_override("font_color", Color(0.6, 0.6, 0.6))
		_item_container.add_child(empty_label)
	else:
		for item: Dictionary in items:
			var row := _create_item_row(item)
			_item_container.add_child(row)

	visible = true


func _create_item_row(item: Dictionary) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)

	# Item info (left side)
	var info := VBoxContainer.new()
	info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	info.add_theme_constant_override("separation", 2)

	var name_label := Label.new()
	name_label.text = item.get("name", "???")
	name_label.add_theme_font_size_override("font_size", 13)
	name_label.add_theme_color_override("font_color", Color(0.9, 0.85, 0.7))
	info.add_child(name_label)

	var desc_label := Label.new()
	desc_label.text = item.get("description", "")
	desc_label.add_theme_font_size_override("font_size", 10)
	desc_label.add_theme_color_override("font_color", Color(0.6, 0.6, 0.55))
	desc_label.autowrap_mode = TextServer.AUTOWRAP_WORD
	desc_label.custom_minimum_size.x = 200
	info.add_child(desc_label)

	row.add_child(info)

	# Price (right side)
	var price_label := Label.new()
	price_label.text = "%d gold" % item.get("price", 0)
	price_label.add_theme_font_size_override("font_size", 12)
	price_label.add_theme_color_override("font_color", Color(0.9, 0.75, 0.2))
	price_label.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(price_label)

	return row


func _on_close() -> void:
	visible = false
	closed.emit()


func _unhandled_input(event: InputEvent) -> void:
	if visible and event is InputEventKey and event.pressed:
		if event.keycode == KEY_ESCAPE:
			_on_close()
			get_viewport().set_input_as_handled()
