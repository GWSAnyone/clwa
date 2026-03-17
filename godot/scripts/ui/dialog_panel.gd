extends PanelContainer
## Dialog panel — NPC conversation with streaming, chat history, trust display, IL feedback.

signal closed
signal action_requested(action: String, npc_id: String)

var _header: HBoxContainer
var _npc_name_label: Label
var _trust_bar: ProgressBar
var _trust_label: Label
var _chat_log: RichTextLabel
var _input_field: LineEdit
var _send_btn: Button
var _close_btn: Button
var _action_container: HBoxContainer
var _talking_to: String = ""
var _talking_to_name: String = ""
var _streaming := false
var _stream_buffer: String = ""

# Per-NPC chat history persists across dialog open/close
var _chat_histories: Dictionary = {}  # npc_id -> Array[{role, text}]
const MAX_HISTORY := 20
const HISTORY_DISPLAY := 8

# Colors
const CLR_GOLD := Color(0.92, 0.78, 0.35)
const CLR_DIM := Color(0.45, 0.42, 0.38)
const CLR_PLAYER := Color(0.95, 0.88, 0.55)
const CLR_NPC := Color(0.65, 0.82, 0.78)
const CLR_SYSTEM := Color(0.5, 0.48, 0.42)
const CLR_IL := Color(0.55, 0.65, 0.55)
const CLR_BG := Color(0.08, 0.08, 0.1, 0.96)
const CLR_BORDER := Color(0.35, 0.3, 0.22)


