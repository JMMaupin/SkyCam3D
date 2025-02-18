let scene, camera, renderer, controls;
let masts = [], ropes = [], spar, mastLabels = [], ground, axesHelper;

const params = {
    masts: [
        { height: 5, x: -5, z: -3 },
        { height: 5, x: 5, z: -3 },
        { height: 5, x: 5, z: 3 },
        { height: 5, x: -5, z: 3 }
    ],
    spar: {
        width: 0.5,
        length: 0.3
    },
    showAxes: false,
};

let dynParams = {
    ropes: [
        { length: 7 },
        { length: 7 },
        { length: 7 },
        { length: 7 }
    ]
};

function init() {
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x999999, 0.05);  // Add fog to the scene with higher density

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;  // Enable shadow maps
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;  // Optional: softer shadows
    document.body.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    camera.position.set(1, 2, 8);  // Adjust the camera position to be lower
    controls.update();  // Update controls before setting the lookAt
    camera.lookAt(new THREE.Vector3(0, 1, 0));  // Make the camera look at (0, 1, 0)

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(3, 20, 10);
    directionalLight.castShadow = true;  // Enable shadows for the light

    // Adjust shadow camera parameters
    directionalLight.shadow.camera.left = -50;  // Increase the size of the shadow camera
    directionalLight.shadow.camera.right = 50;
    directionalLight.shadow.camera.top = 50;
    directionalLight.shadow.camera.bottom = -50;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 200;  // Increase the far distance of the shadow camera
    directionalLight.shadow.mapSize.width = 4096;  // Increase shadow map resolution
    directionalLight.shadow.mapSize.height = 4096; // Increase shadow map resolution

    scene.add(directionalLight);

    axesHelper = new THREE.AxesHelper(1);
    axesHelper.position.y = 0.1;  // Ensure the axes are always above the ground
    scene.add(axesHelper);

    // Add background gradient
    const vertexShader = `
        varying vec3 vWorldPosition;
        void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
    `;

    const fragmentShader = `
        varying vec3 vWorldPosition;
        void main() {
            float h = normalize(vWorldPosition).y;
            float offset = -0.5;  // Adjust this value to lower the median position of the gradient
            vec3 topColor = vec3(0.4, 0.7, 0.98);  // Sky blue
            vec3 bottomColor = vec3(1.0, 0.65, 0.0);  // Orange
            gl_FragColor = vec4(mix(bottomColor, topColor, max(h * 0.5 + 0.5 - offset, 0.0)), 1.0);
        }
    `;

    const gradientMaterial = new THREE.ShaderMaterial({
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        side: THREE.BackSide
    });

    const gradientGeometry = new THREE.SphereGeometry(500, 32, 32);
    const gradientMesh = new THREE.Mesh(gradientGeometry, gradientMaterial);
    scene.add(gradientMesh);
    updateAxesHelper()
    initScene();
    setupGUI();
    animate();
}

function createTextLabel(text, position) {
    const loader = new THREE.FontLoader();
    loader.load('https://threejs.org/examples/fonts/helvetiker_regular.typeface.json', function (font) {
        const textGeometry = new THREE.TextGeometry(text, {
            font: font,
            size: 0.2,
            height: 0.05,
        });
        const textMaterial = new THREE.MeshPhongMaterial({ color: 0xffffff });
        const textMesh = new THREE.Mesh(textGeometry, textMaterial);
        textMesh.position.copy(position);
        scene.add(textMesh);
        mastLabels.push(textMesh);
    });
}

function removeTextLabels() {
    mastLabels.forEach(label => scene.remove(label));
    mastLabels = [];
}

function initScene() {
    masts.forEach(mast => scene.remove(mast));
    ropes.forEach(rope => scene.remove(rope));
    removeTextLabels();
    if (spar) scene.remove(spar);
    if (ground) scene.remove(ground);

    const mastGeometry = new THREE.CylinderGeometry(0.1, 0.1, 1, 8);
    const mastMaterial = new THREE.MeshPhongMaterial({ color: 0x808080 });

    masts = [];
    for (let i = 0; i < 4; i++) {
        const mast = new THREE.Mesh(mastGeometry, mastMaterial);
        mast.castShadow = true;  // Enable shadows for the masts
        mast.receiveShadow = true;  // Enable receiving shadows for the masts
        masts.push(mast);
        scene.add(mast);
    }

    const ropeMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
    ropes = [];
    for (let i = 0; i < 4; i++) {
        const ropeGeometry = new THREE.BufferGeometry();
        ropes[i] = new THREE.Line(ropeGeometry, ropeMaterial);
        ropes[i].castShadow = true;  // Enable shadows for the ropes
        scene.add(ropes[i]);
    }

    const rectangleGeometry = new THREE.PlaneGeometry(params.spar.width, params.spar.length);
    const rectangleMaterial = new THREE.MeshPhongMaterial({ color: 0x00ff00, side: THREE.DoubleSide });
    spar = new THREE.Mesh(rectangleGeometry, rectangleMaterial);
    spar.rotation.x = Math.PI / 2;  // Rotate to make it horizontal
    spar.castShadow = true;  // Enable shadows for the rectangle
    scene.add(spar);

    updateGeometry();
}

