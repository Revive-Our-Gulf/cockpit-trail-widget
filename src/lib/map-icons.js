export function createRovIcon(leaflet) {
  return leaflet.divIcon({
    className: "",
    html: "<div class='rov-marker'></div>",
    iconSize: [14, 20],
    iconAnchor: [7, 13],
  });
}