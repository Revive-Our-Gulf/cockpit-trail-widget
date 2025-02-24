const canvas = document.getElementById('mapCanvas');
const ctx = canvas.getContext('2d');
const positionDisplay = document.getElementById('currentPos');
const mapContainer = document.getElementById('mapContainer');

// State variables
let trail = []; // Store absolute lat/lon positions
let firstPoint = null;
let currentHeading = 0;
let currentPosition = { lat: null, lon: null };
let targets = []; // Array to store multiple targets
let activeTargetIndex = -1; // Currently selected target

// Constants
const MIN_DISTANCE = 0.5;  // meters
const MAX_TRAIL_POINTS = 100;
const EARTH_RADIUS = 111320; // meters per degree at equator
const BASE_SCALE = 10; // Base scale for metersToPixels

// Visual settings
const COLORS = {
    arrow: 'blue',
    trail: 'red',
    target: 'limegreen',
    targetLine: 'lightgrey'
};

// MAVLink variables
const VARS = {
    lat: 'GLOBAL_POSITION_INT/lat',
    lon: 'GLOBAL_POSITION_INT/lon',
    hdg: 'GLOBAL_POSITION_INT/hdg'
};

const LINES = {
    trail: 2,
    target: 3,
    targetLine: 1
};

// Transformation variables for pan & zoom
let scale = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let startPan = { x: 0, y: 0 };

function resizeCanvas() {
    canvas.width = mapContainer.clientWidth;
    canvas.height = mapContainer.clientHeight;
    draw();
}

resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Coordinate conversion functions
function latLonToMeters(lat, lon, refLat, refLon) {
    const latMeters = (lat - refLat) * EARTH_RADIUS;
    const lonMeters = (lon - refLon) * EARTH_RADIUS * Math.cos((refLat * Math.PI) / 180);
    return { x: lonMeters, y: -latMeters };
}

function metersToPixels(meters, scaleFactor = BASE_SCALE) {
    return meters * scaleFactor;
}

// Converts world (meters) coordinates to screen coordinates.
function worldToScreen(meters) {
    return {
        x: canvas.width / 2 + panX + metersToPixels(meters.x) * scale,
        y: canvas.height / 2 + panY + metersToPixels(meters.y) * scale
    };
}

function calculateLatLonDistance(pos1, pos2) {
    const meters = latLonToMeters(pos1.lat, pos1.lon, pos2.lat, pos2.lon);
    return Math.sqrt(meters.x * meters.x + meters.y * meters.y);
}

// ------------------ Cookie Persistence Functions ------------------ //

// Sets a cookie with a name, value and expiration in days.
function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    const expires = "expires=" + d.toUTCString();
    document.cookie = name + "=" + encodeURIComponent(value) + ";" + expires + ";path=/";
}

// Gets a cookie value by its name.
function getCookie(name) {
    const cname = name + "=";
    const decodedCookie = decodeURIComponent(document.cookie);
    const ca = decodedCookie.split(';');
    for (let c of ca) {
        while (c.charAt(0) === ' ') { c = c.substring(1); }
        if (c.indexOf(cname) === 0) {
            return c.substring(cname.length, c.length);
        }
    }
    return "";
}

// ------------------ Target Persistence using Cookies ------------------ //

function loadTargets() {
    const cookieVal = getCookie('cockpit-trail-widget-targets');
    if (cookieVal) {
        try {
            targets = JSON.parse(cookieVal);
            // If there are any targets, automatically select the first target
            if (targets && targets.length > 0) {
                activeTargetIndex = 0;
                const container = document.getElementById('addedTargetsContainer');
                container.innerHTML = '';
                targets.forEach((target, index) => {
                    createTargetEntry(index);
                });
            }
        } catch (e) {
            console.error('Error parsing targets cookie', e);
        }
    }
}

function saveTargets() {
    setCookie('cockpit-trail-widget-targets', JSON.stringify(targets), 365);
}

