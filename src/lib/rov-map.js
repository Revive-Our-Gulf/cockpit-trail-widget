import { createRovIcon } from "./map-icons.js";

export function createRovMap(options) {
  var leaflet = options.leaflet;
  var doc = options.document;
  var mapId = options.mapId;
  var statusId = options.statusId;
  var centerButtonId = options.centerButtonId;
  var defaultCenter = options.defaultCenter;
  var defaultZoom = options.defaultZoom;

  var state = {
    lat: null,
    lon: null,
    heading: 0,
  };
  var map;
  var rovMarker;
  var rovIcon;
  var statusElement;

  function setStatus(message) {
    if (statusElement) {
      statusElement.textContent = message;
    }
  }

  function updateRovMarker() {
    if (!map || state.lat === null || state.lon === null) return;

    var latLng = [state.lat, state.lon];
    if (rovMarker) {
      rovMarker.setLatLng(latLng);
    } else {
      rovMarker = leaflet.marker(latLng, { icon: rovIcon }).addTo(map);
    }

    var markerElement = rovMarker.getElement();
    if (!markerElement) return;

    var markerInner = markerElement.querySelector(".rov-marker");
    if (markerInner) {
      markerInner.style.transform = "rotate(" + state.heading + "deg)";
    }
  }

  function updateStatus() {
    var mapLat = "n/a";
    var mapLon = "n/a";
    var rovLat = "n/a";
    var rovLon = "n/a";

    if (map) {
      var center = map.getCenter();
      mapLat = center.lat.toFixed(6);
      mapLon = center.lng.toFixed(6);
    }

    if (state.lat !== null && state.lon !== null) {
      rovLat = state.lat.toFixed(6);
      rovLon = state.lon.toFixed(6);
    }

    setStatus(
      "Map: " + mapLat + ", " + mapLon + "\n" +
      "ROV: " + rovLat + ", " + rovLon
    );
  }

  function centerOnRov() {
    if (!map) return;
    if (state.lat === null || state.lon === null) return;
    map.setView([state.lat, state.lon], map.getZoom(), { animate: false });
  }

  function setRovState(update) {
    state = {
      ...state,
      ...update,
    };

    updateRovMarker();
    updateStatus();
  }

  function init() {
    var mapContainer = doc.getElementById(mapId);
    statusElement = doc.getElementById(statusId);

    if (!mapContainer) {
      setStatus("Map container missing");
      return false;
    }

    if (!leaflet || !leaflet.map) {
      setStatus("Leaflet global not found (window.L)");
      return false;
    }

    if (map) {
      return true;
    }

    if (mapContainer.dataset.mapReady === "1") {
      return false;
    }

    mapContainer.dataset.mapReady = "1";
    rovIcon = createRovIcon(leaflet);

    map = leaflet.map(mapId, {
      center: defaultCenter,
      zoom: defaultZoom,
      zoomControl: true,
      attributionControl: false,
    });

    var centerButton = doc.getElementById(centerButtonId);
    if (centerButton) {
      centerButton.onclick = centerOnRov;
    }

    map.on("move zoom", updateStatus);
    updateStatus();

    setTimeout(function () {
      map.invalidateSize();
      updateStatus();
    }, 0);

    return true;
  }

  return {
    init,
    setRovState,
  };
}