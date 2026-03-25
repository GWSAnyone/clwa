extends Node2D
## NPC visual representation — Tiny Swords sprites + path-based movement.

signal clicked(npc_id: String)

@onready var sprite: AnimatedSprite2D = $Sprite
@onready var mood_ring: Sprite2D = $MoodRing
@onready var name_label: Label = $NameLabel
@onready var thought_bubble: PanelContainer = $ThoughtBubble
@onready var thought_label: Label = $ThoughtBubble/ThoughtLabel
@onready var goal_icon: Label = $GoalIcon

var npc_id: String = ""
var npc_name: String = ""
var current_mood: float = 0.0
var is_dead: bool = false
var status: String = ""  # "", "detained", "exiled", "fled"

const MOVE_SPEED := 120.0  # pixels per second
var _target_pos := Vector2.ZERO
var _moving := false


func setup(id: String, display_name: String, frames: SpriteFrames) -> void:
	npc_id = id
	npc_name = display_name
	name_label.text = display_name
	if frames:
		sprite.sprite_frames = frames
		sprite.play("idle")


func play_idle() -> void:
	if sprite.sprite_frames and sprite.sprite_frames.has_animation("idle"):
		sprite.play("idle")


func play_run() -> void:
	if sprite.sprite_frames and sprite.sprite_frames.has_animation("run"):
		sprite.play("run")


func move_to_position(target_pos: Vector2) -> void:
	_target_pos = target_pos
	_moving = true
	play_run()


func _process(delta: float) -> void:
	if is_dead or status != "" or not _moving:
		return

	var dir := _target_pos - position
	var dist := dir.length()

	if dist < 8.0:
		_moving = false
		play_idle()
		return

	position += dir.normalized() * MOVE_SPEED * delta

	if abs(dir.x) > 1:
		sprite.flip_h = dir.x < 0

	if abs(dir.x) > 1:
		sprite.flip_h = dir.x < 0
	if sprite.animation != "run":
		play_run()


# ─── Mood Ring ───

func update_mood(new_mood: float) -> void:
	current_mood = new_mood
	# Green (happy) → Yellow (neutral) → Red (distressed)
	var color: Color
	if new_mood > 0:
		color = Color(0.3, 0.8, 0.3, 0.4).lerp(Color(0.9, 0.9, 0.3, 0.3), clampf(new_mood, 0, 1))
	else:
		color = Color(0.9, 0.9, 0.3, 0.4).lerp(Color(0.9, 0.2, 0.2, 0.5), clampf(-new_mood, 0, 1))
	mood_ring.modulate = color


# ─── Thought Bubble ───

func show_thought(action: String, reason: String, tier: String, duration: float = 4.0) -> void:
	var tier_icon := ""
	match tier:
		"whisper": tier_icon = "~"
		"echo": tier_icon = "..."
		"temptation": tier_icon = "!"
		"grip": tier_icon = "!!"
		"flood": tier_icon = "!!!"
		"torrent": tier_icon = ">>>>"
		"abyss": tier_icon = "<<<>>>"
		_: tier_icon = ""

	var short_reason: String = reason.left(40) + "..." if reason.length() > 40 else reason
	thought_label.text = "%s %s" % [tier_icon, action] if tier_icon else action
	thought_bubble.visible = true
	# Keep bubble above NPC head
	thought_bubble.position = Vector2(-60, -90)
	thought_bubble.size = Vector2(120, 0)  # auto-height
	await get_tree().create_timer(duration).timeout
	if is_instance_valid(self):
		thought_bubble.visible = false


# ─── Goal Icon ───

func show_goal(goal_type: String) -> void:
	var icon := ""
	match goal_type:
		"investigate": icon = "🔍"
		"arrest": icon = "⚔"
		"report_crime", "testify": icon = "📢"
		"steal": icon = "💰"
		"kill": icon = "💀"
		"evaluate_case": icon = "⚖"
		"gossip": icon = "💬"
		"flee_town": icon = "🏃"
		"blackmail", "leverage": icon = "🤫"
		"visit": icon = "👋"
		_: icon = "•"
	goal_icon.text = icon
	goal_icon.visible = true


func hide_goal() -> void:
	goal_icon.visible = false


# ─── Status ───

func set_status(new_status: String) -> void:
	status = new_status
	match new_status:
		"detained":
			modulate = Color(0.6, 0.6, 0.6, 1)
			name_label.text = npc_name + " [DETAINED]"
		"exiled", "fled":
			visible = false
		"":
			modulate = Color(1, 1, 1, 1)
			name_label.text = npc_name


func set_dead() -> void:
	is_dead = true
	sprite.stop()
	modulate = Color(0.4, 0.4, 0.4, 0.7)
	name_label.text = npc_name + " [DEAD]"
	rotation_degrees = 90
