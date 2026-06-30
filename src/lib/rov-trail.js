function distanceInMeters(firstPoint, secondPoint) {
  var latDiff = (firstPoint.lat - secondPoint.lat) * 111320;
  var lonDiff =
    (firstPoint.lon - secondPoint.lon) *
    111320 *
    Math.cos((((firstPoint.lat + secondPoint.lat) / 2) * Math.PI) / 180);

  return Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
}

function clamp(value, minValue, maxValue) {
  return Math.min(maxValue, Math.max(minValue, value));
}

export function createRovTrail(options) {
  var leaflet = options.leaflet;
  var color = options.color || "#a00000";
  var weight = options.weight || 4;
  var maxDistanceMeters = options.maxDistanceMeters || 200;
  var minSegmentDistanceMeters = options.minSegmentDistanceMeters || 1;
  var maxPoints =
    options.maxPoints ||
    Math.ceil(maxDistanceMeters / minSegmentDistanceMeters) + 1;
  var minOpacity = options.minOpacity || 0.15;
  var maxOpacity = options.maxOpacity || 1;
  var points = [];
  var layerGroup = leaflet.layerGroup();
  var totalDistanceMeters = 0;

  function trimToBudget() {
    while (
      points.length > 1 &&
      (points.length > maxPoints || totalDistanceMeters > maxDistanceMeters)
    ) {
      totalDistanceMeters -= points[1].segmentDistanceMeters;
      points.shift();
      points[0].segmentDistanceMeters = 0;
    }
  }

  function redraw() {
    layerGroup.clearLayers();

    if (points.length < 2) {
      return;
    }

    var distanceFromNewestMeters = 0;
    for (var index = points.length - 1; index >= 1; index -= 1) {
      var currentPoint = points[index];
      var previousPoint = points[index - 1];
      var midpointDistanceMeters =
        distanceFromNewestMeters + currentPoint.segmentDistanceMeters / 2;
      var distanceRatio = clamp(
        midpointDistanceMeters / maxDistanceMeters,
        0,
        1
      );
      var opacity =
        minOpacity + (maxOpacity - minOpacity) * (1 - distanceRatio);

      distanceFromNewestMeters += currentPoint.segmentDistanceMeters;

      layerGroup.addLayer(
        leaflet.polyline(
          [
            [previousPoint.lat, previousPoint.lon],
            [currentPoint.lat, currentPoint.lon],
          ],
          {
          color: color,
          weight: weight,
          opacity: opacity,
          }
        )
      );
    }
  }

  function appendPoint(point) {
    if (point.lat === null || point.lon === null) {
      return false;
    }

    var previousPoint = points[points.length - 1];
    if (!previousPoint) {
      points.push({
        lat: point.lat,
        lon: point.lon,
        segmentDistanceMeters: 0,
      });
      redraw();
      return true;
    }

    var segmentDistanceMeters = distanceInMeters(previousPoint, point);
    if (segmentDistanceMeters < minSegmentDistanceMeters) {
      return false;
    }

    points.push({
      lat: point.lat,
      lon: point.lon,
      segmentDistanceMeters: segmentDistanceMeters,
    });
    totalDistanceMeters += segmentDistanceMeters;
    trimToBudget();

    redraw();

    return true;
  }

  function clear() {
    points = [];
    totalDistanceMeters = 0;
    redraw();
  }

  function addTo(map) {
    layerGroup.addTo(map);
    redraw();
    return layerGroup;
  }

  function getPoints() {
    return points.map(function (point) {
      return [point.lat, point.lon];
    });
  }

  return {
    addTo: addTo,
    appendPoint: appendPoint,
    clear: clear,
    getPoints: getPoints,
    layerGroup: layerGroup,
  };
}