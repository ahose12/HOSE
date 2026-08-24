/*
HOSE AREA INTELLIGENCE SATELLITE + PIN FIX
Replace public/app.js with this file ONLY if your current app.js is the spatial v2 build.
This patch keeps the existing app and replaces the Area Intelligence mapping functions.
*/

// ---- PATCH INSTALLER: runs after the existing app.js definitions are loaded ----
document.addEventListener("DOMContentLoaded", () => {
  // Wait for the app to finish its normal initialization.
  setTimeout(() => {
    installAreaIntelligenceSatelliteFix();
  }, 350);
});

function installAreaIntelligenceSatelliteFix() {
  if (typeof L === "undefined") {
    console.error("Leaflet is not loaded.");
    return;
  }

  // Add clear placement-state CSS without requiring a styles.css replacement.
  const style = document.createElement("style");
  style.textContent = `
    #areaMap.hose-placement-mode,
    #areaMap.hose-placement-mode .leaflet-container,
    #areaMap.hose-placement-mode .leaflet-grab,
    #areaMap.hose-placement-mode .leaflet-interactive {
      cursor: crosshair !important;
    }
    .hose-map-help {
      background: rgba(13,21,16,.94);
      color: #f1f5f0;
      border: 1px solid #a5be86;
      border-radius: 10px;
      padding: 8px 10px;
      font: 12px/1.3 system-ui,sans-serif;
      box-shadow: 0 2px 10px rgba(0,0,0,.25);
    }
  `;
  document.head.appendChild(style);

  // Replace the existing Area Intelligence map instance so we can guarantee
  // correct click behavior and a satellite basemap.
  try {
    if (typeof areaMap !== "undefined" && areaMap) {
      areaMap.off();
      areaMap.remove();
      areaMap = null;
    }
  } catch (_) {}

  const mapEl = document.getElementById("areaMap");
  if (!mapEl) return;
  mapEl.innerHTML = "";

  areaMap = L.map("areaMap", {
    zoomControl: true,
    doubleClickZoom: true
  }).setView([34.65, -86.55], 9);

  // Satellite / aerial imagery.
  const satellite = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 19,
      attribution:
        "Sources: Esri, Vantor, Earthstar Geographics, and the GIS User Community"
    }
  );

  // Familiar street layer as an optional switch.
  const streets = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 20,
      attribution: "&copy; OpenStreetMap contributors"
    }
  );

  satellite.addTo(areaMap);

  L.control.layers(
    {
      "Satellite / Aerial": satellite,
      "Street Map": streets
    },
    {},
    {
      position: "topright",
      collapsed: false
    }
  ).addTo(areaMap);

  areaLayer = L.layerGroup().addTo(areaMap);
  movementLayer = L.layerGroup().addTo(areaMap);

  // Visible reminder on the map itself.
  const Help = L.Control.extend({
    onAdd() {
      const div = L.DomUtil.create("div", "hose-map-help");
      div.innerHTML = "<b>Place a pin</b><br>Choose a camera or stand → click Place → click the exact spot on the imagery.";
      L.DomEvent.disableClickPropagation(div);
      return div;
    }
  });
  new Help({ position: "bottomleft" }).addTo(areaMap);

  // IMPORTANT FIX: one direct map click handler.
  areaMap.on("click", async (event) => {
    if (!placementMode) return;

    const mode = placementMode;
    placementMode = null;
    mapEl.classList.remove("hose-placement-mode");

    const message = document.getElementById("placementMessage");
    if (message) message.textContent = "Saving pin location…";

    try {
      if (mode.type === "camera") {
        await updateCameraLocation(mode.id, event.latlng.lat, event.latlng.lng);
      } else if (mode.type === "stand") {
        await updateStandLocation(mode.id, event.latlng.lat, event.latlng.lng);
      }
    } catch (error) {
      console.error("HOSE pin placement error:", error);
      if (message) {
        message.textContent =
          "Could not save the pin: " + (error?.message || String(error));
      }
    }
  });

  // Replace button behavior with a very explicit placement state.
  const cameraButton = document.getElementById("placeCameraBtn");
  if (cameraButton) {
    const replacement = cameraButton.cloneNode(true);
    cameraButton.replaceWith(replacement);

    replacement.addEventListener("click", () => {
      const id = document.getElementById("mapCamera")?.value;

      if (!id) {
        document.getElementById("placementMessage").textContent =
          "Choose a camera first.";
        return;
      }

      placementMode = { type: "camera", id };
      mapEl.classList.add("hose-placement-mode");

      const camera = cameras.find(c => c.id === id);
      document.getElementById("placementMessage").innerHTML =
        `<span class="status-warn">📷 PLACING ${camera?.name || "CAMERA"}:</span> click the exact camera location on the satellite image.`;
    });
  }

  const standButton = document.getElementById("placeStandBtn");
  if (standButton) {
    const replacement = standButton.cloneNode(true);
    standButton.replaceWith(replacement);

    replacement.addEventListener("click", () => {
      const id = document.getElementById("mapStand")?.value;

      if (!id) {
        document.getElementById("placementMessage").textContent =
          "Choose a stand first.";
        return;
      }

      placementMode = { type: "stand", id };
      mapEl.classList.add("hose-placement-mode");

      const stand = stands.find(s => s.id === id);
      document.getElementById("placementMessage").innerHTML =
        `<span class="status-warn">🌲 PLACING ${stand?.name || "STAND"}:</span> click the exact stand location on the satellite image.`;
    });
  }

  // ESC cancels placement.
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && placementMode) {
      placementMode = null;
      mapEl.classList.remove("hose-placement-mode");
      const message = document.getElementById("placementMessage");
      if (message) message.textContent = "Pin placement cancelled.";
    }
  });

  // Re-render any saved cameras/stands.
  try {
    syncAreaSelectors();
    renderAreaMap();
  } catch (error) {
    console.error("Area Intelligence initial render:", error);
  }

  setTimeout(() => areaMap.invalidateSize(), 100);
}
