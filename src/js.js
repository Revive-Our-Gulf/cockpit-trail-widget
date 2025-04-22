const ROVMap = (() => {
  const canvas = document.getElementById("mapCanvas");
  const ctx = canvas.getContext("2d");
  const positionDisplay = document.getElementById("currentPos");
  const mapContainer = document.getElementById("mapContainer");

  const CONSTANTS = {
    MIN_DISTANCE: 0.5,
    MAX_TRAIL_POINTS: 100,
    EARTH_RADIUS: 111320,
    BASE_SCALE: 20,
    MIN_SCALE: 0.1,
    MAX_SCALE: 20,
    TARGET_REACHED_THRESHOLD: 1.0,
    ROV_SIZE: 20,
  };

  const STYLES = {
    COLORS: {
      ROV: "white",
      TRAIL: "rgba(160, 0, 0, 1)",
      ACTIVE_TARGET_ICON: "limegreen",
      INACTIVE_TARGET_ICON: "white",
      TARGET_LINE: "white",
      DISTANCE_LINE_PRIMARY: "limegreen",
      DISTANCE_LINE_SECONDARY: "#999999",
      // GRID: "rgba(68, 68, 68, 0.5)",
      GRID: "rgba(255, 255, 255, 0.1)",
      NORTH: "#FF4444",
    },
    LINES: {
      TRAIL: 3,
      TARGET: 5,
      TARGET_LINE: 3,
    },
  };

  const MAVLINK_VARS = {
    LAT: "GLOBAL_POSITION_INT/lat",
    LON: "GLOBAL_POSITION_INT/lon",
    HDG: "GLOBAL_POSITION_INT/hdg",
  };

  let state = {
    trail: [],
    firstPoint: null,
    currentHeading: 0,
    currentPosition: { lat: null, lon: null },
    targets: [],
    activeTargetIndex: -1,
    scale: 1,
    gridOrigin: { lat: null, lon: null },
    gridOffset: { x: 0, y: 0 },
    lastPosition: { lat: null, lon: null },
    viewMode: "rov-up",
  };

  let uiState = {
    initialPinchDistance: 0,
    lastScale: 1,
  };

  const helpers = {
    resizeCanvas() {
      canvas.width = mapContainer.clientWidth;
      canvas.height = mapContainer.clientHeight;
      render.requestDraw();
    },
    latLonToMeters(lat, lon, refLat, refLon) {
      const latMeters = (lat - refLat) * CONSTANTS.EARTH_RADIUS;
      const lonMeters =
        (lon - refLon) *
        CONSTANTS.EARTH_RADIUS *
        Math.cos((refLat * Math.PI) / 180);
      return { x: lonMeters, y: -latMeters };
    },
    metersToPixels(meters, scaleFactor = CONSTANTS.BASE_SCALE) {
      return meters * scaleFactor;
    },
    worldToScreen(meters) {
      return {
        x: canvas.width / 2 + helpers.metersToPixels(meters.x) * state.scale,
        y: canvas.height / 2 + helpers.metersToPixels(meters.y) * state.scale,
      };
    },
    toScreenCoordinates(point, applyScale = true) {
      if (!point || !point.x || !point.y) return null;

      return {
        x: canvas.width / 2 + point.x * (applyScale ? state.scale : 1),
        y: canvas.height / 2 + point.y * (applyScale ? state.scale : 1),
      };
    },
    getGridSpacing() {
      const candidateSteps = [
        1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
      ];
      const minPixelSpacing = 60;
      const effectiveScale = CONSTANTS.BASE_SCALE * state.scale;

      for (let step of candidateSteps) {
        if (step * effectiveScale >= minPixelSpacing) {
          return step;
        }
      }
      return candidateSteps[candidateSteps.length - 1];
    },
    setCookie(name, value, days) {
      const d = new Date();
      d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
      const expires = "expires=" + d.toUTCString();
      document.cookie =
        name + "=" + encodeURIComponent(value) + ";" + expires + ";path=/";
    },
    getCookie(name) {
      const cname = name + "=";
      const decodedCookie = decodeURIComponent(document.cookie);
      const ca = decodedCookie.split(";");
      for (let c of ca) {
        while (c.charAt(0) === " ") {
          c = c.substring(1);
        }
        if (c.indexOf(cname) === 0) {
          return c.substring(cname.length, c.length);
        }
      }
      return "";
    },
    drawMarker(ctx, x, y, size, color, lineWidth) {
      this.drawLine(ctx, x - size, y - size, x + size, y + size, {
        color,
        width: lineWidth,
      });
      this.drawLine(ctx, x + size, y - size, x - size, y + size, {
        color,
        width: lineWidth,
      });
    },

    drawLine(ctx, startX, startY, endX, endY, style = {}) {
      ctx.save();
      ctx.strokeStyle = style.color || STYLES.COLORS.TRAIL;
      ctx.lineWidth = style.width || STYLES.LINES.TRAIL;
      if (style.shadow) {
        ctx.shadowColor = style.shadowColor || "rgba(0, 0, 0, 0.5)";
        ctx.shadowBlur = style.shadowBlur || 10;
      }
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.restore();
    },
  };

  const geoUtils = {
    latLonToScreenPos(pos, applyScale = true) {
      const ref = state.currentPosition;

      const latMeters = (pos.lat - ref.lat) * CONSTANTS.EARTH_RADIUS;
      const lonMeters =
        (pos.lon - ref.lon) *
        CONSTANTS.EARTH_RADIUS *
        Math.cos((ref.lat * Math.PI) / 180);

      const x = lonMeters * CONSTANTS.BASE_SCALE;
      const y = -latMeters * CONSTANTS.BASE_SCALE;

      return {
        x: canvas.width / 2 + x * (applyScale ? state.scale : 1),
        y: canvas.height / 2 + y * (applyScale ? state.scale : 1),
      };
    },

    getDistance(pos1, pos2) {
      if (!pos1 || !pos2) return 0;

      const latDiff = (pos1.lat - pos2.lat) * CONSTANTS.EARTH_RADIUS;
      const lonDiff =
        (pos1.lon - pos2.lon) *
        CONSTANTS.EARTH_RADIUS *
        Math.cos(((pos1.lat + pos2.lat) / 2) * (Math.PI / 180));

      return Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
    },

    getBearing(from, to) {
      const dLon = (to.lon - from.lon) * (Math.PI / 180);
      const y = Math.sin(dLon) * Math.cos(to.lat * (Math.PI / 180));
      const x =
        Math.cos(from.lat * (Math.PI / 180)) *
          Math.sin(to.lat * (Math.PI / 180)) -
        Math.sin(from.lat * (Math.PI / 180)) *
          Math.cos(to.lat * (Math.PI / 180)) *
          Math.cos(dLon);
      const bearing = Math.atan2(y, x) * (180 / Math.PI);
      return (bearing + 360) % 360;
    },

    isTargetVisible(target, padding = 50) {
      const pos = this.latLonToScreenPos(target, false);
      if (!pos) return false;

      const scaledX = pos.x * state.scale;
      const scaledY = pos.y * state.scale;

      const diagonal = Math.sqrt(
        Math.pow(canvas.width / 2, 2) + Math.pow(canvas.height / 2, 2)
      );

      const distance = Math.sqrt(scaledX * scaledX + scaledY * scaledY);
      return distance < diagonal + padding;
    },
  };

  const targets = {
    saveTargets() {
      helpers.setCookie(
        "cockpit-trail-widget-targets",
        JSON.stringify(state.targets),
        365
      );
    },
    loadTargets() {
      const cookieVal = helpers.getCookie("cockpit-trail-widget-targets");
      if (cookieVal) {
        try {
          state.targets = JSON.parse(cookieVal);
          if (state.targets && state.targets.length > 0) {
            state.activeTargetIndex = 0;
            const container = document.getElementById("addedTargetsContainer");
            container.innerHTML = "";
            state.targets.forEach((target, index) => {
              targets.createTargetEntry(index);
            });
          }
        } catch (e) {
          console.error("Error parsing targets cookie", e);
        }
      }
    },
    createTargetEntry(index) {
      const inputGroup = document.createElement("div");
      inputGroup.className = "target-input-group";
      inputGroup.dataset.index = index;
      inputGroup.innerHTML = `
      <div class="target-entry" style="display: flex; align-items: center;">
        <div class="v-btn v-btn--icon v-theme--dark v-btn--density-compact v-btn--size-small v-btn--variant-text drag-handle mr-2">
          <i class="mdi-drag-vertical mdi v-icon notranslate v-theme--dark v-icon--size-default"></i>
        </div>
        <div class="v-input v-input--horizontal v-input--center-affix v-input--density-compact v-theme--light v-text-field" style="flex-grow: 1;">
          <div class="v-input__control">
            <div class="v-field v-field--active v-field--center-affix v-field--variant-outlined v-theme--light">
              <div class="v-field__overlay"></div>
              <div class="v-field__field" data-no-activator>
                <label class="v-label v-field-label">Target ${index + 1}</label>
                <input type="text" class="v-field__input targetCoords">
              </div>
              <div class="v-field__outline">
                <div class="v-field__outline__start"></div>
                <div class="v-field__outline__notch">
                  <label class="v-label v-field-label v-field-label--floating">Target ${
                    index + 1
                  }</label>
                </div>
                <div class="v-field__outline__end"></div>
              </div>
            </div>
          </div>
        </div>
        <button type="button" class="v-btn v-btn--icon v-theme--dark v-btn--density-compact v-btn--size-default v-btn--variant-text select-target mx-2">
          <i class="mdi-target mdi v-icon notranslate v-theme--dark v-icon--size-default"></i>
        </button>
        <button type="button" class="v-btn v-btn--icon v-theme--dark v-btn--density-compact v-btn--size-default v-btn--variant-text remove-target">
          <i class="mdi-close mdi v-icon notranslate v-theme--dark v-icon--size-default"></i>
        </button>
      </div>
    `;

      const targetInput = inputGroup.querySelector(".targetCoords");
      targetInput.value = `${state.targets[index].lat}, ${state.targets[index].lon}`;

      targetInput.addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
          const value = targetInput.value;
          const coords = value.split(",");
          if (coords.length !== 2) {
            console.log("Invalid coordinate format. Use lat,lon");
            return;
          }
          const lat = parseFloat(coords[0].trim());
          const lon = parseFloat(coords[1].trim());
          if (isNaN(lat) || isNaN(lon)) {
            console.log("Invalid coordinates");
            return;
          }
          state.targets[index] = { lat, lon };
          targetInput.value = `${lat}, ${lon}`;
          render.requestDraw();;
          targets.saveTargets();
        }
      });

      document.getElementById("addedTargetsContainer").appendChild(inputGroup);
      targets.setupTargetEntryListeners(inputGroup, index);
      targets.setupDragForElement(inputGroup);
    },

    setupDragAndDrop() {
      const targetContainer = document.getElementById("addedTargetsContainer");

      const observer = new MutationObserver((mutations) => {
        for (let mutation of mutations) {
          if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
            mutation.addedNodes.forEach((node) => {
              if (
                node.classList &&
                node.classList.contains("target-input-group")
              ) {
                this.setupDragForElement(node);
              }
            });
          }
        }
      });

      observer.observe(targetContainer, { childList: true });
    },

    setupDragForElement(element) {
      const dragHandle = element.querySelector(".drag-handle");
      if (!dragHandle) return;

      dragHandle.style.cursor = "grab";

      let draggedElement = null;
      let startY = 0;
      let startIndex = 0;

      const handleMouseMove = (e) => {
        if (!draggedElement) return;

        const container = document.getElementById("addedTargetsContainer");
        const children = Array.from(container.children);

        const currentY = e.clientY;

        const targetElements = children.filter((el) => el !== draggedElement);
        let swapWith = null;

        targetElements.forEach((el) => {
          const box = el.getBoundingClientRect();
          const centerY = box.top + box.height / 2;

          if (currentY < centerY && currentY > box.top) {
            swapWith = el;
          } else if (currentY > centerY && currentY < box.bottom) {
            swapWith = el;
          }
        });

        if (swapWith) {
          const newIndex = parseInt(swapWith.dataset.index);

          [state.targets[startIndex], state.targets[newIndex]] = [
            state.targets[newIndex],
            state.targets[startIndex],
          ];

          targets.compactTargets();
          targets.saveTargets();

          draggedElement = document.querySelector(
            `.target-input-group[data-index="${newIndex}"]`
          );
          draggedElement.classList.add("target-dragging");
          startIndex = newIndex;
          startY = currentY;
        }
      };

      const handleMouseUp = () => {
        if (!draggedElement) return;

        draggedElement.classList.remove("target-dragging");
        draggedElement = null;
        document.body.style.cursor = "";

        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);

        render.requestDraw();;
      };

      const newDragHandle = dragHandle.cloneNode(true);
      dragHandle.parentNode.replaceChild(newDragHandle, dragHandle);

      newDragHandle.addEventListener("mousedown", (e) => {
        draggedElement = element;
        startY = e.clientY;
        startIndex = parseInt(element.dataset.index);

        document.body.style.cursor = "grabbing";

        element.classList.add("target-dragging");

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);

        e.preventDefault();
      });
    },

    setupTargetEntryListeners(inputGroup, index) {
      const selectBtn = inputGroup.querySelector(".select-target");
      const removeBtn = inputGroup.querySelector(".remove-target");

      selectBtn.addEventListener("click", () => {
        state.activeTargetIndex = index;
        render.requestDraw();;
      });

      removeBtn.addEventListener("click", () => {
        state.targets.splice(index, 1);
        targets.compactTargets();
        render.requestDraw();;
        targets.saveTargets();
      });
    },

    compactTargets() {
      state.targets = state.targets.filter((target) => target !== null);

      const container = document.getElementById("addedTargetsContainer");
      container.innerHTML = "";

      state.targets.forEach((target, index) => {
        targets.createTargetEntry(index);
        const targetSpan = container.querySelector(
          `.target-input-group[data-index="${index}"] .targetCoords`
        );
        if (targetSpan) {
          targetSpan.textContent = `${target.lat}, ${target.lon}`;
        }
      });

      if (state.activeTargetIndex !== -1) {
        state.activeTargetIndex = state.targets.findIndex(
          (target, i) => i === state.activeTargetIndex
        );
      }
    },

    setupNewTargetInput() {
      const newTargetGroup = document.getElementById("newTargetInput");
      const input = newTargetGroup.querySelector(".newTargetCoords");
      const addBtn = newTargetGroup.querySelector(".add-new-target");

      const submitNewTarget = () => {
        const value = input.value;
        const coords = value.split(",");
        if (coords.length !== 2) {
          console.log("Invalid coordinate format. Use lat,lon");
          return;
        }
        const lat = parseFloat(coords[0].trim());
        const lon = parseFloat(coords[1].trim());
        if (isNaN(lat) || isNaN(lon)) {
          console.log("Invalid coordinates");
          return;
        }
        const newIndex = state.targets.length;
        state.targets.push({ lat, lon });
        targets.createTargetEntry(newIndex);
        state.activeTargetIndex = newIndex;
        render.requestDraw();;
        input.value = "";
        targets.saveTargets();
      };

      addBtn.addEventListener("click", submitNewTarget);
      input.addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          submitNewTarget();
        }
      });
    },

    addDragStyles() {
      const style = document.createElement("style");
      style.textContent = `
      .target-dragging {
        opacity: 0.8;
        background-color: rgba(0, 0, 0, 0.1);
        box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
        position: relative;
        z-index: 1000;
        transition: transform 0.1s;
      }
      .drag-handle {
        cursor: grab;
      }
      .drag-handle:active {
        cursor: grabbing;
      }
      `;
      document.head.appendChild(style);
    },
  };

  const render = {
    animationFrameId: null,
    updatePending: false,
    fps: 10, // Target frame rate
    lastFrameTime: 0,

    startAnimationLoop() {
      const frameInterval = 1000 / this.fps;
      
      const animationLoop = (timestamp) => {
        // Calculate elapsed time since last frame
        const elapsed = timestamp - this.lastFrameTime;
        
        // Only draw if enough time has passed for the target frame rate
        // OR if an update was specifically requested
        if (elapsed >= frameInterval || this.updatePending) {
          this.lastFrameTime = timestamp - (elapsed % frameInterval);
          this.draw();
          this.updatePending = false;
        }
        
        this.animationFrameId = requestAnimationFrame(animationLoop);
      };
      
      this.animationFrameId = requestAnimationFrame(animationLoop);
    },

    stopAnimationLoop() {
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
    },

    requestDraw() {
      // this.updatePending = true;
    },

    applyViewRotation(drawingFunction) {
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);

      // Only apply heading rotation in 'rov-up' mode
      if (state.viewMode === "rov-up") {
        ctx.rotate(-state.currentHeading * (Math.PI / 180));
      }

      ctx.translate(-canvas.width / 2, -canvas.height / 2);

      // Execute the provided drawing function
      drawingFunction();

      ctx.restore();
    },

    draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.drawGrid();
      this.drawTrailPath();
      this.drawTargets();
      this.drawROV();
      this.drawScaleIndicator();
    },

    drawROV() {
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
    
      // In north-up mode, we need to rotate the ROV icon to match its heading
      if (state.viewMode === "north-up") {
        ctx.rotate(state.currentHeading * (Math.PI / 180));
      }
    
      ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
      ctx.shadowBlur = 30;
      ctx.beginPath();
      ctx.moveTo(0, -CONSTANTS.ROV_SIZE);
      ctx.lineTo(CONSTANTS.ROV_SIZE, CONSTANTS.ROV_SIZE);
      ctx.lineTo(0, CONSTANTS.ROV_SIZE / 2);
      ctx.lineTo(-CONSTANTS.ROV_SIZE, CONSTANTS.ROV_SIZE);
      ctx.closePath();
      ctx.fillStyle = STYLES.COLORS.ROV;
      ctx.fill();
    
      // Save context again before drawing north indicator
      ctx.save();
      
      // If in north-up mode, counter-rotate to keep north indicator steady
      if (state.viewMode === "north-up") {
        ctx.rotate(-state.currentHeading * (Math.PI / 180));
      }
    
      // Now draw the north indicator (will be fixed in north-up mode)
      const northAngle = -state.currentHeading * (Math.PI / 180);
      const northLength = 55;
      const northX = Math.sin(northAngle) * northLength;
      const northY = -Math.cos(northAngle) * northLength;
      
      // In north-up mode, north always points up
      if (state.viewMode === "north-up") {
        helpers.drawLine(ctx, 0, 0, 0, -northLength, {
          color: STYLES.COLORS.NORTH,
          width: 3.5,
        });
        
        // Arrow for north indicator
        const arrowWidth = 12;
        ctx.beginPath();
        ctx.fillStyle = STYLES.COLORS.NORTH;
        ctx.moveTo(0, -northLength);
        ctx.lineTo(-arrowWidth/2, -northLength + 10);
        ctx.lineTo(arrowWidth/2, -northLength + 10);
        ctx.closePath();
        ctx.fill();
        
        // "N" label
        ctx.fillStyle = STYLES.COLORS.NORTH;
        ctx.font = "bold 16px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("N", 0, -northLength - 10);
      } else {
        // Original north indicator for ROV-up mode
        helpers.drawLine(ctx, 0, 0, northX, northY, {
          color: STYLES.COLORS.NORTH,
          width: 3.5,
        });
        
        // Arrow
        const arrowLength = 10;
        const arrowWidth = 12;
        ctx.beginPath();
        ctx.fillStyle = STYLES.COLORS.NORTH;
        ctx.moveTo(northX, northY);
        const baseX = northX - Math.sin(northAngle) * arrowLength;
        const baseY = northY + Math.cos(northAngle) * arrowLength;
        const perpAngle = northAngle + Math.PI / 2;
        const offsetX = (Math.sin(perpAngle) * arrowWidth) / 2;
        const offsetY = (-Math.cos(perpAngle) * arrowWidth) / 2;
        ctx.lineTo(baseX + offsetX, baseY + offsetY);
        ctx.lineTo(baseX - offsetX, baseY - offsetY);
        ctx.closePath();
        ctx.fill();
        
        // "N" label
        ctx.fillStyle = STYLES.COLORS.NORTH;
        ctx.font = "bold 16px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const labelDistance = northLength + 10;
        const labelX = Math.sin(northAngle) * labelDistance;
        const labelY = -Math.cos(northAngle) * labelDistance;
        ctx.fillText("N", labelX, labelY);
      }
      
      // Restore context after drawing north indicator
      ctx.restore();
      ctx.restore();
    },

    drawTrailPath() {
      if (
        !state.currentPosition.lat ||
        !state.currentPosition.lon ||
        state.trail.length < 2
      )
        return;
    
      this.applyViewRotation(() => {
        // Get base color components from the trail color
        const trailColorBase = STYLES.COLORS.TRAIL;
        const isRgba = trailColorBase.startsWith('rgba');
        const baseColor = isRgba ? trailColorBase.substring(0, trailColorBase.lastIndexOf(',')) : 'rgba(160, 0, 0';
        
        for (let i = 1; i < state.trail.length; i++) {
          const prevPoint = state.trail[i - 1];
          const currentPoint = state.trail[i];
    
          const opacity = Math.max(0.1, i / state.trail.length);
          const trailColor = `${baseColor}, ${opacity})`;
          
          const prevScreenPos = geoUtils.latLonToScreenPos(prevPoint, true);
          const currentScreenPos = geoUtils.latLonToScreenPos(
            currentPoint,
            true
          );
    
          helpers.drawLine(
            ctx,
            prevScreenPos.x,
            prevScreenPos.y,
            currentScreenPos.x,
            currentScreenPos.y,
            {
              color: trailColor,
              width: STYLES.LINES.TRAIL,
            }
          );
        }
      });
    },

    drawTargets() {
      if (
        !state.firstPoint ||
        !state.targets.length ||
        !state.currentPosition.lat ||
        !state.currentPosition.lon
      )
        return;

      this.applyViewRotation(() => {
        this._drawTargetConnections();
        this._drawActiveTargetLine();
        this._drawPreviousTargetLine();
        this._drawTargetMarkers();
      });
    },

    _drawLineWithTextGap(start, end, textPosition, style = {}) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const textDist = Math.sqrt(
        Math.pow(textPosition.x - start.x, 2) +
          Math.pow(textPosition.y - start.y, 2)
      );
      const totalDist = Math.sqrt(dx * dx + dy * dy);
      const dirX = dx / totalDist;
      const dirY = dy / totalDist;
      const gapSize = 25;
      const gapStart = {
        x: textPosition.x - gapSize * dirX,
        y: textPosition.y - gapSize * dirY,
      };
      const gapEnd = {
        x: textPosition.x + gapSize * dirX,
        y: textPosition.y + gapSize * dirY,
      };

      ctx.beginPath();
      if (style.dashed) {
        ctx.setLineDash(style.dashed);
      } else {
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = style.color || STYLES.COLORS.DISTANCE_LINE_PRIMARY;
      ctx.lineWidth = style.width || STYLES.LINES.TARGET_LINE;

      ctx.moveTo(start.x, start.y);
      ctx.lineTo(gapStart.x, gapStart.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(gapEnd.x, gapEnd.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();

      ctx.setLineDash([]);
    },

    _drawTargetConnections() {
      ctx.beginPath();
      ctx.strokeStyle = "#999999";
      ctx.lineWidth = STYLES.LINES.TARGET_LINE;

      state.targets.forEach((target, index) => {
        if (!target) return;
        const screenPos = geoUtils.latLonToScreenPos(target);

        if (index > 0 && state.targets[index - 1]) {
          const prevScreenPos = geoUtils.latLonToScreenPos(
            state.targets[index - 1]
          );

          helpers.drawLine(
            ctx,
            prevScreenPos.x,
            prevScreenPos.y,
            screenPos.x,
            screenPos.y,
            {
              color: STYLES.COLORS.TARGET_LINE,
              width: STYLES.LINES.TARGET_LINE,
            }
          );
        }
      });
    },

    _drawTargetLine(targetIndex, lineColor, textColor) {
      if (
        targetIndex === -1 ||
        !state.targets[targetIndex] ||
        !state.currentPosition.lat ||
        !state.currentPosition.lon
      )
        return;

      const target = state.targets[targetIndex];
      const scaledTarget = geoUtils.latLonToScreenPos(target);
      const currentPixels = { x: canvas.width / 2, y: canvas.height / 2 };

      const { lineEndPoint, textPosition, angle } =
        this._calculateLineEndpoints(currentPixels, scaledTarget);

      ctx.beginPath();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = STYLES.LINES.TARGET_LINE;
      ctx.setLineDash([5, 5]);
      ctx.moveTo(currentPixels.x, currentPixels.y);
      ctx.lineTo(lineEndPoint.x, lineEndPoint.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const distanceMeters = geoUtils.getDistance(
        state.currentPosition,
        target
      );
      this._drawDistanceLabel(textPosition, distanceMeters, textColor, angle);
    },

    _drawActiveTargetLine() {
      this._drawTargetLine(
        state.activeTargetIndex,
        STYLES.COLORS.DISTANCE_LINE_PRIMARY,
        STYLES.COLORS.DISTANCE_LINE_PRIMARY
      );
    },

    _drawPreviousTargetLine() {
      if (state.activeTargetIndex === -1 || state.targets.length <= 1) return;

      const prevIndex =
        (state.activeTargetIndex - 1 + state.targets.length) %
        state.targets.length;

      if (prevIndex === state.activeTargetIndex) return;

      this._drawTargetLine(
        prevIndex,
        STYLES.COLORS.DISTANCE_LINE_SECONDARY,
        STYLES.COLORS.DISTANCE_LINE_SECONDARY
      );
    },

    _calculateLineEndpoints(start, end) {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Calculate the angle of the line
      const angle = Math.atan2(dy, dx);

      if (distance < 10) {
        // For very close points, position text slightly offset
        return {
          lineEndPoint: end,
          textPosition: {
            x: (start.x + end.x) / 2 + 20,
            y: (start.y + end.y) / 2 - 10,
          },
          angle: angle,
        };
      }

      const dirX = dx / distance;
      const dirY = dy / distance;

      // Calculate perpendicular direction for text offset
      const perpX = -dirY;
      const perpY = dirX;
      const offsetDistance = 30; // Offset distance from line

      const diagonal =
        Math.sqrt(Math.pow(canvas.width, 2) + Math.pow(canvas.height, 2)) / 2;
      const isTargetVisible = distance < diagonal;

      let lineEndPoint;
      if (isTargetVisible) {
        lineEndPoint = { x: end.x, y: end.y };
      } else {
        const extendedDistance = diagonal * 1.5;
        lineEndPoint = {
          x: start.x + dirX * extendedDistance,
          y: start.y + dirY * extendedDistance,
        };
      }

      const textDistance = isTargetVisible
        ? distance / 2
        : Math.min(distance / 2, diagonal / 2);

      // Position text beside the line by adding perpendicular offset
      const textPosition = {
        x: start.x + dirX * textDistance + perpX * offsetDistance,
        y: start.y + dirY * textDistance + perpY * offsetDistance,
      };

      return { lineEndPoint, textPosition, angle };
    },

    _drawDistanceLabel(position, distanceMeters, textColour, angle) {
      const distanceText = distanceMeters.toFixed(1) + " m";
      ctx.save();
      ctx.translate(position.x, position.y);
      
      ctx.rotate(angle + Math.PI / 2);
      
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const textWidth = ctx.measureText(distanceText).width;
      ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
      ctx.fillRect(-textWidth / 2 - 4, -14, textWidth + 8, 28);
      ctx.fillStyle = textColour;
      ctx.fillText(distanceText, 0, 0);
      ctx.restore();
    },

    _drawTargetMarkers() {
      state.targets.forEach((target, index) => {
        if (!target) return;

        const screenPos = geoUtils.latLonToScreenPos(target);

        const size = 12;
        const color =
          index === state.activeTargetIndex
            ? STYLES.COLORS.ACTIVE_TARGET_ICON
            : STYLES.COLORS.INACTIVE_TARGET_ICON;

        helpers.drawMarker(
          ctx,
          screenPos.x,
          screenPos.y,
          size,
          color,
          STYLES.LINES.TARGET
        );
      });
    },

    drawGrid() {
      if (!state.currentPosition.lat || !state.currentPosition.lon) return;

      this.applyViewRotation(() => {
        const gridParams = this._calculateGridParameters();
        this._drawGridLines(ctx, gridParams);
      });
    },

    _calculateGridParameters() {
      const gridSpacing = helpers.getGridSpacing();
      const effectiveMultiplier = CONSTANTS.BASE_SCALE * state.scale;

      // Calculate grid boundaries with padding for rotation
      const diagonal = Math.sqrt(
        canvas.width * canvas.width + canvas.height * canvas.height
      );
      const extraPadding = diagonal / 2;

      return {
        gridSpacing,
        effectiveMultiplier,
        bounds: {
          left: -(canvas.width / 2 + extraPadding) / effectiveMultiplier,
          right: (canvas.width / 2 + extraPadding) / effectiveMultiplier,
          top: -(canvas.height / 2 + extraPadding) / effectiveMultiplier,
          bottom: (canvas.height / 2 + extraPadding) / effectiveMultiplier,
        },
        offset: {
          x: state.gridOffset.x % gridSpacing,
          y: state.gridOffset.y % gridSpacing,
        },
      };
    },

    _drawGridLines(ctx, params) {
      const { gridSpacing, bounds, offset } = params;

      ctx.beginPath();
      ctx.strokeStyle = STYLES.COLORS.GRID;
      ctx.lineWidth = 1;

      const startX =
        Math.floor(bounds.left / gridSpacing) * gridSpacing - offset.x;
      const endX =
        Math.ceil(bounds.right / gridSpacing) * gridSpacing - offset.x;

      for (let x = startX; x <= endX; x += gridSpacing) {
        const start = helpers.worldToScreen({ x, y: bounds.top });
        const end = helpers.worldToScreen({ x, y: bounds.bottom });
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
      }

      const startY =
        Math.floor(bounds.top / gridSpacing) * gridSpacing - offset.y;
      const endY =
        Math.ceil(bounds.bottom / gridSpacing) * gridSpacing - offset.y;

      for (let y = startY; y <= endY; y += gridSpacing) {
        const start = helpers.worldToScreen({ x: bounds.left, y });
        const end = helpers.worldToScreen({ x: bounds.right, y });
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
      }

      ctx.stroke();
    },

    drawScaleIndicator() {
      const gridSpacing = helpers.getGridSpacing();
      const formattedValue =
        gridSpacing >= 1000
          ? (gridSpacing / 1000).toFixed(1) + " km"
          : gridSpacing.toFixed(1) + " m";

      const padding = 20;
      const x = canvas.width - padding;
      const y = canvas.height - padding;

      ctx.save();
      ctx.font = "bold 20px Arial";

      ctx.fillStyle = "grey";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(formattedValue, x, y - 8);
      ctx.restore();
    },
  };

  const mavlink = {
    handleLatitude() {
      const lat =
        window.cockpit.getDataLakeVariableData(MAVLINK_VARS.LAT) / 1e7;
      if (lat === undefined) return;

      state.currentPosition.lat = lat;
      mavlink.updatePosition();
    },

    handleLongitude() {
      const lon =
        window.cockpit.getDataLakeVariableData(MAVLINK_VARS.LON) / 1e7;
      if (lon === undefined) return;

      state.currentPosition.lon = lon;
      mavlink.updatePosition();
    },

    handleHeading() {
      const heading =
        window.cockpit.getDataLakeVariableData(MAVLINK_VARS.HDG) / 100;
      if (heading === undefined) return;

      state.currentHeading = heading;
      render.requestDraw();;
    },

    updatePosition() {
      if (!state.currentPosition.lat || !state.currentPosition.lon) return;

      const { lat, lon } = state.currentPosition;

      if (!state.gridOrigin.lat) {
        state.gridOrigin.lat = lat;
        state.gridOrigin.lon = lon;
      }

      if (state.lastPosition.lat !== null) {
        const movement = helpers.latLonToMeters(
          lat,
          lon,
          state.lastPosition.lat,
          state.lastPosition.lon
        );
        state.gridOffset.x += movement.x;
        state.gridOffset.y += movement.y;
      }

      state.lastPosition.lat = lat;
      state.lastPosition.lon = lon;

      if (!state.firstPoint) {
        state.firstPoint = { lat, lon };
      }

      if (
        state.trail.length === 0 ||
        geoUtils.getDistance(
          { lat, lon },
          state.trail[state.trail.length - 1]
        ) >= CONSTANTS.MIN_DISTANCE
      ) {
        state.trail.push({ lat, lon });
        if (state.trail.length > CONSTANTS.MAX_TRAIL_POINTS)
          state.trail.shift();
      }

      positionDisplay.innerText = `ROV: ${lat.toFixed(7)}°, ${lon.toFixed(7)}°`;

      this.checkTargetProximity();

      render.requestDraw();;
    },

    checkTargetProximity() {
      if (
        state.activeTargetIndex === -1 ||
        !state.targets.length ||
        !state.currentPosition.lat ||
        !state.currentPosition.lon
      ) {
        return;
      }

      const currentTarget = state.targets[state.activeTargetIndex];
      const distanceToTarget = geoUtils.getDistance(
        state.currentPosition,
        currentTarget
      );

      if (distanceToTarget <= CONSTANTS.TARGET_REACHED_THRESHOLD) {
        console.log(
          `Target ${
            state.activeTargetIndex + 1
          } reached! Distance: ${distanceToTarget.toFixed(2)}m`
        );

        state.activeTargetIndex =
          (state.activeTargetIndex + 1) % state.targets.length;
        console.log(`Moving to target ${state.activeTargetIndex + 1}`);

        render.requestDraw();;
      }
    },

    setupListeners() {
      window.cockpit.listenDataLakeVariable(
        MAVLINK_VARS.LAT,
        this.handleLatitude
      );
      window.cockpit.listenDataLakeVariable(
        MAVLINK_VARS.LON,
        this.handleLongitude
      );
      window.cockpit.listenDataLakeVariable(
        MAVLINK_VARS.HDG,
        this.handleHeading
      );
    },
  };

  const events = {
    handleWheel(e) {
      e.preventDefault();
      const zoomFactor = 1.1;

      if (e.deltaY < 0) {
        state.scale *= zoomFactor;
      } else {
        state.scale /= zoomFactor;
      }

      state.scale = Math.max(
        CONSTANTS.MIN_SCALE,
        Math.min(state.scale, CONSTANTS.MAX_SCALE)
      );
      render.requestDraw();;
    },

    handleTouchStart(e) {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        uiState.initialPinchDistance = Math.sqrt(dx * dx + dy * dy);
        uiState.lastScale = state.scale;
      }
    },

    // Handle touch move for pinch zooming
    handleTouchMove(e) {
      if (e.touches.length === 2) {
        e.preventDefault();

        // Calculate pinch distance
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const pinchDistance = Math.sqrt(dx * dx + dy * dy);

        // Calculate new scale
        const scaleFactor = pinchDistance / uiState.initialPinchDistance;
        state.scale = uiState.lastScale * scaleFactor;

        // Apply scale limits
        state.scale = Math.max(
          CONSTANTS.MIN_SCALE,
          Math.min(state.scale, CONSTANTS.MAX_SCALE)
        );

        render.requestDraw();;
      }
    },

    // Handle double click to reset grid
    handleDoubleClick() {
      state.gridOffset = { x: 0, y: 0 };
      if (state.currentPosition.lat) {
        state.gridOrigin.lat = state.currentPosition.lat;
        state.gridOrigin.lon = state.currentPosition.lon;
      }
      render.requestDraw();;
    },

    // Handle target container toggle
    handleToggleTargetContainer() {
      const targetContainer = document.getElementById("targetContainer");
      const chevronIcon = document.getElementById("targetChevron");

      if (targetContainer.style.display === "none") {
        targetContainer.style.display = "block";
        chevronIcon.className =
          "mdi mdi-chevron-up v-icon notranslate v-theme--dark v-icon--size-default";
      } else {
        targetContainer.style.display = "none";
        chevronIcon.className =
          "mdi mdi-chevron-down v-icon notranslate v-theme--dark v-icon--size-default";
      }

      helpers.resizeCanvas();
    },

    // Set up all event listeners
    setupEventListeners() {
      // Resize handling
      window.addEventListener("resize", helpers.resizeCanvas);

      // Zooming with mousewheel
      canvas.addEventListener("wheel", this.handleWheel);

      // Touch events for pinch zoom
      canvas.addEventListener("touchstart", this.handleTouchStart);
      canvas.addEventListener("touchmove", this.handleTouchMove);

      // Double click to reset grid
      canvas.addEventListener("dblclick", this.handleDoubleClick);

      const targetContainer = document.getElementById("targetContainer");
      const chevronIcon = document.getElementById("targetChevron");

      targetContainer.style.display = "none";
      chevronIcon.className =
        "mdi mdi-chevron-down v-icon notranslate v-theme--dark v-icon--size-default";

      document
        .getElementById("toggleTargetContainer")
        .addEventListener("click", this.handleToggleTargetContainer);

      // Clear trail button if it exists
      const clearTrailBtn = document.getElementById("clearTrail");
      if (clearTrailBtn) {
        clearTrailBtn.addEventListener("click", () => {
          state.trail = [];
          render.requestDraw();;
        });
      }

      const clearTargetsBtn = document.getElementById("clearTargets");
      if (clearTargetsBtn) {
        clearTargetsBtn.addEventListener("click", () => {
          state.targets = [];
          state.activeTargetIndex = -1;
          document.getElementById("addedTargetsContainer").innerHTML = "";
          targets.saveTargets();
          render.requestDraw();;
        });
      }

      const viewModeBtn = document.getElementById("toggleViewMode");
      if (viewModeBtn) {
        viewModeBtn.addEventListener("click", () => {
          state.viewMode = state.viewMode === "rov-up" ? "north-up" : "rov-up";
          const icon = viewModeBtn.querySelector("i");
          if (icon) {
            icon.className =
              state.viewMode === "rov-up"
                ? "mdi mdi-compass v-icon notranslate v-theme--dark v-icon--size-default"
                : "mdi mdi-navigation v-icon notranslate v-theme--dark v-icon--size-default";
          }

          render.requestDraw();;
        });
      }
    },
  };

  const gpxImport = {
    // Parse GPX or KML file and extract waypoints
    parseFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
          const fileContent = e.target.result;
          const fileExtension = file.name.split(".").pop().toLowerCase();

          try {
            if (fileExtension === "gpx") {
              resolve(this.parseGPX(fileContent));
            } else if (fileExtension === "kml") {
              resolve(this.parseKML(fileContent));
            } else if (fileExtension === "kmz") {
              this.extractKMZ(fileContent)
                .then((kmlContent) => resolve(this.parseKML(kmlContent)))
                .catch(reject);
            } else {
              reject(new Error("Unsupported file format"));
            }
          } catch (error) {
            reject(error);
          }
        };

        reader.onerror = () => {
          reject(new Error("Error reading file"));
        };

        reader.readAsText(file);
      });
    },

    // Parse GPX content
    parseGPX(gpxText) {
      const parser = new DOMParser();
      const gpxDoc = parser.parseFromString(gpxText, "text/xml");

      // Check if parsing was successful
      if (gpxDoc.documentElement.nodeName === "parsererror") {
        throw new Error("Invalid GPX file");
      }

      const waypoints = [];

      // Extract waypoints (wpt elements)
      const wptNodes = gpxDoc.getElementsByTagName("wpt");
      for (let i = 0; i < wptNodes.length; i++) {
        const wpt = wptNodes[i];
        const lat = parseFloat(wpt.getAttribute("lat"));
        const lon = parseFloat(wpt.getAttribute("lon"));

        if (!isNaN(lat) && !isNaN(lon)) {
          let name = "";
          const nameNode = wpt.getElementsByTagName("name")[0];
          if (nameNode && nameNode.textContent) {
            name = nameNode.textContent;
          }

          waypoints.push({ lat, lon, name });
        }
      }

      // Extract track points (trkpt elements) if no waypoints found
      if (waypoints.length === 0) {
        const trkptNodes = gpxDoc.getElementsByTagName("trkpt");
        for (let i = 0; i < trkptNodes.length; i++) {
          const trkpt = trkptNodes[i];
          const lat = parseFloat(trkpt.getAttribute("lat"));
          const lon = parseFloat(trkpt.getAttribute("lon"));

          if (!isNaN(lat) && !isNaN(lon)) {
            waypoints.push({ lat, lon });
          }
        }
      }

      // Extract route points (rtept elements) if still no points found
      if (waypoints.length === 0) {
        const rteptNodes = gpxDoc.getElementsByTagName("rtept");
        for (let i = 0; i < rteptNodes.length; i++) {
          const rtept = rteptNodes[i];
          const lat = parseFloat(rtept.getAttribute("lat"));
          const lon = parseFloat(rtept.getAttribute("lon"));

          if (!isNaN(lat) && !isNaN(lon)) {
            waypoints.push({ lat, lon });
          }
        }
      }

      return waypoints;
    },

    // Parse KML content
    parseKML(kmlText) {
      const parser = new DOMParser();
      const kmlDoc = parser.parseFromString(kmlText, "text/xml");

      // Check if parsing was successful
      if (kmlDoc.documentElement.nodeName === "parsererror") {
        throw new Error("Invalid KML file");
      }

      const waypoints = [];

      // Extract Placemarks
      const placemarks = kmlDoc.getElementsByTagName("Placemark");
      for (let i = 0; i < placemarks.length; i++) {
        const placemark = placemarks[i];

        // Get name if available
        let name = "";
        const nameNode = placemark.getElementsByTagName("name")[0];
        if (nameNode && nameNode.textContent) {
          name = nameNode.textContent;
        }

        // Check for Point coordinates
        const points = placemark.getElementsByTagName("Point");
        if (points.length > 0) {
          const coordsNode = points[0].getElementsByTagName("coordinates")[0];
          if (coordsNode && coordsNode.textContent) {
            const coordStr = coordsNode.textContent.trim();
            const coords = coordStr.split(",");

            if (coords.length >= 2) {
              const lon = parseFloat(coords[0]);
              const lat = parseFloat(coords[1]);

              if (!isNaN(lat) && !isNaN(lon)) {
                waypoints.push({ lat, lon, name });
              }
            }
          }
          continue; // Skip to next placemark if we found a point
        }

        // Check for LineString or LinearRing coordinates
        const lineTypes = ["LineString", "LinearRing"];
        for (const lineType of lineTypes) {
          const lines = placemark.getElementsByTagName(lineType);
          if (lines.length > 0) {
            const coordsNode = lines[0].getElementsByTagName("coordinates")[0];
            if (coordsNode && coordsNode.textContent) {
              const coordsText = coordsNode.textContent.trim();
              const coordPairs = coordsText.split(/\s+/); // Split by whitespace

              coordPairs.forEach((pair) => {
                const coords = pair.split(",");
                if (coords.length >= 2) {
                  const lon = parseFloat(coords[0]);
                  const lat = parseFloat(coords[1]);

                  if (!isNaN(lat) && !isNaN(lon)) {
                    waypoints.push({ lat, lon });
                  }
                }
              });
            }
          }
        }
      }

      return waypoints;
    },

    // Placeholder for KMZ extraction (would need JSZip library for full implementation)
    extractKMZ(kmzContent) {
      return Promise.reject(
        new Error("KMZ files are not supported yet. Convert to KML first.")
      );
    },

    // Add waypoints as targets to the map
    addWaypointsAsTargets(waypoints) {
      if (!waypoints || waypoints.length === 0) return;

      state.targets = [];
      document.getElementById("addedTargetsContainer").innerHTML = "";

      // Add waypoints as targets
      waypoints.forEach((waypoint) => {
        const newIndex = state.targets.length;
        state.targets.push({ lat: waypoint.lat, lon: waypoint.lon });

        // Create UI entry for target
        targets.createTargetEntry(newIndex);
      });

      // Set the first imported waypoint as active
      state.activeTargetIndex = state.targets.length - waypoints.length;

      // Save targets and redraw
      targets.saveTargets();
      render.requestDraw();;
    },

    // Setup event listeners for file import
    setupGPXImport() {
      const importBtn = document.getElementById("importGpx");
      const fileInput = document.getElementById("gpxFileInput");

      if (fileInput) {
        // Update to accept KML files too
        fileInput.accept = ".gpx,.kml,.kmz";
      }

      if (importBtn && fileInput) {
        importBtn.addEventListener("click", () => {
          fileInput.click();
        });

        fileInput.addEventListener("change", async (event) => {
          if (event.target.files.length === 0) return;

          const file = event.target.files[0];
          try {
            const waypoints = await this.parseFile(file);
            console.log(
              `Imported ${waypoints.length} waypoints from ${file.name}`
            );

            if (waypoints.length === 0) {
              console.log("No waypoints found in the file");
              return;
            }

            // Add the waypoints as targets
            this.addWaypointsAsTargets(waypoints);
          } catch (error) {
            console.error(`Error importing file: ${error.message}`);
          }

          // Reset the file input so the same file can be selected again
          fileInput.value = "";
        });
      }
    },
  };

  // Public methods
  return {
    // Initialize the application
    init() {
      helpers.resizeCanvas();
      targets.setupNewTargetInput();
      targets.loadTargets();
      targets.setupDragAndDrop();
      targets.addDragStyles();
      events.setupEventListeners();
      mavlink.setupListeners();
      gpxImport.setupGPXImport();
      render.startAnimationLoop();
    },
  };
})();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => ROVMap.init());
} else {
  ROVMap.init();
}