func _ready() -> void:
	visible = false
	custom_minimum_size = Vector2(540, 360)
	anchor_left = 0.5
	anchor_right = 0.5
	anchor_top = 1.0
	anchor_bottom = 1.0
	offset_left = -270
	offset_right = 270
	offset_top = -370
	offset_bottom = -10

	var style := StyleBoxFlat.new()
	style.bg_color = CLR_BG
	style.border_color = CLR_BORDER
	style.set_border_width_all(1)
	style.set_corner_radius_all(6)
	style.content_margin_left = 14
	style.content_margin_right = 14
	style.content_margin_top = 10
	style.content_margin_bottom = 10
	add_theme_stylebox_override("panel", style)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 6)
	add_child(vbox)

	# ── Header row: name + trust + close ──
	_header = HBoxContainer.new()
	_header.add_theme_constant_override("separation", 10)
	vbox.add_child(_header)

	_npc_name_label = Label.new()
	_npc_name_label.add_theme_font_size_override("font_size", 15)
	_npc_name_label.add_theme_color_override("font_color", CLR_GOLD)
	_header.add_child(_npc_name_label)

	# Trust section (bar + label)
	var trust_box := HBoxContainer.new()
	trust_box.add_theme_constant_override("separation", 4)
	trust_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	trust_box.alignment = BoxContainer.ALIGNMENT_END
	_header.add_child(trust_box)

	var trust_prefix := Label.new()
	trust_prefix.text = "Trust"
	trust_prefix.add_theme_font_size_override("font_size", 10)
	trust_prefix.add_theme_color_override("font_color", CLR_DIM)
	trust_box.add_child(trust_prefix)

	_trust_bar = ProgressBar.new()
	_trust_bar.custom_minimum_size = Vector2(60, 6)
	_trust_bar.max_value = 100
	_trust_bar.value = 30
	_trust_bar.show_percentage = false
	_trust_bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	# Style the bar
	var bar_bg := StyleBoxFlat.new()
	bar_bg.bg_color = Color(0.15, 0.15, 0.15)
	bar_bg.set_corner_radius_all(3)
	_trust_bar.add_theme_stylebox_override("background", bar_bg)
	var bar_fill := StyleBoxFlat.new()
	bar_fill.bg_color = Color(0.7, 0.5, 0.2)
	bar_fill.set_corner_radius_all(3)
	_trust_bar.add_theme_stylebox_override("fill", bar_fill)
	trust_box.add_child(_trust_bar)

	_trust_label = Label.new()
	_trust_label.add_theme_font_size_override("font_size", 10)
	_trust_label.add_theme_color_override("font_color", CLR_DIM)
	trust_box.add_child(_trust_label)

	_close_btn = Button.new()
	_close_btn.text = "×"
	_close_btn.custom_minimum_size = Vector2(28, 28)
	_close_btn.focus_mode = Control.FOCUS_NONE
	_close_btn.mouse_filter = Control.MOUSE_FILTER_STOP
	var close_style := StyleBoxFlat.new()
	close_style.bg_color = Color(0.15, 0.12, 0.1, 0.6)
	close_style.set_corner_radius_all(4)
	_close_btn.add_theme_stylebox_override("normal", close_style)
	_close_btn.add_theme_color_override("font_color", CLR_DIM)
	_close_btn.add_theme_font_size_override("font_size", 16)
	_close_btn.pressed.connect(_on_close)
	_header.add_child(_close_btn)

	# ── Separator ──
	var sep := HSeparator.new()
	sep.add_theme_constant_override("separation", 2)
	sep.add_theme_stylebox_override("separator", _make_line(CLR_BORDER, 1))
	vbox.add_child(sep)

	# ── Chat log ──
	_chat_log = RichTextLabel.new()
	_chat_log.bbcode_enabled = true
	_chat_log.scroll_following = true
	_chat_log.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_chat_log.custom_minimum_size = Vector2(0, 200)
	_chat_log.add_theme_font_size_override("normal_font_size", 13)
	_chat_log.add_theme_color_override("default_color", Color(0.78, 0.75, 0.7))
	vbox.add_child(_chat_log)

	# ── Action buttons ──
	_action_container = HBoxContainer.new()
	_action_container.add_theme_constant_override("separation", 8)
	_action_container.visible = false
	vbox.add_child(_action_container)

	# ── Input row ──
	var input_row := HBoxContainer.new()
	input_row.add_theme_constant_override("separation", 6)
	vbox.add_child(input_row)

	_input_field = LineEdit.new()
	_input_field.placeholder_text = "Say something..."
	_input_field.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var input_style := StyleBoxFlat.new()
	input_style.bg_color = Color(0.12, 0.12, 0.14)
	input_style.border_color = Color(0.25, 0.22, 0.18)
	input_style.set_border_width_all(1)
	input_style.set_corner_radius_all(4)
	input_style.content_margin_left = 8
	input_style.content_margin_right = 8
	_input_field.add_theme_stylebox_override("normal", input_style)
	_input_field.add_theme_color_override("font_color", Color(0.9, 0.87, 0.8))
	_input_field.add_theme_color_override("font_placeholder_color", Color(0.4, 0.38, 0.35))
	_input_field.add_theme_font_size_override("font_size", 13)
	_input_field.text_submitted.connect(_on_text_submitted)
	input_row.add_child(_input_field)

	_send_btn = Button.new()
	_send_btn.text = "→"
	_send_btn.custom_minimum_size = Vector2(36, 0)
	var send_style := StyleBoxFlat.new()
	send_style.bg_color = Color(0.25, 0.22, 0.15)
	send_style.border_color = CLR_BORDER
	send_style.set_border_width_all(1)
	send_style.set_corner_radius_all(4)
	_send_btn.add_theme_stylebox_override("normal", send_style)
	var send_hover := send_style.duplicate()
	send_hover.bg_color = Color(0.35, 0.3, 0.2)
	_send_btn.add_theme_stylebox_override("hover", send_hover)
	_send_btn.add_theme_color_override("font_color", CLR_GOLD)
	_send_btn.add_theme_font_size_override("font_size", 16)
	_send_btn.pressed.connect(func() -> void: _on_text_submitted(_input_field.text))
	input_row.add_child(_send_btn)

	# Backend signals
	Backend.chat_token.connect(_on_chat_token)
	Backend.chat_done.connect(_on_chat_done)
	Backend.intent_detected.connect(_on_intent_detected)