function calculateCentralPosition() {
    const mastTops = masts.map(mast => {
        return new THREE.Vector3(
            mast.position.x,
            mast.position.y + mast.scale.y / 2,
            mast.position.z
        );
    });

    let bestPosition = new THREE.Vector3(0, 0, 0);
    let minError = Infinity;
    const learningRate = 0.1;

    // Algorithme d'optimisation par gradient
    for (let iter = 0; iter < 100; iter++) {
        let totalError = 0;
        const gradient = new THREE.Vector3();

        mastTops.forEach((mastTop, i) => {
            const vecToPoint = bestPosition.clone().sub(mastTop);
            const currentDistance = vecToPoint.length();
            const targetDistance = dynParams.ropes[i].length;

            const error = currentDistance - targetDistance;
            totalError += Math.abs(error);

            if (currentDistance > 0) {
                const direction = vecToPoint.normalize();
                gradient.add(direction.multiplyScalar(error));
            }
        });

        bestPosition.sub(gradient.multiplyScalar(learningRate));

        if (totalError < 0.01) break;
    }

    return bestPosition;
}

function updateGround() {
    if (ground) scene.remove(ground);

    // Calculate the bounding box of the masts
    const minX = Math.min(...params.masts.map(mast => mast.x));
    const maxX = Math.max(...params.masts.map(mast => mast.x));
    const minZ = Math.min(...params.masts.map(mast => mast.z));
    const maxZ = Math.max(...params.masts.map(mast => mast.z));

    // Calculate the width and depth of the ground with a 20% margin
    const groundWidth = (maxX - minX) * 1.2;
    const groundDepth = (maxZ - minZ) * 1.2;

    // Calculate the center position of the ground
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;

    const groundGeometry = new THREE.PlaneGeometry(groundWidth, groundDepth);
    const groundMaterial = new THREE.MeshPhongMaterial({ color: 0x707070, side: THREE.DoubleSide });
    ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(centerX, 0, centerZ);  // Center the ground
    ground.receiveShadow = true;  // Enable receiving shadows for the ground
    scene.add(ground);
}

function updateGeometry() {
    const positions = params.masts.map(mast => [mast.x, mast.height / 2, mast.z]);

    masts.forEach((mast, i) => {
        mast.position.set(positions[i][0], positions[i][1], positions[i][2]);
        mast.scale.y = params.masts[i].height;
    });

    removeTextLabels();
    masts.forEach((mast, i) => {
        createTextLabel(`${i + 1}`, new THREE.Vector3(mast.position.x-0.05, mast.position.y-0.05 + mast.scale.y / 2 + 0.1, mast.position.z-0.05));
    });

    const newPosition = calculateCentralPosition();
    spar.position.copy(newPosition);

    const rectangleHalfWidth = params.spar.width / 2;  // Use parameter for size
    const rectangleHalfDepth = params.spar.length / 2;  // Use parameter for size

    const rectangleCorners = [
        new THREE.Vector3(newPosition.x - rectangleHalfWidth, newPosition.y, newPosition.z - rectangleHalfDepth),
        new THREE.Vector3(newPosition.x + rectangleHalfWidth, newPosition.y, newPosition.z - rectangleHalfDepth),
        new THREE.Vector3(newPosition.x + rectangleHalfWidth, newPosition.y, newPosition.z + rectangleHalfDepth),
        new THREE.Vector3(newPosition.x - rectangleHalfWidth, newPosition.y, newPosition.z + rectangleHalfDepth)
    ];

    ropes.forEach((rope, i) => {
        const mastTop = new THREE.Vector3(
            masts[i].position.x,
            masts[i].position.y + masts[i].scale.y / 2,
            masts[i].position.z
        );

        const points = [mastTop, rectangleCorners[i]];
        rope.geometry.setFromPoints(points);
        rope.geometry.attributes.position.needsUpdate = true;
    });

    updateGround();
}

function updateAxesHelper() {
    axesHelper.visible = params.showAxes;
}

function setupGUI() {
    const gui = new dat.GUI();

    const mastFolder = gui.addFolder('Mast Height');
    params.masts.forEach((mast, i) => {
        mastFolder.add(mast, 'height', 1, 10).name(`Mast ${i + 1}`).onChange(updateGeometry);
    });

    const positionFolder = gui.addFolder('Mast positions');
    params.masts.forEach((mast, i) => {
        positionFolder.add(mast, 'x', -10, 10).name(`Mast ${i + 1} X`).onChange(updateGeometry);
        positionFolder.add(mast, 'z', -10, 10).name(`Mast ${i + 1} Z`).onChange(updateGeometry);
    });

    const ropeFolder = gui.addFolder('Ropes Length');
    dynParams.ropes.forEach((rope, i) => {
        ropeFolder.add(rope, 'length', 1, 10).name(`Rope ${i + 1}`).onChange(() => {
            updateGeometry();
        });
    });
    ropeFolder.open();
    const sparFolder = gui.addFolder('Spar');
        sparFolder.add(params.spar, 'width', 0.1, 1).name('Width').onChange(() => {
            spar.geometry.dispose();
            spar.geometry = new THREE.PlaneGeometry(params.spar.width, params.spar.length);
            updateGeometry();
        });
        sparFolder.add(params.spar, 'length', 0.1, 1).name('Length').onChange(() => {
            spar.geometry.dispose();
            spar.geometry = new THREE.PlaneGeometry(params.spar.width, params.spar.length);
            updateGeometry();
        });

    gui.add(params, 'showAxes').name('show Axes').onChange(updateAxesHelper);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

init();