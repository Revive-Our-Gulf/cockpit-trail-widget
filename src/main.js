import { createDebugPanel } from "./lib/debug-panel.js";
import { createRovInput } from "./lib/rov-input.js";
import { createRovMap } from "./lib/rov-map.js";

(function () {
  var buildInfo = {
    version: __WIDGET_VERSION__,
    sha: __WIDGET_SHA__,
  };

  function initWidget() {
    var debugPanel = createDebugPanel({
      element: document.getElementById("map-status"),
      buildInfo: buildInfo,
    });
    window.debug = debugPanel;

    var rovMap = createRovMap({
      leaflet: window.L,
      document: window.document,
      mapId: "leaflet-map",
      centerButtonId: "center-rov",
      defaultCenter: [0, 0],
      defaultZoom: 3,
      onStateChange: function (nextState) {
        debugPanel.setMapState(nextState.map);
        debugPanel.setRovState(nextState.rov);
      },
    });

    if (!rovMap.init()) {
      debugPanel.log("map init failed");
      return;
    }

    var rovInput = createRovInput(window.cockpit);
    if (!rovInput.isAvailable()) {
      debugPanel.log("cockpit API unavailable");
      return;
    }

    rovInput.subscribe({
      onUpdate: function (update) {
        rovMap.setRovState(update);
      },
    });

    var snapshot = rovInput.readSnapshot();
    rovMap.setRovState(snapshot);
    debugPanel.log("widget ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWidget, { once: true });
  } else {
    initWidget();
  }
})();