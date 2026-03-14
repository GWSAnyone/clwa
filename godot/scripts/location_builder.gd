extends RefCounted
## Builds isometric tile compositions for each location using Kenney assets.
## Replaces the old procedural draw() buildings + location_props.

const DUNGEON := "res://assets/kenney/dungeon/Isometric/"
const FARM := "res://assets/kenney/farm/Isometric/"
const LIBRARY := "res://assets/kenney/library/Isometric/"

const TILE_SCALE := 0.35

# Isometric grid constants at TILE_SCALE
const GRID_X := 44.8   # 128 * 0.35
const GRID_Y := 22.4   # 64 * 0.35
const WALL_H := -45.5   # -130 * 0.35 (roof above wall)

# Location name label style
const LABEL_FONT_SIZE := 11
const LABEL_COLOR := Color(0.85, 0.8, 0.65, 0.8)
const LABEL_SHADOW := Color(0, 0, 0, 0.7)


static func build_all(parent: Node2D, location_positions: Dictionary) -> void:
	for loc_name: String in location_positions:
		var pos: Vector2 = location_positions[loc_name]
		var container := Node2D.new()
		container.name = loc_name.replace(" ", "")
		container.position = pos
		parent.add_child(container)

		match loc_name:
			"Silver Flagon Tavern":
				_build_tavern(container)
			"Town Square":
				_build_town_square(container)
			"Town Gate":
				_build_town_gate(container)
			"Market Square":
				_build_market(container)
			"Blacksmith":
				_build_blacksmith(container)
			"Temple of Dawn":
				_build_temple(container)
			"Residential Lane":
				_build_residential(container)
			"Courthouse":
				_build_courthouse(container)

		_add_location_label(container, loc_name)


# -- Helper: place a tile sprite --

static func _tile(parent: Node2D, path: String, ox: float, oy: float, z: int = 0) -> Sprite2D:
	var tex := load(path) as Texture2D
	if not tex:
		push_warning("LocationBuilder: missing texture %s" % path)
		return null
	var sprite := Sprite2D.new()
	sprite.texture = tex
	sprite.scale = Vector2(TILE_SCALE, TILE_SCALE)
	sprite.position = Vector2(ox, oy)
	sprite.z_index = z
	parent.add_child(sprite)
	return sprite


# -- Helper: iso grid to screen offset --

static func _iso(gx: int, gy: int) -> Vector2:
	return Vector2((gx - gy) * GRID_X, (gx + gy) * GRID_Y)


# -- Helper: add a location name label below the building --

static func _add_location_label(container: Node2D, text: String) -> void:
	var label := Label.new()
	label.text = text
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.position = Vector2(-60, 55)
	label.size = Vector2(120, 20)
	label.add_theme_font_size_override("font_size", LABEL_FONT_SIZE)
	label.add_theme_color_override("font_color", LABEL_COLOR)
	label.add_theme_color_override("font_shadow_color", LABEL_SHADOW)
	label.add_theme_constant_override("shadow_offset_x", 1)
	label.add_theme_constant_override("shadow_offset_y", 1)
	label.z_index = 5
	container.add_child(label)


# ============================================================
# BUILDING COMPOSITIONS
# ============================================================

