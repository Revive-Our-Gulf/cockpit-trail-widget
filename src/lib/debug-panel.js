function formatCoordinate(value) {
  return value === null || value === undefined ? "n/a" : Number(value).toFixed(6);
}

function formatHeading(value) {
  return value === null || value === undefined ? "n/a" : Number(value).toFixed(2);
}

function formatZoom(value) {
  return value === null || value === undefined ? "n/a" : String(value);
}

function createInitialState(buildInfo) {
  return {
    build: {
      version: buildInfo.version || "dev",
      sha: buildInfo.sha || "unknown",
    },
    rov: {
      lat: null,
      lon: null,
      heading: null,
    },
    map: {
      lat: null,
      lon: null,
      zoom: null,
    },
    logs: [],
  };
}

function renderLines(state) {
  var lines = [
    "widget version: " + state.build.version,
    "sha: " + state.build.sha,
    "rov lat, lon, hdg: " + formatCoordinate(state.rov.lat) + ", " + formatCoordinate(state.rov.lon) + ", " + formatHeading(state.rov.heading),
    "map lat, lon, zoom: " + formatCoordinate(state.map.lat) + ", " + formatCoordinate(state.map.lon) + ", " + formatZoom(state.map.zoom),
  ];

  if (state.logs.length) {
    lines.push("logs:");
    state.logs.forEach(function (entry) {
      lines.push("- " + entry);
    });
  }

  return lines;
}

export function createDebugPanel(options) {
  var element = options.element;
  var maxLogs = options.maxLogs || 10;
  var hertz = options.hertz;
  var state = createInitialState(options.buildInfo || {});
  var scheduledFrame = null;
  var scheduledTimeout = null;
  var frameInterval = typeof hertz === "number" && hertz > 0 ? 1000 / hertz : 0;
  var lastRenderAt = 0;

  function renderNow() {
    if (!element) return;
    lastRenderAt = Date.now();
    element.textContent = renderLines(state).join("\n");
  }

  function scheduleRender() {
    if (scheduledFrame !== null || scheduledTimeout !== null) {
      return;
    }

    if (frameInterval > 0) {
      var now = Date.now();
      var waitMs = Math.max(0, frameInterval - (now - lastRenderAt));

      scheduledTimeout = setTimeout(function () {
        scheduledTimeout = null;
        renderNow();
      }, waitMs);
      return;
    }

    if (typeof requestAnimationFrame !== "function") {
      renderNow();
      return;
    }

    scheduledFrame = requestAnimationFrame(function () {
      scheduledFrame = null;
      renderNow();
    });
  }

  function render() {
    if (scheduledFrame !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(scheduledFrame);
      scheduledFrame = null;
    }

    if (scheduledTimeout !== null) {
      clearTimeout(scheduledTimeout);
      scheduledTimeout = null;
    }

    renderNow();
  }

  function setBuildInfo(buildInfo) {
    state.build = {
      version: buildInfo.version || state.build.version,
      sha: buildInfo.sha || state.build.sha,
    };
    scheduleRender();
  }

  function setRovState(rovState) {
    state.rov = {
      lat: rovState.lat === undefined ? state.rov.lat : rovState.lat,
      lon: rovState.lon === undefined ? state.rov.lon : rovState.lon,
      heading: rovState.heading === undefined ? state.rov.heading : rovState.heading,
    };
    scheduleRender();
  }

  function setMapState(mapState) {
    state.map = {
      lat: mapState.lat === undefined ? state.map.lat : mapState.lat,
      lon: mapState.lon === undefined ? state.map.lon : mapState.lon,
      zoom: mapState.zoom === undefined ? state.map.zoom : mapState.zoom,
    };
    scheduleRender();
  }

  function log(message) {
    state.logs = [String(message)].concat(state.logs).slice(0, maxLogs);
    scheduleRender();
  }

  renderNow();

  return {
    log,
    render,
    setBuildInfo,
    setMapState,
    setRovState,
  };
}