// ------------------ Target Management Functions ------------------ //

// Creates an entry for a target using the persistent new-target style.
function createTargetEntry(index) {
    const inputGroup = document.createElement('div');
    inputGroup.className = 'target-input-group';
    inputGroup.dataset.index = index;
    inputGroup.innerHTML = `
        <div class="target-entry" style="display: flex; align-items: center;">
            <div class="reorder-controls" style="margin-right: 5px;">
                <button type="button" class="v-btn v-btn--icon v-theme--dark v-btn--density-compact v-btn--size-small v-btn--variant-text reorder-up">
                    <i class="mdi-arrow-up mdi v-icon notranslate v-theme--dark v-icon--size-default"></i>
                </button>
                <button type="button" class="v-btn v-btn--icon v-theme--dark v-btn--density-compact v-btn--size-small v-btn--variant-text reorder-down">
                    <i class="mdi-arrow-down mdi v-icon notranslate v-theme--dark v-icon--size-default"></i>
                </button>
            </div>
            <div class="v-input v-input--horizontal v-input--center-affix v-input--density-compact v-theme--light v-text-field" style="flex-grow: 1;">
                <div class="v-input__control">
                    <div class="v-field v-field--active v-field--center-affix v-field--variant-outlined v-theme--light">
                        <div class="v-field__overlay"></div>
                        <div class="v-field__field" data-no-activator>
                            <label class="v-label v-field-label">Target ${index + 1}</label>
                            <input type="text" class="v-field__input targetCoords">
                        </div>
                        <div class="v-field__outline">
                            <div class="v-field__outline__start"></div>
                            <div class="v-field__outline__notch">
                                <label class="v-label v-field-label v-field-label--floating">Target ${index + 1}</label>
                            </div>
                            <div class="v-field__outline__end"></div>
                        </div>
                    </div>
                </div>
            </div>
            <button type="button" class="v-btn v-btn--icon v-theme--dark v-btn--density-compact v-btn--size-default v-btn--variant-text select-target">
                <i class="mdi-target mdi v-icon notranslate v-theme--dark v-icon--size-default"></i>
            </button>
            <button type="button" class="v-btn v-btn--icon v-theme--dark v-btn--density-compact v-btn--size-default v-btn--variant-text remove-target">
                <i class="mdi-close mdi v-icon notranslate v-theme--dark v-icon--size-default"></i>
            </button>
        </div>
    `;
    // Set initial target coordinates in the input field.
    const targetInput = inputGroup.querySelector('.targetCoords');
    targetInput.value = `${targets[index].lat}, ${targets[index].lon}`;

    // Allow updating the target on Enter key press.
    targetInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            const value = targetInput.value;
            const coords = value.split(',');
            if (coords.length !== 2) {
                console.log('Invalid coordinate format. Use lat,lon');
                return;
            }
            const lat = parseFloat(coords[0].trim());
            const lon = parseFloat(coords[1].trim());
            if (isNaN(lat) || isNaN(lon)) {
                console.log('Invalid coordinates');
                return;
            }
            targets[index] = { lat, lon };
            targetInput.value = `${lat}, ${lon}`;
            draw();
            saveTargets();
        }
    });

    // Setup reorder buttons.
    const upBtn = inputGroup.querySelector('.reorder-up');
    const downBtn = inputGroup.querySelector('.reorder-down');
    upBtn.addEventListener('click', () => {
        if (index > 0) {
            [targets[index - 1], targets[index]] = [targets[index], targets[index - 1]];
            compactTargets();
            draw();
            saveTargets();
        }
    });
    downBtn.addEventListener('click', () => {
        if (index < targets.length - 1) {
            [targets[index], targets[index + 1]] = [targets[index + 1], targets[index]];
            compactTargets();
            draw();
            saveTargets();
        }
    });

    document.getElementById('addedTargetsContainer').appendChild(inputGroup);
    setupTargetEntryListeners(inputGroup, index);
}

