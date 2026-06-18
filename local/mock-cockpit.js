(function () {
  var vars = {
    "GLOBAL_POSITION_INT/lat": 0,
    "GLOBAL_POSITION_INT/lon": 0,
    "GLOBAL_POSITION_INT/hdg": 0,
  };

  var listeners = {};

  function emit(key) {
    var subs = listeners[key] || [];
    for (var i = 0; i < subs.length; i += 1) {
      subs[i]();
    }
  }

  window.cockpit = {
    listenDataLakeVariable: function (key, callback) {
      if (!listeners[key]) listeners[key] = [];
      listeners[key].push(callback);
    },
    getDataLakeVariableData: function (key) {
      return vars[key];
    },
  };

  var lat = 29.7604;
  var lon = -95.3698;
  var heading = 0;
  var speed = 0.6;

  function step() {
    var rad = (heading * Math.PI) / 180;
    lat += (speed * Math.cos(rad)) / 111320;
    lon += (speed * Math.sin(rad)) / (111320 * Math.cos((lat * Math.PI) / 180));
    heading = (heading + 3) % 360;

    vars["GLOBAL_POSITION_INT/lat"] = Math.round(lat * 1e7);
    vars["GLOBAL_POSITION_INT/lon"] = Math.round(lon * 1e7);
    vars["GLOBAL_POSITION_INT/hdg"] = Math.round(heading * 100);

    emit("GLOBAL_POSITION_INT/lat");
    emit("GLOBAL_POSITION_INT/lon");
    emit("GLOBAL_POSITION_INT/hdg");
  }

  step();
  setInterval(step, 400);
})();