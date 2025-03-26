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

// Only keep zoom factor, no panning as ROV will stay centered
let scale = 1;

// Grid origin - fixed point in the world to anchor the grid
let gridOrigin = { lat: null, lon: null };
// Grid shift - track accumulated ROV movement to shift grid
let gridOffset = { x: 0, y: 0 };
// Last position - track ROV movement between updates
let lastPosition = { lat: null, lon: null };

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

// Updated worldToScreen to always keep ROV at center
function worldToScreen(meters) {
    return {
        x: canvas.width / 2 + metersToPixels(meters.x) * scale,
        y: canvas.height / 2 + metersToPixels(meters.y) * scale
    };
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

function drawROVIcon(x, y) {
    ctx.save();
    ctx.translate(x, y);
    // No rotation - ROV always points up

    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 30;

    // Draw a single arrow shape with constant dimensions (pointing up)
    ctx.beginPath();
    ctx.moveTo(0, -10); // Top vertex
    ctx.lineTo(10, 10); // Bottom right vertex
    ctx.lineTo(0, 5); // Middle bottom vertex
    ctx.lineTo(-10, 10); // Bottom left vertex
    ctx.closePath();
    ctx.fillStyle = 'white';
    ctx.fill();

    // Draw a line extending straight upward
    ctx.beginPath();
    ctx.moveTo(0, -10); // Start at the top vertex of the triangle
    ctx.lineTo(0, -40); // Extend straight ahead - shorter than before
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
}

function drawROV() {
    // Always draw the ROV at the center of the canvas pointing up
    drawROVIcon(canvas.width / 2, canvas.height / 2);
}

function drawTrailPath() {
    if (!currentPosition.lat || !currentPosition.lon || trail.length < 2) return;

    ctx.save();
    // Apply the inverse of the ROV heading rotation to the context
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-currentHeading * (Math.PI / 180));
    ctx.translate(-canvas.width / 2, -canvas.height / 2);
    
    ctx.strokeStyle = COLORS.trail;
    ctx.lineWidth = LINES.trail;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 10;

    ctx.beginPath();

    trail.forEach((point, index) => {
        // Draw trail relative to the current position
        const meters = latLonToMeters(point.lat, point.lon, currentPosition.lat, currentPosition.lon);
        const pixels = worldToScreen(meters);
        if (index === 0) {
            ctx.moveTo(pixels.x, pixels.y);
        } else {
            ctx.lineTo(pixels.x, pixels.y);
        }
    });
    ctx.stroke();
    
    ctx.restore();
}

