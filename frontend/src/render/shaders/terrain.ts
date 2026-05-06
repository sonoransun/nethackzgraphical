// Animated terrain shaders. Each is rendered as a sprite layer on top
// of the base scene; the renderer toggles them per-cell based on the
// underlying tileidx (water tiles get the water shader, etc.).
//
// Phase 5B ships these uncomposed — the renderer would need a small
// "what tileidx is water" registry to dispatch. For now they're
// reusable building blocks; integration TODO documented in
// MODERNIZATION.md.

export const TERRAIN_VERT = /* glsl */ `#version 300 es
precision highp float;
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
    v_uv = a_uv;
    gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const WATER_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_baseTile;
uniform float u_time;
uniform vec2 u_seed;             // per-cell stable seed (cellX, cellY)
uniform vec3 u_tint;             // [r, g, b]; gehennom rivers tinted red
out vec4 o_color;

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
    // Sine-wave UV displacement
    float t = u_time * 0.001;
    float n = hash(u_seed);
    vec2 disp = vec2(
        sin(v_uv.y * 6.28 + t * 1.4 + n * 6.28) * 0.012,
        cos(v_uv.x * 6.28 + t * 1.1 + n * 6.28) * 0.008
    );
    vec3 c = texture(u_baseTile, v_uv + disp).rgb;
    // Reflective shimmer
    float shimmer = sin(v_uv.x * 30.0 + t * 4.0 + n * 12.0) * 0.5 + 0.5;
    c += vec3(shimmer * 0.05);
    c *= u_tint;
    o_color = vec4(c, 1.0);
}
`;

export const LAVA_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_baseTile;
uniform float u_time;
uniform vec2 u_seed;
out vec4 o_color;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    float t = u_time * 0.001;
    float n = hash(u_seed);
    // Bubble: per-cell stable bubble locations modulated by time
    vec2 b1 = vec2(0.3 + sin(t * 0.7 + n * 6.28) * 0.1, 0.4 + cos(t * 0.9 + n * 6.28) * 0.1);
    vec2 b2 = vec2(0.7 + sin(t * 1.1 + n * 9.0) * 0.1, 0.6 + cos(t * 0.5 + n * 9.0) * 0.1);
    float d1 = length(v_uv - b1);
    float d2 = length(v_uv - b2);
    float bubble = max(0.0, 1.0 - d1 / 0.18) + max(0.0, 1.0 - d2 / 0.16);

    vec3 c = texture(u_baseTile, v_uv).rgb;
    c += vec3(bubble * 0.7, bubble * 0.3, 0.0);
    // Flicker the whole tile slightly so the eye reads it as molten.
    c *= 0.9 + sin(t * 6.0 + n * 12.0) * 0.1;
    o_color = vec4(c, 1.0);
}
`;

export const TORCH_GLOW_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_baseTile;
uniform float u_time;
uniform vec2 u_seed;             // independent seed per torch
out vec4 o_color;

// 1/f-style noise: stack of decreasing-amplitude sines.
float pinkNoise(float t, float seed) {
    return (sin(t * 6.1 + seed * 3.0)
          + sin(t * 13.7 + seed * 7.0) * 0.5
          + sin(t * 27.3 + seed * 11.0) * 0.25
          + sin(t * 51.1 + seed * 17.0) * 0.125) / 1.875;
}

void main() {
    float t = u_time * 0.001;
    float seed = (u_seed.x * 0.1 + u_seed.y * 0.13);
    float intensity = 0.92 + pinkNoise(t * 6.0, seed) * 0.08;
    vec3 c = texture(u_baseTile, v_uv).rgb;
    // Warm tint around the flame
    vec2 cc = v_uv - 0.5;
    float halo = exp(-dot(cc, cc) * 8.0);
    c += vec3(0.7, 0.4, 0.15) * halo * intensity * 0.4;
    c *= intensity;
    o_color = vec4(c, 1.0);
}
`;

export const ALTAR_PILLAR_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform float u_time;
uniform vec3 u_color;            // alignment: white / violet / red
out vec4 o_color;

void main() {
    float t = u_time * 0.001;
    // Pillar: vertical column of light, brightest at center, fading up.
    float dx = abs(v_uv.x - 0.5);
    float column = exp(-dx * dx * 30.0);
    float pulse = 0.7 + sin(t * 0.3 * 6.28) * 0.3;
    float fadeUp = 1.0 - v_uv.y;
    float alpha = column * pulse * fadeUp * 0.6;
    o_color = vec4(u_color, alpha);
}
`;

export const WEATHER_RAIN_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_intensity;       // 0..1
out vec4 o_color;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
    if (u_intensity < 0.01) { o_color = vec4(0.0); return; }
    // Diagonal rain streaks. Tile UV space into "streak columns".
    vec2 uv = v_uv * vec2(u_resolution.x / 12.0, u_resolution.y / 100.0);
    float t = u_time * 0.0015;
    uv.x += t * 0.4;
    float col = floor(uv.x);
    float seed = hash(vec2(col, 0.0));
    float y = fract(uv.y - t * (1.0 + seed));
    float streak = smoothstep(0.85, 1.0, y) * u_intensity;
    o_color = vec4(0.7, 0.8, 1.0, streak * 0.5);
}
`;