# Silver Flagon Tavern — large wooden 2x2
static func _build_tavern(c: Node2D) -> void:
	# Floor 2x2 planks (centered around origin)
	var o00 := _iso(0, 0)  # center tile
	var o10 := _iso(1, 0)
	var o01 := _iso(0, 1)
	var o11 := _iso(1, 1)

	# Shift everything so the building is roughly centered
	var cx := -(o11.x + o00.x) * 0.5
	var cy := -(o11.y + o00.y) * 0.5

	# Floors
	_tile(c, FARM + "planks_S.png", o00.x + cx, o00.y + cy, -2)
	_tile(c, FARM + "planks_S.png", o10.x + cx, o10.y + cy, -2)
	_tile(c, FARM + "planks_S.png", o01.x + cx, o01.y + cy, -2)
	_tile(c, FARM + "planks_S.png", o11.x + cx, o11.y + cy, -2)

	# Right wall (_S) — along south edge (gridY=1 row, right side)
	_tile(c, FARM + "woodWall_S.png", o01.x + cx, o01.y + cy, 0)
	_tile(c, FARM + "woodWallDoorway_S.png", o11.x + cx, o11.y + cy, 0)

	# Left wall (_E) — along east edge (gridX=1 row, left side)
	_tile(c, FARM + "woodWallWindowGlass_E.png", o10.x + cx, o10.y + cy, 0)
	_tile(c, FARM + "woodWall_E.png", o11.x + cx, o11.y + cy, 1)

	# Roof above walls
	_tile(c, FARM + "roof_S.png", o01.x + cx, o01.y + cy + WALL_H, 2)
	_tile(c, FARM + "roof_S.png", o11.x + cx, o11.y + cy + WALL_H, 2)
	_tile(c, FARM + "roof_E.png", o10.x + cx, o10.y + cy + WALL_H, 2)
	_tile(c, FARM + "roof_E.png", o11.x + cx, o11.y + cy + WALL_H, 3)

	# Chimney on roof
	_tile(c, FARM + "chimneyBase_S.png", o00.x + cx, o00.y + cy + WALL_H, 4)
	_tile(c, FARM + "chimneyTop_S.png", o00.x + cx, o00.y + cy + WALL_H * 2, 5)

	# Props outside
	_tile(c, DUNGEON + "barrel_S.png", o01.x + cx - 50, o01.y + cy + 15, -1)
	_tile(c, DUNGEON + "barrel_S.png", o01.x + cx - 42, o01.y + cy + 20, -1)
	_tile(c, DUNGEON + "tableRoundChairs_S.png", o00.x + cx - 35, o00.y + cy + 35, -1)


# Town Square — open stone 3x3
static func _build_town_square(c: Node2D) -> void:
	# 3x3 stone floor centered
	for gx: int in range(3):
		for gy: int in range(3):
			var o := _iso(gx, gy)
			# Center the 3x3 grid
			var center := _iso(1, 1)
			_tile(c, DUNGEON + "stone_S.png", o.x - center.x, o.y - center.y, -2)

	# Stone columns at two corners
	var corner_nw := _iso(0, 0)
	var corner_se := _iso(2, 2)
	var center := _iso(1, 1)
	_tile(c, DUNGEON + "stoneColumn_S.png", corner_nw.x - center.x, corner_nw.y - center.y, 0)
	_tile(c, DUNGEON + "stoneColumn_S.png", corner_se.x - center.x, corner_se.y - center.y, 0)

	# Props
	_tile(c, DUNGEON + "barrel_S.png", corner_se.x - center.x + 30, corner_se.y - center.y + 5, -1)
	_tile(c, DUNGEON + "woodenCrate_S.png", corner_nw.x - center.x - 30, corner_nw.y - center.y + 5, -1)


# Town Gate — stone fortification 1x2
static func _build_town_gate(c: Node2D) -> void:
	var o0 := _iso(0, 0)
	var o1 := _iso(0, 1)
	var center_y := (o0.y + o1.y) * 0.5

	# Floor
	_tile(c, DUNGEON + "stone_S.png", o0.x, o0.y - center_y, -2)
	_tile(c, DUNGEON + "stone_S.png", o1.x, o1.y - center_y, -2)

	# Gate wall
	_tile(c, DUNGEON + "stoneWallGate_S.png", o0.x, o0.y - center_y, 0)

	# Regular wall
	_tile(c, DUNGEON + "stoneWall_S.png", o1.x, o1.y - center_y, 0)

	# Columns flanking
	_tile(c, DUNGEON + "stoneColumn_S.png", o0.x - GRID_X, o0.y - center_y - GRID_Y, 0)
	_tile(c, DUNGEON + "stoneColumn_S.png", o1.x + GRID_X, o1.y - center_y + GRID_Y, 0)

	# Props
	_tile(c, DUNGEON + "barrel_S.png", 50, 15, -1)
	_tile(c, DUNGEON + "woodenCrate_S.png", -50, 10, -1)


