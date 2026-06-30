export const ROV_VARIABLES = {
  LAT: "GLOBAL_POSITION_INT/lat",
  LON: "GLOBAL_POSITION_INT/lon",
  HDG: "GLOBAL_POSITION_INT/hdg",
};

function scaleValue(rawValue, divisor) {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }

  return rawValue / divisor;
}

const ROV_FIELDS = {
  lat: {
    variable: ROV_VARIABLES.LAT,
    normalize: function (rawValue) {
      return scaleValue(rawValue, 1e7);
    },
  },
  lon: {
    variable: ROV_VARIABLES.LON,
    normalize: function (rawValue) {
      return scaleValue(rawValue, 1e7);
    },
  },
  heading: {
    variable: ROV_VARIABLES.HDG,
    normalize: function (rawValue) {
      return scaleValue(rawValue, 100);
    },
  },
};

export function createRovInput(cockpit) {
  const emptySnapshot = { lat: null, lon: null, heading: null };
  let pendingUpdate = null;
  let emitScheduled = false;

  function isAvailable() {
    return Boolean(
      cockpit &&
        typeof cockpit.listenDataLakeVariable === "function" &&
        typeof cockpit.getDataLakeVariableData === "function"
    );
  }

  function readField(fieldName) {
    const field = ROV_FIELDS[fieldName];
    return field.normalize(cockpit.getDataLakeVariableData(field.variable));
  }

  function subscribeField(fieldName, callback) {
    const field = ROV_FIELDS[fieldName];

    cockpit.listenDataLakeVariable(field.variable, function () {
      const value = readField(fieldName);
      if (value !== null && callback) {
        pendingUpdate = {
          ...pendingUpdate,
          [fieldName]: value,
        };

        if (emitScheduled) {
          return;
        }

        emitScheduled = true;
        queueMicrotask(function () {
          emitScheduled = false;

          if (!pendingUpdate) {
            return;
          }

          var nextUpdate = pendingUpdate;
          pendingUpdate = null;
          callback(nextUpdate);
        });
      }
    });
  }

  function readSnapshot() {
    if (!isAvailable()) {
      return emptySnapshot;
    }

    return {
      lat: readField("lat"),
      lon: readField("lon"),
      heading: readField("heading"),
    };
  }

  function subscribe(handlers) {
    if (!isAvailable()) return false;

    subscribeField("lat", handlers.onUpdate);
    subscribeField("lon", handlers.onUpdate);
    subscribeField("heading", handlers.onUpdate);

    return true;
  }

  return {
    isAvailable,
    readSnapshot,
    subscribe,
  };
}