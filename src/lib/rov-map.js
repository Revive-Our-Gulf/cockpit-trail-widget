import { createRovIcon } from "./map-icons.js";
import { createRovTrail } from "./rov-trail.js";

export function createRovMap(options) {
  var leaflet = options.leaflet;
  var doc = options.document;
  var mapId = options.mapId;
  var centerButtonId = options.centerButtonId;
  var defaultCenter = options.defaultCenter;
  var defaultZoom = options.defaultZoom;
  var onStateChange = options.onStateChange;
  var trailMaxPoints = options.trailMaxPoints;
  var trailMaxDistanceMeters = options.trailMaxDistanceMeters || 200;
  var trailMinDistanceMeters = options.trailMinDistanceMeters || 1;

  var state = {
    lat: null,
    lon: null,
    heading: 0,
  };
  var map;
  var rovMarker;
  var rovIcon;
  var rovTrail;
  var isFollowingRov = true;

  function emitStateChange() {
    if (!onStateChange) return;

    var mapState = {
      lat: null,
      lon: null,
      zoom: null,
    };

    if (map) {
      var center = map.getCenter();
      mapState = {
        lat: center.lat,
        lon: center.lng,
        zoom: map.getZoom(),
      };
    }

    onStateChange({
      map: mapState,
      rov: {
        lat: state.lat,
        lon: state.lon,
        heading: state.heading,
      },
    });
  }

  function updateRovMarker(positionChanged) {
    if (!map || state.lat === null || state.lon === null) return;

    var latLng = [state.lat, state.lon];
    if (rovMarker) {
      rovMarker.setLatLng(latLng);
    } else {
      rovMarker = leaflet.marker(latLng, { icon: rovIcon }).addTo(map);
    }

    var markerElement = rovMarker.getElement();
    if (!markerElement) return;

    var markerInner = markerElement.querySelector(".rov-marker__inner");
    if (markerInner) {
      markerInner.style.transform = "rotate(" + state.heading + "deg)";
    }

    if (positionChanged && rovTrail) {
      rovTrail.appendPoint({ lat: state.lat, lon: state.lon });
    }

    if (positionChanged && isFollowingRov) {
      centerOnRov();
    }
  }

  function centerOnRov() {
    if (!map) return;
    isFollowingRov = true;
    if (state.lat === null || state.lon === null) return;
    map.setView([state.lat, state.lon], map.getZoom(), { animate: false });
  }

  function handleDragStart() {
    isFollowingRov = false;
    emitStateChange();
  }

  function setRovState(update) {
    var previousState = state;
    state = {
      ...state,
      ...update,
    };

    var positionChanged =
      state.lat !== previousState.lat || state.lon !== previousState.lon;

    updateRovMarker(positionChanged);
    emitStateChange();
  }

  function init() {
    var mapContainer = doc.getElementById(mapId);

    if (!mapContainer) {
      emitStateChange();
      return false;
    }

    if (!leaflet || !leaflet.map) {
      emitStateChange();
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
    rovTrail = createRovTrail({
      leaflet: leaflet,
      maxPoints: trailMaxPoints,
      maxDistanceMeters: trailMaxDistanceMeters,
      minSegmentDistanceMeters: trailMinDistanceMeters,
    });

    map = leaflet.map(mapId, {
      center: defaultCenter,
      zoom: defaultZoom,
      zoomControl: true,
      attributionControl: false,
    });
    rovTrail.addTo(map);

    var centerButton = doc.getElementById(centerButtonId);
    if (centerButton) {
      centerButton.onclick = centerOnRov;
    }

    map.on("dragstart", handleDragStart);
    map.on("move zoom", emitStateChange);
    emitStateChange();

    setTimeout(function () {
      map.invalidateSize();
      emitStateChange();
    }, 0);

    return true;
  }

  return {
    init,
    setRovState,
  };
}