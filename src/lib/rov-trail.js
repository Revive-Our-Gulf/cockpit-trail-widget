function distanceInMeters(firstPoint, secondPoint) {
  var latDiff = (firstPoint.lat - secondPoint.lat) * 111320;
  var lonDiff =
    (firstPoint.lon - secondPoint.lon) *
    111320 *
    Math.cos((((firstPoint.lat + secondPoint.lat) / 2) * Math.PI) / 180);

  return Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
}

export function createRovTrail(options) {
  var leaflet = options.leaflet;
  var color = options.color || "#22d3ee";
  var weight = options.weight || 4;
  var maxPoints = options.maxPoints || 30;
  var minSegmentDistanceMeters = options.minSegmentDistanceMeters || 0.5;
  var minOpacity = options.minOpacity || 0.15;
  var maxOpacity = options.maxOpacity || 0.85;
  var points = [];
  var layerGroup = leaflet.layerGroup();

  function redraw() {
    layerGroup.clearLayers();

    if (points.length < 2) {
      return;
    }

    var segmentCount = points.length - 1;
    for (var index = 1; index < points.length; index += 1) {
      var ratio = segmentCount === 1 ? 1 : index / segmentCount;
      var opacity = minOpacity + (maxOpacity - minOpacity) * ratio;
      layerGroup.addLayer(
        leaflet.polyline([points[index - 1], points[index]], {
          color: color,
          weight: weight,
          opacity: opacity,
        })
      );
    }
  }

  function appendPoint(point) {
    if (point.lat === null || point.lon === null) {
      return false;
    }

    var previousPoint = points[points.length - 1];
    if (
      previousPoint &&
      distanceInMeters(point, previousPoint) < minSegmentDistanceMeters
    ) {
      return false;
    }

    points.push([point.lat, point.lon]);
    if (points.length > maxPoints) {
      points.shift();
    }

    redraw();
    return true;
  }

  function clear() {
    points = [];
    redraw();
  }

  function addTo(map) {
    layerGroup.addTo(map);
    redraw();
    return layerGroup;
  }

  function getPoints() {
    return points.slice();
  }

  return {
    addTo: addTo,
    appendPoint: appendPoint,
    clear: clear,
    getPoints: getPoints,
    layerGroup: layerGroup,
  };
}