function setupTargetEntryListeners(inputGroup, index) {
    const selectBtn = inputGroup.querySelector('.select-target');
    const removeBtn = inputGroup.querySelector('.remove-target');
    selectBtn.addEventListener('click', () => {
        activeTargetIndex = index;
        draw();
    });
    removeBtn.addEventListener('click', () => {
        targets.splice(index, 1);
        compactTargets();
        draw();
        saveTargets();
    });
}

function compactTargets() {
    targets = targets.filter(target => target !== null);
    const container = document.getElementById('addedTargetsContainer');
    container.innerHTML = '';
    targets.forEach((target, index) => {
        createTargetEntry(index);
        const targetSpan = container.querySelector(`.target-input-group[data-index="${index}"] .targetCoords`);
        if (targetSpan) {
            targetSpan.textContent = `${target.lat}, ${target.lon}`;
        }
    });
    if (activeTargetIndex !== -1) {
        activeTargetIndex = targets.findIndex((target, i) => i === activeTargetIndex);
    }
}

function setupNewTargetInput() {
    const newTargetGroup = document.getElementById('newTargetInput');
    const input = newTargetGroup.querySelector('.newTargetCoords');
    const addBtn = newTargetGroup.querySelector('.add-new-target');
    const submitNewTarget = () => {
        const value = input.value;
        const coords = value.split(',');
        if (coords.length !== 2) {
            console.log('Invalid coordinate format. Use lat,lon');
            return;
        }
        const lat = parseFloat(coords[0].trim());
        const lon = parseFloat(coords[1].trim());
        if (isNaN(lat) || isNaN(lon)) {
            console.log('Invalid coordinates');
            return;
        }
        const newIndex = targets.length;
        targets.push({ lat, lon });
        createTargetEntry(newIndex);
        activeTargetIndex = newIndex;
        draw();
        input.value = '';
        saveTargets();
    };
    addBtn.addEventListener('click', submitNewTarget);
    input.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            submitNewTarget();
        }
    });
}

// Initialize persistent new target input on startup and load any saved targets.
setupNewTargetInput();
loadTargets();

// ------------------ Drawing Functions ------------------ //

function drawROVIcon(x, y, heading) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading * (Math.PI / 180));
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(10, 10);
    ctx.lineTo(0, 5);
    ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fillStyle = 'white';
    ctx.fill();
    ctx.restore();
}

function drawROV() {
    if (!firstPoint || !currentPosition.lat || !currentPosition.lon) return;
    const meters = latLonToMeters(currentPosition.lat, currentPosition.lon, firstPoint.lat, firstPoint.lon);
    const pixels = worldToScreen(meters);
    drawROVIcon(pixels.x, pixels.y, currentHeading);
}

function drawTrailPath() {
    if (!firstPoint || trail.length < 2) return;
    ctx.strokeStyle = COLORS.trail;
    ctx.lineWidth = LINES.trail;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    trail.forEach((point, index) => {
        const meters = latLonToMeters(point.lat, point.lon, firstPoint.lat, firstPoint.lon);
        const pixels = worldToScreen(meters);
        if (index === 0) {
            ctx.moveTo(pixels.x, pixels.y);
        } else {
            ctx.lineTo(pixels.x, pixels.y);
        }
    });
    ctx.stroke();
}

