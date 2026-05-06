// Shader sources for the WebGL2 renderer. Kept inline as TS string
// constants so Vite can hash them with the bundle and there's no second
// HTTP roundtrip for tiny GLSL files. Phase 5B adds the heavy shaders
// (post-process, terrain) in their own files.

export const SPRITE_VERT = /* glsl */ `#version 300 es
precision highp float;

// Per-vertex (unit quad)
in vec2 a_pos;            // [0..1]
in vec2 a_uv;             // [0..1]

// Per-instance
in vec4 a_dst;            // (dx, dy, dw, dh) in pixels
in vec4 a_src;            // (sx, sy, sw, sh) in atlas pixels
in vec4 a_tint;           // RGBA premultiplied tint, 0..1

uniform vec2 u_viewport;  // viewport in CSS pixels
uniform vec2 u_atlasSize; // atlas texture size in pixels
uniform vec2 u_camera;    // camera offset in CSS pixels
uniform float u_zoom;     // multiplicative zoom around viewport center

out vec2 v_uv;
out vec4 v_tint;

void main() {
    vec2 px = a_dst.xy + a_pos * a_dst.zw;
    vec2 centered = px - u_viewport * 0.5 - u_camera;
    centered *= u_zoom;
    px = centered + u_viewport * 0.5;

    vec2 ndc = (px / u_viewport) * 2.0 - 1.0;
    ndc.y = -ndc.y;
    gl_Position = vec4(ndc, 0.0, 1.0);

    vec2 uvPx = a_src.xy + a_uv * a_src.zw;
    v_uv = uvPx / u_atlasSize;
    v_tint = a_tint;
}
`;

export const SPRITE_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
in vec4 v_tint;

uniform sampler2D u_atlas;

out vec4 o_color;

void main() {
    vec4 c = texture(u_atlas, v_uv);
    // Atlas is straight alpha; tint is multiplied. Sprites with v_tint.a
    // less than 1 fade out.
    o_color = vec4(c.rgb * v_tint.rgb, c.a * v_tint.a);
}
`;
