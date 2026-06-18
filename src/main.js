(function () {
  var MAP_ID = "leaflet-map";
  var STATUS_ID = "map-status";
  var CENTER_BUTTON_ID = "center-rov";
  var DEFAULT_CENTER = [0, 0];
  var DEFAULT_ZOOM = 3;
  var MAVLINK_VARS = {
    LAT: "GLOBAL_POSITION_INT/lat",
    LON: "GLOBAL_POSITION_INT/lon",
    HDG: "GLOBAL_POSITION_INT/hdg"
  };
  var state = {
    lat: null,
    lon: null,
    heading: null
  };
  var map;
  var rovTriangle;

  function setStatus(message) {
    var statusEl = document.getElementById(STATUS_ID);
    if (statusEl) statusEl.textContent = message;
  }

  function offsetLatLon(lat, lon, headingDeg, distanceMeters) {
    var rad = (headingDeg * Math.PI) / 180;
    var dLat = (distanceMeters * Math.cos(rad)) / 111320;
    var cosLat = Math.cos((lat * Math.PI) / 180) || 1e-9;
    var dLon = (distanceMeters * Math.sin(rad)) / (111320 * cosLat);
    return [lat + dLat, lon + dLon];
  }

  function getTrianglePoints(lat, lon, headingDeg) {
    var tip = offsetLatLon(lat, lon, headingDeg, 4.0);
    var backLeft = offsetLatLon(lat, lon, headingDeg - 150, 2.8);
    var backRight = offsetLatLon(lat, lon, headingDeg + 150, 2.8);
    return [tip, backLeft, backRight];
  }

  function updateRovIcon() {
    if (!rovTriangle) return;
    if (state.lat === null || state.lon === null) return;

    var heading = state.heading === null ? 0 : state.heading;
    rovTriangle.setLatLngs(getTrianglePoints(state.lat, state.lon, heading));
  }

  function updateDebugStatus() {
    var mapLat = "n/a";
    var mapLon = "n/a";
    var rovLat = "n/a";
    var rovLon = "n/a";
    var rovHdg = "n/a";

    if (map) {
      var center = map.getCenter();
      mapLat = center.lat.toFixed(6);
      mapLon = center.lng.toFixed(6);
    }

    if (state.lat !== null && state.lon !== null) {
      rovLat = state.lat.toFixed(6);
      rovLon = state.lon.toFixed(6);
    }

    if (state.heading !== null) {
      rovHdg = state.heading.toFixed(1);
    }

    setStatus(
      "Map: " + mapLat + ", " + mapLon + "\n" +
      "ROV: " + rovLat + ", " + rovLon + "\n" +
      "HDG: " + rovHdg
    );
  }

  function tryReadCurrentRov() {
    handleLatitude();
    handleLongitude();
    handleHeading();
  }

  function centerMapOnRov() {
    if (!map) return;
    if (state.lat === null || state.lon === null) return;
    map.setView([state.lat, state.lon], map.getZoom(), { animate: false });
  }

  function handleLatitude() {
    var raw = window.cockpit.getDataLakeVariableData(MAVLINK_VARS.LAT);
    if (raw === undefined || raw === null) return;
    state.lat = raw / 1e7;
    updateRovIcon();
    updateDebugStatus();
  }

  function handleLongitude() {
    var raw = window.cockpit.getDataLakeVariableData(MAVLINK_VARS.LON);
    if (raw === undefined || raw === null) return;
    state.lon = raw / 1e7;
    updateRovIcon();
    updateDebugStatus();
  }

  function handleHeading() {
    var raw = window.cockpit.getDataLakeVariableData(MAVLINK_VARS.HDG);
    if (raw === undefined || raw === null) return;
    state.heading = raw / 100;
    updateRovIcon();
    updateDebugStatus();
  }

  function setupRovListeners() {
    if (!window.cockpit || !window.cockpit.listenDataLakeVariable || !window.cockpit.getDataLakeVariableData) {
      updateDebugStatus();
      return;
    }

    window.cockpit.listenDataLakeVariable(MAVLINK_VARS.LAT, handleLatitude);
    window.cockpit.listenDataLakeVariable(MAVLINK_VARS.LON, handleLongitude);
    window.cockpit.listenDataLakeVariable(MAVLINK_VARS.HDG, handleHeading);
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

    rovTriangle = window.L.polygon(getTrianglePoints(DEFAULT_CENTER[0], DEFAULT_CENTER[1], 0), {
      color: "#22d3ee",
      weight: 1,
      fillColor: "#22d3ee",
      fillOpacity: 0.9
    }).addTo(map);

    var centerButton = document.getElementById(CENTER_BUTTON_ID);
    if (centerButton) {
      centerButton.onclick = centerMapOnRov;
    }

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