function drawTarget() {
    if (!currentPosition.lat || !currentPosition.lon || !targets.length) return;
    
    ctx.save();
    // Apply the inverse of the ROV heading rotation to the context
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-currentHeading * (Math.PI / 180));
    ctx.translate(-canvas.width / 2, -canvas.height / 2);
    
    // Draw connecting lines between targets
    ctx.beginPath();
    ctx.strokeStyle = '#999999';
    ctx.lineWidth = LINES.targetLine;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
    ctx.shadowBlur = 10;
    
    targets.forEach((target, index) => {
        if (!target) return;
        const targetMeters = latLonToMeters(target.lat, target.lon, currentPosition.lat, currentPosition.lon);
        const targetPixels = worldToScreen(targetMeters);

        if (index > 0 && targets[index - 1]) {
            const prevMeters = latLonToMeters(targets[index - 1].lat, targets[index - 1].lon, currentPosition.lat, currentPosition.lon);
            const prevPixels = worldToScreen(prevMeters);
            ctx.moveTo(prevPixels.x, prevPixels.y);
            ctx.lineTo(targetPixels.x, targetPixels.y);
        }
    });
    ctx.stroke();

    // Draw dotted line to active target if selected
    if (activeTargetIndex !== -1 && targets[activeTargetIndex]) {
        const target = targets[activeTargetIndex];
        const targetMeters = latLonToMeters(target.lat, target.lon, currentPosition.lat, currentPosition.lon);
        const targetPixels = worldToScreen(targetMeters);
        
        // ROV is always at center
        const currentPixels = { x: canvas.width / 2, y: canvas.height / 2 };
        
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
        
        // Calculate and display bearing to target (since we rotated the world)
        const dx = targetPixels.x - currentPixels.x;
        const dy = targetPixels.y - currentPixels.y;
        const bearing = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
        ctx.fillText(bearing.toFixed(0) + '°', midX, midY - 20);
    }
    
    // Draw all target markers
    targets.forEach((target, index) => {
        if (!target) return;
        const targetMeters = latLonToMeters(target.lat, target.lon, currentPosition.lat, currentPosition.lon);
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
    
    ctx.restore();
}

function getGridSpacing() {
    const candidateSteps = [1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]; // in meters
    const minPixelSpacing = 60; // minimum spacing in pixels
    const effectiveScale = BASE_SCALE * scale;
    for (let step of candidateSteps) {
        if (step * effectiveScale >= minPixelSpacing) {
            return step;
        }
    }
    return candidateSteps[candidateSteps.length - 1];
}

// Updated grid drawing function to move with ROV movement
function drawGrid() {
    if (!currentPosition.lat || !currentPosition.lon) return;
    
    ctx.save();
    // Apply the inverse of the ROV heading rotation to the context
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-currentHeading * (Math.PI / 180));
    ctx.translate(-canvas.width / 2, -canvas.height / 2);
    
    const gridSpacing = getGridSpacing();
    const effectiveMultiplier = BASE_SCALE * scale;
    
    // Calculate grid boundaries based on canvas size and scale
    const leftMeters = -(canvas.width / 2) / effectiveMultiplier;
    const rightMeters = (canvas.width / 2) / effectiveMultiplier;
    const topMeters = -(canvas.height / 2) / effectiveMultiplier;
    const bottomMeters = (canvas.height / 2) / effectiveMultiplier;
    
    // Apply grid offset from ROV movement
    const offsetX = gridOffset.x % gridSpacing;
    const offsetY = gridOffset.y % gridSpacing;
    
    ctx.beginPath();
    ctx.strokeStyle = "rgba(68, 68, 68, 0.5)";
    ctx.lineWidth = 1;
    
    // Draw vertical grid lines with offset
    const startX = Math.floor(leftMeters / gridSpacing) * gridSpacing - offsetX;
    const endX = Math.ceil(rightMeters / gridSpacing) * gridSpacing - offsetX;
    for (let x = startX; x <= endX; x += gridSpacing) {
        const startPoint = worldToScreen({ x: x, y: topMeters });
        const endPoint = worldToScreen({ x: x, y: bottomMeters });
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(endPoint.x, endPoint.y);
    }
    
    // Draw horizontal grid lines with offset
    const startY = Math.floor(topMeters / gridSpacing) * gridSpacing - offsetY;
    const endY = Math.ceil(bottomMeters / gridSpacing) * gridSpacing - offsetY;
    for (let y = startY; y <= endY; y += gridSpacing) {
        const startPoint = worldToScreen({ x: leftMeters, y: y });
        const endPoint = worldToScreen({ x: rightMeters, y: y });
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(endPoint.x, endPoint.y);
    }
    
    ctx.stroke();
    
    ctx.restore();
}

function drawCompass() {
    const radius = 30;
    const padding = 20;
    const x = canvas.width - radius - padding;
    const y = radius + padding;

    // Draw compass background
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Draw cardinal directions (oriented to north, not ROV heading)
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    
    // North (always at top)
    ctx.fillText("N", x, y - radius + 10);
    // East
    ctx.fillText("E", x + radius - 10, y);
    // South
    ctx.fillText("S", x, y + radius - 10);
    // West
    ctx.fillText("W", x - radius + 10, y);
    
    // Draw heading indicator (points to current heading)
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(currentHeading * Math.PI / 180);
    
    ctx.beginPath();
    ctx.moveTo(0, -radius + 5);
    ctx.lineTo(5, 0);
    ctx.lineTo(-5, 0);
    ctx.closePath();
    ctx.fillStyle = "red";
    ctx.fill();
    
    ctx.restore();
    
    // Draw the heading value
    ctx.fillStyle = "white";
    ctx.font = "bold 10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${Math.round(currentHeading)}°`, x, y);
    
    ctx.restore();
}

function drawDirectionIndicator() {
    // Display North indicator - since the world rotates, add an arrow pointing to North
    const margin = 20;
    const arrowSize = 15;
    const x = margin + arrowSize;
    const y = margin + arrowSize;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-currentHeading * Math.PI / 180); // Apply inverse rotation
    
    // Draw N arrow
    ctx.beginPath();
    ctx.moveTo(0, -arrowSize);
    ctx.lineTo(arrowSize/3, 0);
    ctx.lineTo(-arrowSize/3, 0);
    ctx.closePath();
    ctx.fillStyle = "#FF4444";
    ctx.fill();
    
    // Draw N letter
    ctx.font = "bold 12px sans-serif";
    ctx.fillStyle = "white";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("N", 0, -arrowSize - 8);
    
    ctx.restore();
}

