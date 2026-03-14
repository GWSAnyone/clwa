extends Node2D
## Spawns Kenney prop sprites around building locations for atmosphere.

const KENNEY_DUNGEON := "res://assets/kenney/dungeon/Isometric/"
const KENNEY_FARM := "res://assets/kenney/farm/Isometric/"
const KENNEY_LIBRARY := "res://assets/kenney/library/Isometric/"
const PROP_SCALE := 0.22

# Props per location: [texture_path, offset_x, offset_y, flip_h]
const LOCATION_PROPS: Dictionary = {
	"Silver Flagon Tavern": [
		[KENNEY_DUNGEON + "barrel_S.png", 55, 15, false],
		[KENNEY_DUNGEON + "barrel_S.png", 45, 20, true],
		[KENNEY_DUNGEON + "tableRoundChairs_S.png", -50, 35, false],
		[KENNEY_DUNGEON + "chair_S.png", 60, 40, false],
	],
	"Market Square": [
		[KENNEY_DUNGEON + "woodenCrate_S.png", 50, 20, false],
		[KENNEY_DUNGEON + "woodenCrates_S.png", -45, 15, false],
		[KENNEY_FARM + "sack_S.png", 40, 35, false],
		[KENNEY_FARM + "sacksCrate_S.png", -55, 30, true],
	],
	"Blacksmith": [
		[KENNEY_DUNGEON + "barrel_S.png", 50, 25, false],
		[KENNEY_DUNGEON + "woodenCrate_S.png", -40, 30, false],
		[KENNEY_FARM + "hay_S.png", 60, 40, false],
	],
	"Town Gate": [
		[KENNEY_DUNGEON + "barrel_S.png", 30, 15, false],
		[KENNEY_DUNGEON + "woodenCrate_S.png", -30, 20, false],
	],
	"Temple of Dawn": [
		[KENNEY_LIBRARY + "candleStand_S.png", 45, 10, false],
		[KENNEY_LIBRARY + "bookStand_S.png", -40, 15, false],
	],
	"Residential Lane": [
		[KENNEY_FARM + "hay_S.png", 50, 20, false],
		[KENNEY_FARM + "hayBales_S.png", -50, 25, true],
		[KENNEY_DUNGEON + "barrel_S.png", 40, 40, false],
	],
	"Courthouse": [
		[KENNEY_LIBRARY + "candleStandDouble_S.png", 45, 10, false],
		[KENNEY_LIBRARY + "candleStandDouble_S.png", -45, 10, true],
	],
}


static func spawn_props(parent: Node2D, location_positions: Dictionary) -> void:
	for loc_name: String in LOCATION_PROPS:
		if not location_positions.has(loc_name):
			continue
		var base_pos: Vector2 = location_positions[loc_name]
		var props: Array = LOCATION_PROPS[loc_name]
		for prop_def: Array in props:
			var tex_path: String = prop_def[0]
			var ox: float = prop_def[1]
			var oy: float = prop_def[2]
			var flip: bool = prop_def[3]

			var tex := load(tex_path) as Texture2D
			if not tex:
				continue

			var sprite := Sprite2D.new()
			sprite.texture = tex
			sprite.scale = Vector2(PROP_SCALE, PROP_SCALE)
			sprite.position = base_pos + Vector2(ox, oy)
			sprite.flip_h = flip
			# Anchor at bottom — props sit lower in the sprite (around y=450)
			sprite.offset = Vector2(0, -195)
			sprite.z_index = -1
			parent.add_child(sprite)
