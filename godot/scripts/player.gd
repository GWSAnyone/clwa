extends Node2D
## Player character — WASD movement, NPC interaction detection.

signal interact_requested(npc_id: String)
signal investigate_requested(location_id: String)

@onready var sprite: AnimatedSprite2D = $Sprite
@onready var name_label: Label = $NameLabel
@onready var interact_area: Area2D = $InteractArea

const SPEED := 200.0
const SPRINT_SPEED := 350.0

var _nearby_npcs: Array[Node2D] = []
var _interact_hint_label: Label = null


func _ready() -> void:
	name_label.text = "You"
	name_label.modulate = Color(0.95, 0.88, 0.55, 1)  # Gold


func setup(frames: SpriteFrames) -> void:
	if frames:
		sprite.sprite_frames = frames
		sprite.play("idle")


func _physics_process(delta: float) -> void:
	var dir := Vector2.ZERO
	if Input.is_action_pressed("ui_left") or Input.is_key_pressed(KEY_A):
		dir.x -= 1
	if Input.is_action_pressed("ui_right") or Input.is_key_pressed(KEY_D):
		dir.x += 1
	if Input.is_action_pressed("ui_up") or Input.is_key_pressed(KEY_W):
		dir.y -= 1
	if Input.is_action_pressed("ui_down") or Input.is_key_pressed(KEY_S):
		dir.y += 1

	if dir.length() > 0:
		dir = dir.normalized()
		var speed := SPRINT_SPEED if Input.is_key_pressed(KEY_SHIFT) else SPEED
		position += dir * speed * delta

		# Flip sprite
		if abs(dir.x) > 0.1:
			sprite.flip_h = dir.x < 0

		if sprite.sprite_frames and sprite.sprite_frames.has_animation("run"):
			sprite.play("run")
	else:
		if sprite.sprite_frames and sprite.sprite_frames.has_animation("idle"):
			sprite.play("idle")


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_accept") or (event is InputEventKey and event.pressed and event.keycode == KEY_E):
		var nearest := _get_nearest_npc()
		if nearest:
			interact_requested.emit(nearest.npc_id)

	# Mouse wheel zoom
	if event is InputEventMouseButton:
		var cam := get_viewport().get_camera_2d()
		if cam:
			if event.button_index == MOUSE_BUTTON_WHEEL_UP:
				cam.zoom = (cam.zoom * 1.1).clampf(0.3, 3.0)
			elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
				cam.zoom = (cam.zoom / 1.1).clampf(0.3, 3.0)


func _get_nearest_npc() -> Node2D:
	var closest: Node2D = null
	var closest_dist := 999999.0
	for npc: Node2D in _nearby_npcs:
		if not is_instance_valid(npc) or not npc.visible:
			continue
		var dist := global_position.distance_to(npc.global_position)
		if dist < closest_dist:
			closest_dist = dist
			closest = npc
	return closest


func register_nearby(npc: Node2D) -> void:
	if npc not in _nearby_npcs:
		_nearby_npcs.append(npc)


func unregister_nearby(npc: Node2D) -> void:
	_nearby_npcs.erase(npc)