# Market Square — wooden stalls 2x2 dirt
static func _build_market(c: Node2D) -> void:
	var center := _iso(0, 0)

	# 2x2 dirt floor
	for gx: int in range(2):
		for gy: int in range(2):
			var o := _iso(gx, gy)
			var mid := _iso(0, 0)
			_tile(c, FARM + "dirt_S.png", o.x - mid.x - GRID_X * 0.5, o.y - mid.y - GRID_Y * 0.5, -2)

	# Stall wall backdrop
	_tile(c, FARM + "woodWall_S.png", -GRID_X * 0.5, -GRID_Y * 0.5, 0)

	# Fences around perimeter
	_tile(c, FARM + "fenceHigh_S.png", GRID_X * 0.5, GRID_Y * 1.5, -1)
	_tile(c, FARM + "fenceHigh_E.png", GRID_X * 0.5 + GRID_X, GRID_Y * 0.5 - GRID_Y, -1)

	# Props
	_tile(c, DUNGEON + "woodenCrate_S.png", 45, 20, -1)
	_tile(c, FARM + "sack_S.png", -50, 25, -1)
	_tile(c, FARM + "hayBales_S.png", 30, -15, -1)


# Blacksmith — mixed stone/wood 2x1
static func _build_blacksmith(c: Node2D) -> void:
	var o0 := _iso(0, 0)
	var o1 := _iso(1, 0)
	var cx := -(o0.x + o1.x) * 0.5
	var cy := -(o0.y + o1.y) * 0.5

	# Floor
	_tile(c, FARM + "planks_S.png", o0.x + cx, o0.y + cy, -2)
	_tile(c, FARM + "planks_S.png", o1.x + cx, o1.y + cy, -2)

	# Walls
	_tile(c, FARM + "woodWall_S.png", o0.x + cx, o0.y + cy, 0)
	_tile(c, FARM + "woodWallDoorway_E.png", o1.x + cx, o1.y + cy, 0)
	_tile(c, FARM + "woodWall_E.png", o0.x + cx, o0.y + cy, 0)

	# Props outside
	_tile(c, DUNGEON + "barrel_S.png", o0.x + cx - 40, o0.y + cy + 20, -1)
	_tile(c, DUNGEON + "woodenCrate_S.png", o1.x + cx + 30, o1.y + cy + 15, -1)
	_tile(c, FARM + "hay_S.png", o1.x + cx + 45, o1.y + cy + 25, -1)


# Temple of Dawn — grand stone 2x2
static func _build_temple(c: Node2D) -> void:
	var o00 := _iso(0, 0)
	var o10 := _iso(1, 0)
	var o01 := _iso(0, 1)
	var o11 := _iso(1, 1)
	var cx := -(o11.x + o00.x) * 0.5
	var cy := -(o11.y + o00.y) * 0.5

	# 2x2 stone floor
	_tile(c, DUNGEON + "stone_S.png", o00.x + cx, o00.y + cy, -2)
	_tile(c, DUNGEON + "stone_S.png", o10.x + cx, o10.y + cy, -2)
	_tile(c, DUNGEON + "stone_S.png", o01.x + cx, o01.y + cy, -2)
	_tile(c, DUNGEON + "stone_S.png", o11.x + cx, o11.y + cy, -2)

	# South wall (_S) with stained glass window
	_tile(c, DUNGEON + "stoneWall_S.png", o01.x + cx, o01.y + cy, 0)
	_tile(c, DUNGEON + "stoneWallWindow_S.png", o11.x + cx, o11.y + cy, 0)

	# East wall (_E) with archway entrance
	_tile(c, DUNGEON + "stoneWallArchway_E.png", o10.x + cx, o10.y + cy, 0)
	_tile(c, DUNGEON + "stoneWall_E.png", o11.x + cx, o11.y + cy, 1)

	# Columns flanking entrance
	_tile(c, DUNGEON + "stoneColumn_E.png", o10.x + cx - GRID_X, o10.y + cy - GRID_Y, 0)
	_tile(c, DUNGEON + "stoneColumn_S.png", o00.x + cx + GRID_X, o00.y + cy + GRID_Y, 0)

	# Candle stand inside
	_tile(c, LIBRARY + "candleStand_S.png", o00.x + cx + 5, o00.y + cy + 5, -1)


