// Canvas setup
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
}

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

function calculateLatLonDistance(pos1, pos2) {
    const meters = latLonToMeters(pos1.lat, pos1.lon, pos2.lat, pos2.lon);
    return Math.sqrt(meters.x * meters.x + meters.y * meters.y);
}

// --------- Target Management Functions --------- //

// Creates an entry for a target using the persistent new-target style.
// The target's coordinates are shown within a span rather than in an editable input.
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
    
    // Allow the user to update the target value on Enter key press.
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
            // Update the underlying targets array.
            targets[index] = { lat, lon };
            targetInput.value = `${lat}, ${lon}`;
            draw();
        }
    });
    
    // Setup reorder buttons.
    const upBtn = inputGroup.querySelector('.reorder-up');
    const downBtn = inputGroup.querySelector('.reorder-down');
    upBtn.addEventListener('click', () => {
        if (index > 0) {
            // Swap with the previous target.
            [targets[index - 1], targets[index]] = [targets[index], targets[index - 1]];
            compactTargets();
            draw();
        }
    });
    downBtn.addEventListener('click', () => {
        if (index < targets.length - 1) {
            // Swap with the next target.
            [targets[index], targets[index + 1]] = [targets[index + 1], targets[index]];
            compactTargets();
            draw();
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
    });
}

// Rebuilds the target entries after a deletion or modification.
function compactTargets() {
    // Remove any null values and rebuild the array.
    targets = targets.filter(target => target !== null);
    
    const container = document.getElementById('addedTargetsContainer');
    container.innerHTML = ''; // Clear existing entries

    targets.forEach((target, index) => {
        createTargetEntry(index);
        // Restore the target coordinates in the span element
        const targetSpan = container.querySelector(`.target-input-group[data-index="${index}"] .targetCoords`);
        if (targetSpan) {
            targetSpan.textContent = `${target.lat}, ${target.lon}`;
        }
    });

    // Update active target index if needed.
    if (activeTargetIndex !== -1) {
        activeTargetIndex = targets.findIndex((target, i) => i === activeTargetIndex);
    }
}

// Setup the persistent "New Target" input handling.
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
        // Append new target and update display.
        const newIndex = targets.length;
        targets.push({ lat, lon });
        createTargetEntry(newIndex);
        activeTargetIndex = newIndex;
        draw();
        input.value = '';
    };

    addBtn.addEventListener('click', submitNewTarget);
    input.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            submitNewTarget();
        }
    });
}

// Initialize persistent new target input on startup.
setupNewTargetInput();

// --------- Drawing Functions --------- //

function drawROVIcon(x, y, heading) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(heading * (Math.PI / 180));

    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 30;

    // Draw a single arrow shape
    ctx.beginPath();
    ctx.moveTo(0, -10); // Top vertex
    ctx.lineTo(10, 10); // Bottom right vertex
    ctx.lineTo(0, 5); // Middle bottom vertex
    ctx.lineTo(-10, 10); // Bottom left vertex
    ctx.closePath();
    ctx.fillStyle = 'white';
    ctx.fill();

    ctx.restore();
}

