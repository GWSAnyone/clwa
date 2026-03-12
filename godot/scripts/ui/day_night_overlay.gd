extends ColorRect
## Day/night atmosphere overlay — tints screen based on game time period.

const PERIOD_COLORS: Dictionary = {
	"night": Color(0.05, 0.05, 0.2, 0.55),
	"dawn": Color(0.4, 0.25, 0.1, 0.2),
	"morning": Color(0.1, 0.1, 0.05, 0.05),
	"afternoon": Color(0.15, 0.12, 0.05, 0.08),
	"evening": Color(0.3, 0.15, 0.05, 0.25),
}

var _current_period: String = ""
var _tween: Tween


func _ready() -> void:
	# Fullscreen overlay
	set_anchors_preset(PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	color = Color(0, 0, 0, 0)

	Backend.tick_completed.connect(_on_tick)

	# Set initial state
	var period: String = Backend.time_data.get("period", "morning")
	_apply_period(period)


func _on_tick(tick_data: Dictionary) -> void:
	var time: Dictionary = tick_data.get("time", {})
	var period: String = time.get("period", "morning")
	if period != _current_period:
		_apply_period(period)


func _apply_period(period: String) -> void:
	_current_period = period
	var target: Color = PERIOD_COLORS.get(period, Color(0, 0, 0, 0))

	if _tween and _tween.is_running():
		_tween.kill()
	_tween = create_tween()
	_tween.tween_property(self, "color", target, 1.5).set_ease(Tween.EASE_IN_OUT)
