extends PanelContainer
## Dialog panel — NPC conversation with streaming responses via WebSocket.

signal closed
signal action_requested(action: String, npc_id: String)

var _npc_name_label: Label
var _chat_log: RichTextLabel
var _input_field: LineEdit
var _send_btn: Button
var _close_btn: Button
var _action_container: HBoxContainer
var _talking_to: String = ""  # NPC id
var _talking_to_name: String = ""
var _streaming := false
var _stream_buffer: String = ""


func _ready() -> void:
	visible = false
	custom_minimum_size = Vector2(500, 300)
	anchor_left = 0.5
	anchor_right = 0.5
	anchor_top = 1.0
	anchor_bottom = 1.0
	offset_left = -250
	offset_right = 250
	offset_top = -310
	offset_bottom = -10

	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.1, 0.1, 0.12, 0.95)
	style.border_color = Color(0.4, 0.35, 0.25)
	style.set_border_width_all(2)
	style.set_corner_radius_all(4)
	style.set_content_margin_all(10)
	add_theme_stylebox_override("panel", style)

	var vbox := VBoxContainer.new()
	add_child(vbox)

	# Header
	var header := HBoxContainer.new()
	vbox.add_child(header)

	_npc_name_label = Label.new()
	_npc_name_label.text = "NPC"
	_npc_name_label.add_theme_font_size_override("font_size", 16)
	_npc_name_label.add_theme_color_override("font_color", Color(1, 0.85, 0.3))
	_npc_name_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(_npc_name_label)

	_close_btn = Button.new()
	_close_btn.text = "X"
	_close_btn.custom_minimum_size = Vector2(36, 36)
	_close_btn.focus_mode = Control.FOCUS_NONE  # don't steal focus from input field
	_close_btn.mouse_filter = Control.MOUSE_FILTER_STOP
	_close_btn.pressed.connect(_on_close)
	header.add_child(_close_btn)

	# Chat log
	_chat_log = RichTextLabel.new()
	_chat_log.bbcode_enabled = true
	_chat_log.scroll_following = true
	_chat_log.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_chat_log.custom_minimum_size = Vector2(0, 180)
	vbox.add_child(_chat_log)

	# Action buttons (shown when intent detected)
	_action_container = HBoxContainer.new()
	_action_container.add_theme_constant_override("separation", 8)
	_action_container.visible = false
	vbox.add_child(_action_container)

	# Input row
	var input_row := HBoxContainer.new()
	vbox.add_child(input_row)

	_input_field = LineEdit.new()
	_input_field.placeholder_text = "Say something..."
	_input_field.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_input_field.text_submitted.connect(_on_text_submitted)
	input_row.add_child(_input_field)

	_send_btn = Button.new()
	_send_btn.text = "Send"
	_send_btn.custom_minimum_size = Vector2(60, 0)
	_send_btn.pressed.connect(func() -> void: _on_text_submitted(_input_field.text))
	input_row.add_child(_send_btn)

	# Connect to backend chat signals
	Backend.chat_token.connect(_on_chat_token)
	Backend.chat_done.connect(_on_chat_done)
	Backend.intent_detected.connect(_on_intent_detected)


func open_dialog(npc_id: String, npc_name: String) -> void:
	_talking_to = npc_id
	_talking_to_name = npc_name
	_npc_name_label.text = npc_name
	_chat_log.clear()
	_chat_log.append_text("[color=gray]You approach %s...[/color]\n" % npc_name)
	# Reset streaming state in case previous dialog was interrupted
	_streaming = false
	_send_btn.disabled = false
	_input_field.editable = true
	visible = true
	_input_field.grab_focus()


func _on_text_submitted(text: String) -> void:
	if text.strip_edges().is_empty() or _streaming:
		return
	_input_field.clear()
	_clear_actions()
	_chat_log.append_text("[color=yellow]You[/color]: %s\n" % text)
	_streaming = true
	_stream_buffer = ""
	_send_btn.disabled = true
	_input_field.editable = false
	# Start NPC response line
	_chat_log.append_text("[color=cyan]%s[/color]: " % _talking_to_name)
	Backend.send_chat(_talking_to, text)


func _on_chat_token(agent_id: String, token: String) -> void:
	if agent_id != _talking_to or not visible:
		return
	_stream_buffer += token
	_chat_log.append_text(token)


func _on_chat_done(agent_id: String, _full_reply: String) -> void:
	if agent_id != _talking_to or not visible:
		return
	_chat_log.append_text("\n")
	_streaming = false
	_send_btn.disabled = false
	_input_field.editable = true
	_input_field.grab_focus()


func _on_intent_detected(agent_id: String, intent: String, _target_npc: String) -> void:
	if agent_id != _talking_to or not visible:
		return

	# Map intents to action buttons
	var action_label := ""
	var action_id := ""
	match intent:
		"trade":
			action_label = "Browse Wares"
			action_id = "shop"
		"accuse":
			action_label = "Press Further"
			action_id = "accuse"
		_:
			return  # No button for other intents

	_show_action_button(action_label, action_id)


func _show_action_button(label: String, action_id: String) -> void:
	# Clear previous actions
	_clear_actions()

	var btn := Button.new()
	btn.text = "[%s]" % label
	btn.add_theme_font_size_override("font_size", 12)

	# Style the button to look like an action prompt
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.2, 0.18, 0.12, 0.9)
	style.border_color = Color(0.7, 0.6, 0.3, 0.8)
	style.set_border_width_all(1)
	style.set_corner_radius_all(3)
	style.set_content_margin_all(6)
	btn.add_theme_stylebox_override("normal", style)

	var hover_style := style.duplicate()
	hover_style.bg_color = Color(0.3, 0.25, 0.15, 0.95)
	btn.add_theme_stylebox_override("hover", hover_style)

	btn.add_theme_color_override("font_color", Color(0.9, 0.8, 0.4))
	btn.pressed.connect(func() -> void:
		action_requested.emit(action_id, _talking_to)
		_clear_actions()
	)

	_action_container.add_child(btn)
	_action_container.visible = true


func _clear_actions() -> void:
	for child in _action_container.get_children():
		child.queue_free()
	_action_container.visible = false


func _on_close() -> void:
	visible = false
	_talking_to = ""
	_talking_to_name = ""
	_streaming = false
	_send_btn.disabled = false
	_input_field.editable = true
	_clear_actions()
	closed.emit()


func _unhandled_key_input(event: InputEvent) -> void:
	if visible and event is InputEventKey and event.pressed:
		if event.keycode == KEY_ESCAPE:
			_on_close()
			get_viewport().set_input_as_handled()


func get_talking_to() -> String:
	return _talking_to
