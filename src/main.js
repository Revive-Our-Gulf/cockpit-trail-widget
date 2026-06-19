import { createRovInput } from "./lib/rov-input.js";
import { createRovMap } from "./lib/rov-map.js";

(function () {
  function initWidget() {
    var rovMap = createRovMap({
      leaflet: window.L,
      document: window.document,
      mapId: "leaflet-map",
      statusId: "map-status",
      centerButtonId: "center-rov",
      defaultCenter: [0, 0],
      defaultZoom: 3,
    });

    if (!rovMap.init()) {
      return;
    }

    var rovInput = createRovInput(window.cockpit);
    if (!rovInput.isAvailable()) {
      return;
    }

    rovInput.subscribe({ onUpdate: rovMap.setRovState });
    rovMap.setRovState(rovInput.readSnapshot());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWidget, { once: true });
  } else {
    initWidget();
  }
})();