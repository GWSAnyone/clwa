extends Node2D
## Draws isometric ground plane — terrain only, no paths.


func _ready() -> void:
	z_index = -10
	queue_redraw()


func _draw() -> void:
	var ground_color := Color(0.18, 0.22, 0.15)
	var grass_color := Color(0.22, 0.28, 0.18)

	# Main ground diamond
	_draw_iso_diamond(Vector2.ZERO, 900, 600, ground_color)
	_draw_iso_diamond(Vector2.ZERO, 850, 570, grass_color)


func _draw_iso_diamond(center: Vector2, w: float, h: float, color: Color) -> void:
	var hw := w / 2.0
	var hh := h / 2.0
	draw_colored_polygon(PackedVector2Array([
		center + Vector2(0, -hh),
		center + Vector2(hw, 0),
		center + Vector2(0, hh),
		center + Vector2(-hw, 0),
	]), color)
