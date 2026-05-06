// FOV / lighting fragment shader. Reads a low-res darkness texture
// (one cell per texel) and a per-pixel lookup interpolates into a
// smooth gradient — soft shadows around lit areas.
//
// Phase 4 ships this with a simple coarse-to-fine sampling. Phase 5B's
// torch flicker is a separate uniform (per-source positions + intensities)
// that this shader will be extended to consume.

export const FOV_VERT = /* glsl */ `#version 300 es
precision highp float;

in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;

void main() {
    v_uv = a_uv;
    gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const FOV_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_color;       // rendered scene
uniform sampler2D u_darkness;    // coarse darkness 0..1, 1 = fully dark
uniform vec2 u_grid;             // (cols, rows) of darkness texture
uniform float u_minLight;        // visited-but-out-of-FOV brightness (e.g. 0.35)

out vec4 o_color;

// 9-tap separable blur on the darkness texture for soft penumbra.
float sampleDarkness(vec2 uv) {
    vec2 px = 1.0 / u_grid;
    float d = 0.0;
    d += texture(u_darkness, uv + vec2(-px.x, -px.y)).r * 0.0625;
    d += texture(u_darkness, uv + vec2( 0.0, -px.y)).r * 0.125;
    d += texture(u_darkness, uv + vec2( px.x, -px.y)).r * 0.0625;
    d += texture(u_darkness, uv + vec2(-px.x,  0.0 )).r * 0.125;
    d += texture(u_darkness, uv                       ).r * 0.25;
    d += texture(u_darkness, uv + vec2( px.x,  0.0 )).r * 0.125;
    d += texture(u_darkness, uv + vec2(-px.x,  px.y)).r * 0.0625;
    d += texture(u_darkness, uv + vec2( 0.0,  px.y)).r * 0.125;
    d += texture(u_darkness, uv + vec2( px.x,  px.y)).r * 0.0625;
    return d;
}

void main() {
    vec3 c = texture(u_color, v_uv).rgb;
    float darkness = sampleDarkness(v_uv);
    // 0 = fully lit, 1 = fully dark. Out-of-FOV-but-remembered cells
    // get u_minLight as a floor so the player can still navigate.
    float light = mix(1.0, u_minLight, darkness);
    o_color = vec4(c * light, 1.0);
}
`;