function drawScaleIndicator() {
    // Get current grid spacing
    const gridSpacing = getGridSpacing();
    const effectiveMultiplier = BASE_SCALE * scale;
    const lineWidth = gridSpacing * effectiveMultiplier;
    const margin = 10;

    ctx.save();
    // Reset transformation so that the indicator is fixed to the canvas
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    
    // Draw horizontal line in bottom left
    const x = margin;
    const y = canvas.height - margin;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + lineWidth, y);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw vertical lines at both ends
    ctx.beginPath();
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x, y + 5);
    ctx.moveTo(x + lineWidth, y - 5);
    ctx.lineTo(x + lineWidth, y + 5);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw the grid spacing text above the line
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(gridSpacing + " m", x + lineWidth / 2, y - 5);
    
    ctx.restore();
}

// Updated draw() function - ROV always points up, world rotates
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw grid first
    drawGrid();
    
    drawTrailPath();
    drawTarget();
    drawROV(); // Always pointing up
    
    drawScaleIndicator();
    drawCompass();
    drawDirectionIndicator();
}

// --------- User Interaction: Zooming Only --------- //

// Handle zooming via mouse wheel
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = 1.1;
    
    // Adjust scale
    if (e.deltaY < 0) {
        scale *= zoomFactor;
    } else {
        scale /= zoomFactor;
    }
    
    draw();
});

// --------- Touch Interaction: Zooming Only --------- //

// Variables to track pinch zoom
let initialPinchDistance = 0;
let lastScale = 1;

// Touch event handlers for pinch zoom
canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
        // Store initial pinch distance
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
        lastScale = scale;
    }
});

canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
        e.preventDefault();
        
        // Calculate new pinch distance
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const pinchDistance = Math.sqrt(dx * dx + dy * dy);
        
        // Calculate scale change
        const scaleFactor = pinchDistance / initialPinchDistance;
        scale = lastScale * scaleFactor;
        
        // Apply limits to scale
        scale = Math.max(0.1, Math.min(scale, 10));
        
        draw();
    }
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
    draw(); // Redraw when heading changes since world orientation changes
}

function updatePosition() {
    if (!currentPosition.lat || !currentPosition.lon) return;
    
    const { lat, lon } = currentPosition;

    // Initialize grid origin if not set
    if (!gridOrigin.lat) {
        gridOrigin.lat = lat;
        gridOrigin.lon = lon;
    }
    
    // Update grid offset based on ROV movement
    if (lastPosition.lat !== null) {
        const movement = latLonToMeters(lat, lon, lastPosition.lat, lastPosition.lon);
        // Apply movement to grid offset - this creates the illusion of the grid being fixed
        gridOffset.x += movement.x;
        gridOffset.y += movement.y;
    }
    
    // Update last position
    lastPosition.lat = lat;
    lastPosition.lon = lon;

    if (!firstPoint) {
        firstPoint = { lat, lon };
    }

    if (trail.length === 0 || calculateLatLonDistance({ lat, lon }, trail[trail.length - 1]) >= MIN_DISTANCE) {
        trail.push({ lat, lon });
        if (trail.length > MAX_TRAIL_POINTS) trail.shift();
    }

    positionDisplay.innerText = `ROV: ${lat.toFixed(7)}°, ${lon.toFixed(7)}°`;
    
    // Since ROV is now always centered, we need to redraw when position changes
    draw();
}

// --------- MAVLink Listeners --------- //

window.cockpit.listenDataLakeVariable(VARS.lat, handleLatitude);
window.cockpit.listenDataLakeVariable(VARS.lon, handleLongitude);
window.cockpit.listenDataLakeVariable(VARS.hdg, handleHeading);

// Toggle target container
document.getElementById('toggleTargetContainer').addEventListener('click', function () {
    const targetContainer = document.getElementById('targetContainer');
    targetContainer.style.display = (targetContainer.style.display === 'none') ? 'block' : 'none';
    resizeCanvas();
});

// Reset grid offset with double click/tap
canvas.addEventListener('dblclick', () => {
    gridOffset = { x: 0, y: 0 };
    if (currentPosition.lat) {
        gridOrigin.lat = currentPosition.lat;
        gridOrigin.lon = currentPosition.lon;
    }
    draw();
});

// Initial draw
draw();