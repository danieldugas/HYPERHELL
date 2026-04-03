import { Transform4D, Vector4D } from '../hyperengine/transform4d.js';
import { Hyperobject, createHypercube } from '../hyperengine/hyperobject.js';
import { createIslandFloorShader } from '../floor_shaders/island_floor.js';

const CLIP_FAR_BELOW_GROUND_OBJECTS = "true";

export async function runHyperengine(scene) {
    let canvas = scene.mainCanvas;

    // remove right click from canvas
    canvas.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

    let VOX = 96; // 96 128; // Voxel grid size
    if (scene.custom_vox_resolution != null) { VOX = scene.custom_vox_resolution; }
    let PROFILING = false;
    if (scene.enable_profiling != null) { PROFILING = scene.enable_profiling; }

    const PHYSICS_DT = 0.016; // Fixed ~60Hz physics timestep
    
    // Engine state (anything that can change live)
    class EngineState {
        constructor(scene) {
            this.scene = scene;

            // game variables
            this.paused = false; // when true, freeze physics/controls/animation
            this.STEP_PHYSICS_ONCE = false;
            this.DEBUG_PHYSICS = false;
            this.physics_time_s = 0;
            this.accumulated_animation_time_s = 0;
            this.player_is_jumping = false;
            this.last_player_jump_time = 0;

            // Hypercamera definition
            this.camstand_height = 2.0;
            // a vertical pole that is always gravity aligned, on which the camera is mounted with 1 DoF up/down swivel
            this.camstand_T = new Transform4D([
                [1, 0, 0, 0, 0],
                [0, 1, 0, 0, 0],
                [0, 0, 1, 0, 0],
                [0, 0, 0, 1, 0],
                [0, 0, 0, 0, 1]
            ]);
            this.camstandswivel_angle = 0.0;
            this.hypercamera_T = new Transform4D([
                [1, 0, 0, 0, 0],
                [0, 1, 0, 0, 0],
                [0, 0, 1, 0, 1],
                [0, 0, 0, 1, 0],
                [0, 0, 0, 0, 1]
            ]); // hypercam in world
            // No intrinsics for now, (assumed identity)

            // Sensor camera state
            this.sensorCamRotX = -1.6    ;
            this.sensorCamRotY = 0.7;
            this.sensorCamDist = 70;

            this.SENSOR_MODE = 3.0;
            this.DEBUG_TETRA_COLORS = false;
            this.SENSOR_ALPHA = 1.0;
            this.AUTO_SHAKE_SENSOR = false;

            // Controls state
            // mouse
            this.isDraggingLeftClick = false;
            this.lastX = 0;
            this.lastY = 0;
            this.mouseCurrentClickedX = 0;
            this.mouseCurrentClickedY = 0;
            this.isDraggingRightClick = false;
            this.lastXRight = 0;
            this.lastYRight = 0;
            this.isDraggingMiddleClick = false;
            this.lastXMiddle = 0;
            this.lastYMiddle = 0;
            this.mouseScroll01 = 0.5;
            this.mouseScrollActive = false;
            // keyboard
            this.keys = {};
        }
    }
    let engineState = new EngineState(scene);
    


    // Add Controls Div
    if (document.getElementById("help-div") == null) {
        let help_div = document.createElement("div");
        help_div.id = "help-div";
        help_div.style.position = "fixed";
        help_div.style.top = "10px";
        help_div.style.left = "10px";
        help_div.style.backgroundColor = "rgba(0,0,0,0.5)";
        help_div.style.padding = "10px";
        help_div.style.borderRadius = "5px";
        help_div.style.fontSize = "12px";
        help_div.style.color = "#ccc";
        help_div.style.maxWidth = "300px";
        document.body.appendChild(help_div);
        let help_html =
        `
        <div id="help-controls" style="color:rgb(156, 156, 156);">
        WASD: Move hypercamera forwards, sideways<br>
        Q/E: Move hypercamera in ana, kata directions<br>
        IJKL: Rotate hypercamera up/down, left/right<br>
        U/O: Rotate hypercamera in wx plane<br>
        Y/P: Rotate hypercamera in wy plane<br>
        Mouse drag: Rotate sensor view<br>
        Mouse wheel: Zoom<br>

        <!-- dropdown menu for sensor mode (slice, cutout, full) -->
        <div id="sensor-mode-dropdown" style="color:rgb(156, 156, 156);">
        <label for="sensor-mode">Sensor Mode:</label>
        <select id="sensor-mode">
            <option value="slice">Slice</option>
            <option value="cutout">Cutout</option>
            <option value="full" selected>Full</option>
            <option value="half">Half</option>
            <option value="eyeball">Eyeball</option>
        </select>
        </div>

        <!-- Slider for sensor transparency -->
        <div id="sensor-transparency-slider" style="color:rgb(156, 156, 156);">
        <label for="sensor-transparency">Sensor Transparency:</label>
        <input type="range" id="sensor-transparency" name="sensor-transparency" min="0" max="1" step="0.01" value="1.0">
        </div>

        <!-- Checkbox for debugging tetras -->
        <div id="debug-tetras-checkbox" style="color:rgb(156, 156, 156);">
        <label for="debug-tetras">Debug Tetras:</label>
        <input type="checkbox" id="debug-tetras" name="debug-tetras">
        </div>

        <!-- Checkbox for auto shake sensor -->
        <div id="auto-shake-sensor-checkbox" style="color:rgb(156, 156, 156);">
        <label for="auto-shake-sensor">Auto Shake Sensor:</label>
        <input type="checkbox" id="auto-shake-sensor" name="auto-shake-sensor">
        </div>


        </div>
        <br>
        This is the GPU version of <a href="../4d_camera.html">Hypercamera</a>
        `;
        help_div.innerHTML = help_html;
        // update sensor mode
        document.getElementById("sensor-mode").addEventListener("change", function() {
            let sensormodefloat = 0.0;
            if (this.value === "slice") {
                sensormodefloat = 0.0;
            } else if (this.value === "cutout") {
                sensormodefloat = 1.0;
            } else if (this.value === "half") {
                sensormodefloat = 2.0;
            } else if (this.value === "full") {
                sensormodefloat = 3.0;
            } else if (this.value === "eyeball") {
                sensormodefloat = 4.0;
            } else {
                console.log("unknown sensor mode");
            }
            engineState.SENSOR_MODE = sensormodefloat;
            console.log(engineState.SENSOR_MODE);
        });
        // update sensor transparency
        document.getElementById("sensor-transparency").addEventListener("input", function() {
            engineState.SENSOR_ALPHA = parseFloat(this.value);
            console.log(engineState.SENSOR_ALPHA);
        });
        // update debug tetras
        document.getElementById("debug-tetras").addEventListener("change", function() {
            engineState.DEBUG_TETRA_COLORS = this.checked;
            console.log("engineState.DEBUG_TETRA_COLORS:", engineState.DEBUG_TETRA_COLORS);
        });
        // update auto shake sensor
        document.getElementById("auto-shake-sensor").addEventListener("change", function() {
            engineState.AUTO_SHAKE_SENSOR = this.checked;
            console.log("engineState.AUTO_SHAKE_SENSOR:", engineState.AUTO_SHAKE_SENSOR);
        });
    }

    // Add PDA
    if (scene.floorPreset === 'island') {
        // Create floating div at top level of the page, absolute bottom left position, with some text
        let info_div = document.createElement("div");
        info_div.style.position = "absolute";
        info_div.style.left = "20px";
        info_div.style.bottom = "20px";
        info_div.style.width = "300px";
        info_div.style.height = "400px";
        info_div.style.textAlign = "left";
        info_div.style.padding = "10px";
        info_div.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
        info_div.style.color = "white";
        info_div.style.fontFamily = "monospace";
        info_div.style.fontSize = "12px";
        info_div.style.zIndex = 1000;
        document.body.appendChild(info_div);
        // Write text
        const text = `
        HYPERION OS v0.17.1<br>
        -------------------<br>
        Booting Up Emergency Assistance System ...<br>
        <br>
        [ ^_^] < Hi there, I'm Hyperion, your autonomous assistant.<br>
        <br>
        [ -_-] < If I've been activated, it's very likely that your spaceship has crashed into a celestial object.<br>
        <br>
        ['-.-] < Bummer <br>
        <br>
        [ ^.^] < But let's focus on the good: You've got me, and I'm here to help! First, let's see what we're dealing with<br>
        <br>
        [ #_#] < Analyzing...<br>
        <br>
        [ o_o] < oh.<br>
         <br>
        [ o.o] < It looks like your escape pod has landed on a 4-Dimensional planet.<br>
        <br>
        [ -.-] < Ok. No need to panic, let's do some basic movement together. This may be a little disorienting at first.<br>
        `;
        info_div.innerHTML = text;
    }


    // Floor definition
    // Default floor: checkerboard
    let floorShader = `
    // add a ground plane with custom texture
    // get camera ray origin and direction from voxel coordinates
    // hypercamera_in_world_5x5 is passed as a uniform buffer
    if (true) {
    let ray_origin_in_world = hypercameraPoseBuffer.tr;
    let ray_direction_in_hcam = vec4<f32>(1.0, u, v, l);
    let ray_direction_in_world = vec4<f32>(
        hypercameraPoseBuffer.r0.x * 1.0 + hypercameraPoseBuffer.r1.x * u + hypercameraPoseBuffer.r2.x * v + hypercameraPoseBuffer.r3.x * l,
        hypercameraPoseBuffer.r0.y * 1.0 + hypercameraPoseBuffer.r1.y * u + hypercameraPoseBuffer.r2.y * v + hypercameraPoseBuffer.r3.y * l,
        hypercameraPoseBuffer.r0.z * 1.0 + hypercameraPoseBuffer.r1.z * u + hypercameraPoseBuffer.r2.z * v + hypercameraPoseBuffer.r3.z * l,
        hypercameraPoseBuffer.r0.w * 1.0 + hypercameraPoseBuffer.r1.w * u + hypercameraPoseBuffer.r2.w * v + hypercameraPoseBuffer.r3.w * l
    );
    // solve for intersection with plane z = 0 (ground plane)
    let denominator = ray_direction_in_world.z;
    if (abs(denominator) > 1e-6) {
        let t = -ray_origin_in_world.z / denominator;
        if (t > 0.0) {
            let intersect_point = vec4<f32>(
                ray_origin_in_world.x + t * ray_direction_in_world.x,
                ray_origin_in_world.y + t * ray_direction_in_world.y,
                0.0,
                ray_origin_in_world.w + t * ray_direction_in_world.w
            );
            // checkerboard pattern based on intersect_point.x and intersect_point.y and intersect_point.w
            let checker_size = 1.0;
            let check_x = floor(intersect_point.x / checker_size);
            let check_y = floor(intersect_point.y / checker_size);
            let check_w = floor(intersect_point.w / checker_size);
            let is_white = (i32(check_x) + i32(check_y) + i32(check_w)) % 2 == 0;
            if (is_white) {
                best_voxel.r = 1.0;
                best_voxel.g = 1.0;
                best_voxel.b = 1.0;
                // white spotlight for (x^2 + y^2 + w^2) < 5^2, outside of that colors for each axis
                let x = intersect_point.x;
                let y = intersect_point.y;
                let w = intersect_point.w;
                let R = 10.0; // spotlight radius
                if (x*x + y*y + w*w) > R*R {
                    // decay away from white
                    let dx = abs(x) - R;
                    let dy = abs(y) - R;
                    let dw = abs(w) - R;
                    let dnorm = sqrt(dx*dx + dy*dy + dw*dw);
                    best_voxel.r = max(0.3, 0.6 * dx / dnorm);
                    best_voxel.g = max(0.3, 0.6 * dy / dnorm);
                    best_voxel.b = max(0.3, 0.6 * dw / dnorm);
                }
            } else {
                best_voxel.r = 0.0;
                best_voxel.g = 0.0;
                best_voxel.b = 0.0;
            }
            best_voxel.a = 0.2;
            best_voxel.s = t; // use t as "s" value for depth comparison
        }
    }
    }
    `;
    function flat_heightmap(x, y, w) {
        return 0;
    }
    if (!scene.floor_heightmap) { 
        scene.floor_heightmap = flat_heightmap;
    }
    // island floor
    if (scene.floorPreset === 'island') {
       floorShader = createIslandFloorShader();
    }
    // Custom floor shader (scene can provide its own WGSL floor shader code)
    if (scene.floorShader) {
        floorShader = scene.floorShader;
    }

    // Scene pre-processing and setting up static memory
    // Stage 0: Create buffers and gather all vertices and tetras from visible hyperobjects
    // --------------------------------------
    const s0_start = performance.now();
    // let vertices_in_world = hypercube.vertices_in_world;
    // let tetras = hypercube.tetras.map(tetra => ({ indices: tetra, color: hypercube.color }));
    let vertices_in_world = [];
    let tetras = [];
    for (let obj of scene.visibleHyperobjects) {
        const base_index = vertices_in_world.length;
        // add vertices
        for (let v of obj.vertices_in_world) {
            vertices_in_world.push(v);
        }
        // add tetras with adjusted indices
        for (let tet of obj.tetras) {
            tetras.push({ indices: tet.map(vi => vi + base_index), color: obj.color });
        }
    }
    const s0_end = performance.now();
    console.log(`Stage 0: Gathered vertices and tetras from visible hyperobjects in ${(s0_end - s0_start).toFixed(2)} ms`);
    // Create texture buffers
    let object_texture_header_data = new Uint32Array(scene.visibleHyperobjects.length * 4); // offset, USIZE, VSIZE, WSIZE
    let vertices_texcoords_data = new Float32Array(vertices_in_world.length * 3); // u,v,l per vertex
    // Create global texture data buffer and figure out offsets (dedup shared textures)
    let texture_data_offset = 0;
    let textureOffsetMap = new Map(); // texture array reference -> offset in global buffer
    let bytes_saved = 0;
    let n_textures_saved = 0;
    for (let obj_index = 0; obj_index < scene.visibleHyperobjects.length; obj_index++) {
        let obj = scene.visibleHyperobjects[obj_index];
        let USIZE = obj.texture_info.USIZE;
        let VSIZE = obj.texture_info.VSIZE;
        let WSIZE = obj.texture_info.WSIZE;
        let data_size = USIZE * VSIZE * WSIZE;
        // reuse offset if this texture was already added
        let offset;
        if (textureOffsetMap.has(obj.texture)) {
            offset = textureOffsetMap.get(obj.texture);
            bytes_saved += data_size;
            n_textures_saved++;
        } else {
            offset = texture_data_offset;
            textureOffsetMap.set(obj.texture, offset);
            texture_data_offset += data_size;
        }
        object_texture_header_data[obj_index * 4 + 0] = offset;
        object_texture_header_data[obj_index * 4 + 1] = USIZE;
        object_texture_header_data[obj_index * 4 + 2] = VSIZE;
        object_texture_header_data[obj_index * 4 + 3] = WSIZE;
    }
    let total_texture_data_size = texture_data_offset;
    // Allow scenes to reserve extra texture buffer space for live texture updates
    let texture_buffer_size = Math.max(total_texture_data_size, scene.maxTextureBufferSize || 0);
    // fill global texture data with unique textures only
    let global_texture_data = new Uint32Array(texture_buffer_size);
    for (let [texture, offset] of textureOffsetMap) {
        // texture layout is index = (u + (v * USIZE) + (w * USIZE * VSIZE));
        // Make sure the same indexing is used at creation and in the shaders
        // each value is a rgba_u32
        global_texture_data.set(texture, offset);
    }
    console.log(`Loaded ${textureOffsetMap.size} unique textures in ${total_texture_data_size} bytes`);
    console.log(`Saved ${bytes_saved} bytes by deduping ${n_textures_saved} textures`);
    // Create buffers with 1. all vertices in object frame, 2. all object poses 3. the object index of each vertex
    let all_vertices_in_object_data = new Float32Array(vertices_in_world.length * 4);
    let all_object_poses_data = new Float32Array(scene.visibleHyperobjects.length * 5 * 5);
    let vertex_object_indices_data = new Uint32Array(vertices_in_world.length);
    let vertex_counter = 0;
    for (let obj_index = 0; obj_index < scene.visibleHyperobjects.length; obj_index++) {
        let obj = scene.visibleHyperobjects[obj_index];
        // object poses
        let pose = obj.pose.matrix;
        for (let i = 0; i < 5; i++) {
            for (let j = 0; j < 5; j++) {
                all_object_poses_data[obj_index * 5 * 5 + i * 5 + j] = pose[i][j];
            }
        }
        // vertices
        obj.object_vertex_start_index = vertex_counter;
        for (let i_v = 0; i_v < obj.vertices_in_object.length; i_v++) {
            let v = obj.vertices_in_object[i_v];
            let v_tex = obj.vertices_in_texmap[i_v];
            all_vertices_in_object_data[vertex_counter * 4 + 0] = v.x;
            all_vertices_in_object_data[vertex_counter * 4 + 1] = v.y;
            all_vertices_in_object_data[vertex_counter * 4 + 2] = v.z;
            all_vertices_in_object_data[vertex_counter * 4 + 3] = v.w;
            vertex_object_indices_data[vertex_counter] = obj_index;
            // set texcoords for each vertex of this object
            // just map the object coordinates to the texture coordinates directly for now
            vertices_texcoords_data[vertex_counter * 3 + 0] = v_tex.x;
            vertices_texcoords_data[vertex_counter * 3 + 1] = v_tex.y;
            vertices_texcoords_data[vertex_counter * 3 + 2] = v_tex.z;
            // increment counter
            vertex_counter++;
        }
    }
    // Initit Hypercamera Pose buffer
    let hypercamera_inv_pose_data = new Float32Array(5 * 5);
    let hypercamera_pose_data = new Float32Array(5 * 4);
    // Prepare tetra data
    const tetraData = new Uint32Array(tetras.length * 5); // 4 vert idx per tet + 1 color
    for (let i = 0; i < tetras.length; i++) {
        const tetra = tetras[i];
        tetraData[i * 5 + 0] = tetra.indices[0];
        tetraData[i * 5 + 1] = tetra.indices[1];
        tetraData[i * 5 + 2] = tetra.indices[2];
        tetraData[i * 5 + 3] = tetra.indices[3];
        tetraData[i * 5 + 4] = 0;
    }
    // initialize vertex storage
    const vertices1uvlstexData = new Float32Array(vertices_in_world.length * 8);
    for (let i = 0; i < vertices_in_world.length; i++) {
        // 1uvls gets recomputed on GPU at every frame
        vertices1uvlstexData[i * 8 + 0] = 0;
        vertices1uvlstexData[i * 8 + 1] = 0;
        vertices1uvlstexData[i * 8 + 2] = 0;
        vertices1uvlstexData[i * 8 + 3] = 0;
        // texcoords are static and assigned only in the setup
        vertices1uvlstexData[i * 8 + 4] = vertices_texcoords_data[i * 3 + 0];
        vertices1uvlstexData[i * 8 + 5] = vertices_texcoords_data[i * 3 + 1];
        vertices1uvlstexData[i * 8 + 6] = vertices_texcoords_data[i * 3 + 2];
        vertices1uvlstexData[i * 8 + 7] = vertex_object_indices_data[i]; // object index TODO: gpu expects a u32, but this is a f32
    }
    // initialize acceleration structure
    let TILE_SZ = 2;
    let MAX_ACCEL_STRUCTURE_DEPTH = 100; // lower reqs less mem but may cause rendering errors
    if (VOX > 128) {
        TILE_SZ = 8;
        MAX_ACCEL_STRUCTURE_DEPTH = 50;
    }
    const TILE_RES = VOX / TILE_SZ;
    const MAX_ACCEL_STRUCTURE_SIZE = TILE_RES*TILE_RES*TILE_RES*MAX_ACCEL_STRUCTURE_DEPTH;
    const MAX_LARGE_TETRAS = tetras.length; // large tetras get stored in a separate accel structure
    const LARGE_TETRA_THRESHOLD = VOX * VOX * VOX / 64; // number of voxels required to be a large tetra. Set to VOX*VOX*VOX to disable.
    const accelStructureOffsetsData = new Uint32Array(TILE_RES*TILE_RES*TILE_RES);
    const accelStructureCountsData = new Uint32Array(TILE_RES*TILE_RES*TILE_RES);
    const accelStructureTetraIndicesData = new Uint32Array(MAX_ACCEL_STRUCTURE_SIZE);
    // Initialize voxel grid (4x4x4)
    const voxelData = new Float32Array(VOX*VOX*VOX*8); // 64x64x64 grid for simplicity


    // ---------------------------------
    // Setup WebGPU Shaders, Buffers, Bindings and Pipelines
    // ---------------------------------
    // WebGPU init 
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    
    context.configure({
        device,
        format,
        alphaMode: 'opaque',
    });

    const stage1ShaderCode = `
  // Stage 1: Transform vertices from object space to world space, then to camera space, then to SUVL space
struct Vector4D {
    x: f32,
    y: f32,
    z: f32,
    w: f32,
}

struct Vertex1uvlstex {
    u: f32,
    v: f32,
    l: f32,
    s: f32,
    tex_u: f32,
    tex_v: f32,
    tex_w: f32,
    object_i: u32,
}

@group(0) @binding(0) var<storage, read> vertices_in_object: array<Vector4D>;
@group(0) @binding(1) var<storage, read> object_poses_5by5: array<f32>;
@group(0) @binding(2) var<storage, read> vertex_object_indices: array<u32>;
@group(0) @binding(3) var<storage, read> hypercamera_inv_pose_5by5: array<f32>;
@group(0) @binding(4) var<storage, read_write> vertices1uvlstexBuffer: array<Vertex1uvlstex>;

@group(1) @binding(0) var<uniform> vertex_counts: vec4<u32>; // num_vertices, unused, unused, unused

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let vertex_index = global_id.x;
    let num_vertices = vertex_counts.x; // TODO: pass as uniform
    if (vertex_index >= num_vertices) {
        return;
    }

    // Load existing vertex info
    let prev = vertices1uvlstexBuffer[vertex_index];

    // Load vertex in object space
    let v_obj = vertices_in_object[vertex_index];
    // Load object pose
    let obj_index = vertex_object_indices[vertex_index]; // TODO use data in vertices1uvlstexBuffer instead
    var obj_pose: array<array<f32,5>,5>;
    for (var i: u32 = 0u; i < 5u; i++) {
        for (var j: u32 = 0u; j < 5u; j++) {
            obj_pose[i][j] = object_poses_5by5[obj_index * 25u + i * 5u + j];
        }
    }
    // Transform to world space
    var v_world: Vector4D;
    v_world.x = obj_pose[0][0] * v_obj.x + obj_pose[0][1] * v_obj.y + obj_pose[0][2] * v_obj.z + obj_pose[0][3] * v_obj.w + obj_pose[0][4];
    v_world.y = obj_pose[1][0] * v_obj.x + obj_pose[1][1] * v_obj.y + obj_pose[1][2] * v_obj.z + obj_pose[1][3] * v_obj.w + obj_pose[1][4];
    v_world.z = obj_pose[2][0] * v_obj.x + obj_pose[2][1] * v_obj.y + obj_pose[2][2] * v_obj.z + obj_pose[2][3] * v_obj.w + obj_pose[2][4];
    v_world.w = obj_pose[3][0] * v_obj.x + obj_pose[3][1] * v_obj.y + obj_pose[3][2] * v_obj.z + obj_pose[3][3] * v_obj.w + obj_pose[3][4];
    // Load hypercamera pose
    var hc_pose: array<array<f32,5>,5>;
    for (var i: u32 = 0u; i < 5u; i++) {
        for (var j: u32 = 0u; j < 5u; j++) {
            hc_pose[i][j] = hypercamera_inv_pose_5by5[i * 5u + j];
        }
    }
    // Transform to camera space
    var v_cam: Vector4D;
    v_cam.x = hc_pose[0][0] * v_world.x + hc_pose[0][1] * v_world.y + hc_pose[0][2] * v_world.z + hc_pose[0][3] * v_world.w + hc_pose[0][4];
    v_cam.y = hc_pose[1][0] * v_world.x + hc_pose[1][1] * v_world.y + hc_pose[1][2] * v_world.z + hc_pose[1][3] * v_world.w + hc_pose[1][4];
    v_cam.z = hc_pose[2][0] * v_world.x + hc_pose[2][1] * v_world.y + hc_pose[2][2] * v_world.z + hc_pose[2][3] * v_world.w + hc_pose[2][4];
    v_cam.w = hc_pose[3][0] * v_world.x + hc_pose[3][1] * v_world.y + hc_pose[3][2] * v_world.z + hc_pose[3][3] * v_world.w + hc_pose[3][4];
    // Transform to 1UVL space
    // var v_1uvls: Vector4D;
    // v_1uvls.x = v_cam.y / v_cam.x;
    // v_1uvls.y = v_cam.z / v_cam.x;
    // v_1uvls.z = v_cam.w / v_cam.x;
    // v_1uvls.w = v_cam.x;

    // keep the texcoords, only update the suvls
    var v_1uvlstex: Vertex1uvlstex;
    if (v_cam.x == 0.0) { // avoid division by zero
        v_1uvlstex.u = v_cam.y;
        v_1uvlstex.v = v_cam.z;
        v_1uvlstex.l = v_cam.w;
    } else {
        v_1uvlstex.u = v_cam.y / v_cam.x;
        v_1uvlstex.v = v_cam.z / v_cam.x;
        v_1uvlstex.l = v_cam.w / v_cam.x;
    }

    v_1uvlstex.s = v_cam.x;
    v_1uvlstex.tex_u = prev.tex_u;
    v_1uvlstex.tex_v = prev.tex_v;
    v_1uvlstex.tex_w = prev.tex_w;
    // v_1uvlstex.object_i = prev.object_i;
    v_1uvlstex.object_i = obj_index;
    
    // Cull vertices far below ground (e.g. creatures hidden at z=-10000)
    if (${CLIP_FAR_BELOW_GROUND_OBJECTS}) {
        if (v_world.z < -1000.0) {
            v_1uvlstex.s = -1000.0;
        }
    }

    // Store result
    vertices1uvlstexBuffer[vertex_index] = v_1uvlstex;
}
`;

    // Stage 2.a - Tetrahedron Clipping Shader
    const stage2aShaderCode = `
// Stage 2.a: Tetrahedron Clipping Against Sensor Plane (s=0)

struct TetraData {
    i0: u32,
    i1: u32,
    i2: u32,
    i3: u32,
    flags: u32, // unused
}

struct Vertex1uvlstex {
    u: f32,
    v: f32,
    l: f32,
    s: f32,
    tex_u: f32,
    tex_v: f32,
    tex_w: f32,
    object_i: u32,
}

@group(0) @binding(0) var<storage, read_write> tetrasBuffer: array<TetraData>;
@group(0) @binding(1) var<storage, read_write> vertices1uvlstexBuffer: array<Vertex1uvlstex>;
@group(0) @binding(2) var<storage, read_write> tetraCountsBuffer: array<atomic<u32>>;

@group(1) @binding(0) var<uniform> params: vec4<u32>;
// params.x = original_tetra_count
// params.y = original_vertex_count

fn clip_vertex(v_behind: Vertex1uvlstex, v_front: Vertex1uvlstex) -> Vertex1uvlstex {
    // put near plane at s=0.1
    let denom = v_front.s - v_behind.s;
    const S_near = 0.1;
    let t = (S_near - v_behind.s) / denom;
    var result: Vertex1uvlstex;
    // undo proj scale - convert back to SUVL to interpolate
    // U = u * s (if s == 0, then U = u)
    var U_behind = v_behind.u * v_behind.s;
    var V_behind = v_behind.v * v_behind.s;
    var L_behind = v_behind.l * v_behind.s;
    if (v_behind.s == 0.0) {
        U_behind = v_behind.u;
        V_behind = v_behind.v;
        L_behind = v_behind.l;
    }
    let U_front = v_front.u * v_front.s;
    let V_front = v_front.v * v_front.s;
    let L_front = v_front.l * v_front.s;
    let U = U_behind + t * (U_front - U_behind);
    let V = V_behind + t * (V_front - V_behind);
    let L = L_behind + t * (L_front - L_behind);
    result.u = U / S_near;
    result.v = V / S_near;
    result.l = L / S_near;
    result.s = S_near;
    result.tex_u = v_behind.tex_u + t * (v_front.tex_u - v_behind.tex_u);
    result.tex_v = v_behind.tex_v + t * (v_front.tex_v - v_behind.tex_v);
    result.tex_w = v_behind.tex_w + t * (v_front.tex_w - v_behind.tex_w);
    result.object_i = v_behind.object_i;
    return result;
}

fn add_vertex(v: Vertex1uvlstex) -> u32 {
    let idx = atomicAdd(&tetraCountsBuffer[3], 1u);
    let n_orig = atomicLoad(&tetraCountsBuffer[1]);
    vertices1uvlstexBuffer[n_orig + idx] = v;
    return n_orig + idx;
}

fn add_tetra(i0: u32, i1: u32, i2: u32, i3: u32, flags: u32) {
    let idx = atomicAdd(&tetraCountsBuffer[2], 1u);
    let n_orig = atomicLoad(&tetraCountsBuffer[0]);
    tetrasBuffer[n_orig + idx].i0 = i0;
    tetrasBuffer[n_orig + idx].i1 = i1;
    tetrasBuffer[n_orig + idx].i2 = i2;
    tetrasBuffer[n_orig + idx].i3 = i3;
    tetrasBuffer[n_orig + idx].flags = flags;
}

fn clip_tetrahedron(
    mask: u32,
    tetra: TetraData,
    v0: Vertex1uvlstex,
    v1: Vertex1uvlstex,
    v2: Vertex1uvlstex,
    v3: Vertex1uvlstex
) {
    let flags = tetra.flags;
    // let flags = 1u; // DEBUG
    let i0 = tetra.i0;
    let i1 = tetra.i1;
    let i2 = tetra.i2;
    let i3 = tetra.i3;

    // Case 1: 1 vertex behind (results in 3 tetras)
    if (mask == 1u) { // v0 behind. Even Permutation: (0, 1, 2, 3)
        let v01 = add_vertex(clip_vertex(v0, v1));
        let v02 = add_vertex(clip_vertex(v0, v2));
        let v03 = add_vertex(clip_vertex(v0, v3));
        add_tetra(v01, i1, i2, i3, flags);
        add_tetra(v01, v02, i2, i3, flags);
        add_tetra(v01, v02, v03, i3, flags);
    }
    else if (mask == 2u) { // v1 behind. Even Permutation: (1, 0, 3, 2)
        let v10 = add_vertex(clip_vertex(v1, v0));
        let v13 = add_vertex(clip_vertex(v1, v3));
        let v12 = add_vertex(clip_vertex(v1, v2));
        add_tetra(v10, i0, i3, i2, flags);
        add_tetra(v10, v13, i3, i2, flags);
        add_tetra(v10, v13, v12, i2, flags);
    }
    else if (mask == 4u) { // v2 behind. Even Permutation: (2, 0, 1, 3)
        let v20 = add_vertex(clip_vertex(v2, v0));
        let v21 = add_vertex(clip_vertex(v2, v1));
        let v23 = add_vertex(clip_vertex(v2, v3));
        add_tetra(v20, i0, i1, i3, flags);
        add_tetra(v20, v21, i1, i3, flags);
        add_tetra(v20, v21, v23, i3, flags);
    }
    else if (mask == 8u) { // v3 behind. Even Permutation: (3, 0, 2, 1)
        let v30 = add_vertex(clip_vertex(v3, v0));
        let v32 = add_vertex(clip_vertex(v3, v2));
        let v31 = add_vertex(clip_vertex(v3, v1));
        add_tetra(v30, i0, i2, i1, flags);
        add_tetra(v30, v32, i2, i1, flags);
        add_tetra(v30, v32, v31, i1, flags);
    }
    // Case 2: 2 vertices behind (results in 3 tetras)
    else if (mask == 3u) { // v0, v1 behind. Perm: (0, 1, 2, 3)
        let v02 = add_vertex(clip_vertex(v0, v2));
        let v12 = add_vertex(clip_vertex(v1, v2));
        let v03 = add_vertex(clip_vertex(v0, v3));
        let v13 = add_vertex(clip_vertex(v1, v3));
        add_tetra(v02, v12, v03, i2, flags);
        add_tetra(v12, v13, v03, i3, flags);
        add_tetra(v12, v03, i2, i3, flags);
    }
    else if (mask == 5u) { // v0, v2 behind. Perm: (0, 2, 3, 1)
        let v03 = add_vertex(clip_vertex(v0, v3));
        let v23 = add_vertex(clip_vertex(v2, v3));
        let v01 = add_vertex(clip_vertex(v0, v1));
        let v21 = add_vertex(clip_vertex(v2, v1));
        add_tetra(v03, v23, v01, i3, flags);
        add_tetra(v23, v21, v01, i1, flags);
        add_tetra(v23, v01, i3, i1, flags);
    }
    else if (mask == 6u) { // v1, v2 behind. Perm: (1, 2, 0, 3)
        let v10 = add_vertex(clip_vertex(v1, v0));
        let v20 = add_vertex(clip_vertex(v2, v0));
        let v13 = add_vertex(clip_vertex(v1, v3));
        let v23 = add_vertex(clip_vertex(v2, v3));
        add_tetra(v10, v20, v13, i0, flags);
        add_tetra(v20, v23, v13, i3, flags);
        add_tetra(v20, v13, i0, i3, flags);
    }
    else if (mask == 9u) { // v0, v3 behind. Perm: (0, 3, 1, 2)
        let v01 = add_vertex(clip_vertex(v0, v1));
        let v31 = add_vertex(clip_vertex(v3, v1));
        let v02 = add_vertex(clip_vertex(v0, v2));
        let v32 = add_vertex(clip_vertex(v3, v2));
        add_tetra(v01, v31, v02, i1, flags);
        add_tetra(v31, v32, v02, i2, flags);
        add_tetra(v31, v02, i1, i2, flags);
    }
    else if (mask == 10u) { // v1, v3 behind. Perm: (1, 3, 2, 0)
        let v12 = add_vertex(clip_vertex(v1, v2));
        let v32 = add_vertex(clip_vertex(v3, v2));
        let v10 = add_vertex(clip_vertex(v1, v0));
        let v30 = add_vertex(clip_vertex(v3, v0));
        add_tetra(v12, v32, v10, i2, flags);
        add_tetra(v32, v30, v10, i0, flags);
        add_tetra(v32, v10, i2, i0, flags);
    }
    else if (mask == 12u) { // v2, v3 behind. Perm: (2, 3, 0, 1)
        let v20 = add_vertex(clip_vertex(v2, v0));
        let v30 = add_vertex(clip_vertex(v3, v0));
        let v21 = add_vertex(clip_vertex(v2, v1));
        let v31 = add_vertex(clip_vertex(v3, v1));
        add_tetra(v20, v30, v21, i0, flags);
        add_tetra(v30, v31, v21, i1, flags);
        add_tetra(v30, v21, i0, i1, flags);
    }
    // Case 3: 3 vertices behind (results in 1 tetra)
    else if (mask == 7u) { // Only v3 in front. Perm: (0, 1, 2, 3)
        let v03 = add_vertex(clip_vertex(v0, v3));
        let v13 = add_vertex(clip_vertex(v1, v3));
        let v23 = add_vertex(clip_vertex(v2, v3));
        add_tetra(v03, v13, v23, i3, flags);
    }
    else if (mask == 11u) { // Only v2 in front. Perm: (0, 3, 1, 2)
        let v02 = add_vertex(clip_vertex(v0, v2));
        let v32 = add_vertex(clip_vertex(v3, v2));
        let v12 = add_vertex(clip_vertex(v1, v2));
        add_tetra(v02, v32, v12, i2, flags);
    }
    else if (mask == 13u) { // Only v1 in front. Perm: (0, 2, 3, 1)
        let v01 = add_vertex(clip_vertex(v0, v1));
        let v21 = add_vertex(clip_vertex(v2, v1));
        let v31 = add_vertex(clip_vertex(v3, v1));
        add_tetra(v01, v21, v31, i1, flags);
    }
    else if (mask == 14u) { // Only v0 in front. Perm: (3, 2, 1, 0)
        let v30 = add_vertex(clip_vertex(v3, v0));
        let v20 = add_vertex(clip_vertex(v2, v0));
        let v10 = add_vertex(clip_vertex(v1, v0));
        add_tetra(v30, v20, v10, i0, flags);
    }
}

@compute @workgroup_size(64)
fn clip_tetras(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let S_near = 0.1;
    let tetra_index = global_id.x;
    let orig_n_tetras = atomicLoad(&tetraCountsBuffer[0]);
    if (tetra_index >= orig_n_tetras) { return; }

    let tetra = tetrasBuffer[tetra_index];
    let v0 = vertices1uvlstexBuffer[tetra.i0];
    let v1 = vertices1uvlstexBuffer[tetra.i1];
    let v2 = vertices1uvlstexBuffer[tetra.i2];
    let v3 = vertices1uvlstexBuffer[tetra.i3];

    // Classify vertices
    var behind_mask: u32 = 0u;
    if (v0.s <= S_near) { behind_mask |= 1u; }
    if (v1.s <= S_near) { behind_mask |= 2u; }
    if (v2.s <= S_near) { behind_mask |= 4u; }
    if (v3.s <= S_near) { behind_mask |= 8u; }

    let num_behind = countOneBits(behind_mask);

    if (num_behind == 0u) {
        // Pass through unchanged
        return;
    }
    else if (num_behind == 4u) {
        // Completely behind - discard
        return;
    }
    else {
        // Clip - handle 14 cases
        clip_tetrahedron(behind_mask, tetra, v0, v1, v2, v3);
        return;
    }
}
`;

    // Stage 2.1 - Update counts in Screen Space Tile Acceleration Structure
    const stage2p1ShaderCode = `
struct TetraData {
    i0: u32,
    i1: u32,
    i2: u32,
    i3: u32,
    flags: u32,
}

struct Vector4D {
    x: f32,
    y: f32,
    z: f32,
    w: f32,
}

struct Vertex1uvlstex {
    u: f32,
    v: f32,
    l: f32,
    s: f32,
    tex_u: f32,
    tex_v: f32,
    tex_w: f32,
    object_i: u32,
}

struct CellCountAndOffset {
    count: u32,
    offset: u32,
}

@group(0) @binding(0) var<storage, read> tetras: array<TetraData>;
@group(0) @binding(1) var<storage, read> vertices1uvlstexBuffer: array<Vertex1uvlstex>;
@group(0) @binding(2) var<storage, read_write> cellCountsAndOffsetsBuffer: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> largeTetraBuffer: array<atomic<u32>>; // [count, idx0, idx1, ...]

@group(1) @binding(0) var<uniform> params: vec4<u32>; // RES, TILE_RES, TILE_SZ, unused
@group(1) @binding(1) var<uniform> tetra_counts: vec4<u32>; // num_valid_tetras, num_vertices, num_additional_tetras, num_additional_vertices

const LARGE_TETRA_THRESHOLD: u32 = ${LARGE_TETRA_THRESHOLD}u;
const MAX_LARGE_TETRAS: u32 = ${MAX_LARGE_TETRAS}u;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let tetra_index = global_id.x;
    let num_tetras = tetra_counts.x + tetra_counts.z;
    let TILE_RES = params.y;

    if (tetra_index >= num_tetras) {
        return;
    }

    let tetra = tetras[tetra_index];
    let v0_1uvls = vertices1uvlstexBuffer[tetra.i0];
    let v1_1uvls = vertices1uvlstexBuffer[tetra.i1];
    let v2_1uvls = vertices1uvlstexBuffer[tetra.i2];
    let v3_1uvls = vertices1uvlstexBuffer[tetra.i3];

    // For safety, ignore tetra if any vertex has non-positive S (even after stage 2a culling)
    if (v0_1uvls.s <= 0.0 || v1_1uvls.s <= 0.0 || v2_1uvls.s <= 0.0 || v3_1uvls.s <= 0.0) {
        return;
    }

    let u_min = min(min(v0_1uvls.u, v1_1uvls.u), min(v2_1uvls.u, v3_1uvls.u));
    let u_max = max(max(v0_1uvls.u, v1_1uvls.u), max(v2_1uvls.u, v3_1uvls.u));
    let v_min = min(min(v0_1uvls.v, v1_1uvls.v), min(v2_1uvls.v, v3_1uvls.v));
    let v_max = max(max(v0_1uvls.v, v1_1uvls.v), max(v2_1uvls.v, v3_1uvls.v));
    let l_min = min(min(v0_1uvls.l, v1_1uvls.l), min(v2_1uvls.l, v3_1uvls.l));
    let l_max = max(max(v0_1uvls.l, v1_1uvls.l), max(v2_1uvls.l, v3_1uvls.l));

    let S_U_START = -1.0;
    let S_U_RANGE = 2.0;
    let S_V_START = -1.0;
    let S_V_RANGE = 2.0;
    let S_L_START = -1.0;
    let S_L_RANGE = 2.0;

    let TU_min = u32(clamp(floor((u_min - S_U_START) / S_U_RANGE * f32(TILE_RES)), 0.0, f32(TILE_RES - 1)));
    let TU_max = u32(clamp(ceil((u_max - S_U_START) / S_U_RANGE * f32(TILE_RES)), 0.0, f32(TILE_RES - 1)));
    let TV_min = u32(clamp(floor((v_min - S_V_START) / S_V_RANGE * f32(TILE_RES)), 0.0, f32(TILE_RES - 1)));
    let TV_max = u32(clamp(ceil((v_max - S_V_START) / S_V_RANGE * f32(TILE_RES)), 0.0, f32(TILE_RES - 1)));
    let TL_min = u32(clamp(floor((l_min - S_L_START) / S_L_RANGE * f32(TILE_RES)), 0.0, f32(TILE_RES - 1)));
    let TL_max = u32(clamp(ceil((l_max - S_L_START) / S_L_RANGE * f32(TILE_RES)), 0.0, f32(TILE_RES - 1)));

    // Divert large tetras to a separate global list
    let span = (TU_max - TU_min + 1u) * (TV_max - TV_min + 1u) * (TL_max - TL_min + 1u);
    if (span > LARGE_TETRA_THRESHOLD) {
        let idx = atomicAdd(&largeTetraBuffer[0], 1u);
        if (idx < MAX_LARGE_TETRAS) {
            atomicStore(&largeTetraBuffer[idx + 1u], tetra_index);
        }
        return;
    }

    for (var TU = TU_min; TU <= TU_max; TU++) {
        for (var TV = TV_min; TV <= TV_max; TV++) {
            for (var TL = TL_min; TL <= TL_max; TL++) {
                let CELL_ID = TU + TV * TILE_RES + TL * TILE_RES * TILE_RES;
                atomicAdd(&cellCountsAndOffsetsBuffer[CELL_ID * 2], 1u); // * 2 to access the count element
            }
        }
    }
}
`;

    // Stage 2.2
    // Stage 2.2: Prefix Sum to calculate offsets from counts
    // This uses a work-efficient parallel scan algorithm
    const stage2p2ShaderCode = `

struct CellCountAndOffset {
    count: u32,
    offset: u32,
}

@group(0) @binding(0) var<storage, read_write> cellCountsAndOffsetsBuffer: array<CellCountAndOffset>;
@group(0) @binding(1) var<storage, read_write> temp: array<u32>;

@group(1) @binding(0) var<uniform> params: vec4<u32>; 

@compute @workgroup_size(256)
fn upsweep(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let tid = global_id.x;
    let level = params.y;
    let num_elements = params.x;
    
    let stride = 1u << (level + 1u);
    let idx = tid * stride;
    
    if (idx + stride - 1u < num_elements) {
        let left = idx + (1u << level) - 1u;
        let right = idx + stride - 1u;
        temp[right] = temp[left] + temp[right];
    }
}

@compute @workgroup_size(256)
fn downsweep(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let tid = global_id.x;
    let level = params.y;
    let num_elements = params.x;
    
    let stride = 1u << (level + 1u);
    let idx = tid * stride;
    
    if (idx + stride - 1u < num_elements) {
        let left = idx + (1u << level) - 1u;
        let right = idx + stride - 1u;
        
        let t = temp[left];
        temp[left] = temp[right];
        temp[right] = t + temp[right];
    }
}

@compute @workgroup_size(256)
fn init(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let tid = global_id.x;
    let padded_size = params.x;
    let real_size = params.y;
    if (tid < padded_size) {
        if (tid < real_size) {
            temp[tid] = cellCountsAndOffsetsBuffer[tid].count;
        } else {
            temp[tid] = 0u; // zero-fill padding for power-of-2 Blelloch scan
        }
    }
}

@compute @workgroup_size(256)
fn finalize(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let tid = global_id.x;
    let num_elements = params.x;
    if (tid < num_elements) {
        cellCountsAndOffsetsBuffer[tid].offset = temp[tid];
    }
}

// NEW: Kernel to clear the root element safely
@compute @workgroup_size(1)
fn clear_root() {
    let num_elements = params.x;
    if (num_elements > 0u) {
        temp[num_elements - 1u] = 0u;
    }
}
`;

    // Shader to clear buffers (replaces queue.writeBuffer)
    const clearBufferShaderCode = `
@group(0) @binding(0) var<storage, read_write> buffer: array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let idx = global_id.x;
    if (idx < arrayLength(&buffer)) {
        buffer[idx] = 0u;
    }
}
`;

    // Stage 2.3 - Binning (Writes tetra indices into the grid)
    const stage2p3ShaderCode = `
struct TetraData { i0: u32, i1: u32, i2: u32, i3: u32, flags: u32 }
struct Vector4D { x: f32, y: f32, z: f32, w: f32 }

struct Vertex1uvlstex {
    u: f32,
    v: f32,
    l: f32,
    s: f32,
    tex_u: f32,
    tex_v: f32,
    tex_w: f32,
    object_i: u32,
}

struct CellCountAndOffset {
    count: u32,
    offset: u32,
}

@group(0) @binding(0) var<storage, read> tetras: array<TetraData>;
@group(0) @binding(1) var<storage, read> vertices1uvlstexBuffer: array<Vertex1uvlstex>;
@group(0) @binding(2) var<storage, read> cellCountsAndOffsetsBuffer: array<CellCountAndOffset>;
@group(0) @binding(3) var<storage, read_write> cell_write_counters: array<atomic<u32>>; // Temporary atomic counter
@group(0) @binding(4) var<storage, read_write> cell_tetra_indices: array<u32>; // Output

@group(1) @binding(0) var<uniform> params: vec4<u32>;
@group(1) @binding(1) var<uniform> tetra_counts: vec4<u32>;

const LARGE_TETRA_THRESHOLD: u32 = ${LARGE_TETRA_THRESHOLD}u;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let tetra_index = global_id.x;
    let num_tetras = tetra_counts.x + tetra_counts.z;
    let TILE_RES = params.y;

    if (tetra_index >= num_tetras) { return; }

    let tetra = tetras[tetra_index];
    let v0 = vertices1uvlstexBuffer[tetra.i0];
    let v1 = vertices1uvlstexBuffer[tetra.i1];
    let v2 = vertices1uvlstexBuffer[tetra.i2];
    let v3 = vertices1uvlstexBuffer[tetra.i3];

    // For safety, ignore tetra if any vertex has non-positive S (even after stage 2a culling)
    if (v0.s <= 0.0 || v1.s <= 0.0 || v2.s <= 0.0 || v3.s <= 0.0) {
        return;
    }

    // Calculate AABB (Same logic as Stage 2.1)
    let u_min = min(min(v0.u, v1.u), min(v2.u, v3.u));
    let u_max = max(max(v0.u, v1.u), max(v2.u, v3.u));
    let v_min = min(min(v0.v, v1.v), min(v2.v, v3.v));
    let v_max = max(max(v0.v, v1.v), max(v2.v, v3.v));
    let l_min = min(min(v0.l, v1.l), min(v2.l, v3.l));
    let l_max = max(max(v0.l, v1.l), max(v2.l, v3.l));

    let S_U_START = -1.0; let S_U_RANGE = 2.0;
    let S_V_START = -1.0; let S_V_RANGE = 2.0;
    let S_L_START = -1.0; let S_L_RANGE = 2.0;

    let TU_min = u32(clamp(floor((u_min - S_U_START) / S_U_RANGE * f32(TILE_RES)), 0.0, f32(TILE_RES - 1)));
    let TU_max = u32(clamp(ceil((u_max - S_U_START) / S_U_RANGE * f32(TILE_RES)), 0.0, f32(TILE_RES - 1)));
    let TV_min = u32(clamp(floor((v_min - S_V_START) / S_V_RANGE * f32(TILE_RES)), 0.0, f32(TILE_RES - 1)));
    let TV_max = u32(clamp(ceil((v_max - S_V_START) / S_V_RANGE * f32(TILE_RES)), 0.0, f32(TILE_RES - 1)));
    let TL_min = u32(clamp(floor((l_min - S_L_START) / S_L_RANGE * f32(TILE_RES)), 0.0, f32(TILE_RES - 1)));
    let TL_max = u32(clamp(ceil((l_max - S_L_START) / S_L_RANGE * f32(TILE_RES)), 0.0, f32(TILE_RES - 1)));

    // Skip large tetras - they were already added to the global list in Stage 2.1
    let span = (TU_max - TU_min + 1u) * (TV_max - TV_min + 1u) * (TL_max - TL_min + 1u);
    if (span > LARGE_TETRA_THRESHOLD) {
        return;
    }

    for (var TU = TU_min; TU <= TU_max; TU++) {
        for (var TV = TV_min; TV <= TV_max; TV++) {
            for (var TL = TL_min; TL <= TL_max; TL++) {
                let CELL_ID = TU + TV * TILE_RES + TL * TILE_RES * TILE_RES;
                
                // CRITICAL FIX: Determine where to write using Offsets + Atomic Increment
                let start_offset = cellCountsAndOffsetsBuffer[CELL_ID].offset;
                let local_idx = atomicAdd(&cell_write_counters[CELL_ID], 1u);
                
                // Safety check: if we exceed allocated size, skip writing
                if (start_offset + local_idx >= arrayLength(&cell_tetra_indices)) {
                    continue; // TODO: raise some kind of error
                }

                // Write the tetra index to the global buffer
                // Note: We should technically check bounds here, but MAX_SIZE is usually large enough
                cell_tetra_indices[start_offset + local_idx] = tetra_index;
            }
        }
    }
}
`;

    // Stage 3 - Per voxel: tetra tests and final compute shader to write to voxels
    const stage3ShaderCode = `
struct TetraData {
    i0: u32,
    i1: u32,
    i2: u32,
    i3: u32,
    flags: u32,
}

struct Vector4D {
    x: f32,
    y: f32,
    z: f32,
    w: f32,
}


struct Vertex1uvlstex {
    u: f32,
    v: f32,
    l: f32,
    s: f32,
    tex_u: f32,
    tex_v: f32,
    tex_w: f32,
    object_i: u32,
}

struct Voxel {
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    s: f32,
    _pad: u32,
    _pad2: u32,
    _pad3: u32,
}


struct CellCountAndOffset {
    count: u32,
    offset: u32,
}

struct UniformPose4D {
    r0: vec4<f32>,
    r1: vec4<f32>,
    r2: vec4<f32>,
    r3: vec4<f32>,
    tr: vec4<f32>,
}

@group(0) @binding(0) var<storage, read> tetras: array<TetraData>;
@group(0) @binding(1) var<storage, read> vertices1uvlstexBuffer: array<Vertex1uvlstex>;
@group(0) @binding(2) var<storage, read> cellCountsAndOffsetsBuffer: array<CellCountAndOffset>;
@group(0) @binding(3) var<storage, read> cell_tetra_indices: array<u32>;
@group(0) @binding(4) var<storage, read> object_texture_header: array<vec4<u32>>; // offset, USIZE, VSIZE, WSIZE
@group(0) @binding(5) var<storage, read> texture_data: array<u32>; // combine with above
@group(0) @binding(6) var<storage, read_write> voxels: array<Voxel>;
@group(0) @binding(7) var<storage, read> largeTetraBuffer: array<u32>; // [count, idx0, idx1, ...]

@group(1) @binding(0) var<uniform> params: vec4<u32>; // RES, TILE_RES, TILE_SZ, unused
@group(1) @binding(1) var<uniform> hypercameraPoseBuffer: UniformPose4D; // 5x5 matrix
@group(1) @binding(2) var<uniform> simtimeBuffer: vec4<f32>; // simulation time
@group(1) @binding(3) var<uniform> stage3DebugBuffer: vec4<f32>; // debug info

fn signedVolume(a: vec3<f32>, b: vec3<f32>, c: vec3<f32>, d: vec3<f32>) -> f32 {
    let ab = b - a;
    let ac = c - a;
    let ad = d - a;
    return dot(cross(ab, ac), ad) / 6.0;
}

fn barycentricCoordinates(P: vec3<f32>, A: vec3<f32>, B: vec3<f32>, C: vec3<f32>, D: vec3<f32>) -> vec4<f32> {
    let V = signedVolume(A, B, C, D);
    if (abs(V) < 1e-10) {
        return vec4<f32>(-1.0);
    }
    let alpha = signedVolume(P, B, C, D) / V;
    let beta = signedVolume(A, P, C, D) / V;
    let gamma = signedVolume(A, B, P, D) / V;
    let delta = signedVolume(A, B, C, P) / V;
    return vec4<f32>(alpha, beta, gamma, delta);
}

fn getTexture(tetra: TetraData, bary: vec4<f32>) -> vec3<f32> {
    // Get UVMap coordinates from barycentric interpolation
    let v0_uvlstexcoord = vertices1uvlstexBuffer[tetra.i0];
    let v1_uvlstexcoord = vertices1uvlstexBuffer[tetra.i1];
    let v2_uvlstexcoord = vertices1uvlstexBuffer[tetra.i2];
    let v3_uvlstexcoord = vertices1uvlstexBuffer[tetra.i3];
    // let object_index = vertex_object_indices[tetra.i0]; // assuming all vertices of tetra belong to same object
    let object_index = v0_uvlstexcoord.object_i; // assuming all vertices of tetra belong to same object
    let v0_texcoord = vec3<f32>(v0_uvlstexcoord.tex_u, v0_uvlstexcoord.tex_v, v0_uvlstexcoord.tex_w);
    let v1_texcoord = vec3<f32>(v1_uvlstexcoord.tex_u, v1_uvlstexcoord.tex_v, v1_uvlstexcoord.tex_w);
    let v2_texcoord = vec3<f32>(v2_uvlstexcoord.tex_u, v2_uvlstexcoord.tex_v, v2_uvlstexcoord.tex_w);
    let v3_texcoord = vec3<f32>(v3_uvlstexcoord.tex_u, v3_uvlstexcoord.tex_v, v3_uvlstexcoord.tex_w);
    // Straightforward barycentric interpolation is wrong here (because of perspective)
    // let texcoord = bary.x * v0_texcoord + bary.y * v1_texcoord + bary.z * v2_texcoord + bary.w * v3_texcoord;
    // Instead: Perspective-correct texture interpolation
    let v0_s = v0_uvlstexcoord.s;
    let v1_s = v1_uvlstexcoord.s;
    let v2_s = v2_uvlstexcoord.s;
    let v3_s = v3_uvlstexcoord.s;
    let inv_s = bary.x / v0_s + bary.y / v1_s + bary.z / v2_s + bary.w / v3_s;
    let texcoord = (bary.x * v0_texcoord / v0_s + bary.y * v1_texcoord / v1_s + bary.z * v2_texcoord / v2_s + bary.w * v3_texcoord / v3_s) / inv_s;
    // modulo texcoord to [0,1] (for repeating textures)
    let texcoord01 = fract(texcoord);
    // Load texture map for that object
    let tex_info = object_texture_header[object_index]; // offset, USIZE, VSIZE, WSIZE
    let tex_offset = tex_info.x; // texture for that object starts at this offset
    let tex_usize = tex_info.y; // number of texels in [0, 1] u direction (aka resolution)
    let tex_vsize = tex_info.z;
    let tex_wsize = tex_info.w;
    let texcoord_discrete = vec3<u32>(u32(texcoord01.x * f32(tex_usize)), u32(texcoord01.y * f32(tex_vsize)), u32(texcoord01.z * f32(tex_wsize)));
    // Clamp to valid range
    let texcoord_discrete_x = min(texcoord_discrete.x, tex_usize - 1u);
    let texcoord_discrete_y = min(texcoord_discrete.y, tex_vsize - 1u);
    let texcoord_discrete_z = min(texcoord_discrete.z, tex_wsize - 1u);
    // Fetch texel
    let texel_index = tex_offset + texcoord_discrete_x + texcoord_discrete_y * tex_usize + texcoord_discrete_z * tex_usize * tex_vsize;
    // We can't store as u8, so we store as one big u32 and unpack here
    let texel_u32 = texture_data[texel_index];
    let texel_u8 = vec4<u32>(
        (texel_u32 >> 0u) & 0xFF,
        (texel_u32 >> 8u) & 0xFF,
        (texel_u32 >> 16u) & 0xFF,
        (texel_u32 >> 24u) & 0xFF,
    );
    let texel = vec3<f32>(f32(texel_u8.x) / 255.0, f32(texel_u8.y) / 255.0, f32(texel_u8.z) / 255.0);
    return texel;
}

fn tetraIntersectionTest(tetra_index: u32, u: f32, v: f32, l: f32, current_best_voxel: Voxel) -> Voxel {
    var best_voxel = current_best_voxel;
    let tetra = tetras[tetra_index];
    
    let v0_1uvls = vertices1uvlstexBuffer[tetra.i0];
    let v1_1uvls = vertices1uvlstexBuffer[tetra.i1];
    let v2_1uvls = vertices1uvlstexBuffer[tetra.i2];
    let v3_1uvls = vertices1uvlstexBuffer[tetra.i3];
    
    let v0_s = v0_1uvls.s;
    let v1_s = v1_1uvls.s;
    let v2_s = v2_1uvls.s;
    let v3_s = v3_1uvls.s;
    
    let A = vec3<f32>(v0_1uvls.u, v0_1uvls.v, v0_1uvls.l);
    let B = vec3<f32>(v1_1uvls.u, v1_1uvls.v, v1_1uvls.l);
    let C = vec3<f32>(v2_1uvls.u, v2_1uvls.v, v2_1uvls.l);
    let D = vec3<f32>(v3_1uvls.u, v3_1uvls.v, v3_1uvls.l);
    let P = vec3<f32>(u, v, l);
    
    let u_min = min(min(v0_1uvls.u, v1_1uvls.u), min(v2_1uvls.u, v3_1uvls.u));
    let u_max = max(max(v0_1uvls.u, v1_1uvls.u), max(v2_1uvls.u, v3_1uvls.u));
    let v_min = min(min(v0_1uvls.v, v1_1uvls.v), min(v2_1uvls.v, v3_1uvls.v));
    let v_max = max(max(v0_1uvls.v, v1_1uvls.v), max(v2_1uvls.v, v3_1uvls.v));
    let l_min = min(min(v0_1uvls.l, v1_1uvls.l), min(v2_1uvls.l, v3_1uvls.l));
    let l_max = max(max(v0_1uvls.l, v1_1uvls.l), max(v2_1uvls.l, v3_1uvls.l));
    
    if (u < u_min || u > u_max || v < v_min || v > v_max || l < l_min || l > l_max) {
        return best_voxel;
    }
    
    let bary = barycentricCoordinates(P, A, B, C, D);
    
    if (all(bary >= vec4<f32>(0.0)) && all(bary <= vec4<f32>(1.0))) {
        // Straightforward linear interpolation isn't exactly correct due to perspective
        // let inv_s = bary.x * v0_s + bary.y * v1_s + bary.z * v2_s + bary.w * v3_s;
        // Perspective-correct interpolation: interpolate 1/s linearly, then invert
        let inv_s = bary.x / v0_s + bary.y / v1_s + bary.z / v2_s + bary.w / v3_s;
        let s = 1.0 / inv_s;

        if (s < best_voxel.s) {
            // Fetch texture color
            let texel = getTexture(tetra, bary);
            best_voxel.r = texel.x;
            best_voxel.g = texel.y;
            best_voxel.b = texel.z;
            if (tetra.flags != 0u) {
                best_voxel.r = f32((tetra.flags * 53u) % 256u) / 256.0;
                best_voxel.g = f32((tetra.flags * 97u) % 256u) / 256.0;
                best_voxel.b = f32((tetra.flags * 193u) % 256u) / 256.0;
            }
            // DEBUG: use tetra debug colors instead
            if (stage3DebugBuffer.x > 0.5) {
                best_voxel.r = f32(((tetra_index + 1u) * 53u) % 256u) / 256.0;
                best_voxel.g = f32(((tetra_index + 1u) * 97u) % 256u) / 256.0;
                best_voxel.b = f32(((tetra_index + 1u) * 193u) % 256u) / 256.0;
            }
            best_voxel.a = 1.0;
            best_voxel.s = s;
        }
    }

    return best_voxel;
}

@compute @workgroup_size(4, 4, 4)
fn cs_main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let RES = params.x;
    let TILE_RES = params.y;
    let TILE_SZ = params.z;
    let sim_t = simtimeBuffer.x;
    
    let U = global_id.x;
    let V = global_id.y;
    let L = global_id.z;
    
    if (U >= RES || V >= RES || L >= RES) {
        return;
    }

      
    let voxel_index = U + V * RES + L * RES * RES;

    if (U == 0 || U == RES-1 || V == 0 || V == RES-1 || L == 0 || L == RES-1) {
     voxels[voxel_index] = Voxel(1.0, 1.0, 1.0, 0.01, 1.0, 0u, 0u, 0u);
     return;
     } 
    
    let TU = U / TILE_SZ;
    let TV = V / TILE_SZ;
    let TL = L / TILE_SZ;
    
    let S_U_START = -1.0;
    let S_U_RANGE = 2.0;
    let S_V_START = -1.0;
    let S_V_RANGE = 2.0;
    let S_L_START = -1.0;
    let S_L_RANGE = 2.0;
    
    let u = S_U_START + (f32(U) + 0.5) / f32(RES) * S_U_RANGE;
    let v = S_V_START + (f32(V) + 0.5) / f32(RES) * S_V_RANGE;
    let l = S_L_START + (f32(L) + 0.5) / f32(RES) * S_L_RANGE;
    
    let CELL_ID = TU + TV * TILE_RES + TL * TILE_RES * TILE_RES;
    let cell_offset = cellCountsAndOffsetsBuffer[CELL_ID].offset;
    let cell_count = cellCountsAndOffsetsBuffer[CELL_ID].count;
  
    var best_voxel = voxels[voxel_index];
    best_voxel.s = 100000000.0; // TODO inf
    best_voxel.a = 0.0;

    ${floorShader}
    
    for (var i = 0u; i < cell_count; i++) {
        let tetra_index = cell_tetra_indices[cell_offset + i];
        best_voxel = tetraIntersectionTest(tetra_index, u, v, l, best_voxel);
    }

    // Test large tetras (not in the grid, tested by every voxel)
    let num_large = largeTetraBuffer[0];
    for (var j = 0u; j < num_large; j++) {
        let lt_index = largeTetraBuffer[j + 1u];
        best_voxel = tetraIntersectionTest(lt_index, u, v, l, best_voxel);
    }

    voxels[voxel_index] = best_voxel;
}
`;

    // DDA ray traversal shader code
    const stage4ShaderCode = `
struct Uniforms {
  cameraPos: vec3f,
  cameraDir: vec3f,
  cameraUp: vec3f,
  cameraRight: vec3f,
  resolution: vec3f,
  debug1: vec4f,
}

struct Voxel {
    r: f32,
    g: f32,
    b: f32,
    a: f32,
    s: f32,
    _pad: u32,
    _pad2: u32,
    _pad3: u32,
}

const fVOX: f32 = ${VOX}.0;
const iVOX: i32 = ${VOX};

@group(0) @binding(0) var<uniform> stage4UniformBuffer: Uniforms;
@group(0) @binding(1) var<storage, read> voxelGrid: array<Voxel>;

fn getVoxel(pos: vec3i) -> Voxel {
  if (pos.x < 0 || pos.x >= iVOX || pos.y < 0 || pos.y >= iVOX || pos.z < 0 || pos.z >= iVOX) {
    return Voxel(0.0, 0.0, 0.0, 0.0, 0.0, 0u, 0u, 0u);
  }

  // sensormodefloat
  if (stage4UniformBuffer.resolution.z == 0.0) { // slice
    if (pos.z == iVOX / 2) {} else { return Voxel(0.0, 0.0, 0.0, 0.0, 0.0, 0u, 0u, 0u); }
  }
  if (stage4UniformBuffer.resolution.z == 1.0) { // cutout
    if (pos.x < iVOX / 2 && pos.z < iVOX / 2) { return Voxel(0.0, 0.0, 0.0, 0.0, 0.0, 0u, 0u, 0u); }
  }
  if (stage4UniformBuffer.resolution.z == 2.0) { // half
    if (pos.z < iVOX / 2) { return Voxel(0.0, 0.0, 0.0, 0.0, 0.0, 0u, 0u, 0u); }
  }
  if (stage4UniformBuffer.resolution.z > 2.0 && stage4UniformBuffer.resolution.z < 3.0) { // half + a fraction
    let frac = stage4UniformBuffer.resolution.z - 2.0; // 0-1
    let zlim = iVOX / 2 - i32(f32(iVOX) / 2.0 * frac);
    if (pos.z < zlim) { return Voxel(0.0, 0.0, 0.0, 0.0, 0.0, 0u, 0u, 0u); }
  }
  if (stage4UniformBuffer.resolution.z == 4.0) { // eyeball
    let center = iVOX / 2;
    let radius = iVOX / 2;
    let dx = pos.x - center;
    let dy = pos.y - center;
    let dz = pos.z - center;
    if (dx * dx + dy * dy + dz * dz > radius * radius) {
      return Voxel(0.0, 0.0, 0.0, 0.0, 0.0, 0u, 0u, 0u);
    }
  }
  let idx = pos.x + pos.y * iVOX + pos.z * iVOX * iVOX;
  return voxelGrid[idx];
}


fn unpackColor(voxel: Voxel) -> vec4f {
  let r = voxel.r;
  let g = voxel.g;
  let b = voxel.b;
  let a = voxel.a * stage4UniformBuffer.debug1.x; // global opacity multiplier
  return vec4f(r, g, b, a);
}

// DDA ray traversal through voxel grid
fn traceRay(origin: vec3f, dir: vec3f) -> vec4f {
  // Find intersection with grid bounding box (0,0,0) to (VOX,VOX,VOX)
  let boxMin = vec3f(0.0, 0.0, 0.0);
  let boxMax = vec3f(fVOX, fVOX, fVOX);
  
  let invDir = vec3f(1.0) / dir;
  let t0 = (boxMin - origin) * invDir;
  let t1 = (boxMax - origin) * invDir;
  
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  
  let tenter = max(max(tmin.x, tmin.y), tmin.z);
  let texit = min(min(tmax.x, tmax.y), tmax.z);
  
  
  var skyColor = vec4f(0.07, 0.07, 0.07, 1.0);

  // Ray misses box or starts after exit
  if (tenter > texit || texit < 0.0) {
    return skyColor;
  }
  
  // Start ray at entry point (or origin if inside box)
  let tstart = max(tenter, 0.0);
  var rayPos = origin + dir * tstart + dir * 0.001; // Small epsilon to ensure we're inside
  
  // Current voxel position
  var voxelPos = vec3i(floor(rayPos));
  
  // Clamp to valid range
  voxelPos = clamp(voxelPos, vec3i(0), vec3i(iVOX-1));
  
  // Step direction (1 or -1 for each axis)
  let step = vec3i(sign(dir));
  
  // Distance to next voxel boundary along each axis
  let deltaDist = abs(vec3f(1.0) / dir);
  
  // Initial side distances
  var sideDist: vec3f;
  if (dir.x < 0.0) {
    sideDist.x = (rayPos.x - f32(voxelPos.x)) * deltaDist.x;
  } else {
    sideDist.x = (f32(voxelPos.x + 1) - rayPos.x) * deltaDist.x;
  }
  if (dir.y < 0.0) {
    sideDist.y = (rayPos.y - f32(voxelPos.y)) * deltaDist.y;
  } else {
    sideDist.y = (f32(voxelPos.y + 1) - rayPos.y) * deltaDist.y;
  }
  if (dir.z < 0.0) {
    sideDist.z = (rayPos.z - f32(voxelPos.z)) * deltaDist.z;
  } else {
    sideDist.z = (f32(voxelPos.z + 1) - rayPos.z) * deltaDist.z;
  }
  
  // DDA traversal
  var compositeRayColor = vec4f(0.0, 0.0, 0.0, 0.0);
  var side = 0;
  let maxSteps = iVOX * 4;
  
  for (var i = 0; i < maxSteps; i++) {
    // Check current voxel
    let voxel = getVoxel(voxelPos);
    if (true) {
      let color = unpackColor(voxel);
      if (color.a > 0.0) {
        var effectiveAlpha = color.a;
        var srcAlpha = effectiveAlpha * (1 - compositeRayColor.a);
        compositeRayColor = vec4f(compositeRayColor.rgb + color.rgb * srcAlpha, compositeRayColor.a + srcAlpha);
        if (compositeRayColor.a >= 0.99) {
          return compositeRayColor;
        }
      }
    }
    
    // Step to next voxel
    if (sideDist.x < sideDist.y) {
      if (sideDist.x < sideDist.z) {
        sideDist.x += deltaDist.x;
        voxelPos.x += step.x;
        side = 0;
      } else {
        sideDist.z += deltaDist.z;
        voxelPos.z += step.z;
        side = 2;
      }
    } else {
      if (sideDist.y < sideDist.z) {
        sideDist.y += deltaDist.y;
        voxelPos.y += step.y;
        side = 1;
      } else {
        sideDist.z += deltaDist.z;
        voxelPos.z += step.z;
        side = 2;
      }
    }
    
    // Check if ray left grid bounds
    if (voxelPos.x < -1 || voxelPos.x > iVOX || 
        voxelPos.y < -1 || voxelPos.y > iVOX || 
        voxelPos.z < -1 || voxelPos.z > iVOX) {
      break;
    }
  }
  
  // Sky color
  var effectiveAlpha = skyColor.a;
  var srcAlpha = effectiveAlpha * (1 - compositeRayColor.a);
  compositeRayColor = vec4f(compositeRayColor.rgb + skyColor.rbg * srcAlpha, compositeRayColor.a + srcAlpha);

  return compositeRayColor;
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  // Full screen quad
  var pos = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0)
  );
  return vec4f(pos[vertexIndex], 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
  let uv = (fragCoord.xy / stage4UniformBuffer.resolution.xy) * 2.0 - 1.0;
  let aspect = stage4UniformBuffer.resolution.x / stage4UniformBuffer.resolution.y;
  
  // Construct ray direction
  let rayDir = normalize(
    stage4UniformBuffer.cameraDir + 
    stage4UniformBuffer.cameraRight * uv.x * aspect -
    stage4UniformBuffer.cameraUp * uv.y
  );
  
  return traceRay(stage4UniformBuffer.cameraPos, rayDir);
}
`;
  

    // Create shader module
    const stage1ShaderModule = device.createShaderModule({
        code: stage1ShaderCode,
    });
    const clearShaderModule = device.createShaderModule({
        code: clearBufferShaderCode
    });
    const stage2p1ShaderModule = device.createShaderModule({
        code: stage2p1ShaderCode,
    });
    const stage2p2ShaderModule = device.createShaderModule({
        code: stage2p2ShaderCode,
    });
    const stage2p3ShaderModule = device.createShaderModule({
        code: stage2p3ShaderCode
    });
    const stage3ShaderModule = device.createShaderModule({
        code: stage3ShaderCode,
    });
    const stage4ShaderModule = device.createShaderModule({
        code: stage4ShaderCode,
    });

    // -- Buffers --
    // Create uniform buffer
    // 4 vec4s (camera pos, dir, up, right) + 1 vec2 (resolution) + padding = 80 bytes
    const stage4UniformBuffer = device.createBuffer({
    size: 6 * 4 * 4, // 6 vec3s, 4 f32s per vec3, 4 bytes per f32
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create voxel storage buffer
    const voxelBuffer = device.createBuffer({
    size: voxelData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Stage 1 Buffers and Pipeline
    // Extend buffers to accommodate clipped geometry (X% expansion for memory efficiency)
    const CLIPPING_EXPANSION = 3.0;
    const MAX_TOTAL_TETRAS = Math.ceil(tetras.length * (1 + CLIPPING_EXPANSION)) + 400;
    const MAX_TOTAL_VERTICES = Math.ceil(vertices_in_world.length * (1 + CLIPPING_EXPANSION)) + 400;

    const tetraBuffer = device.createBuffer({
        size: MAX_TOTAL_TETRAS * 20, // 20 bytes per tetra (5 u32s)
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(tetraBuffer, 0, tetraData);

    const tetraCountsBuffer = device.createBuffer({
        size: 4 * 4, // 4 u32s
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });
    const originalTetraCountsBufferData = new Uint32Array([tetras.length, vertices_in_world.length, 0, 0]);
    device.queue.writeBuffer(tetraCountsBuffer, 0, originalTetraCountsBufferData);

    const vertices1uvlstexBuffer = device.createBuffer({
        size: MAX_TOTAL_VERTICES * 32, // 32 bytes per vertex (8 f32s)
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(vertices1uvlstexBuffer, 0, vertices1uvlstexData);

    const stage2aParamsBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(stage2aParamsBuffer, 0, new Uint32Array([
        tetras.length,
        vertices_in_world.length,
        0,
        0
    ]));

    const allVerticesInObjectBuffer = device.createBuffer({
    size: all_vertices_in_object_data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(allVerticesInObjectBuffer, 0, all_vertices_in_object_data);

    const objectPosesBuffer = device.createBuffer({
    size: all_object_poses_data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(objectPosesBuffer, 0, all_object_poses_data);

    const vertexObjectIndicesBuffer = device.createBuffer({
    size: vertex_object_indices_data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(vertexObjectIndicesBuffer, 0, vertex_object_indices_data);

    const hypercameraInvPoseBuffer = device.createBuffer({
    size: hypercamera_inv_pose_data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    const hypercameraPoseBuffer = device.createBuffer({ // useful for tracing rays from camera (e.g. ground plane)
    size: hypercamera_pose_data.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const stage1ParamsBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(stage1ParamsBuffer, 0, new Uint32Array([all_vertices_in_object_data.length, 0, 0, 0]));

    const simtimeBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(simtimeBuffer, 0, new Float32Array([engineState.physics_time_s, 0, 0, 0]));

    const stage3DebugBuffer = device.createBuffer({
    size: 1 * 4 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(stage3DebugBuffer, 0, new Float32Array([0, 0, 0, 0]));

    // textures
    const textureHeaderBuffer = device.createBuffer({
    size: object_texture_header_data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(textureHeaderBuffer, 0, object_texture_header_data);

    const textureBuffer = device.createBuffer({
    size: global_texture_data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(textureBuffer, 0, global_texture_data);

    const verticesTexcoordBuffer = device.createBuffer({
    size: vertices_texcoords_data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(verticesTexcoordBuffer, 0, vertices_texcoords_data);  

    // consolidate counts and offsets into one buffer to reduce bind groups
    const cellCountsAndOffsetsBuffer = device.createBuffer({
        size: accelStructureCountsData.byteLength + accelStructureOffsetsData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });

    const cellTetraIndicesBuffer = device.createBuffer({
        size: accelStructureTetraIndicesData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(cellTetraIndicesBuffer, 0, accelStructureTetraIndicesData);

    // Create temp buffer for scan algorithm (Stage 2.2)
    // Blelloch scan requires power-of-2 size; pad to next power of 2
    const PREFIX_SUM_N = 1 << Math.ceil(Math.log2(TILE_RES * TILE_RES * TILE_RES));
    const tempBuffer = device.createBuffer({
        size: PREFIX_SUM_N * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC // NOCOMMIT DEBUG
    });

    //  Create a larger buffer for parameters
    // We need space for ~40 passes. 256 bytes alignment is standard.
    const ALIGNED_SIZE = 256; 
    const MAX_PASSES = 100; // Enough for Init + Up(18) + Clear + Down(18) + Finalize
    const prefixSumParamsBuffer = device.createBuffer({
        size: MAX_PASSES * ALIGNED_SIZE, 
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    // Buffer for temporary write counts during binning
    const cellWriteCountsBuffer = device.createBuffer({
        size: accelStructureCountsData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    // Large tetra list: [count, idx0, idx1, ...] — element 0 is atomic counter
    const largeTetraBuffer = device.createBuffer({
        size: (1 + MAX_LARGE_TETRAS) * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });

    // Update params for rasterization
    const rasterParamsBufferData = new Uint32Array([VOX, TILE_RES, TILE_SZ, 0]);
    const rasterParamsBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    device.queue.writeBuffer(rasterParamsBuffer, 0, rasterParamsBufferData);

    // ---- Layouts, Pipelines ----
    // Create bind group layout
    const stage1BindGroupLayout = device.createBindGroupLayout({
    entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ]
    });
    const stage1ParamsBindGroupLayout = device.createBindGroupLayout({
    entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }
    ]
    });
    const stage1PipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [stage1BindGroupLayout, stage1ParamsBindGroupLayout]
    });
    const stage1Pipeline = device.createComputePipeline({
    layout: stage1PipelineLayout,
    compute: {
        module: stage1ShaderModule,
        entryPoint: 'main'
    }
    });
    const stage1BindGroup = device.createBindGroup({
    layout: stage1BindGroupLayout,
    entries: [
        { binding: 0, resource: { buffer: allVerticesInObjectBuffer } },
        { binding: 1, resource: { buffer: objectPosesBuffer } },
        { binding: 2, resource: { buffer: vertexObjectIndicesBuffer } },
        { binding: 3, resource: { buffer: hypercameraInvPoseBuffer } },
        { binding: 4, resource: { buffer: vertices1uvlstexBuffer } }
    ]
    });
    const stage1ParamsBindGroup = device.createBindGroup({
    layout: stage1ParamsBindGroupLayout,
    entries: [
        { binding: 0, resource: { buffer: stage1ParamsBuffer } }
    ]
    });

    // Stage 2.a - Tetrahedron Clipping ---
    const stage2aShaderModule = device.createShaderModule({
        code: stage2aShaderCode,
    });
    const stage2aBindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }
        ]
    });
    const stage2aParamsBindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }
        ]
    });
    const stage2aPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [stage2aBindGroupLayout, stage2aParamsBindGroupLayout]
    });
    const stage2aPipeline = device.createComputePipeline({
        layout: stage2aPipelineLayout,
        compute: {
            module: stage2aShaderModule,
            entryPoint: 'clip_tetras'
        }
    });
    const stage2aBindGroup = device.createBindGroup({
        layout: stage2aBindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: tetraBuffer } }, // Input: original tetras
            { binding: 1, resource: { buffer: vertices1uvlstexBuffer } }, // Input: transformed vertices
            { binding: 2, resource: { buffer: tetraCountsBuffer } }
        ]
    });
    const stage2aParamsBindGroup = device.createBindGroup({
        layout: stage2aParamsBindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: stage2aParamsBuffer } }
        ]
    });

    // Stage 2 ---
    const stage2p1BindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }
        ]
    });
    const stage2p1ParamsBindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }
        ]
    });
    const stage2p1PipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [stage2p1BindGroupLayout, stage2p1ParamsBindGroupLayout]
    });
    const stage2p1Pipeline = device.createComputePipeline({
        layout: stage2p1PipelineLayout,
        compute: {
            module: stage2p1ShaderModule,
            entryPoint: 'main'
        }
    });
    const stage2p1BindGroup = device.createBindGroup({
        layout: stage2p1BindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: tetraBuffer } },
            { binding: 1, resource: { buffer: vertices1uvlstexBuffer } },
            { binding: 2, resource: { buffer: cellCountsAndOffsetsBuffer } },
            { binding: 3, resource: { buffer: largeTetraBuffer } }
        ]
    });
    const stage2p1ParamsBindGroup = device.createBindGroup({
        layout: stage2p1ParamsBindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: rasterParamsBuffer } },
            { binding: 1, resource: { buffer: tetraCountsBuffer } }
        ]
    });
    // Stage 2.2 Pipelines
    const prefixSumBindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }
        ]
    });
    const prefixSumParamsLayout = device.createBindGroupLayout({
        entries: [
            { 
            binding: 0, 
            visibility: GPUShaderStage.COMPUTE, 
            buffer: { type: 'uniform', hasDynamicOffset: true } // Changed to true
            }
        ]
    });
    const prefixSumBindGroup = device.createBindGroup({
        layout: prefixSumBindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: cellCountsAndOffsetsBuffer } },
            { binding: 1, resource: { buffer: tempBuffer } }
        ]
    });
    const prefixSumParamsBindGroup = device.createBindGroup({
        layout: prefixSumParamsLayout,
        entries: [
            { 
            binding: 0, 
            resource: { 
                buffer: prefixSumParamsBuffer,
                size: 16 // Shader only needs a vec4<u32> (16 bytes)
            } 
            }
        ]
    });
    const prefixSumPipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [prefixSumBindGroupLayout, prefixSumParamsLayout]
    });
    const clearBindGroupLayout = device.createBindGroupLayout({
        entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }]
    });
    const clearPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [clearBindGroupLayout] });
    const clearPipeline = device.createComputePipeline({
        layout: clearPipelineLayout,
        compute: { module: clearShaderModule, entryPoint: 'main' }
    });
    const clearCountsBG = device.createBindGroup({
        layout: clearBindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: cellCountsAndOffsetsBuffer } }]
    });
    const clearWriteCountsBG = device.createBindGroup({
        layout: clearBindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: cellWriteCountsBuffer } }]
    });
    const clearLargeTetraBG = device.createBindGroup({
        layout: clearBindGroupLayout,
        entries: [{ binding: 0, resource: { buffer: largeTetraBuffer } }]
    });
    const initPipeline = device.createComputePipeline({
    layout: prefixSumPipelineLayout,
    compute: {
        module: stage2p2ShaderModule,
        entryPoint: 'init'
    }
    });
    const upsweepPipeline = device.createComputePipeline({
    layout: prefixSumPipelineLayout,
    compute: {
        module: stage2p2ShaderModule,
        entryPoint: 'upsweep'
    }
    });
    const clearRootPipeline = device.createComputePipeline({
    layout: prefixSumPipelineLayout,
    compute: {
        module: stage2p2ShaderModule,
        entryPoint: 'clear_root'
    }
    });
    const downsweepPipeline = device.createComputePipeline({
    layout: prefixSumPipelineLayout,
    compute: {
        module: stage2p2ShaderModule,
        entryPoint: 'downsweep'
    }
    });
    const finalizePipeline = device.createComputePipeline({
    layout: prefixSumPipelineLayout,
    compute: {
        module: stage2p2ShaderModule,
        entryPoint: 'finalize'
    }
    });
    // 2. Setup Stage 2.3 (Binning) Pipeline
    const stage2p3BindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }, // Offsets
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },           // Write Counters (Atomic)
            { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }            // Tetra Indices (Output)
        ]
    });
    const stage2p3PipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [stage2p3BindGroupLayout, stage2p1ParamsBindGroupLayout] // Reuse params layout
    });
    const stage2p3Pipeline = device.createComputePipeline({
        layout: stage2p3PipelineLayout,
        compute: { module: stage2p3ShaderModule, entryPoint: 'main' }
    });
    const stage2p3BindGroup = device.createBindGroup({
        layout: stage2p3BindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: tetraBuffer } },
            { binding: 1, resource: { buffer: vertices1uvlstexBuffer } },
            { binding: 2, resource: { buffer: cellCountsAndOffsetsBuffer } },
            { binding: 3, resource: { buffer: cellWriteCountsBuffer } },
            { binding: 4, resource: { buffer: cellTetraIndicesBuffer } }
        ]
    });
    // Stage 3 Pipelines
    const stage3BindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } }
        ]
    });
    const stage3ParamsBindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
            { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }
        ]
    });
    const stage3PipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [stage3BindGroupLayout, stage3ParamsBindGroupLayout]
    });
    const stage3Pipeline = device.createComputePipeline({
        layout: stage3PipelineLayout,
        compute: {
            module: stage3ShaderModule,
            entryPoint: 'cs_main'
        }
    });
    const stage3BindGroup = device.createBindGroup({
        layout: stage3BindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: tetraBuffer } },
            { binding: 1, resource: { buffer: vertices1uvlstexBuffer } },
            { binding: 2, resource: { buffer: cellCountsAndOffsetsBuffer } },
            { binding: 3, resource: { buffer: cellTetraIndicesBuffer } },
            { binding: 4, resource: { buffer: textureHeaderBuffer } },
            { binding: 5, resource: { buffer: textureBuffer } },
            { binding: 6, resource: { buffer: voxelBuffer } },
            { binding: 7, resource: { buffer: largeTetraBuffer } }
        ]
    });
    const stage3ParamsBindGroup = device.createBindGroup({
        layout: stage3ParamsBindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: rasterParamsBuffer } },
            { binding: 1, resource: { buffer: hypercameraPoseBuffer } },
            { binding: 2, resource: { buffer: simtimeBuffer } },
            { binding: 3, resource: { buffer: stage3DebugBuffer } }
        ]
    });
    // Stage 4 Pipelines
    const stage4BindGroupLayout = device.createBindGroupLayout({
    entries: [
        {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
        },
        {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
        },
    ],
    });
    const stage4BindGroup = device.createBindGroup({
    layout: stage4BindGroupLayout,
    entries: [
        { binding: 0, resource: { buffer: stage4UniformBuffer } },
        { binding: 1, resource: { buffer: voxelBuffer } },
    ],
    });
    const stage4Pipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({
        bindGroupLayouts: [stage4BindGroupLayout],
    }),
    vertex: {
        module: stage4ShaderModule,
        entryPoint: 'vs_main',
    },
    fragment: {
        module: stage4ShaderModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
    },
    primitive: {
        topology: 'triangle-list',
    },
    });

    // -------------------
    // Controls 
    // -------------------

    // Register Keyboard controls
    window.addEventListener('keydown', (e) => {
        engineState.keys[e.key.toLowerCase()] = true;
    });

    window.addEventListener('keyup', (e) => {
        engineState.keys[e.key.toLowerCase()] = false;
    });
    // Mouse interaction
    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
            engineState.isDraggingLeftClick = true;
            engineState.lastX = e.clientX;
            engineState.lastY = e.clientY;
        } else if (e.button === 2) {
            engineState.isDraggingRightClick = true;
            engineState.lastXRight = e.clientX;
            engineState.lastYRight = e.clientY;
        } else if (e.button === 1) {
            engineState.isDraggingMiddleClick = true;
            engineState.lastXMiddle = e.clientX;
            engineState.lastYMiddle = e.clientY;
        }
    });
    canvas.addEventListener('mousemove', (e) => {
        engineState.mouseCurrentClickedX = e.clientX;
        engineState.mouseCurrentClickedY = e.clientY;

    });
    canvas.addEventListener('mouseup', () => {
        engineState.isDraggingLeftClick = false;
        engineState.isDraggingRightClick = false;
        engineState.isDraggingMiddleClick = false;
    });
    canvas.addEventListener('mouseleave', () => {
        engineState.isDraggingLeftClick = false;
        engineState.isDraggingRightClick = false;
        engineState.isDraggingMiddleClick = false;
    });
    // Scrolling changes camera distance
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        engineState.mouseScroll01 += e.deltaY * 0.0005;
        engineState.mouseScroll01 = Math.min(1, Math.max(0, engineState.mouseScroll01));
        engineState.mouseScrollActive = true;
    });

    function lookTowards(lookAt_in_world) {
        // Rotates the camera to look towards the chosen point.

        // new camera x axis
        let worldZ = new Vector4D(0, 0, 1, 0);
        let x = lookAt_in_world.subtract(engineState.camstand_T.origin()).normalize();
        let zProj = x.multiply_by_scalar(worldZ.dot(x));
        let zPrime = worldZ.subtract(zProj);
        let z = zPrime.normalize();

        // ---- Step 2: compute w ----
        // We want the camera w vector to be as close as possible to the world w axis
        // Otherwise the camera feels "fragged" in the usual xyz axes
        // let vW = new Vector4D(0, 0, 0, 1); // world w axis
        // Or we pick the current camera w, seems more robust
        let vW = new Vector4D(engineState.camstand_T.matrix[3][0], engineState.camstand_T.matrix[3][1], engineState.camstand_T.matrix[3][2], engineState.camstand_T.matrix[3][3]);

        let wPrime = vW
            .subtract(x.multiply_by_scalar(vW.dot(x)))
            .subtract(z.multiply_by_scalar(vW.dot(z)));
        let w = wPrime.normalize();

        // ---- Step 3: compute y ----
        // pick a vector not colinear with x, z
        // let vY = new Vector4D(0, 1, 0, 0);
        // pick the current y axis of the camera
        let vY = new Vector4D(engineState.camstand_T.matrix[1][0], engineState.camstand_T.matrix[1][1], engineState.camstand_T.matrix[1][2], engineState.camstand_T.matrix[1][3]);

        let yPrime = vY
            .subtract(x.multiply_by_scalar(vY.dot(x)))
            .subtract(z.multiply_by_scalar(vY.dot(z)))
            .subtract(w.multiply_by_scalar(vY.dot(w)));
        let y = yPrime.normalize();

        const PROGRESSIVE_ROTATION_TO_TARGET = true;

        // matrix = [x y z w]
        if (!PROGRESSIVE_ROTATION_TO_TARGET) {
        engineState.camstand_T.matrix[0][0] = x.x; engineState.camstand_T.matrix[0][1] = y.x; engineState.camstand_T.matrix[0][2] = z.x; engineState.camstand_T.matrix[0][3] = w.x;
        engineState.camstand_T.matrix[1][0] = x.y; engineState.camstand_T.matrix[1][1] = y.y; engineState.camstand_T.matrix[1][2] = z.y; engineState.camstand_T.matrix[1][3] = w.y;
        engineState.camstand_T.matrix[2][0] = x.z; engineState.camstand_T.matrix[2][1] = y.z; engineState.camstand_T.matrix[2][2] = z.z; engineState.camstand_T.matrix[2][3] = w.z;
        engineState.camstand_T.matrix[3][0] = x.w; engineState.camstand_T.matrix[3][1] = y.w; engineState.camstand_T.matrix[3][2] = z.w; engineState.camstand_T.matrix[3][3] = w.w;
        }

        if (PROGRESSIVE_ROTATION_TO_TARGET) {
            // interpolate towards the solution

            // Matrix operations
            function matrixMultiply(A, B) {
                const n = A.length;
                const result = Array(n).fill(0).map(() => Array(n).fill(0));
                
                for (let i = 0; i < n; i++) {
                    for (let j = 0; j < n; j++) {
                        for (let k = 0; k < n; k++) {
                            result[i][j] += A[i][k] * B[k][j];
                        }
                    }
                }
                return result;
            }

            function matrixTranspose(M) {
                const n = M.length;
                const result = Array(n).fill(0).map(() => Array(n).fill(0));
                
                for (let i = 0; i < n; i++) {
                    for (let j = 0; j < n; j++) {
                        result[i][j] = M[j][i];
                    }
                }
                return result;
            }

            // Simple method: Linear interpolation + SVD orthogonalization
            function interpolateRotation4D_Simple(R0, R1, t) {
                const n = 4;
                const R_interp = Array(n).fill(0).map(() => Array(n).fill(0));
                
                // Linear interpolation
                for (let i = 0; i < n; i++) {
                    for (let j = 0; j < n; j++) {
                        R_interp[i][j] = (1 - t) * R0[i][j] + t * R1[i][j];
                    }
                }
                
                // Re-orthogonalize using Gram-Schmidt
                return gramSchmidt4D(R_interp);
            }

            // Gram-Schmidt orthogonalization for 4D matrices
            function gramSchmidt4D(M) {
                const result = M.map(row => [...row]);
                
                for (let i = 0; i < 4; i++) {
                    // Subtract projections onto previous vectors
                    for (let j = 0; j < i; j++) {
                        const dot = dotProduct4D(result[i], result[j]);
                        for (let k = 0; k < 4; k++) {
                            result[i][k] -= dot * result[j][k];
                        }
                    }
                    
                    // Normalize
                    const norm = Math.sqrt(dotProduct4D(result[i], result[i]));
                    for (let k = 0; k < 4; k++) {
                        result[i][k] /= norm;
                    }
                }
                
                return result;
            }

            function dotProduct4D(v1, v2) {
                return v1[0]*v2[0] + v1[1]*v2[1] + v1[2]*v2[2] + v1[3]*v2[3];
            }


            // More accurate method using matrix logarithm (exponential map)
            function matrixLog(M) {
                // For rotation matrices, use series expansion
                // log(R) = (R - R^T)/2 + higher order terms for small rotations
                const n = 4;
                const MT = matrixTranspose(M);
                const skew = Array(n).fill(0).map(() => Array(n).fill(0));
                
                // First approximation: (M - M^T)/2
                for (let i = 0; i < n; i++) {
                    for (let j = 0; j < n; j++) {
                        skew[i][j] = (M[i][j] - MT[i][j]) / 2;
                    }
                }
                
                // For better accuracy with larger rotations, use series expansion
                // This is a simplified version
                return skew;
            }

            function matrixExp(M) {
                const n = 4;
                let result = Array(n).fill(0).map((_, i) => 
                    Array(n).fill(0).map((_, j) => i === j ? 1 : 0)
                );
                
                let term = result.map(row => [...row]);
                
                // Series expansion: exp(M) = I + M + M^2/2! + M^3/3! + ...
                for (let k = 1; k <= 20; k++) {
                    term = matrixMultiply(term, M);
                    const factorial = factorial_memo(k);
                    
                    for (let i = 0; i < n; i++) {
                        for (let j = 0; j < n; j++) {
                            result[i][j] += term[i][j] / factorial;
                        }
                    }
                }
                
                return result;
            }

            function factorial_memo(n) {
                let result = 1;
                for (let i = 2; i <= n; i++) result *= i;
                return result;
            }

            function interpolateRotation4D_Geodesic(R0, R1, t) {
                // Compute R1 * R0^T
                const R0T = matrixTranspose(R0);
                const R_rel = matrixMultiply(R1, R0T);
                
                // Compute log(R_rel)
                const log_R = matrixLog(R_rel);
                
                // Scale by t
                const scaled_log = log_R.map(row => row.map(val => val * t));
                
                // Compute exp(t * log_R)
                const exp_tlog = matrixExp(scaled_log);
                
                // Multiply by R0
                return matrixMultiply(exp_tlog, R0);
            }

            // Example usage:
            const from_R = [
                [engineState.camstand_T.matrix[0][0], engineState.camstand_T.matrix[0][1], engineState.camstand_T.matrix[0][2], engineState.camstand_T.matrix[0][3]],
                [engineState.camstand_T.matrix[1][0], engineState.camstand_T.matrix[1][1], engineState.camstand_T.matrix[1][2], engineState.camstand_T.matrix[1][3]],
                [engineState.camstand_T.matrix[2][0], engineState.camstand_T.matrix[2][1], engineState.camstand_T.matrix[2][2], engineState.camstand_T.matrix[2][3]],
                [engineState.camstand_T.matrix[3][0], engineState.camstand_T.matrix[3][1], engineState.camstand_T.matrix[3][2], engineState.camstand_T.matrix[3][3]]
            ];

            const to_R = [
                [x.x, y.x, z.x, w.x],
                [x.y, y.y, z.y, w.y],
                [x.z, y.z, z.z, w.z],
                [x.w, y.w, z.w, w.w]
            ];

            // simple method
            const interpolated_R = interpolateRotation4D_Simple(from_R, to_R, 0.3);
            // Geodesic method (more accurate, especially for large rotations)
            // const interpolated_R = interpolateRotation4D_Geodesic(from_R, to_R, 0.3);

            // Update engineState.camstand_T with interpolated rotation
            engineState.camstand_T.matrix[0][0] = interpolated_R[0][0]; engineState.camstand_T.matrix[0][1] = interpolated_R[0][1]; engineState.camstand_T.matrix[0][2] = interpolated_R[0][2]; engineState.camstand_T.matrix[0][3] = interpolated_R[0][3];
            engineState.camstand_T.matrix[1][0] = interpolated_R[1][0]; engineState.camstand_T.matrix[1][1] = interpolated_R[1][1]; engineState.camstand_T.matrix[1][2] = interpolated_R[1][2]; engineState.camstand_T.matrix[1][3] = interpolated_R[1][3];
            engineState.camstand_T.matrix[2][0] = interpolated_R[2][0]; engineState.camstand_T.matrix[2][1] = interpolated_R[2][1]; engineState.camstand_T.matrix[2][2] = interpolated_R[2][2]; engineState.camstand_T.matrix[2][3] = interpolated_R[2][3];
            engineState.camstand_T.matrix[3][0] = interpolated_R[3][0]; engineState.camstand_T.matrix[3][1] = interpolated_R[3][1]; engineState.camstand_T.matrix[3][2] = interpolated_R[3][2]; engineState.camstand_T.matrix[3][3] = interpolated_R[3][3];
        }
    }
    function updatePlayerControls() {
        // If the scene has a game manager, use it to handle player controls
        if (scene.gameManager) {
            scene.gameManager.updatePlayerControls(engineState);
            return;
        }

        // Else, default controls
        if (engineState.isDraggingLeftClick) {
            const deltaX = engineState.mouseCurrentClickedX - engineState.lastX;
            const deltaY = engineState.mouseCurrentClickedY - engineState.lastY;
            
            engineState.camstand_T.rotate_self_by_delta('XY', deltaX * 0.01, true);
            engineState.camstand_T.rotate_self_by_delta('XW', deltaY * 0.01, true);
            
            engineState.lastX = engineState.mouseCurrentClickedX;
            engineState.lastY = engineState.mouseCurrentClickedY;
        }
        if (engineState.isDraggingRightClick) {
            const deltaX = engineState.mouseCurrentClickedX - engineState.lastXRight;
            const deltaY = engineState.mouseCurrentClickedY - engineState.lastYRight;
            engineState.camstand_T.rotate_self_by_delta('YW', deltaX * 0.01, true);
            engineState.camstandswivel_angle += deltaY * 0.01;
            engineState.lastXRight = engineState.mouseCurrentClickedX;
            engineState.lastYRight = engineState.mouseCurrentClickedY;
        }
        if (engineState.isDraggingMiddleClick) {
            const deltaX = engineState.mouseCurrentClickedX - engineState.lastXMiddle;
            const deltaY = engineState.mouseCurrentClickedY - engineState.lastYMiddle;
            engineState.sensorCamRotY += deltaY * 0.01;
            engineState.sensorCamRotX += deltaX * 0.01;
            engineState.lastXMiddle = engineState.mouseCurrentClickedX;
            engineState.lastYMiddle = engineState.mouseCurrentClickedY;
        }
        engineState.sensorCamDist = engineState.mouseScroll01 * 100 + 1;

        // keyboard
        const moveSpeed = 0.1;
        const RELATIVE_MOVEMENT = true;
        if (engineState.keys['w']) {
            engineState.camstand_T.translate_self_by_delta(moveSpeed, 0, 0, 0, RELATIVE_MOVEMENT);
        }
        if (engineState.keys['s']) {
            engineState.camstand_T.translate_self_by_delta(-moveSpeed, 0, 0, 0, RELATIVE_MOVEMENT);
        }
        if (engineState.keys['a']) {
            engineState.camstand_T.translate_self_by_delta(0, moveSpeed, 0, 0, RELATIVE_MOVEMENT);
        }
        if (engineState.keys['d']) {
            engineState.camstand_T.translate_self_by_delta(0,-moveSpeed, 0, 0, RELATIVE_MOVEMENT);
        }
        if (engineState.keys['q']) {
            engineState.camstand_T.translate_self_by_delta(0, 0, 0, -moveSpeed, RELATIVE_MOVEMENT);
        }
        if (engineState.keys['e']) {
            engineState.camstand_T.translate_self_by_delta(0, 0, 0, +moveSpeed, RELATIVE_MOVEMENT);
        }
        if (engineState.keys['r']) {
            engineState.camstand_T.translate_self_by_delta(0, 0, moveSpeed, 0, RELATIVE_MOVEMENT);
        }
        if (engineState.keys['f']) {
            engineState.camstand_T.translate_self_by_delta(0, 0, -moveSpeed, 0, RELATIVE_MOVEMENT);
        }
        // space to jump
        if (engineState.keys[' ']) {
            if (!engineState.player_is_jumping) {
                engineState.last_player_jump_time = engineState.physics_time_s;
                engineState.player_is_jumping = true;
            }
        }

        const rotateSpeed = 0.05;
        if (engineState.keys['i']) {
            engineState.camstandswivel_angle -= rotateSpeed;
        }
        if (engineState.keys['k']) {
            engineState.camstandswivel_angle += rotateSpeed;
        }
        if (engineState.keys['j']) {
            engineState.camstand_T.rotate_self_by_delta('XY', rotateSpeed, true);
        }
        if (engineState.keys['l']) {
            engineState.camstand_T.rotate_self_by_delta('XY', -rotateSpeed, true);
        }
        if (engineState.keys['u']) {
            engineState.camstand_T.rotate_self_by_delta('XW', rotateSpeed, true);
        }
        if (engineState.keys['o']) {
            engineState.camstand_T.rotate_self_by_delta('XW', -rotateSpeed, true);
        }
        if (engineState.keys['y']) {
            engineState.camstand_T.rotate_self_by_delta('YW', -rotateSpeed, true);
        }
        if (engineState.keys['p']) {
            engineState.camstand_T.rotate_self_by_delta('YW', rotateSpeed, true);
        }

        if (engineState.keys['1']) {
            let idx = 0;
            if (idx < scene.visibleHyperobjects.length) { lookTowards(scene.visibleHyperobjects[idx].get_com()); }
        }
        if (engineState.keys['2']) {
            let idx = 1;
            if (idx < scene.visibleHyperobjects.length) { lookTowards(scene.visibleHyperobjects[idx].get_com()); }
        }
        if (engineState.keys['3']) {
            let idx = 2;
            if (idx < scene.visibleHyperobjects.length) { lookTowards(scene.visibleHyperobjects[idx].get_com()); }
        }
        if (engineState.keys['0']) {
            lookTowards(new Vector4D(0, 0, 0, 0));
        }

        // Box Colliders
        for (let i = 0; i < scene.visibleHyperobjects.length; i++) {
            const obj = scene.visibleHyperobjects[i];
            if (obj.collider) {
                obj.collider.constrainTransform(engineState.camstand_T);
            }
        }

                // Debug: print the player pose to a div
                // create div if it doesn't exist
                if (!document.getElementById("player_pose")) {
                    const div = document.createElement("div");
                    div.id = "player_pose";
                    document.body.appendChild(div);
                    div.style.position = "absolute";
                    div.style.top = "10px";
                    div.style.right = "10px";
                    div.style.color = "rgb(156, 156, 156)";
                    div.style.fontFamily = "monospace";
                    div.style.fontSize = "12px";
                    console.log("created div");
                }
                // update div
                document.getElementById("player_pose").innerHTML = `Player:<br>`;
                document.getElementById("player_pose").innerHTML += `[${engineState.camstand_T.matrix[0][0].toFixed(2)}, ${engineState.camstand_T.matrix[0][1].toFixed(2)}, ${engineState.camstand_T.matrix[0][2].toFixed(2)}, ${engineState.camstand_T.matrix[0][3].toFixed(2)}, ${engineState.camstand_T.matrix[0][4].toFixed(2)}]<br>`;
                document.getElementById("player_pose").innerHTML += `[${engineState.camstand_T.matrix[1][0].toFixed(2)}, ${engineState.camstand_T.matrix[1][1].toFixed(2)}, ${engineState.camstand_T.matrix[1][2].toFixed(2)}, ${engineState.camstand_T.matrix[1][3].toFixed(2)}, ${engineState.camstand_T.matrix[1][4].toFixed(2)}]<br>`;
                document.getElementById("player_pose").innerHTML += `[${engineState.camstand_T.matrix[2][0].toFixed(2)}, ${engineState.camstand_T.matrix[2][1].toFixed(2)}, ${engineState.camstand_T.matrix[2][2].toFixed(2)}, ${engineState.camstand_T.matrix[2][3].toFixed(2)}, ${engineState.camstand_T.matrix[2][4].toFixed(2)}]<br>`;
                document.getElementById("player_pose").innerHTML += `[${engineState.camstand_T.matrix[3][0].toFixed(2)}, ${engineState.camstand_T.matrix[3][1].toFixed(2)}, ${engineState.camstand_T.matrix[3][2].toFixed(2)}, ${engineState.camstand_T.matrix[3][3].toFixed(2)}, ${engineState.camstand_T.matrix[3][4].toFixed(2)}]<br>`;



        // Don't let player off the island
        if (scene.floorPreset === 'island') {
            const islandR = 20.0;
            var playerPosXYW = engineState.camstand_T.origin();
            playerPosXYW.z = 0.0;
            if (playerPosXYW.magnitude() > islandR) {
                playerPosXYW = playerPosXYW.normalize().multiply_by_scalar(islandR);
                engineState.camstand_T.matrix[0][4] = playerPosXYW.x;
                engineState.camstand_T.matrix[1][4] = playerPosXYW.y;
                engineState.camstand_T.matrix[3][4] = playerPosXYW.w;
            }
        }

        // Compute final camera transform from intermediate poses
        // Jump and camera height
        // reset camera z to 0
        let jump_z = 0;
        const jump_height = 1;
        if (engineState.player_is_jumping) {
            // jump height is a parabola
            const tend = 4; // jump duration
            let dt = engineState.physics_time_s - engineState.last_player_jump_time;
            let jp01 = dt / tend; // jump progress from 0 to 1
            if (dt > tend) {
                engineState.player_is_jumping = false;
            } else {
                jump_z = jump_height * (1.0 - (2.0 * jp01 - 1.0) ** 2);
            }
        }
        engineState.camstand_T.matrix[2][4] = scene.floor_heightmap(
            engineState.camstand_T.matrix[0][4],
            engineState.camstand_T.matrix[1][4],
            engineState.camstand_T.matrix[3][4]
        ) + jump_z;
        // sine and cosine of swivel angle
        let ss = Math.sin(engineState.camstandswivel_angle);
        let cs = Math.cos(engineState.camstandswivel_angle);
        let h = engineState.camstand_height;
        let hypercam_in_camstand = new Transform4D([
            [cs, 0, ss, 0, 0],
            [0, 1, 0, 0, 0],
            [-ss, 0, cs, 0, h],
            [0, 0, 0, 1, 0],
            [0, 0, 0, 0, 1]
        ]);
        engineState.hypercamera_T = engineState.camstand_T.transform_transform(hypercam_in_camstand);
    } // updatePlayerControls

    function writeCameraPoseToGPU() {
        let hypercamera_inv_pose_data = new Float32Array(5 * 5);
        let hc_pose = engineState.hypercamera_T.inverse().matrix;
        for (let i = 0; i < 5; i++) {
            for (let j = 0; j < 5; j++) {
                hypercamera_inv_pose_data[i * 5 + j] = hc_pose[i][j];
            }
        }
        device.queue.writeBuffer(hypercameraInvPoseBuffer, 0, hypercamera_inv_pose_data);
        // uniform buffer for hypercamera pose (so we only pass the first 4 rows of each vector)
        let hypercamera_pose_data = new Float32Array(5 * 4);
        for (let i = 0; i < 5; i++) {
            hypercamera_pose_data[i * 4 + 0] = engineState.hypercamera_T.matrix[0][i];
            hypercamera_pose_data[i * 4 + 1] = engineState.hypercamera_T.matrix[1][i];
            hypercamera_pose_data[i * 4 + 2] = engineState.hypercamera_T.matrix[2][i];
            hypercamera_pose_data[i * 4 + 3] = engineState.hypercamera_T.matrix[3][i];
        }
        device.queue.writeBuffer(hypercameraPoseBuffer, 0, hypercamera_pose_data);
    }
    function writeDDACameraPoseToGPU() {
        let rotY = engineState.sensorCamRotX;
        let rotX = engineState.sensorCamRotY;

        if (engineState.AUTO_SHAKE_SENSOR) {
            rotY = -Math.PI / 2. + Math.sin(engineState.physics_time_s * 0.2) * 0.2;
            rotX = 0.3 + Math.cos(engineState.physics_time_s * 0.2) * 0.1;
        }
        let dist = engineState.sensorCamDist;

        // Sensor modes
        if (engineState.SENSOR_MODE === 0.0) {
            rotY = -Math.PI / 2.0;
            rotX = 0.;
            dist = 50.0 * VOX / 96;
        }

        // Camera position (orbit around center at 2,2,2)
        const cx = VOX / 2 + Math.cos(rotY) * Math.cos(rotX) * dist;
        const cy = VOX / 2 + Math.sin(rotX) * dist;
        const cz = VOX / 2 + Math.sin(rotY) * Math.cos(rotX) * dist;

        // Camera direction (look at center)
        const target = [VOX / 2, VOX / 2, VOX / 2];
        const dx = target[0] - cx;
        const dy = target[1] - cy;
        const dz = target[2] - cz;
        const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
        const dir = [dx/len, dy/len, dz/len];

        // Camera up and right vectors
        const worldUp = [0, 1, 0];
        const right = [
            dir[1] * worldUp[2] - dir[2] * worldUp[1],
            dir[2] * worldUp[0] - dir[0] * worldUp[2],
            dir[0] * worldUp[1] - dir[1] * worldUp[0],
        ];
        const rlen = Math.sqrt(right[0]**2 + right[1]**2 + right[2]**2);
        right[0] /= rlen; right[1] /= rlen; right[2] /= rlen;

        const up = [
            right[1] * dir[2] - right[2] * dir[1],
            right[2] * dir[0] - right[0] * dir[2],
            right[0] * dir[1] - right[1] * dir[0],
        ];



        // Update uniform buffer
        const stage4UniformBufferData = new Float32Array([
            cx, cy, cz, 0,
            dir[0], dir[1], dir[2], 0,
            up[0], up[1], up[2], 0,
            right[0], right[1], right[2], 0,
            canvas.width, canvas.height, engineState.SENSOR_MODE, 0,
            engineState.SENSOR_ALPHA, 0, 0, 0, // debug1
        ]);
        device.queue.writeBuffer(stage4UniformBuffer, 0, stage4UniformBufferData);
    }

    function physicsStepCPU() {
        // Simulate physics
        const SIMULATE_PHYSICS = true;
        const N_PHYS_SUBSTEPS = 4;
        for (let n = 0; n < N_PHYS_SUBSTEPS; n++) { // substeps for stability
            if (SIMULATE_PHYSICS) {
                // debug log
                let html_physics_log = '';

                const FLOOR_STIFFNESS = 100;
                const FLOOR_DAMPING = 10;
                const GRAVITY = -9.81;
                const AIR_FRICTION_COEFFICIENT = 1.0;
                const FLOOR_SIDE_FRICTION_COEFFICIENT = 1;
                const dt = PHYSICS_DT / N_PHYS_SUBSTEPS; // ~60fps

                html_physics_log += '<b>Sim Time:</b> ' + engineState.physics_time_s.toFixed(2) + ' s<br>';
                html_physics_log += '<b>UI Time:</b> ' + engineState.accumulated_animation_time_s.toFixed(2) + ' s<br>';

                for (let hyperobject of scene.visibleHyperobjects) {
                    if (hyperobject.simulate_physics) {

                        html_physics_log += `<b>Object:</b> ${hyperobject.name}<br>`;

                        // calculate hyperobject center of mass 
                        let hyperobject_com = hyperobject.get_com();
                        
                        // mujoco-style forward/backward
                        // 1. apply gravity
                        // 2. apply collision to c.o.m based on vertices penetrating the floor (use z=-2 as the floor height)
                        // 3. resolve c.o.m velocity and rotational velocity
                        // 4. update vertex positions based on c.o.m and rotational velocity
                        
                        // force and torque accumulators
                        let com_force = new Vector4D(0, 0, GRAVITY * hyperobject.mass, 0);
                        let com_torque = {xy: 0, xz: 0, xw: 0, yz: 0, yw: 0, zw: 0};

                        // If object com is within 1 unit of camera, push it away with small force
                        let to_camera = hyperobject_com.subtract(engineState.hypercamera_T.origin());
                        let distance_to_camera = Math.sqrt(to_camera.x**2 + to_camera.y**2 + to_camera.z**2 + to_camera.w**2);
                        if (distance_to_camera < 2.0 && distance_to_camera > 0.01) {
                            // let push_strength = 50 * (1.0 - distance_to_camera);
                            let min_push_strength = 50;
                            let max_push_strength = 500;
                            let push_01 = (2.0 - distance_to_camera) / 2.0;
                            let push_strength = min_push_strength + (max_push_strength - min_push_strength) * push_01;
                            let push_direction = to_camera.multiply_by_scalar(1.0 / distance_to_camera); // normalize
                            let push_force = push_direction.multiply_by_scalar(push_strength);
                            com_force = com_force.add(push_force);
                        }

                        // Add a general friction force
                        let friction_force = hyperobject.velocity_in_world.multiply_by_scalar(-AIR_FRICTION_COEFFICIENT);
                        com_force = com_force.add(friction_force);

                        // Add a general air friction rotational torque
                        com_torque.xy += -AIR_FRICTION_COEFFICIENT * hyperobject.rotational_velocity.xy;
                        com_torque.xz += -AIR_FRICTION_COEFFICIENT * hyperobject.rotational_velocity.xz;
                        com_torque.xw += -AIR_FRICTION_COEFFICIENT * hyperobject.rotational_velocity.xw;
                        com_torque.yz += -AIR_FRICTION_COEFFICIENT * hyperobject.rotational_velocity.yz;
                        com_torque.yw += -AIR_FRICTION_COEFFICIENT * hyperobject.rotational_velocity.yw;
                        com_torque.zw += -AIR_FRICTION_COEFFICIENT * hyperobject.rotational_velocity.zw;
                        
                        // 2. Check for collisions with floor and accumulate forces/torques
                        for (let v of hyperobject.vertices_in_world) {
                            let floor_height = scene.floor_heightmap(v.x, v.y, v.w);
                            let penetration = floor_height - v.z;
                            if (penetration > 0) {
                                // Position relative to CoM
                                let r = v.subtract(hyperobject_com); // position relative to CoM
                                
                                // Calculate velocity of this vertex in world frame
                                let vertex_velocity = new Vector4D(0, 0, 0, 0);

                                // Linear velocity from CoM
                                vertex_velocity = vertex_velocity.add(hyperobject.velocity_in_world)

                                // Velocity due to rotation (v_rot = omega × r in 4D)
                                // too unstable
                                // let v_rot = new Vector4D(
                                    // hyperobject.rotational_velocity.xy * r.y - hyperobject.rotational_velocity.xz * r.z - hyperobject.rotational_velocity.xw * r.w,
                                    // -hyperobject.rotational_velocity.xy * r.x + hyperobject.rotational_velocity.yz * r.z + hyperobject.rotational_velocity.yw * r.w,
                                    // hyperobject.rotational_velocity.xz * r.x - hyperobject.rotational_velocity.yz * r.y + hyperobject.rotational_velocity.zw * r.w,
                                    // hyperobject.rotational_velocity.xw * r.x - hyperobject.rotational_velocity.yw * r.y - hyperobject.rotational_velocity.zw * r.z
                                // );
                                // vertex_velocity = vertex_velocity.add(v_rot);
                                
                                
                                
                                // Spring-damper force (normal direction only, z-axis)
                                let normal_force_z = FLOOR_STIFFNESS * penetration - FLOOR_DAMPING * vertex_velocity.z;
                                
                                let contact_force = new Vector4D(0, 0, normal_force_z, 0);

                                // Add side friction to contact force
                                let lateral_velocity = new Vector4D(vertex_velocity.x, vertex_velocity.y, 0, vertex_velocity.w);
                                let lateral_speed = Math.sqrt(lateral_velocity.x**2 + lateral_velocity.y**2 + lateral_velocity.w**2);
                                if (lateral_speed > 0.01) {
                                    let lateral_direction = lateral_velocity.multiply_by_scalar(1.0 / lateral_speed); // normalize
                                    let lateral_friction_magnitude = FLOOR_SIDE_FRICTION_COEFFICIENT * Math.abs(normal_force_z);
                                    let lateral_friction = lateral_direction.multiply_by_scalar(-lateral_friction_magnitude);
                                    contact_force = contact_force.add(lateral_friction);
                                }
                                
                                // Accumulate force on CoM
                                com_force = com_force.add(contact_force);

                                // Debug
                                if (v.z < -4) {
                                    let aaa = 1;
                                }
                                
                                // Accumulate torque (r × F in 4D gives bivector with 6 components)
                                com_torque.xy += r.x * contact_force.y - r.y * contact_force.x;
                                com_torque.xz += r.x * contact_force.z - r.z * contact_force.x;
                                com_torque.xw += r.x * contact_force.w - r.w * contact_force.x;
                                com_torque.yz += r.y * contact_force.z - r.z * contact_force.y;
                                com_torque.yw += r.y * contact_force.w - r.w * contact_force.y;
                                com_torque.zw += r.z * contact_force.w - r.w * contact_force.z;
                            }
                        }


                        const fmt = (n) => {
                            let str = n.toFixed(3);
                            str = (n < 0 ? str.slice(1) : str); // remove minus for padding
                            str = str.padStart(8, '_');
                            str = (n >= 0 ? '+' + str : '-' + str);
                            return str
                        };

                        html_physics_log += `<table style="border-collapse: collapse; font-family: monospace;">`;
                        html_physics_log += `<tr><th>Property</th><th>x</th><th>y</th><th>z</th><th>w</th><th></th><th></th></tr>`;
                        html_physics_log += `<tr><td>Com Force</td><td>${fmt(com_force.x)}</td><td>${fmt(com_force.y)}</td><td>${fmt(com_force.z)}</td><td>${fmt(com_force.w)}</td><td></td><td></td></tr>`;
                        html_physics_log += `<tr><td>Com Vel</td><td>${fmt(hyperobject.velocity_in_world.x)}</td><td>${fmt(hyperobject.velocity_in_world.y)}</td><td>${fmt(hyperobject.velocity_in_world.z)}</td><td>${fmt(hyperobject.velocity_in_world.w)}</td><td></td><td></td></tr>`;
                        html_physics_log += `<tr><th></th><th>xy</th><th>xz</th><th>xw</th><th>yz</th><th>yw</th><th>zw</th></tr>`;
                        html_physics_log += `<tr><td>Com Torque</td><td>${fmt(com_torque.xy)}</td><td>${fmt(com_torque.xz)}</td><td>${fmt(com_torque.xw)}</td><td>${fmt(com_torque.yz)}</td><td>${fmt(com_torque.yw)}</td><td>${fmt(com_torque.zw)}</td></tr>`;
                        html_physics_log += `<tr><td>Com Ang Vel</td><td>${fmt(hyperobject.rotational_velocity.xy)}</td><td>${fmt(hyperobject.rotational_velocity.xz)}</td><td>${fmt(hyperobject.rotational_velocity.xw)}</td><td>${fmt(hyperobject.rotational_velocity.yz)}</td><td>${fmt(hyperobject.rotational_velocity.yw)}</td><td>${fmt(hyperobject.rotational_velocity.zw)}</td></tr>`;
                        html_physics_log += `</table>`;
                        
                        // 3. Integrate velocities (simple Euler integration)
                        
                        // Linear velocity update: v += (F/m) * dt
                        hyperobject.velocity_in_world = hyperobject.velocity_in_world.add(
                            new Vector4D(
                                com_force.x / hyperobject.mass * dt,
                                com_force.y / hyperobject.mass * dt,
                                com_force.z / hyperobject.mass * dt,
                                com_force.w / hyperobject.mass * dt
                            )
                        );
                        
                        // Angular velocity update: omega += (torque / I) * dt
                        // For uniform hyperobject with edge length 2: I = (2/3) * mass
                        const I = (2/3) * hyperobject.mass;
                        hyperobject.rotational_velocity.xy += (com_torque.xy / I) * dt;
                        hyperobject.rotational_velocity.xz += (com_torque.xz / I) * dt;
                        hyperobject.rotational_velocity.xw += (com_torque.xw / I) * dt;
                        hyperobject.rotational_velocity.yz += (com_torque.yz / I) * dt;
                        hyperobject.rotational_velocity.yw += (com_torque.yw / I) * dt;
                        hyperobject.rotational_velocity.zw += (com_torque.zw / I) * dt;
                        
                        // 4. Update pose based on CoM velocity and rotation, update vertices
                        // Update CoM position
                        // translate the pose matrix by velocity * dt
                        hyperobject.pose.translate_self_by_delta(
                            hyperobject.velocity_in_world.x * dt,
                            hyperobject.velocity_in_world.y * dt,
                            hyperobject.velocity_in_world.z * dt,
                            hyperobject.velocity_in_world.w * dt,
                            false
                        );
                        // rotate the pose matrix by rotational velocity * dt
                        hyperobject.pose.rotate_self_by_delta('XY', hyperobject.rotational_velocity.xy * dt, false);
                        hyperobject.pose.rotate_self_by_delta('XZ', hyperobject.rotational_velocity.xz * dt, false);
                        hyperobject.pose.rotate_self_by_delta('XW', hyperobject.rotational_velocity.xw * dt, false);
                        hyperobject.pose.rotate_self_by_delta('YZ', hyperobject.rotational_velocity.yz * dt, false);
                        hyperobject.pose.rotate_self_by_delta('YW', hyperobject.rotational_velocity.yw * dt, false);
                        hyperobject.pose.rotate_self_by_delta('ZW', hyperobject.rotational_velocity.zw * dt, false);
                        // update vertices
                        hyperobject.update_vertices_in_world();
                    }
                }

                engineState.physics_time_s += dt;

                if (engineState.DEBUG_PHYSICS) {
                    // document.getElementById('physics-debug-text').innerHTML = html_physics_log;
                } else {
                    // document.getElementById('physics-debug-text').innerHTML = '';
                }

                if (engineState.STEP_PHYSICS_ONCE) {
                    SIMULATE_PHYSICS = false;
                    engineState.STEP_PHYSICS_ONCE = false;
                }
            } // End of SIMULATE_PHYSICS
        } // end of substeps
    } // end function physicsStepCPU()

    function writeObjectPosesToGPU() {
        let new_object_poses_data = new Float32Array(scene.visibleHyperobjects.length * 5 * 5);
        for (let obj_index = 0; obj_index < scene.visibleHyperobjects.length; obj_index++) {
            let obj = scene.visibleHyperobjects[obj_index];
            // basic physics - move cube up and down 
            let time = performance.now() * 0.001;
            // DEBUG - rotate the hypercube
            // if (obj_index === 0) {
            //     obj.pose.rotate_self_by_delta('ZW', 0.01, false)
            // }
            // object poses
            let pose = obj.pose.matrix;
            for (let i = 0; i < 5; i++) {
                for (let j = 0; j < 5; j++) {
                    new_object_poses_data[obj_index * 5 * 5 + i * 5 + j] = pose[i][j];
                }
            }
        }
        device.queue.writeBuffer(objectPosesBuffer, 0, new_object_poses_data);
    }
    
    function writePhysicsTimeToGPU() {
        device.queue.writeBuffer(simtimeBuffer, 0, new Float32Array([engineState.physics_time_s, 0, 0, 0])); // write sim time to GPU
        const debugtetracolorsfloat = engineState.DEBUG_TETRA_COLORS ? 1.0 : 0.0;
        device.queue.writeBuffer(stage3DebugBuffer, 0, new Float32Array([debugtetracolorsfloat, 0, 0, 0])); // write stage3 debug flags
    }

    function animateObjects() {
        let isObjectVertPosDataChanged = false;
        let isTexcoordsChanged = false;
        for (let obj_index = 0; obj_index < scene.visibleHyperobjects.length; obj_index++) {
            let obj = scene.visibleHyperobjects[obj_index];
            if (obj.is_animated) {
                obj.animateFunction(obj, engineState.physics_time_s);
                isObjectVertPosDataChanged = true;
                // Write vertices to pre-buffer
                let vertex_counter = obj.object_vertex_start_index;
                for (let i_v = 0; i_v < obj.vertices_in_object.length; i_v++) {
                    let v = obj.vertices_in_object[i_v];
                    all_vertices_in_object_data[vertex_counter * 4 + 0] = v.x;
                    all_vertices_in_object_data[vertex_counter * 4 + 1] = v.y;
                    all_vertices_in_object_data[vertex_counter * 4 + 2] = v.z;
                    all_vertices_in_object_data[vertex_counter * 4 + 3] = v.w;
                    // Also update texcoords (animation may shift them, e.g. hit flash)
                    let v_tex = obj.vertices_in_texmap[i_v];
                    vertices1uvlstexData[vertex_counter * 8 + 4] = v_tex.x;
                    vertices1uvlstexData[vertex_counter * 8 + 5] = v_tex.y;
                    vertices1uvlstexData[vertex_counter * 8 + 6] = v_tex.z;
                    // increment counter
                    vertex_counter++;
                }
                isTexcoordsChanged = true;
            }
        }
        if (isTexcoordsChanged) {
            device.queue.writeBuffer(vertices1uvlstexBuffer, 0, vertices1uvlstexData);
        }
        return isObjectVertPosDataChanged;
    }

    function writeObjectVerticesToGPU() {
        device.queue.writeBuffer(allVerticesInObjectBuffer, 0, all_vertices_in_object_data);
    }

    function writeTextureDataToGPU() {
        // Rebuild texture header and data from scene objects, then upload to GPU
        let tex_offset = 0;
        for (let i = 0; i < scene.visibleHyperobjects.length; i++) {
            let obj = scene.visibleHyperobjects[i];
            let sz = obj.texture_info.USIZE * obj.texture_info.VSIZE * obj.texture_info.WSIZE;
            object_texture_header_data[i * 4 + 0] = tex_offset;
            object_texture_header_data[i * 4 + 1] = obj.texture_info.USIZE;
            object_texture_header_data[i * 4 + 2] = obj.texture_info.VSIZE;
            object_texture_header_data[i * 4 + 3] = obj.texture_info.WSIZE;
            tex_offset += sz;
        }
        device.queue.writeBuffer(textureHeaderBuffer, 0, object_texture_header_data);
        if (tex_offset <= global_texture_data.length) {
            let pos = 0;
            for (let i = 0; i < scene.visibleHyperobjects.length; i++) {
                let obj = scene.visibleHyperobjects[i];
                global_texture_data.set(obj.texture, pos);
                pos += obj.texture_info.USIZE * obj.texture_info.VSIZE * obj.texture_info.WSIZE;
            }
            device.queue.writeBuffer(textureBuffer, 0, global_texture_data);
        } else {
            console.warn("Texture data too large for pre-allocated buffer. Increase maxTextureBufferSize.");
        }
        scene.textureUpdatePending = false;
    }

    // --- Fixed timestep physics ---
    let physicsAccumulator = 0;
    let lastPhysicsFrameTime = performance.now();

    // --- Profiling setup ---
    const PROF_HISTORY = 60;
    let profiling_div, prof_history, prof_frame_count, prof_last_frame_time, prof_gpu_ms;
    let prof_accel_stats = null; // latest accel structure utilization stats
    let prof_accel_pending = false; // true while a readback is in flight
    let render_iter = 0;

    // Staging buffers for accel structure readback
    const NUM_CELLS = TILE_RES * TILE_RES * TILE_RES;
    const accelStagingBuffer = device.createBuffer({
        size: NUM_CELLS * 2 * 4, // count + offset per cell, u32 each
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });
    const largeTetrasCountStagingBuffer = device.createBuffer({
        size: 4, // just the counter (first u32)
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });
    const tetraCountsStagingBuffer = device.createBuffer({
        size: 4 * 4, // 4 u32s: [orig_tetras, orig_vertices, additional_tetras, additional_vertices]
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });
    if (PROFILING) {
        profiling_div = document.createElement("div");
        profiling_div.style.position = "fixed";
        profiling_div.style.bottom = "10px";
        profiling_div.style.right = "10px";
        profiling_div.style.backgroundColor = "rgba(0,0,0,0.7)";
        profiling_div.style.padding = "10px";
        profiling_div.style.borderRadius = "5px";
        profiling_div.style.fontSize = "11px";
        profiling_div.style.color = "#0f0";
        profiling_div.style.fontFamily = "monospace";
        profiling_div.style.zIndex = "9999";
        profiling_div.style.whiteSpace = "pre";
        profiling_div.style.pointerEvents = "none";
        document.body.appendChild(profiling_div);
        prof_history = [];
        prof_frame_count = 0;
        prof_last_frame_time = performance.now();
        prof_gpu_ms = 0;
    }

    function render() {
        let t_frame_start, frame_dt, t_dda_cam, t_player, t_cam_gpu, t_verts_gpu, t_animate, t_physics, t_poses_gpu, t_time_gpu;
        if (PROFILING) {
            t_frame_start = performance.now();
            frame_dt = t_frame_start - prof_last_frame_time;
            prof_last_frame_time = t_frame_start;
        }

        // Non-rendering work
        // No need to run this in another thread, because GPU work is already async.
        // When render() loops too fast the GPU.submit just blocks to reduce backpressure.
        // So unless this takes more than ~60ms we are good.

        // Fixed timestep with accumulator
        const now = performance.now();
        const frameTime = (now - lastPhysicsFrameTime) / 1000; // convert to seconds
        lastPhysicsFrameTime = now;
        // Clamp to avoid spiral of death if tab loses focus
        physicsAccumulator += Math.min(frameTime, 0.1);
        let nStepsNeeded = Math.floor(physicsAccumulator / PHYSICS_DT);

        if (engineState.paused) {
            // Drain accumulator without stepping, so time doesn't jump on unpause
            physicsAccumulator = 0;
            nStepsNeeded = 0;
        }

        for (let i = 0; i < nStepsNeeded; i++) { updatePlayerControls(); }
        if (PROFILING) { t_player = performance.now(); }
        let isObjectVertPosDataChanged = false;
        for (let i = 0; i < nStepsNeeded; i++) { isObjectVertPosDataChanged = animateObjects() || isObjectVertPosDataChanged; }
        if (PROFILING) { t_animate = performance.now(); }
        for (let i = 0; i < nStepsNeeded; i++) { physicsStepCPU(); }
        if (PROFILING) { t_physics = performance.now(); }
        physicsAccumulator -= nStepsNeeded * PHYSICS_DT;

        // Schedule Buffer writes
        writeDDACameraPoseToGPU();
        if (PROFILING) { t_dda_cam = performance.now(); }
        writeCameraPoseToGPU();
        if (PROFILING) { t_cam_gpu = performance.now(); }
        if (isObjectVertPosDataChanged) { writeObjectVerticesToGPU(); }
        if (PROFILING) { t_verts_gpu = performance.now(); }
        writeObjectPosesToGPU();
        if (PROFILING) { t_poses_gpu = performance.now(); }
        writePhysicsTimeToGPU();
        if (scene.textureUpdatePending) { writeTextureDataToGPU(); }
        if (PROFILING) { t_time_gpu = performance.now(); }

        // Run all Stages
        const commandEncoder = device.createCommandEncoder();
        const textureView = context.getCurrentTexture().createView();

        // Stage 1: Vertex Shader
        if (true) {
            const computePass = commandEncoder.beginComputePass();
            computePass.setPipeline(stage1Pipeline);
            computePass.setBindGroup(0, stage1BindGroup);
            computePass.setBindGroup(1, stage1ParamsBindGroup);
            const workgroupCount = Math.ceil(all_vertices_in_object_data.length / 64);
            computePass.dispatchWorkgroups(workgroupCount);
            computePass.end();
        }

        // Stage 2.a: Clip tetras against sensor plane
        if (true) {
            // Clear clipping counters
            device.queue.writeBuffer(tetraCountsBuffer, 0, originalTetraCountsBufferData);

            // Run clipping shader
            {
                const computePass = commandEncoder.beginComputePass();
                computePass.setPipeline(stage2aPipeline);
                computePass.setBindGroup(0, stage2aBindGroup);
                computePass.setBindGroup(1, stage2aParamsBindGroup);
                const workgroupCount = Math.ceil(tetras.length / 64);
                computePass.dispatchWorkgroups(workgroupCount);
                computePass.end();
            }
        }

        // Stage 2.0: Clear Counters (Use Compute Shader, NOT writeBuffer for proper sync) ---
        const clearPass = commandEncoder.beginComputePass();
        clearPass.setPipeline(clearPipeline);
        // Clear cell_counts
        clearPass.setBindGroup(0, clearCountsBG);
        clearPass.dispatchWorkgroups(Math.ceil(accelStructureCountsData.length * 2 / 256));
        // Clear cell_write_counters
        clearPass.setBindGroup(0, clearWriteCountsBG);
        clearPass.dispatchWorkgroups(Math.ceil(accelStructureCountsData.length / 256));
        // Clear large tetra count
        clearPass.setBindGroup(0, clearLargeTetraBG);
        clearPass.dispatchWorkgroups(1);
        clearPass.end();

        // Stage 2.1: Accel structure counts
        if (true) {
            const computePass = commandEncoder.beginComputePass();
            computePass.setPipeline(stage2p1Pipeline);
            computePass.setBindGroup(0, stage2p1BindGroup);
            computePass.setBindGroup(1, stage2p1ParamsBindGroup);
            const workgroupCount = Math.ceil(MAX_TOTAL_TETRAS / 64);
            computePass.dispatchWorkgroups(workgroupCount);
            computePass.end();
        }

        function computePrefixSum(commandEncoder, numElements) {
            // Blelloch scan requires power-of-2 size; use padded size for sweep passes
            const paddedSize = 1 << Math.ceil(Math.log2(numElements));
            const numLevels = Math.ceil(Math.log2(paddedSize));
            
            // --- 1. Prepare Data CPU Side ---
            // We calculate all parameters needed for every pass and put them in one array
            const ALIGNED_SIZE = 256;
            // Total steps: Init(1) + Up(numLevels) + Clear(1) + Down(numLevels) + Finalize(1)
            const totalSteps = 1 + numLevels + 1 + numLevels + 1;
            
            // Use a DataView or typed array to write into the buffer
            const uniformData = new Uint8Array(totalSteps * ALIGNED_SIZE);
            const view = new DataView(uniformData.buffer);

            let stepIndex = 0;
            
            // Helper to write params (num_elements, level, 0, 0)
            function addParams(n, l) {
                const offset = stepIndex * ALIGNED_SIZE;
                view.setUint32(offset + 0, n, true); // Little endian
                view.setUint32(offset + 4, l, true);
                view.setUint32(offset + 8, 0, true);
                view.setUint32(offset + 12, 0, true);
                stepIndex++;
                return offset;
            }

            // Generate Offsets
            // Init passes paddedSize as x and numElements as y; sweeps use paddedSize; finalize uses numElements
            const offsetInit = addParams(paddedSize, numElements);

            const offsetsUp = [];
            for (let level = 0; level < numLevels; level++) {
                offsetsUp.push(addParams(paddedSize, level));
            }

            const offsetClear = addParams(paddedSize, 0);

            const offsetsDown = [];
            for (let level = numLevels - 1; level >= 0; level--) {
                offsetsDown.push(addParams(paddedSize, level));
            }

            const offsetFinalize = addParams(numElements, 0);

            // --- 2. Upload Data to GPU ---
            // Write the entire sequence of parameters once
            device.queue.writeBuffer(prefixSumParamsBuffer, 0, uniformData);

            // --- 3. Record Commands with Dynamic Offsets ---
            
            // Init (dispatch over paddedSize to zero-fill padding)
            let pass = commandEncoder.beginComputePass();
            pass.setPipeline(initPipeline);
            pass.setBindGroup(0, prefixSumBindGroup);
            pass.setBindGroup(1, prefixSumParamsBindGroup, [offsetInit]);
            pass.dispatchWorkgroups(Math.ceil(paddedSize / 256));
            pass.end();
            
            // Up-sweep
            for (let i = 0; i < numLevels; i++) {
                const level = i;
                pass = commandEncoder.beginComputePass();
                pass.setPipeline(upsweepPipeline);
                pass.setBindGroup(0, prefixSumBindGroup);
                pass.setBindGroup(1, prefixSumParamsBindGroup, [offsetsUp[i]]);
                const workgroups = Math.ceil(paddedSize / (256 * (1 << (level + 1))));
                pass.dispatchWorkgroups(Math.max(1, workgroups));
                pass.end();
            }
            
            // Clear Root (GPU side)
            pass = commandEncoder.beginComputePass();
            pass.setPipeline(clearRootPipeline);
            pass.setBindGroup(0, prefixSumBindGroup);
            pass.setBindGroup(1, prefixSumParamsBindGroup, [offsetClear]);
            pass.dispatchWorkgroups(1);
            pass.end();
            
            // Down-sweep
            for (let i = 0; i < numLevels; i++) {
                const level = numLevels - 1 - i;
                pass = commandEncoder.beginComputePass();
                pass.setPipeline(downsweepPipeline);
                pass.setBindGroup(0, prefixSumBindGroup);
                pass.setBindGroup(1, prefixSumParamsBindGroup, [offsetsDown[i]]);
                const workgroups = Math.ceil(paddedSize / (256 * (1 << (level + 1))));
                pass.dispatchWorkgroups(Math.max(1, workgroups));
                pass.end();
            }

            // Finalize
            pass = commandEncoder.beginComputePass();
            pass.setPipeline(finalizePipeline);
            pass.setBindGroup(0, prefixSumBindGroup);
            pass.setBindGroup(1, prefixSumParamsBindGroup, [offsetFinalize]);
            pass.dispatchWorkgroups(Math.ceil(numElements / 256));
            pass.end();
        }

        // Stage 2.2: Prefix sum to compute cell offsets
        if (true) {
            computePrefixSum(commandEncoder, TILE_RES * TILE_RES * TILE_RES);
        }

        // Stage 2.3 (Binning - Write Indices) ---
        // populates cellTetraIndicesBuffer with the current frame's data
        const pass3 = commandEncoder.beginComputePass();
        pass3.setPipeline(stage2p3Pipeline);
        pass3.setBindGroup(0, stage2p3BindGroup);
        pass3.setBindGroup(1, stage2p1ParamsBindGroup); // Reusing params
        pass3.dispatchWorkgroups(Math.ceil(MAX_TOTAL_TETRAS / 64));
        pass3.end();

        // Accel structure readback (copy to staging buffers for async map)
        if (PROFILING && !prof_accel_pending) {
            commandEncoder.copyBufferToBuffer(cellCountsAndOffsetsBuffer, 0, accelStagingBuffer, 0, NUM_CELLS * 2 * 4);
            commandEncoder.copyBufferToBuffer(largeTetraBuffer, 0, largeTetrasCountStagingBuffer, 0, 4);
            commandEncoder.copyBufferToBuffer(tetraCountsBuffer, 0, tetraCountsStagingBuffer, 0, 4 * 4);
        }

        // Stage 3: Intersection tests compute pass to update voxel data
        if (true) {
            const computePass = commandEncoder.beginComputePass();
            computePass.setPipeline(stage3Pipeline);
            computePass.setBindGroup(0, stage3BindGroup);
            computePass.setBindGroup(1, stage3ParamsBindGroup);
            const workgroupCount = Math.ceil(VOX / 4);
            computePass.dispatchWorkgroups(workgroupCount, workgroupCount, workgroupCount);
            computePass.end();
        }


        // Stage 4: DDA Render pass
        const stage4Pass = commandEncoder.beginRenderPass({
            colorAttachments: [{
            view: textureView,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
            }],
        });
        stage4Pass.setPipeline(stage4Pipeline);
        stage4Pass.setBindGroup(0, stage4BindGroup);
        stage4Pass.draw(6);
        stage4Pass.end();

        device.queue.submit([commandEncoder.finish()]);

        // Async accel structure readback
        if (PROFILING && !prof_accel_pending) {
            prof_accel_pending = true;
            Promise.all([
                accelStagingBuffer.mapAsync(GPUMapMode.READ),
                largeTetrasCountStagingBuffer.mapAsync(GPUMapMode.READ),
                tetraCountsStagingBuffer.mapAsync(GPUMapMode.READ)
            ]).then(() => {
                const countsAndOffsets = new Uint32Array(accelStagingBuffer.getMappedRange());
                const largeCnt = new Uint32Array(largeTetrasCountStagingBuffer.getMappedRange());
                const tetraCounts = new Uint32Array(tetraCountsStagingBuffer.getMappedRange());

                let nonEmpty = 0;
                let totalEntries = 0;
                let maxCount = 0;
                for (let i = 0; i < NUM_CELLS; i++) {
                    const count = countsAndOffsets[i * 2]; // count is first in struct
                    if (count > 0) nonEmpty++;
                    totalEntries += count;
                    if (count > maxCount) maxCount = count;
                }
                const meanNonEmpty = nonEmpty > 0 ? totalEntries / nonEmpty : 0;

                prof_accel_stats = {
                    nonEmpty,
                    totalCells: NUM_CELLS,
                    occupancy: (nonEmpty / NUM_CELLS * 100),
                    totalEntries,
                    maxDepth: MAX_ACCEL_STRUCTURE_DEPTH,
                    maxCount,
                    meanCount: meanNonEmpty,
                    bufferFill: (totalEntries / MAX_ACCEL_STRUCTURE_SIZE * 100),
                    numLargeTetras: largeCnt[0],
                    // Clipped tetras stats: [orig_tetras, orig_vertices, additional_tetras, additional_vertices]
                    origTetras: tetraCounts[0],
                    origVertices: tetraCounts[1],
                    clippedTetras: tetraCounts[2],
                    clippedVertices: tetraCounts[3],
                };

                accelStagingBuffer.unmap();
                largeTetrasCountStagingBuffer.unmap();
                tetraCountsStagingBuffer.unmap();
                prof_accel_pending = false;
            }).catch(() => {
                prof_accel_pending = false;
            });
        }

        if (PROFILING) {
            const t_encode_end = performance.now();
            const t_submit = t_encode_end; // submit is measured right after

            if (render_iter < 10) {
                console.log(`Frame ${render_iter}: submit ${t_submit}`);    
            }

            // GPU timing: measure when GPU work completes via onSubmittedWorkDone
            const t_gpu_start = performance.now();
            device.queue.onSubmittedWorkDone().then(() => {
                const t_gpu_done = performance.now();
                prof_gpu_ms = t_gpu_done - t_gpu_start;
                if (render_iter < 10) {
                    console.log(`Frame ${render_iter}: done ${t_gpu_done}`);    
                }
            });

            // Collect CPU timings for this frame
            const frame = {
                frameDt: frame_dt,
                total: t_submit - t_frame_start,
                player: t_player - t_frame_start,
                animate: t_animate - t_player,
                physics: t_physics - t_animate,
                ddaCam: t_dda_cam - t_physics,
                camGpu: t_cam_gpu - t_dda_cam,
                vertsGpu: t_verts_gpu - t_cam_gpu,
                posesGpu: t_poses_gpu - t_verts_gpu,
                timeGpu: t_time_gpu - t_poses_gpu,
                encode: t_encode_end - t_time_gpu,
                submit: t_submit - t_encode_end,
            };

            prof_history.push(frame);
            if (prof_history.length > PROF_HISTORY) prof_history.shift();
            prof_frame_count++;

            // Update display every 30 frames
            if (prof_frame_count % 30 === 0 && prof_history.length > 0) {
                const avg = {};
                for (const key of Object.keys(prof_history[0])) {
                    avg[key] = prof_history.reduce((s, f) => s + f[key], 0) / prof_history.length;
                }
                const fps = 1000 / avg.frameDt;
                const pad = (s, n) => s.padEnd(n);
                const fmt = (v) => v.toFixed(2).padStart(6) + " ms";
                let lines = [];
                lines.push(`FPS: ${fps.toFixed(1)}`);
                lines.push(`Sim time: ${engineState.physics_time_s.toFixed(2)} s`);
                lines.push(`${pad("Frame total", 22)} ${fmt(avg.total)}`);
                lines.push(`--- CPU ---`);
                lines.push(`${pad("  Player controls", 22)} ${fmt(avg.player)}`);
                lines.push(`${pad("  Animate objects", 22)} ${fmt(avg.animate)}`);
                lines.push(`${pad("  Physics (CPU)", 22)} ${fmt(avg.physics)}`);
                lines.push(`${pad("  DDA cam write", 22)} ${fmt(avg.ddaCam)}`);
                lines.push(`${pad("  Cam pose write", 22)} ${fmt(avg.camGpu)}`);
                lines.push(`${pad("  Obj verts write", 22)} ${fmt(avg.vertsGpu)}`);
                lines.push(`${pad("  Obj poses write", 22)} ${fmt(avg.posesGpu)}`);
                lines.push(`${pad("  Sim time write", 22)} ${fmt(avg.timeGpu)}`);
                lines.push(`--- GPU cmd encode ---`);
                lines.push(`${pad("  Encode all stages", 22)} ${fmt(avg.encode)}`);
                lines.push(`${pad("  Queue submit", 22)} ${fmt(avg.submit)}`);
                lines.push(`--- GPU (async) ---`);
                lines.push(`${pad("  GPU work done", 22)} ${fmt(prof_gpu_ms)}`);
                if (prof_accel_stats) {
                    const a = prof_accel_stats;
                    lines.push(`--- Accel structure ---`);
                    lines.push(`${pad("  Cells used", 22)} ${String(a.nonEmpty).padStart(6)} / ${a.totalCells} (${a.occupancy.toFixed(1)}%)`);
                    lines.push(`${pad("  Total entries", 22)} ${String(a.totalEntries).padStart(6)} / ${MAX_ACCEL_STRUCTURE_SIZE} (${a.bufferFill.toFixed(1)}%)`);
                    lines.push(`${pad("  Max cell count", 22)} ${String(a.maxCount).padStart(6)}`);
                    lines.push(`${pad("  Mean cell count", 22)} ${a.meanCount.toFixed(1).padStart(6)} / ${MAX_ACCEL_STRUCTURE_DEPTH}`);
                    lines.push(`${pad("  Large tetras", 22)} ${String(a.numLargeTetras).padStart(6)}`);
                    lines.push(`--- Clipped tetras ---`);
                    const totalTetras = a.origTetras + a.clippedTetras;
                    const totalVertices = a.origVertices + a.clippedVertices;
                    const tetraFill = (totalTetras / MAX_TOTAL_TETRAS * 100);
                    const vertexFill = (totalVertices / MAX_TOTAL_VERTICES * 100);
                    lines.push(`${pad("  Tetras", 22)} ${String(totalTetras).padStart(6)} / ${MAX_TOTAL_TETRAS} (${tetraFill.toFixed(1)}%)  [${a.origTetras} + ${a.clippedTetras} clipped]`);
                    lines.push(`${pad("  Vertices", 22)} ${String(totalVertices).padStart(6)} / ${MAX_TOTAL_VERTICES} (${vertexFill.toFixed(1)}%)  [${a.origVertices} + ${a.clippedVertices} clipped]`);
                }
                profiling_div.textContent = lines.join("\n");
            }
        }

        // Schedule next frame
        render_iter = render_iter + 1;
        requestAnimationFrame(render);
    }

    render();
} // end of function runHyperengine()
