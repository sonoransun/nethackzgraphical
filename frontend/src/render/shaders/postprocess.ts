// Post-process pipeline shaders.
//
// Conceptual order (inserts between scene render and screen):
//   1. Bright-pass extract  →  blur N times       →  Bloom
//   2. Composite (scene + bloom)
//   3. Color grade (per-branch RGB multiplier or 3D LUT)
//   4. Vignette
//   5. Optional CRT (scanlines + chromatic aberration + barrel distortion)
//
// Each pass is a fullscreen quad. The vertex shader is shared.

export const FULLSCREEN_VERT = /* glsl */ `#version 300 es
precision highp float;
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
    v_uv = a_uv;
    gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const BRIGHT_PASS_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_color;
uniform float u_threshold;       // 0..1, anything above contributes
out vec4 o_color;
void main() {
    vec3 c = texture(u_color, v_uv).rgb;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float k = smoothstep(u_threshold, u_threshold + 0.15, l);
    o_color = vec4(c * k, 1.0);
}
`;

export const BLUR_H_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;            // 1.0 / textureSize
out vec4 o_color;
const float W[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
void main() {
    vec3 sum = texture(u_src, v_uv).rgb * W[0];
    for (int i = 1; i < 5; i++) {
        vec2 off = vec2(u_texel.x * float(i), 0.0);
        sum += texture(u_src, v_uv + off).rgb * W[i];
        sum += texture(u_src, v_uv - off).rgb * W[i];
    }
    o_color = vec4(sum, 1.0);
}
`;

export const BLUR_V_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
out vec4 o_color;
const float W[5] = float[5](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
void main() {
    vec3 sum = texture(u_src, v_uv).rgb * W[0];
    for (int i = 1; i < 5; i++) {
        vec2 off = vec2(0.0, u_texel.y * float(i));
        sum += texture(u_src, v_uv + off).rgb * W[i];
        sum += texture(u_src, v_uv - off).rgb * W[i];
    }
    o_color = vec4(sum, 1.0);
}
`;

export const COMPOSITE_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform float u_bloomIntensity;
uniform vec3 u_colorGrade;       // RGB multiplier
uniform float u_vignette;        // 0 = off, 1 = full
out vec4 o_color;
void main() {
    vec3 scene = texture(u_scene, v_uv).rgb;
    vec3 bloom = texture(u_bloom, v_uv).rgb * u_bloomIntensity;
    vec3 c = scene + bloom;
    c *= u_colorGrade;
    // Vignette: soft falloff from center
    vec2 d = v_uv - 0.5;
    float vig = 1.0 - smoothstep(0.35, 0.85, length(d) * 1.4) * u_vignette;
    c *= vig;
    o_color = vec4(c, 1.0);
}
`;

export const CRT_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_resolution;
uniform float u_scanlineIntensity; // 0 = off
uniform float u_chromaticIntensity; // 0 = off
uniform float u_barrelIntensity;    // 0 = off
out vec4 o_color;

vec2 barrelDistort(vec2 uv, float k) {
    vec2 cc = uv - 0.5;
    float d = dot(cc, cc);
    return uv + cc * d * k;
}

void main() {
    vec2 uv = barrelDistort(v_uv, u_barrelIntensity);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        o_color = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    // Chromatic aberration: separate R/B by a tiny offset toward edges.
    vec2 cc = (uv - 0.5);
    float aber = u_chromaticIntensity * 0.004;
    float r = texture(u_src, uv + cc * aber).r;
    float g = texture(u_src, uv).g;
    float b = texture(u_src, uv - cc * aber).b;
    vec3 c = vec3(r, g, b);
    // Scanlines
    float sl = sin(uv.y * u_resolution.y * 3.14159) * 0.5 + 0.5;
    c *= mix(1.0, 0.7 + sl * 0.3, u_scanlineIntensity);
    o_color = vec4(c, 1.0);
}
`;