function drawROV() {
    if (!firstPoint || !currentPosition.lat || !currentPosition.lon) return;

    const meters = latLonToMeters(currentPosition.lat, currentPosition.lon, firstPoint.lat, firstPoint.lon);
    const pixels = {
        x: metersToPixels(meters.x),
        y: metersToPixels(meters.y)
    };
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
        const pixels = {
            x: metersToPixels(meters.x),
            y: metersToPixels(meters.y)
        };
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
    
    // Draw connecting lines between targets
    ctx.beginPath();
    ctx.strokeStyle = '#999999';
    ctx.lineWidth = LINES.targetLine;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 10;
    
    targets.forEach((target, index) => {
        if (!target) return;
        const targetMeters = latLonToMeters(target.lat, target.lon, firstPoint.lat, firstPoint.lon);
        const targetPixels = {
            x: metersToPixels(targetMeters.x),
            y: metersToPixels(targetMeters.y)
        };

        if (index > 0 && targets[index - 1]) {
            const prevMeters = latLonToMeters(targets[index - 1].lat, targets[index - 1].lon, firstPoint.lat, firstPoint.lon);
            const prevPixels = {
                x: metersToPixels(prevMeters.x),
                y: metersToPixels(prevMeters.y)
            };
            ctx.moveTo(prevPixels.x, prevPixels.y);
            ctx.lineTo(targetPixels.x, targetPixels.y);
        }
    });
    ctx.stroke();

    // Draw dotted line to active target if selected.
    if (activeTargetIndex !== -1 && targets[activeTargetIndex]) {
        const target = targets[activeTargetIndex];
        const targetMeters = latLonToMeters(target.lat, target.lon, firstPoint.lat, firstPoint.lon);
        const targetPixels = {
            x: metersToPixels(targetMeters.x),
            y: metersToPixels(targetMeters.y)
        };
        const currentMeters = latLonToMeters(currentPosition.lat, currentPosition.lon, firstPoint.lat, firstPoint.lon);
        const currentPixels = {
            x: metersToPixels(currentMeters.x),
            y: metersToPixels(currentMeters.y)
        };
        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.moveTo(currentPixels.x, currentPixels.y);
        ctx.lineTo(targetPixels.x, targetPixels.y);
        ctx.strokeStyle = COLORS.targetLine;
        ctx.lineWidth = LINES.targetLine;
        ctx.stroke();
        ctx.setLineDash([]);

        // Calculate midpoint and the distance between current position and target.
        const midX = (currentPixels.x + targetPixels.x) / 2;
        const midY = (currentPixels.y + targetPixels.y) / 2;
        const distanceMeters = calculateLatLonDistance(currentPosition, target);

        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.fillText(distanceMeters.toFixed(0) + ' m', midX, midY);
    }
    
    // Draw all target markers.
    targets.forEach((target, index) => {
        if (!target) return;
        const targetMeters = latLonToMeters(target.lat, target.lon, firstPoint.lat, firstPoint.lon);
        const targetPixels = {
            x: metersToPixels(targetMeters.x),
            y: metersToPixels(targetMeters.y)
        };

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

// Updated draw() to include pan & zoom transforms.
function draw() {
    ctx.save();
    // Clear the entire canvas.
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Translate to canvas center, add panning and scaling.
    ctx.translate(canvas.width / 2 + panX, canvas.height / 2 + panY);
    ctx.scale(scale, scale);
    
    drawTrailPath();
    drawTarget();
    drawROV();
    
    ctx.restore();
}

// --------- User Interaction: Panning & Zooming --------- //

// Handle panning via mouse drag.
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
canvas.addEventListener('mouseup', () => {
    isPanning = false;
});
canvas.addEventListener('mouseleave', () => {
    isPanning = false;
});

// Handle zooming via mouse wheel.
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = 1.1;
    // Get mouse position relative to canvas.
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Convert mouse coordinates to scene coordinates.
    const sceneX = (mouseX - canvas.width / 2 - panX) / scale;
    const sceneY = (mouseY - canvas.height / 2 - panY) / scale;
    
    // Adjust scale
    if (e.deltaY < 0) {
        scale *= zoomFactor;
    } else {
        scale /= zoomFactor;
    }
    
    // Adjust pan to keep mouse position stable.
    panX = mouseX - canvas.width / 2 - sceneX * scale;
    panY = mouseY - canvas.height / 2 - sceneY * scale;
    
    draw();
});

// --------- MAVLink & Position Updates --------- //

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

    if (!firstPoint) {
        firstPoint = { lat, lon };
    }

    if (trail.length === 0 || calculateLatLonDistance({ lat, lon }, trail[trail.length - 1]) >= MIN_DISTANCE) {
        trail.push({ lat, lon });
        if (trail.length > MAX_TRAIL_POINTS) trail.shift();
    }

    positionDisplay.innerText = `ROV: ${lat.toFixed(7)}°, ${lon.toFixed(7)}°`;
}

// --------- MAVLink Listeners --------- //

window.cockpit.listenDataLakeVariable(VARS.lat, handleLatitude);
window.cockpit.listenDataLakeVariable(VARS.lon, handleLongitude);
window.cockpit.listenDataLakeVariable(VARS.hdg, handleHeading);

// Initial draw
setInterval(draw, 1000 / 4);

document.getElementById('toggleTargetContainer').addEventListener('click', function () {
    const targetContainer = document.getElementById('targetContainer');

    targetContainer.style.display = (targetContainer.style.display === 'none') ? 'block' : 'none';

    resizeCanvas();
});