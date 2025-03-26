const VARS = {
    lat: 'GLOBAL_POSITION_INT/lat',
    lon: 'GLOBAL_POSITION_INT/lon',
    hdg: 'GLOBAL_POSITION_INT/hdg',
    vx: 'GLOBAL_POSITION_INT/vx',
    vy: 'GLOBAL_POSITION_INT/vy'
};

const currentValues = {};
const listeners = {};
let updatePending = false;
let canvas, mapContainer, ctx;

function initCanvas() {
    canvas = document.getElementById('mapCanvas');
    mapContainer = document.getElementById('mapContainer');
    ctx = canvas.getContext('2d');
    
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
}

function resizeCanvas() {
    if (!canvas || !mapContainer) return;
    
    canvas.width = mapContainer.clientWidth;
    canvas.height = mapContainer.clientHeight;

    updateDisplay();
}



function formatValue(id, value) {
    if (value === undefined) return 'N/A';
    if (id === VARS.hdg) {
        return (value / 100).toFixed(1) + '°';
    } else if (id === VARS.lat || id === VARS.lon) {
        return (value / 10000000).toFixed(7);
    }
    
    return String(value);
}

function scheduleUpdate() {
    if (!updatePending) {
        updatePending = true;
        requestAnimationFrame(() => {
            updateDisplay();
            updatePending = false;
        });
    }
}

function updateDisplay() {
    const headingElement = document.getElementById('currentHeading');
    if (headingElement) {
        headingElement.innerText = formatValue(VARS.hdg, currentValues[VARS.hdg]);
    }
    
    const latElement = document.getElementById('currentLat');
    if (latElement) {
        latElement.innerText = formatValue(VARS.lat, currentValues[VARS.lat]);
    }
    
    const lonElement = document.getElementById('currentLon');
    if (lonElement) {
        lonElement.innerText = formatValue(VARS.lon, currentValues[VARS.lon]);
    }
    
    const posElement = document.getElementById('currentPos');
    if (posElement) {
        const lat = formatValue(VARS.lat, currentValues[VARS.lat]);
        const lon = formatValue(VARS.lon, currentValues[VARS.lon]);
        const hdg = formatValue(VARS.hdg, currentValues[VARS.hdg]);
        const vx = formatValue(VARS.vx, currentValues[VARS.vx]);
        const vy = formatValue(VARS.vy, currentValues[VARS.vy]);
        posElement.innerText = `Lat: ${lat} Lon: ${lon} Heading: ${hdg}, Vx: ${vx}, Vy: ${vy}`;
    }
}


function setupListeners() {
    Object.entries(VARS).forEach(([key, id]) => {
        currentValues[id] = window.cockpit.getDataLakeVariableData(id);
        listeners[id] = window.cockpit.listenDataLakeVariable(id, (value) => {
            currentValues[id] = value;
            scheduleUpdate();
        });
    });
}

function cleanupListeners() {
    Object.entries(listeners).forEach(([id, listenerId]) => {
        window.cockpit.unlistenDataLakeVariable(id, listenerId);
    });
}

function initWidget() {
    initCanvas();
    setupListeners();
    updateDisplay();

    window.addEventListener('unload', cleanupListeners);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWidget);
} else {
    initWidget();
}