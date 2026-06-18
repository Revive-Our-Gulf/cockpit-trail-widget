(function () {
  var MAP_ID = "leaflet-map";
  var STATUS_ID = "map-status";
  var DEFAULT_CENTER = [0, 0];
  var DEFAULT_ZOOM = 3;
  var MAVLINK_VARS = {
    LAT: "GLOBAL_POSITION_INT/lat",
    LON: "GLOBAL_POSITION_INT/lon"
  };
  var state = {
    lat: null,
    lon: null
  };
  var map;

  function setStatus(message) {
    var statusEl = document.getElementById(STATUS_ID);
    if (statusEl) statusEl.textContent = message;
  }

  function updateDebugStatus() {
    var mapLine = "Map: waiting";
    var rovLine = "ROV: waiting";

    if (map) {
      var center = map.getCenter();
      mapLine = "Map: " + center.lat.toFixed(6) + ", " + center.lng.toFixed(6);
    }

    if (state.lat !== null && state.lon !== null) {
      rovLine = "ROV: " + state.lat.toFixed(6) + ", " + state.lon.toFixed(6);
    } else {
      rovLine = "ROV: no position yet";
    }

    setStatus(mapLine + "\n" + rovLine);
  }

  function tryReadCurrentRov() {
    handleLatitude();
    handleLongitude();
  }

  function handleLatitude() {
    var raw = window.cockpit.getDataLakeVariableData(MAVLINK_VARS.LAT);
    if (raw === undefined || raw === null) return;
    state.lat = raw / 1e7;
    updateDebugStatus();
  }

  function handleLongitude() {
    var raw = window.cockpit.getDataLakeVariableData(MAVLINK_VARS.LON);
    if (raw === undefined || raw === null) return;
    state.lon = raw / 1e7;
    updateDebugStatus();
  }

  function setupRovListeners() {
    if (!window.cockpit || !window.cockpit.listenDataLakeVariable || !window.cockpit.getDataLakeVariableData) {
      updateDebugStatus();
      return;
    }

    window.cockpit.listenDataLakeVariable(MAVLINK_VARS.LAT, handleLatitude);
    window.cockpit.listenDataLakeVariable(MAVLINK_VARS.LON, handleLongitude);
    tryReadCurrentRov();
    updateDebugStatus();
  }

  function initMap() {
    var mapContainer = document.getElementById(MAP_ID);
    if (!mapContainer) {
      setStatus("Map container missing");
      return;
    }

    if (!window.L || !window.L.map) {
      setStatus("Leaflet global not found (window.L)");
      return;
    }

    if (mapContainer.dataset.mapReady === "1") return;
    mapContainer.dataset.mapReady = "1";

    map = window.L.map(MAP_ID, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: false,
      worldCopyJump: true
    });

    map.on("move zoom", updateDebugStatus);

    setupRovListeners();
    updateDebugStatus();

    setTimeout(function () {
      map.invalidateSize();
      updateDebugStatus();
    }, 0);
  }

  function start() {
    initMap();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
