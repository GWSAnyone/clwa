extends ColorRect
## Screen-edge vignette for atmosphere.

func _ready() -> void:
	set_anchors_preset(PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	color = Color(0, 0, 0, 0)

	# Use a simple shader for radial vignette
	var shader := Shader.new()
	shader.code = "
shader_type canvas_item;
uniform float intensity : hint_range(0.0, 1.0) = 0.4;
uniform float softness : hint_range(0.0, 1.0) = 0.45;

void fragment() {
    vec2 uv = UV - 0.5;
    float dist = length(uv);
    float vig = smoothstep(softness, softness + 0.3, dist);
    COLOR = vec4(0.0, 0.0, 0.0, vig * intensity);
}
"
	var mat := ShaderMaterial.new()
	mat.shader = shader
	material = mat