func open_dialog(npc_id: String, npc_name: String) -> void:
	_talking_to = npc_id
	_talking_to_name = npc_name
	_npc_name_label.text = npc_name
	_set_trust(30)  # default until intent event arrives
	_chat_log.clear()

	# Restore history
	if _chat_histories.has(npc_id):
		var history: Array = _chat_histories[npc_id]
		var start_idx: int = max(0, history.size() - HISTORY_DISPLAY)
		if start_idx > 0:
			_chat_log.append_text("[color=#333]... earlier ...[/color]\n")
		for i: int in range(start_idx, history.size()):
			var entry: Dictionary = history[i]
			_append_message(entry.role, entry.text)
		if history.size() > 0:
			_chat_log.append_text("\n")
	else:
		_chat_log.append_text("[color=#444]You approach %s.[/color]\n\n" % npc_name)

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
	_append_message("player", text)
	_ensure_history(_talking_to)
	_chat_histories[_talking_to].append({ "role": "player", "text": text })
	_trim_history(_talking_to)
	_streaming = true
	_stream_buffer = ""
	_send_btn.disabled = true
	_input_field.editable = false
	_chat_log.append_text("[color=#%s]%s[/color]  " % [CLR_NPC.to_html(false), _talking_to_name])
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
	_ensure_history(_talking_to)
	_chat_histories[_talking_to].append({ "role": "npc", "text": _stream_buffer })
	_trim_history(_talking_to)
	_streaming = false
	_send_btn.disabled = false
	_input_field.editable = true
	_input_field.grab_focus()


func _on_intent_detected(agent_id: String, intent: String, _target_npc: String, trust: int, claims_created: int) -> void:
	if agent_id != _talking_to or not visible:
		return

	_set_trust(trust)

	# IL feedback — subtle inline
	if claims_created > 0:
		_chat_log.append_text("[color=#%s]  · %d belief(s) registered[/color]\n" % [CLR_IL.to_html(false), claims_created])

	match intent:
		"trade":
			_show_action_button("Browse Wares", "shop")
		"accuse":
			_show_action_button("Press Further", "accuse")


func _set_trust(value: int) -> void:
	_trust_bar.value = value
	_trust_label.text = "%d%%" % value
	# Color gradient: red → yellow → green
	var t := clampf(value / 100.0, 0.0, 1.0)
	var bar_color: Color
	if t < 0.4:
		bar_color = Color(0.7, 0.3, 0.25).lerp(Color(0.75, 0.6, 0.25), t / 0.4)
	else:
		bar_color = Color(0.75, 0.6, 0.25).lerp(Color(0.35, 0.7, 0.35), (t - 0.4) / 0.6)
	var fill := _trust_bar.get_theme_stylebox("fill").duplicate() as StyleBoxFlat
	fill.bg_color = bar_color
	_trust_bar.add_theme_stylebox_override("fill", fill)


func _append_message(role: String, text: String) -> void:
	if role == "player":
		_chat_log.append_text("[color=#%s]You[/color]  %s\n" % [CLR_PLAYER.to_html(false), text])
	else:
		_chat_log.append_text("[color=#%s]%s[/color]  %s\n" % [CLR_NPC.to_html(false), _talking_to_name, text])


func _show_action_button(label: String, action_id: String) -> void:
	_clear_actions()
	var btn := Button.new()
	btn.text = label
	btn.add_theme_font_size_override("font_size", 11)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.18, 0.16, 0.12, 0.9)
	style.border_color = Color(0.5, 0.42, 0.25, 0.7)
	style.set_border_width_all(1)
	style.set_corner_radius_all(3)
	style.content_margin_left = 10
	style.content_margin_right = 10
	style.content_margin_top = 4
	style.content_margin_bottom = 4
	btn.add_theme_stylebox_override("normal", style)
	var hover := style.duplicate()
	hover.bg_color = Color(0.28, 0.24, 0.16, 0.95)
	btn.add_theme_stylebox_override("hover", hover)
	btn.add_theme_color_override("font_color", CLR_GOLD)
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


func _ensure_history(npc_id: String) -> void:
	if not _chat_histories.has(npc_id):
		_chat_histories[npc_id] = []


func _trim_history(npc_id: String) -> void:
	if _chat_histories.has(npc_id) and _chat_histories[npc_id].size() > MAX_HISTORY:
		_chat_histories[npc_id] = _chat_histories[npc_id].slice(-MAX_HISTORY)


func _make_line(color: Color, height: int) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = color
	s.content_margin_top = height
	return s