# Residential Lane — cozy wooden 2x1
static func _build_residential(c: Node2D) -> void:
	var o0 := _iso(0, 0)
	var o1 := _iso(1, 0)
	var cx := -(o0.x + o1.x) * 0.5
	var cy := -(o0.y + o1.y) * 0.5

	# Floor
	_tile(c, FARM + "planks_S.png", o0.x + cx, o0.y + cy, -2)
	_tile(c, FARM + "planks_S.png", o1.x + cx, o1.y + cy, -2)

	# Walls
	_tile(c, FARM + "woodWallDoorway_S.png", o0.x + cx, o0.y + cy, 0)
	_tile(c, FARM + "woodWall_S.png", o1.x + cx, o1.y + cy, 0)
	_tile(c, FARM + "woodWallWindow_E.png", o0.x + cx, o0.y + cy, 0)
	_tile(c, FARM + "woodWall_E.png", o1.x + cx, o1.y + cy, 1)

	# Roof
	_tile(c, FARM + "roof_S.png", o0.x + cx, o0.y + cy + WALL_H, 2)
	_tile(c, FARM + "roof_S.png", o1.x + cx, o1.y + cy + WALL_H, 2)
	_tile(c, FARM + "roof_E.png", o0.x + cx, o0.y + cy + WALL_H, 2)
	_tile(c, FARM + "roof_E.png", o1.x + cx, o1.y + cy + WALL_H, 3)

	# Props outside
	_tile(c, FARM + "fenceLow_S.png", o0.x + cx - 45, o0.y + cy + 15, -1)
	_tile(c, FARM + "hay_S.png", o1.x + cx + 40, o1.y + cy + 20, -1)
	_tile(c, FARM + "sack_S.png", o0.x + cx - 35, o0.y + cy + 30, -1)


# Courthouse — imposing stone 2x2
static func _build_courthouse(c: Node2D) -> void:
	var o00 := _iso(0, 0)
	var o10 := _iso(1, 0)
	var o01 := _iso(0, 1)
	var o11 := _iso(1, 1)
	var cx := -(o11.x + o00.x) * 0.5
	var cy := -(o11.y + o00.y) * 0.5

	# 2x2 stone floor
	_tile(c, DUNGEON + "stone_S.png", o00.x + cx, o00.y + cy, -2)
	_tile(c, DUNGEON + "stone_S.png", o10.x + cx, o10.y + cy, -2)
	_tile(c, DUNGEON + "stone_S.png", o01.x + cx, o01.y + cy, -2)
	_tile(c, DUNGEON + "stone_S.png", o11.x + cx, o11.y + cy, -2)

	# South wall (_S) with door
	_tile(c, DUNGEON + "stoneWallDoor_S.png", o01.x + cx, o01.y + cy, 0)
	_tile(c, DUNGEON + "stoneWall_S.png", o11.x + cx, o11.y + cy, 0)

	# East wall (_E)
	_tile(c, DUNGEON + "stoneWall_E.png", o10.x + cx, o10.y + cy, 0)
	_tile(c, DUNGEON + "stoneWall_E.png", o11.x + cx, o11.y + cy, 1)

	# Columns flanking entrance
	_tile(c, DUNGEON + "stoneColumn_S.png", o01.x + cx - GRID_X, o01.y + cy - GRID_Y, 0)
	_tile(c, DUNGEON + "stoneColumn_S.png", o01.x + cx + GRID_X, o01.y + cy + GRID_Y, 0)

	# Candle stands inside
	_tile(c, LIBRARY + "candleStand_S.png", o00.x + cx + 10, o00.y + cy, -1)
	_tile(c, LIBRARY + "candleStand_S.png", o10.x + cx - 10, o10.y + cy, -1)