function drawTarget() {
    if (!firstPoint || !targets.length || !currentPosition.lat || !currentPosition.lon) return;
    ctx.beginPath();
    ctx.strokeStyle = '#999999';
    ctx.lineWidth = LINES.targetLine;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 10;
    targets.forEach((target, index) => {
        if (!target) return;
        const targetMeters = latLonToMeters(target.lat, target.lon, firstPoint.lat, firstPoint.lon);
        const targetPixels = worldToScreen(targetMeters);
        if (index > 0 && targets[index - 1]) {
            const prevMeters = latLonToMeters(targets[index - 1].lat, targets[index - 1].lon, firstPoint.lat, firstPoint.lon);
            const prevPixels = worldToScreen(prevMeters);
            ctx.moveTo(prevPixels.x, prevPixels.y);
            ctx.lineTo(targetPixels.x, targetPixels.y);
        }
    });
    ctx.stroke();
    if (activeTargetIndex !== -1 && targets[activeTargetIndex]) {
        const target = targets[activeTargetIndex];
        const targetMeters = latLonToMeters(target.lat, target.lon, firstPoint.lat, firstPoint.lon);
        const targetPixels = worldToScreen(targetMeters);
        const currentMeters = latLonToMeters(currentPosition.lat, currentPosition.lon, firstPoint.lat, firstPoint.lon);
        const currentPixels = worldToScreen(currentMeters);
        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.moveTo(currentPixels.x, currentPixels.y);
        ctx.lineTo(targetPixels.x, targetPixels.y);
        ctx.strokeStyle = COLORS.targetLine;
        ctx.lineWidth = LINES.targetLine;
        ctx.stroke();
        ctx.setLineDash([]);
        const midX = (currentPixels.x + targetPixels.x) / 2;
        const midY = (currentPixels.y + targetPixels.y) / 2;
        const distanceMeters = calculateLatLonDistance(currentPosition, target);
        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText(distanceMeters.toFixed(0) + ' m', midX, midY);
    }
    targets.forEach((target, index) => {
        if (!target) return;
        const targetMeters = latLonToMeters(target.lat, target.lon, firstPoint.lat, firstPoint.lon);
        const targetPixels = worldToScreen(targetMeters);
        ctx.beginPath();
        const size = 8;
        ctx.moveTo(targetPixels.x - size, targetPixels.y - size);
        ctx.lineTo(targetPixels.x + size, targetPixels.y + size);
        ctx.moveTo(targetPixels.x + size, targetPixels.y - size);
        ctx.lineTo(targetPixels.x - size, targetPixels.y + size);
        ctx.strokeStyle = index === activeTargetIndex ? COLORS.target : '#999999';
        ctx.lineWidth = LINES.target;
        ctx.stroke();
    });
}

function getGridSpacing() {
    const candidateSteps = [1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
    const minPixelSpacing = 40;
    const effectiveScale = BASE_SCALE * scale;
    for (let step of candidateSteps) {
        if (step * effectiveScale >= minPixelSpacing) {
            return step;
        }
    }
    return candidateSteps[candidateSteps.length - 1];
}

function drawGrid() {
    if (!firstPoint) return;
    const gridSpacing = getGridSpacing();
    const effectiveMultiplier = BASE_SCALE * scale;
    const leftMeters = (0 - canvas.width / 2 - panX) / effectiveMultiplier;
    const rightMeters = (canvas.width - canvas.width / 2 - panX) / effectiveMultiplier;
    const topMeters = (0 - canvas.height / 2 - panY) / effectiveMultiplier;
    const bottomMeters = (canvas.height - canvas.height / 2 - panY) / effectiveMultiplier;
    ctx.beginPath();
    ctx.strokeStyle = "rgba(68, 68, 68, 0.2)";
    ctx.lineWidth = 1;
    const startX = Math.floor(leftMeters / gridSpacing) * gridSpacing;
    const endX = Math.ceil(rightMeters / gridSpacing) * gridSpacing;
    for (let x = startX; x <= endX; x += gridSpacing) {
        const startPoint = worldToScreen({ x: x, y: topMeters });
        const endPoint = worldToScreen({ x: x, y: bottomMeters });
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(endPoint.x, endPoint.y);
    }
    const startY = Math.floor(topMeters / gridSpacing) * gridSpacing;
    const endY = Math.ceil(bottomMeters / gridSpacing) * gridSpacing;
    for (let y = startY; y <= endY; y += gridSpacing) {
        const startPoint = worldToScreen({ x: leftMeters, y: y });
        const endPoint = worldToScreen({ x: rightMeters, y: y });
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(endPoint.x, endPoint.y);
    }
    ctx.stroke();
}

function drawScaleIndicator() {
    const gridSpacing = getGridSpacing();
    const effectiveMultiplier = BASE_SCALE * scale;
    const lineWidth = gridSpacing * effectiveMultiplier;
    const margin = 10;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const x = margin;
    const y = canvas.height - margin;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + lineWidth, y);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    ctx.moveTo(x + lineWidth, y - 5);
    ctx.lineTo(x + lineWidth, y + 5);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(gridSpacing + " m", x + lineWidth / 2, y - 5);
    ctx.restore();
}

