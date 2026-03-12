extends Node2D
## Floating speech bubble above an NPC — auto-dismisses.

var _panel: PanelContainer
var _label: Label
var _timer: float = 0.0
var _lifetime: float = 5.0
var _fade_start: float = 4.0


func _init() -> void:
	z_index = 100


func setup(text: String, duration: float = 5.0) -> void:
	_lifetime = duration
	_fade_start = duration - 1.0

	_panel = PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.12, 0.12, 0.15, 0.92)
	style.border_color = Color(0.5, 0.45, 0.3, 0.6)
	style.set_border_width_all(1)
	style.set_corner_radius_all(6)
	style.set_content_margin_all(6)
	_panel.add_theme_stylebox_override("panel", style)
	add_child(_panel)

	_label = Label.new()
	_label.text = text
	_label.add_theme_font_size_override("font_size", 10)
	_label.add_theme_color_override("font_color", Color(0.9, 0.9, 0.85))
	_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_label.custom_minimum_size = Vector2(120, 0)
	_label.max_lines_visible = 3
	_panel.add_child(_label)

	# Position above NPC head
	_panel.position = Vector2(-65, -80)


func _process(delta: float) -> void:
	_timer += delta

	# Gentle float up
	if _panel:
		_panel.position.y -= delta * 3.0

	# Fade out
	if _timer > _fade_start:
		var fade := 1.0 - (_timer - _fade_start) / (_lifetime - _fade_start)
		modulate.a = maxf(fade, 0.0)

	if _timer >= _lifetime:
		queue_free()
