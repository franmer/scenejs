/**
 * @class Manages creation, sharing and recycle of {@link SceneJS_ProgramSource} instances
 * @private
 */
var SceneJS_ProgramSourceFactory = new (function () {

    this._sourceCache = {}; // Source codes are shared across all scenes


    /**
     * Get sourcecode for a program to render the given states
     */
    this.getSource = function (hash, states) {

        var source = this._sourceCache[hash];
        if (source) {
            source.useCount++;
            return source;
        }

        return this._sourceCache[hash] = new SceneJS_ProgramSource(
            hash,

            this._composePickingVertexShader(states), // pickVertexSrc
            this._composePickingFragmentShader(states), // pickFragmentSrc
            this._composeRenderingVertexShader(states), // drawVertexSrc
            this._composeRenderingFragmentShader(states)  // drawfragmentSrc
        );
    };

    /**
     * Releases program source code
     */
    this.putSource = function (hash) {
        var source = this._sourceCache[hash];
        if (source) {
            if (--source.useCount == 0) {
                this._sourceCache[source.hash] = null;
            }
        }
    };

    this._composePickingVertexShader = function (states) {
        var morphing = !!states.morphGeometry.targets;
        var src = [

            "precision mediump float;",

            "attribute vec3 SCENEJS_aVertex;",
            "uniform mat4 SCENEJS_uMMatrix;",
            "uniform mat4 SCENEJS_uVMatrix;",
            "uniform mat4 SCENEJS_uVNMatrix;",
            "uniform mat4 SCENEJS_uPMatrix;"
        ];

        src.push("varying vec4 SCENEJS_vWorldVertex;");
        src.push("varying vec4 SCENEJS_vViewVertex;");

        if (morphing) {
            src.push("uniform float SCENEJS_uMorphFactor;");       // LERP factor for morph
            if (states.morphGeometry.targets[0].vertexBuf) {      // target2 has these arrays also
                src.push("attribute vec3 SCENEJS_aMorphVertex;");
            }
        }

        src.push("void main(void) {");

        src.push("   vec4 tmpVertex=vec4(SCENEJS_aVertex, 1.0); ");
        if (morphing) {
            if (states.morphGeometry.targets[0].vertexBuf) {
                src.push("  tmpVertex = vec4(mix(tmpVertex.xyz, SCENEJS_aMorphVertex, SCENEJS_uMorphFactor), 1.0); ");
            }
        }
        src.push("  SCENEJS_vWorldVertex = SCENEJS_uMMatrix * tmpVertex; ");

        src.push("  SCENEJS_vViewVertex = SCENEJS_uVMatrix * SCENEJS_vWorldVertex;");

        src.push("  gl_Position =  SCENEJS_uPMatrix * SCENEJS_vViewVertex;");
        src.push("}");
        return src;
    };

    /**
     * Composes a fragment shader script for rendering mode in current scene state
     * @private
     */
    this._composePickingFragmentShader = function (states) {

        var clipping = states.clips.clips.length > 0;

        var src = [
            "precision mediump float;"
        ];

        src.push("varying vec4 SCENEJS_vWorldVertex;");
        src.push("varying vec4  SCENEJS_vViewVertex;");                  // View-space vertex

        src.push("uniform bool  SCENEJS_uRayPickMode;");                   // Z-pick mode when true else colour-pick
        src.push("uniform vec3  SCENEJS_uPickColor;");                   // Used in colour-pick mode
        src.push("uniform float SCENEJS_uZNear;");                      // Used in Z-pick mode
        src.push("uniform float SCENEJS_uZFar;");                       // Used in Z-pick mode
        src.push("uniform bool  SCENEJS_uClipping;");

        if (clipping) {

            // World-space clipping planes
            for (var i = 0; i < states.clips.clips.length; i++) {
                src.push("uniform float SCENEJS_uClipMode" + i + ";");
                src.push("uniform vec4  SCENEJS_uClipNormalAndDist" + i + ";");
            }
        }

        // Pack depth function for ray-pick
        src.push("vec4 packDepth(const in float depth) {");
        src.push("  const vec4 bitShift = vec4(256.0*256.0*256.0, 256.0*256.0, 256.0, 1.0);");
        src.push("  const vec4 bitMask  = vec4(0.0, 1.0/256.0, 1.0/256.0, 1.0/256.0);");
        src.push("  vec4 res = fract(depth * bitShift);");
        src.push("  res -= res.xxyz * bitMask;");
        src.push("  return res;");
        src.push("}");

        src.push("void main(void) {");

        if (clipping) {

            src.push("if (SCENEJS_uClipping) {");
            src.push("  float   dist;");
            for (var i = 0; i < states.clips.clips.length; i++) {
                src.push("    if (SCENEJS_uClipMode" + i + " != 0.0) {");
                src.push("        dist = dot(SCENEJS_vWorldVertex.xyz, SCENEJS_uClipNormalAndDist" + i + ".xyz) - SCENEJS_uClipNormalAndDist" + i + ".w;");
                src.push("        if (SCENEJS_uClipMode" + i + " == 1.0) {");
                src.push("            if (dist > 0.0) { discard; }");
                src.push("        }");
                src.push("        if (SCENEJS_uClipMode" + i + " == 2.0) {");
                src.push("            if (dist > 0.0) { discard; }");
                src.push("        }");
                src.push("    }");
            }
            src.push("}");
        }

        src.push("    if (SCENEJS_uRayPickMode) {");
        src.push("          float zNormalizedDepth = abs((SCENEJS_uZNear + SCENEJS_vViewVertex.z) / (SCENEJS_uZFar - SCENEJS_uZNear));");
        src.push("          gl_FragColor = packDepth(zNormalizedDepth); ");
        src.push("    } else {");
        src.push("          gl_FragColor = vec4(SCENEJS_uPickColor.rgb, 1.0);  ");
        src.push("    }");

        src.push("}");

        return src;
    };

    this._isTexturing = function (states) {
        if (states.texture.layers && states.texture.layers.length > 0) {
            if (states.geometry.uvBuf || states.geometry.uvBuf2) {
                return true;
            }
            if (states.morphGeometry.targets && (states.morphGeometry.targets[0].uvBuf || states.morphGeometry.targets[0].uvBuf2)) {
                return true;
            }
        }
        return false;
    };

    this._isCubeMapping = function (states) {
        return (states.cubemap.layers && states.cubemap.layers.length > 0 && states.geometry.normalBuf);
    };

    this._hasNormals = function (states) {
        if (states.geometry.normalBuf) {
            return true;
        }
        if (states.morphGeometry.targets && states.morphGeometry.targets[0].normalBuf) {
            return true;
        }
        return false;
    };

    this._hasTangents = function (states) {
        if (states.texture) {
            var layers = states.texture.layers;
            if (!layers) {
                return false;
            }
            for (var i = 0, len = layers.length; i < len; i++) {
                if (layers[i].applyTo == "normals") {
                    return true;
                }
            }
        }
        return false;
    };

    this._composeRenderingVertexShader = function (states) {

        var customShaders = states.shader.shaders || {};

        // Do a full custom shader replacement if code supplied without hooks
        if (customShaders.vertex
            && customShaders.vertex.code
            && customShaders.vertex.code != ""
            && SceneJS._isEmpty(customShaders.vertex.hooks)) {
            return [customShaders.vertex.code];
        }

        var customVertexShader = customShaders.vertex || {};
        var vertexHooks = customVertexShader.hooks || {};

        var customFragmentShader = customShaders.fragment || {};
        var fragmentHooks = customFragmentShader.hooks || {};

        var texturing = this._isTexturing(states);
        var normals = this._hasNormals(states);
        var tangents = this._hasTangents(states);
        var clipping = states.clips.clips.length > 0;
        var morphing = !!states.morphGeometry.targets;

        var src = [
            "precision mediump float;"
        ];

        src.push("uniform mat4 SCENEJS_uMMatrix;");             // Model matrix
        src.push("uniform mat4 SCENEJS_uVMatrix;");             // View matrix
        src.push("uniform mat4 SCENEJS_uPMatrix;");             // Projection matrix

        src.push("attribute vec3 SCENEJS_aVertex;");            // Model coordinates

        src.push("uniform vec3 SCENEJS_uWorldEye;");            // World-space eye position

        src.push("varying vec3 SCENEJS_vViewEyeVec;");          // View-space vector from origin to eye

        if (normals) {

            src.push("attribute vec3 SCENEJS_aNormal;");        // Normal vectors
            src.push("uniform   mat4 SCENEJS_uMNMatrix;");      // Model normal matrix
            src.push("uniform   mat4 SCENEJS_uVNMatrix;");      // View normal matrix

            src.push("varying   vec3 SCENEJS_vViewNormal;");    // Output view-space vertex normal

            if (tangents) {
                src.push("attribute vec4 SCENEJS_aTangent;");
            }

            for (var i = 0; i < states.lights.lights.length; i++) {

                var light = states.lights.lights[i];

                if (light.mode == "ambient") {
                    continue;
                }

                if (light.mode == "dir") {
                    src.push("uniform vec3 SCENEJS_uLightDir" + i + ";");
                }

                if (light.mode == "point") {
                    src.push("uniform vec3 SCENEJS_uLightPos" + i + ";");
                }

                if (light.mode == "spot") {
                    src.push("uniform vec3 SCENEJS_uLightPos" + i + ";");
                }

                // Vector from vertex to light, packaged with the pre-computed length of that vector
                src.push("varying vec4 SCENEJS_vViewLightVecAndDist" + i + ";");
            }
        }

        if (texturing) {

            if (states.geometry.uvBuf) {
                src.push("attribute vec2 SCENEJS_aUVCoord;");      // UV coords
            }

            if (states.geometry.uvBuf2) {
                src.push("attribute vec2 SCENEJS_aUVCoord2;");     // UV2 coords
            }
        }

        if (states.geometry.colorBuf) {
            src.push("attribute vec4 SCENEJS_aVertexColor;");       // UV2 coords
            src.push("varying vec4 SCENEJS_vColor;");               // Varying for fragment texturing
        }

        if (clipping) {
            src.push("varying vec4 SCENEJS_vWorldVertex;");         // Varying for fragment clip or world pos hook
        }

        src.push("varying vec4 SCENEJS_vViewVertex;");              // Varying for fragment view clip hook

        if (texturing) {                                            // Varyings for fragment texturing

            if (states.geometry.uvBuf) {
                src.push("varying vec2 SCENEJS_vUVCoord;");
            }

            if (states.geometry.uvBuf2) {
                src.push("varying vec2 SCENEJS_vUVCoord2;");
            }
        }

        if (morphing) {
            src.push("uniform float SCENEJS_uMorphFactor;");       // LERP factor for morph
            if (states.morphGeometry.targets[0].vertexBuf) {      // target2 has these arrays also
                src.push("attribute vec3 SCENEJS_aMorphVertex;");
            }
            if (normals) {
                if (states.morphGeometry.targets[0].normalBuf) {
                    src.push("attribute vec3 SCENEJS_aMorphNormal;");
                }
            }
        }

        if (customVertexShader.code) {
            src.push("\n" + customVertexShader.code + "\n");
        }

        src.push("void main(void) {");

        src.push("  vec4 tmpVertex=vec4(SCENEJS_aVertex, 1.0); ");

        src.push("  vec4 modelVertex = tmpVertex; ");
        if (normals) {
            src.push("  vec4 modelNormal = vec4(SCENEJS_aNormal, 0.0); ");
        }

        // Morphing - morph targets are in same model space as the geometry
        if (morphing) {
            if (states.morphGeometry.targets[0].vertexBuf) {
                src.push("  vec4 vMorphVertex = vec4(SCENEJS_aMorphVertex, 1.0); ");
                src.push("  modelVertex = vec4(mix(modelVertex.xyz, vMorphVertex.xyz, SCENEJS_uMorphFactor), 1.0); ");
            }
            if (normals) {
                if (states.morphGeometry.targets[0].normalBuf) {
                    src.push("  vec4 vMorphNormal = vec4(SCENEJS_aMorphNormal, 1.0); ");
                    src.push("  modelNormal = vec4( mix(modelNormal.xyz, vMorphNormal.xyz, SCENEJS_uMorphFactor), 1.0); ");
                }
            }
        }

        src.push("  vec4 worldVertex = SCENEJS_uMMatrix * modelVertex;");

        if (vertexHooks.viewMatrix) {
            src.push("vec4 viewVertex = " + vertexHooks.viewMatrix + "(SCENEJS_uVMatrix) * worldVertex;");
        } else {
            src.push("vec4 viewVertex  = SCENEJS_uVMatrix * worldVertex; ");
        }

        if (vertexHooks.viewPos) {
            src.push("viewVertex=" + vertexHooks.viewPos + "(viewVertex);");    // Vertex hook function
        }

        if (normals) {
            src.push("  vec3 worldNormal = (SCENEJS_uMNMatrix * modelNormal).xyz; ");
            src.push("  SCENEJS_vViewNormal = (SCENEJS_uVNMatrix * vec4(worldNormal, 1.0)).xyz;");
        }

        if (clipping || fragmentHooks.worldPos) {
            src.push("  SCENEJS_vWorldVertex = worldVertex;");                  // Varying for fragment world clip or hooks
        }

        src.push("  SCENEJS_vViewVertex = viewVertex;");                    // Varying for fragment hooks

        if (vertexHooks.projMatrix) {
            src.push("gl_Position = " + vertexHooks.projMatrix + "(SCENEJS_uPMatrix) * viewVertex;");
        } else {
            src.push("  gl_Position = SCENEJS_uPMatrix * viewVertex;");
        }

        if (tangents) {

            // Compute tangent-bitangent-normal matrix

            src.push("vec3 tangent = normalize((SCENEJS_uVNMatrix * SCENEJS_uMNMatrix * SCENEJS_aTangent).xyz);");
            src.push("vec3 bitangent = cross(SCENEJS_vViewNormal, tangent);");
            src.push("mat3 TBM = mat3(tangent, bitangent, SCENEJS_vViewNormal);");
        }

        src.push("  vec3 tmpVec3;");

        if (normals) {

            for (var i = 0; i < states.lights.lights.length; i++) {

                light = states.lights.lights[i];

                if (light.mode == "ambient") {
                    continue;
                }

                if (light.mode == "dir") {

                    // Directional light

                    if (light.space == "world") {

                        // World space light

                        src.push("tmpVec3 = normalize(SCENEJS_uLightDir" + i + ");");

                        // Transform to View space
                        src.push("tmpVec3 = vec3(SCENEJS_uVMatrix * vec4(tmpVec3, 0.0)).xyz;");

                        if (tangents) {

                            // Transform to Tangent space
                            src.push("tmpVec3 *= TBM;");
                        }

                    } else {

                        // View space light

                        src.push("tmpVec3 = normalize(SCENEJS_uLightDir" + i + ");");

                        if (tangents) {

                            // Transform to Tangent space
                            src.push("tmpVec3 *= TBM;");
                        }
                    }

                    // Output
                    src.push("SCENEJS_vViewLightVecAndDist" + i + " = vec4(-tmpVec3, 0.0);");
                }

                if (light.mode == "point") {

                    // Positional light

                    if (light.space == "world") {

                        // World space

                        src.push("tmpVec3 = SCENEJS_uLightPos" + i + " - worldVertex.xyz;"); // Vector from World coordinate to light pos

                        // Transform to View space
                        src.push("tmpVec3 = vec3(SCENEJS_uVMatrix * vec4(tmpVec3, 0.0)).xyz;");

                        if (tangents) {

                            // Transform to Tangent space
                            src.push("tmpVec3 *= TBM;");
                        }

                    } else {

                        // View space

                        src.push("tmpVec3 = SCENEJS_uLightPos" + i + ".xyz - viewVertex.xyz;"); // Vector from View coordinate to light pos

                        if (tangents) {

                            // Transform to tangent space
                            src.push("tmpVec3 *= TBM;");
                        }
                    }

                    // Output
                    src.push("SCENEJS_vViewLightVecAndDist" + i + " = vec4(tmpVec3, length( SCENEJS_uLightPos" + i + " - worldVertex.xyz));");
                }
            }
        }

        src.push("SCENEJS_vViewEyeVec = ((SCENEJS_uVMatrix * vec4(SCENEJS_uWorldEye, 0.0)).xyz  - viewVertex.xyz);");

        if (tangents) {

            src.push("SCENEJS_vViewEyeVec *= TBM;");
        }

        if (texturing) {

            if (states.geometry.uvBuf) {
                src.push("SCENEJS_vUVCoord = SCENEJS_aUVCoord;");
            }

            if (states.geometry.uvBuf2) {
                src.push("SCENEJS_vUVCoord2 = SCENEJS_aUVCoord2;");
            }
        }

        if (states.geometry.colorBuf) {
            src.push("SCENEJS_vColor = SCENEJS_aVertexColor;");
        }
        src.push("}");

        return src;
    };


    /*-----------------------------------------------------------------------------------------------------------------
     * Rendering Fragment shader
     *---------------------------------------------------------------------------------------------------------------*/

    this._composeRenderingFragmentShader = function (states) {

        var customShaders = states.shader.shaders || {};

        // Do a full custom shader replacement if code supplied without hooks
        if (customShaders.fragment
            && customShaders.fragment.code
            && customShaders.fragment.code != ""
            && SceneJS._isEmpty(customShaders.fragment.hooks)) {
            return [customShaders.fragment.code];
        }

        var customFragmentShader = customShaders.fragment || {};
        var fragmentHooks = customFragmentShader.hooks || {};

        var texturing = this._isTexturing(states);
        var cubeMapping = this._isCubeMapping(states);
        var normals = this._hasNormals(states);
        var tangents = this._hasTangents(states);
        var clipping = states.clips.clips.length > 0;

        var src = ["\n"];

        src.push("precision mediump float;");


        if (clipping) {
            src.push("varying vec4 SCENEJS_vWorldVertex;");             // World-space vertex
        }

        //  if (fragmentHooks.viewPos) {
        src.push("varying vec4 SCENEJS_vViewVertex;");              // View-space vertex
        //  }

        src.push("uniform float SCENEJS_uZNear;");                      // Used in Z-pick mode
        src.push("uniform float SCENEJS_uZFar;");                       // Used in Z-pick mode


        /*-----------------------------------------------------------------------------------
         * Variables
         *----------------------------------------------------------------------------------*/

        if (clipping) {
            for (var i = 0; i < states.clips.clips.length; i++) {
                src.push("uniform float SCENEJS_uClipMode" + i + ";");
                src.push("uniform vec4  SCENEJS_uClipNormalAndDist" + i + ";");
            }
        }

        if (texturing) {
            if (states.geometry.uvBuf) {
                src.push("varying vec2 SCENEJS_vUVCoord;");
            }
            if (states.geometry.uvBuf2) {
                src.push("varying vec2 SCENEJS_vUVCoord2;");
            }
            var layer;
            for (var i = 0, len = states.texture.layers.length; i < len; i++) {
                layer = states.texture.layers[i];
                src.push("uniform sampler2D SCENEJS_uSampler" + i + ";");
                if (layer.matrix) {
                    src.push("uniform mat4 SCENEJS_uLayer" + i + "Matrix;");
                }
                src.push("uniform float SCENEJS_uLayer" + i + "BlendFactor;");
            }
        }

        if (normals && cubeMapping) {
            var layer;
            for (var i = 0, len = states.cubemap.layers.length; i < len; i++) {
                layer = states.cubemap.layers[i];
                src.push("uniform samplerCube SCENEJS_uCubeMapSampler" + i + ";");
                src.push("uniform float SCENEJS_uCubeMapIntensity" + i + ";");
            }
        }

        /* True when lighting
         */
        src.push("uniform bool  SCENEJS_uBackfaceTexturing;");
        src.push("uniform bool  SCENEJS_uBackfaceLighting;");
        src.push("uniform bool  SCENEJS_uSpecularLighting;");
        src.push("uniform bool  SCENEJS_uClipping;");
        src.push("uniform bool  SCENEJS_uAmbient;");
        src.push("uniform bool  SCENEJS_uDiffuse;");
        src.push("uniform bool  SCENEJS_uReflection;");

        // Added in v4.0 to support depth targets
        src.push("uniform bool  SCENEJS_uDepthMode;");

        /* True when rendering transparency
         */
        src.push("uniform bool  SCENEJS_uTransparent;");

        /* Vertex color variable
         */
        if (states.geometry.colorBuf) {
            src.push("varying vec4 SCENEJS_vColor;");
        }

        src.push("uniform vec3  SCENEJS_uAmbientColor;");                         // Scene ambient colour - taken from clear colour

        src.push("uniform vec3  SCENEJS_uMaterialColor;");
        src.push("uniform float SCENEJS_uMaterialAlpha;");
        src.push("uniform float SCENEJS_uMaterialEmit;");
        src.push("uniform vec3  SCENEJS_uMaterialSpecularColor;");
        src.push("uniform float SCENEJS_uMaterialSpecular;");
        src.push("uniform float SCENEJS_uMaterialShine;");

        src.push("varying vec3 SCENEJS_vViewEyeVec;");                          // Direction of world-space vertex from eye

        if (normals) {

            src.push("varying vec3 SCENEJS_vViewNormal;");                   // View-space normal

            var light;
            for (var i = 0; i < states.lights.lights.length; i++) {
                light = states.lights.lights[i];
                if (light.mode == "ambient") {
                    continue;
                }
                src.push("uniform vec3  SCENEJS_uLightColor" + i + ";");
                if (light.mode == "point") {
                    src.push("uniform vec3  SCENEJS_uLightAttenuation" + i + ";");
                }
                src.push("varying vec4  SCENEJS_vViewLightVecAndDist" + i + ";");         // Vector from light to vertex
            }
        }

        if (customFragmentShader.code) {
            src.push("\n" + customFragmentShader.code + "\n");
        }

        src.push("void main(void) {");

        // World-space arbitrary clipping planes

        if (clipping) {
            src.push("if (SCENEJS_uClipping) {");
            src.push("  float   dist;");
            for (var i = 0; i < states.clips.clips.length; i++) {
                src.push("    if (SCENEJS_uClipMode" + i + " != 0.0) {");
                src.push("        dist = dot(SCENEJS_vWorldVertex.xyz, SCENEJS_uClipNormalAndDist" + i + ".xyz) - SCENEJS_uClipNormalAndDist" + i + ".w;");
                src.push("        if (SCENEJS_uClipMode" + i + " == 1.0) {");
                src.push("            if (dist > 0.0) { discard; }");
                src.push("        }");
                src.push("        if (SCENEJS_uClipMode" + i + " == 2.0) {");
                src.push("            if (dist > 0.0) { discard; }");
                src.push("        }");
                src.push("    }");
            }
            src.push("}");
        }

        src.push("  vec3 ambient= SCENEJS_uAmbient ? SCENEJS_uAmbientColor : vec3(0.0, 0.0, 0.0);");

        if (texturing && states.geometry.uvBuf && fragmentHooks.texturePos) {
            src.push(fragmentHooks.texturePos + "(SCENEJS_vUVCoord);");
        }

        if (fragmentHooks.viewPos) {
            src.push(fragmentHooks.viewPos + "(SCENEJS_vViewVertex);");
        }

        if (normals && fragmentHooks.viewNormal) {
            src.push(fragmentHooks.viewNormal + "(SCENEJS_vViewNormal);");
        }

        if (states.geometry.colorBuf) {
            src.push("  vec3    color   = SCENEJS_vColor.rgb;");
        } else {
            src.push("  vec3    color   = SCENEJS_uMaterialColor;")
        }

        src.push("  float alpha         = SCENEJS_uMaterialAlpha;");
        src.push("  float emit          = SCENEJS_uMaterialEmit;");
        src.push("  float specular      = SCENEJS_uMaterialSpecular;");
        src.push("  vec3  specularColor = SCENEJS_uMaterialSpecularColor;");
        src.push("  float shine         = SCENEJS_uMaterialShine;");

        if (fragmentHooks.materialBaseColor) {
            src.push("color=" + fragmentHooks.materialBaseColor + "(color);");
        }
        if (fragmentHooks.materialAlpha) {
            src.push("alpha=" + fragmentHooks.materialAlpha + "(alpha);");
        }
        if (fragmentHooks.materialEmit) {
            src.push("emit=" + fragmentHooks.materialEmit + "(emit);");
        }
        if (fragmentHooks.materialSpecular) {
            src.push("specular=" + fragmentHooks.materialSpecular + "(specular);");
        }
        if (fragmentHooks.materialSpecularColor) {
            src.push("specularColor=" + fragmentHooks.materialSpecularColor + "(specularColor);");
        }
        if (fragmentHooks.materialShine) {
            src.push("shine=" + fragmentHooks.materialShine + "(shine);");
        }

        if (normals) {
            src.push("  float   attenuation = 1.0;");
            if (tangents) {
                src.push("  vec3    viewNormalVec = vec3(0.0, 1.0, 0.0);");
            } else {

                // Normalize the interpolated normals in the per-fragment-fragment-shader,
                // because if we linear interpolated two nonparallel normalized vectors, the resulting vector won’t be of length 1
                src.push("  vec3    viewNormalVec = normalize(SCENEJS_vViewNormal);");
            }
        }

        var layer;
        if (texturing) {

            if (normals) {
                src.push("if (SCENEJS_uBackfaceTexturing || dot(SCENEJS_vViewNormal, SCENEJS_vViewEyeVec) > 0.0) {");
            }

            src.push("  vec4    texturePos;");
            src.push("  vec2    textureCoord=vec2(0.0,0.0);");

            for (var i = 0, len = states.texture.layers.length; i < len; i++) {
                layer = states.texture.layers[i];

                /* Texture input
                 */
                if (layer.applyFrom == "normal" && normals) {
                    if (states.geometry.normalBuf) {
                        src.push("texturePos=vec4(viewNormalVec.xyz, 1.0);");
                    } else {
                        SceneJS.log.warn("Texture layer applyFrom='normal' but geo has no normal vectors");
                        continue;
                    }
                }
                if (layer.applyFrom == "uv") {
                    if (states.geometry.uvBuf) {
                        src.push("texturePos = vec4(SCENEJS_vUVCoord.s, SCENEJS_vUVCoord.t, 1.0, 1.0);");
                    } else {
                        SceneJS.log.warn("Texture layer applyTo='uv' but geometry has no UV coordinates");
                        continue;
                    }
                }
                if (layer.applyFrom == "uv2") {
                    if (states.geometry.uvBuf2) {
                        src.push("texturePos = vec4(SCENEJS_vUVCoord2.s, SCENEJS_vUVCoord2.t, 1.0, 1.0);");
                    } else {
                        SceneJS.log.warn("Texture layer applyTo='uv2' but geometry has no UV2 coordinates");
                        continue;
                    }
                }

                /* Texture matrix
                 */
                if (layer.matrix) {
                    src.push("textureCoord=(SCENEJS_uLayer" + i + "Matrix * texturePos).xy;");
                } else {
                    src.push("textureCoord=texturePos.xy;");
                }

                /* Alpha from Texture
                 */
                if (layer.applyTo == "alpha") {
                    if (layer.blendMode == "multiply") {
                        src.push("alpha = alpha * (SCENEJS_uLayer" + i + "BlendFactor * texture2D(SCENEJS_uSampler" + i + ", vec2(textureCoord.x, 1.0 - textureCoord.y)).b);");
                    } else if (layer.blendMode == "add") {
                        src.push("alpha = ((1.0 - SCENEJS_uLayer" + i + "BlendFactor) * alpha) + (SCENEJS_uLayer" + i + "BlendFactor * texture2D(SCENEJS_uSampler" + i + ", vec2(textureCoord.x, 1.0 - textureCoord.y)).b);");
                    }
                }

                /* Texture output
                 */
                if (layer.applyTo == "baseColor") {
                    if (layer.blendMode == "multiply") {
                        src.push("color = color * (SCENEJS_uLayer" + i + "BlendFactor * texture2D(SCENEJS_uSampler" + i + ", vec2(textureCoord.x, 1.0 - textureCoord.y)).rgb);");
                    } else {
                        src.push("color = ((1.0 - SCENEJS_uLayer" + i + "BlendFactor) * color) + (SCENEJS_uLayer" + i + "BlendFactor * texture2D(SCENEJS_uSampler" + i + ", vec2(textureCoord.x, 1.0 - textureCoord.y)).rgb);");
                    }
                }

                if (layer.applyTo == "emit") {
                    if (layer.blendMode == "multiply") {
                        src.push("emit  = emit * (SCENEJS_uLayer" + i + "BlendFactor * texture2D(SCENEJS_uSampler" + i + ", vec2(textureCoord.x, 1.0 - textureCoord.y)).r);");
                    } else {
                        src.push("emit = ((1.0 - SCENEJS_uLayer" + i + "BlendFactor) * emit) + (SCENEJS_uLayer" + i + "BlendFactor * texture2D(SCENEJS_uSampler" + i + ", vec2(textureCoord.x, 1.0 - textureCoord.y)).r);");
                    }
                }

                if (layer.applyTo == "specular" && normals) {
                    if (layer.blendMode == "multiply") {
                        src.push("specular  = specular * (SCENEJS_uLayer" + i + "BlendFactor * texture2D(SCENEJS_uSampler" + i + ", vec2(textureCoord.x, 1.0 - textureCoord.y)).r);");
                    } else {
                        src.push("specular = ((1.0 - SCENEJS_uLayer" + i + "BlendFactor) * specular) + (SCENEJS_uLayer" + i + "BlendFactor * texture2D(SCENEJS_uSampler" + i + ", vec2(textureCoord.x, 1.0 - textureCoord.y)).r);");
                    }
                }

                if (layer.applyTo == "shine") {
                    if (layer.blendMode == "multiply") {
                        src.push("shine  = shine * (SCENEJS_uLayer" + i + "BlendFactor * texture2D(SCENEJS_uSampler" + i + ", vec2(textureCoord.x, 1.0 - textureCoord.y)).r);");
                    } else {
                        src.push("shine = ((1.0 - SCENEJS_uLayer" + i + "BlendFactor) * shine) + (SCENEJS_uLayer" + i + "BlendFactor * texture2D(SCENEJS_uSampler" + i + ", vec2(textureCoord.x, 1.0 - textureCoord.y)).r);");
                    }
                }

                if (layer.applyTo == "normals" && normals) {
                    src.push("viewNormalVec = normalize(texture2D(SCENEJS_uSampler" + i + ", vec2(textureCoord.x, -textureCoord.y)).xyz * 2.0 - 1.0);");
                }

            }
            if (normals) {
                src.push("}");
            }
        }

        if (normals && cubeMapping) {
            src.push("if (SCENEJS_uReflection) {"); // Flag which can enable/disable reflection
            src.push("vec3 envLookup = reflect(SCENEJS_vViewEyeVec, viewNormalVec);");
            src.push("envLookup.y = envLookup.y * -1.0;"); // Need to flip textures on Y-axis for some reason
            src.push("vec4 envColor;");
            for (var i = 0, len = states.cubemap.layers.length; i < len; i++) {
                layer = states.cubemap.layers[i];
                src.push("envColor = textureCube(SCENEJS_uCubeMapSampler" + i + ", envLookup);");
                src.push("color = mix(color, envColor.rgb, specular * SCENEJS_uCubeMapIntensity" + i + ");");
            }
            src.push("}");
        }

        src.push("  vec4    fragColor;");

        if (normals) {

            src.push("if (SCENEJS_uBackfaceLighting || dot(viewNormalVec, SCENEJS_vViewEyeVec) > 0.0) {");

            src.push("  vec3    lightValue      = vec3(0.0, 0.0, 0.0);");
            src.push("  vec3    specularValue   = vec3(0.0, 0.0, 0.0);");
            src.push("  vec3    viewLightVec;");
            src.push("  float   dotN;");
            src.push("  float   lightDist;");

            var light;

            for (var i = 0, len = states.lights.lights.length; i < len; i++) {
                light = states.lights.lights[i];

                if (light.mode == "ambient") {
                    continue;
                }

                src.push("viewLightVec = SCENEJS_vViewLightVecAndDist" + i + ".xyz;");

                if (light.mode == "point") {

                    src.push("dotN = max(dot(normalize(viewNormalVec), normalize(viewLightVec)), 0.0);");

                    //src.push("if (dotN > 0.0) {");

                    src.push("lightDist = SCENEJS_vViewLightVecAndDist" + i + ".w;");

                    src.push("attenuation = 1.0 - (" +
                        "  SCENEJS_uLightAttenuation" + i + "[0] + " +
                        "  SCENEJS_uLightAttenuation" + i + "[1] * lightDist + " +
                        "  SCENEJS_uLightAttenuation" + i + "[2] * lightDist * lightDist);");

                    if (light.diffuse) {
                        src.push("if (SCENEJS_uDiffuse) {");
                        src.push("      lightValue += dotN * SCENEJS_uLightColor" + i + " * attenuation;");
                        src.push("}");
                    }

                    if (light.specular) {
                        src.push("if (SCENEJS_uSpecularLighting) {");
                        src.push("    specularValue += specularColor * SCENEJS_uLightColor" + i +
                            " * specular * pow(max(dot(reflect(normalize(-viewLightVec), normalize(-viewNormalVec)), normalize(-SCENEJS_vViewVertex.xyz)), 0.0), shine) * attenuation;");
                        src.push("}");
                    }
                }

                if (light.mode == "dir") {

                    src.push("dotN = max(dot(normalize(viewNormalVec), normalize(viewLightVec)), 0.0);");

                    if (light.diffuse) {
                        src.push("if (SCENEJS_uDiffuse) {");
                        src.push("      lightValue += dotN * SCENEJS_uLightColor" + i + ";");
                        src.push("}");
                    }

                    if (light.specular) {
                        src.push("if (SCENEJS_uSpecularLighting) {");
                        src.push("    specularValue += specularColor * SCENEJS_uLightColor" + i +
                            " * specular * pow(max(dot(reflect(normalize(-viewLightVec), normalize(-viewNormalVec)), normalize(-SCENEJS_vViewVertex.xyz)), 0.0), shine);");
                        src.push("}");
                    }
                }
            }

            src.push("      fragColor = vec4((specularValue.rgb + color.rgb * (lightValue.rgb + ambient.rgb)) + (emit * color.rgb), alpha);");
            src.push("   } else {");
            src.push("      fragColor = vec4((color.rgb + (emit * color.rgb)) *  (vec3(1.0, 1.0, 1.0) + ambient.rgb), alpha);");
            src.push("   }");

        } else { // No normals
            src.push("fragColor = vec4((color.rgb + (emit * color.rgb)) *  (vec3(1.0, 1.0, 1.0) + ambient.rgb), alpha);");
        }

        if (fragmentHooks.pixelColor) {
            src.push("fragColor=" + fragmentHooks.pixelColor + "(fragColor);");
        }
        if (false && debugCfg.whitewash === true) {
            src.push("    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);");
        } else {
            src.push("    if (SCENEJS_uDepthMode) {");
            src.push("          float depth = length(SCENEJS_vViewVertex) / (SCENEJS_uZFar - SCENEJS_uZNear);");
            src.push("          const vec4 bias = vec4(1.0 / 255.0,");
            src.push("          1.0 / 255.0,");
            src.push("          1.0 / 255.0,");
            src.push("          0.0);");
            src.push("          float r = depth;");
            src.push("          float g = fract(r * 255.0);");
            src.push("          float b = fract(g * 255.0);");
            src.push("          float a = fract(b * 255.0);");
            src.push("          vec4 colour = vec4(r, g, b, a);");
            src.push("          gl_FragColor = colour - (colour.yzww * bias);");
            src.push("    } else {");
            src.push("          gl_FragColor = fragColor;");
            src.push("    };");
        }
        src.push("}");

        return src;
    };

})();