function draw() {
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    drawTrailPath();
    drawTarget();
    drawROV();
    ctx.restore();
    drawScaleIndicator();
}

// ------------------ User Interaction ------------------ //

// Panning
canvas.addEventListener('mousedown', (e) => {
    isPanning = true;
    startPan.x = e.clientX;
    startPan.y = e.clientY;
});
canvas.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    const dx = e.clientX - startPan.x;
    const dy = e.clientY - startPan.y;
    panX += dx;
    panY += dy;
    startPan.x = e.clientX;
    startPan.y = e.clientY;
    draw();
});
canvas.addEventListener('mouseup', () => { isPanning = false; });
canvas.addEventListener('mouseleave', () => { isPanning = false; });

// Zooming via mouse wheel.
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = 1.1;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const sceneX = (mouseX - canvas.width / 2 - panX) / scale;
    const sceneY = (mouseY - canvas.height / 2 - panY) / scale;
    if (e.deltaY < 0) {
        scale *= zoomFactor;
    } else {
        scale /= zoomFactor;
    }
    panX = mouseX - canvas.width / 2 - sceneX * scale;
    panY = mouseY - canvas.height / 2 - sceneY * scale;
    draw();
});

// ------------------ MAVLink & Position Updates ------------------ //

function handleLatitude() {
    const lat = window.cockpit.getDataLakeVariableData(VARS.lat) / 1e7;
    if (lat === undefined) return;
    currentPosition.lat = lat;
    updatePosition();
}

function handleLongitude() {
    const lon = window.cockpit.getDataLakeVariableData(VARS.lon) / 1e7;
    if (lon === undefined) return;
    currentPosition.lon = lon;
    updatePosition();
}

function handleHeading() {
    const heading = window.cockpit.getDataLakeVariableData(VARS.hdg) / 100;
    if (heading === undefined) return;
    currentHeading = heading;
}

function updatePosition() {
    if (!currentPosition.lat || !currentPosition.lon) return;
    const { lat, lon } = currentPosition;
    if (!firstPoint) { firstPoint = { lat, lon }; }
    if (trail.length === 0 || calculateLatLonDistance({ lat, lon }, trail[trail.length - 1]) >= MIN_DISTANCE) {
        trail.push({ lat, lon });
        if (trail.length > MAX_TRAIL_POINTS) trail.shift();
    }
    positionDisplay.innerText = `ROV: ${lat.toFixed(7)}°, ${lon.toFixed(7)}°`;
}

// ------------------ MAVLink Listeners ------------------ //

window.cockpit.listenDataLakeVariable(VARS.lat, handleLatitude);
window.cockpit.listenDataLakeVariable(VARS.lon, handleLongitude);
window.cockpit.listenDataLakeVariable(VARS.hdg, handleHeading);

// Initial draw
setInterval(draw, 1000 / 4);

document.getElementById('toggleTargetContainer').addEventListener('click', () => {
    const targetContainer = document.getElementById('targetContainer');
    targetContainer.style.display = (targetContainer.style.display === 'none') ? 'block' : 'none';
    resizeCanvas();
});

function clearTrail() {
    trail = [];
    draw();
}

document.getElementById('clearTrail').addEventListener('click', clearTrail);