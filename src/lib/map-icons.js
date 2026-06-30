export function createRovIcon(leaflet) {
  return leaflet.divIcon({
    className: "leaflet-div-icon rov-marker-shell",
    html:
      "<div class='rov-marker__inner'><svg class='rov-marker__svg' width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg' aria-hidden='true'><polygon points='20,4 34,36 20,28 6,36' fill='white' stroke='#444' stroke-width='1.5'/></svg></div>",
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}