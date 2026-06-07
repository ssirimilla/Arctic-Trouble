/* ============================================================
   ARCTIC SEA ICE — main.js
   Coordinates are WGS84 lon/lat (converted from EPSG:3411).
   Each JSON is a FeatureCollection of Polygon fragments —
   we merge them all into one MultiPolygon for a clean render.
   ============================================================ */

(function () {
  "use strict";

  /* ── Projection Defs ─────────────────────────────────────── */
  const EPSG3413 = "+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs";
  proj4.defs("EPSG:3413", EPSG3413);

  /* ── Step config ─────────────────────────────────────────── */
  const STEPS = [
    { year: "1980", file: "1980.json", radius: 32, extent: 7.8, loss:  0 },
    { year: "1990", file: "1990.json", radius: 30, extent: 6.2, loss: 15 },
    { year: "2000", file: "2000.json", radius: 28, extent: 5.9, loss: 20 },
    { year: "2007", file: "2007.json", radius: 26, extent: 4.3, loss: 40 },
    { year: "2012", file: "2012.json", radius: 18, extent: 3.4, loss: 56 },
    { year: "2019", file: "2019.json", radius: 20, extent: 4.1, loss: 47 },
    { year: "2025", file: "2025.json", radius: 21, extent: 4.2, loss: 46 },
  ];

  /* ── DOM refs ────────────────────────────────────────────── */
  const container = document.getElementById("map-container");
  const yearLabel = document.getElementById("year-label");
  const extentNum = document.getElementById("extent-number");
  const lossBar   = document.getElementById("loss-bar-fill");
  const lossPct   = document.getElementById("loss-pct");
  const steps     = document.querySelectorAll(".step");

  /* ── Globe size ──────────────────────────────────────────── */
  const W = container.clientWidth  || 600;
  const H = container.clientHeight || 600;
  const R = Math.min(W, H) / 2.2;
  const R_ZOOM = R * 2.4; // Zoom factor to emphasize Arctic ice

  /* ── SVG ─────────────────────────────────────────────────── */
  const svg = d3.select("#map-container")
    .append("svg")
    .attr("width",  W)
    .attr("height", H)
    .attr("viewBox", `0 0 ${W} ${H}`);

  const mapGroup = svg.append("g");

  /* ── Projection: orthographic, North Pole centred ────────── */
  const projection = d3.geoOrthographic()
    .scale(R_ZOOM)
    .translate([W / 2, H / 2])
    .rotate([0, -90])
    .clipAngle(90);

  const path = d3.geoPath().projection(projection);

  /* ── Ocean sphere ────────────────────────────────────────── */
  svg.append("circle")
    .attr("class", "globe-sphere")
    .attr("cx", W / 2).attr("cy", H / 2).attr("r", R_ZOOM);

  /* ── Graticule ───────────────────────────────────────────── */
  const graticule = d3.geoGraticule();
  svg.append("path").datum(graticule()).attr("class", "graticule").attr("d", path);
  svg.append("path")
    .datum(d3.geoCircle().center([0, 90]).radius(23.5)())
    .attr("class", "graticule-polar").attr("d", path);

  /* ── State ───────────────────────────────────────────────── */
  const geoData = []; // Preloaded GeoJSONs
  let icePaths = [];  // SVG <path> elements per step
  let baselinePath = null;
  let isReady = false;

  /* ── Coordinate Converter ────────────────────────────────── */
  function convert3413toWGS84(geojson) {
    if (!geojson) return geojson;
    
    function transformCoords(coords) {
      if (typeof coords[0] === 'number') {
        try {
          return proj4('EPSG:3413', 'WGS84', coords);
        } catch (e) {
          return [0, 0];
        }
      }
      return coords.map(transformCoords);
    }

    if (geojson.type === "FeatureCollection") {
      geojson.features.forEach(f => {
        if (f.geometry && f.geometry.coordinates) {
          f.geometry.coordinates = transformCoords(f.geometry.coordinates);
        }
      });
    } else if (geojson.type === "Feature") {
      if (geojson.geometry && geojson.geometry.coordinates) {
        geojson.geometry.coordinates = transformCoords(geojson.geometry.coordinates);
      }
    } else if (geojson.type === "GeometryCollection") {
      geojson.geometries.forEach(g => {
        g.coordinates = transformCoords(g.coordinates);
      });
    } else if (geojson.coordinates) {
      geojson.coordinates = transformCoords(geojson.coordinates);
    }
    
    return geojson;
  }

  /* ── Helpers ─────────────────────────────────────────────── */
  function circleGeoJSON(radius) {
    return d3.geoCircle().center([0, 90]).radius(radius)();
  }

  function featureCollectionToMultiPolygon(fc) {
    const polygons = [];
    (fc.features || []).forEach(feat => {
      const geom = feat && feat.geometry;
      if (!geom) return;
      if (geom.type === "Polygon") {
        polygons.push(geom.coordinates);
      } else if (geom.type === "MultiPolygon") {
        polygons.push(...geom.coordinates);
      }
    });
    return {
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: polygons },
      properties: {}
    };
  }

  /* ── Interpolation Helpers ───────────────────────────────── */
  function lerp(start, end, t) {
    return start * (1 - t) + end * t;
  }

  function updateDisplayInterpolated(step1, step2, t) {
    if (!step2) {
      yearLabel.textContent = step1.year;
      extentNum.textContent = step1.extent.toFixed(1);
      lossBar.style.width   = step1.loss + "%";
      lossPct.textContent   = step1.loss + "%";
      return;
    }
    
    const currentYear = Math.round(lerp(parseInt(step1.year), parseInt(step2.year), t));
    const currentExtent = lerp(step1.extent, step2.extent, t);
    const currentLoss = lerp(step1.loss, step2.loss, t);

    yearLabel.textContent = currentYear;
    extentNum.textContent = currentExtent.toFixed(1);
    lossBar.style.width   = currentLoss + "%";
    lossPct.textContent   = Math.round(currentLoss) + "%";

    yearLabel.style.color =
      currentYear >= 2024 ? "var(--gold)"
      : currentYear >= 2012 ? "var(--danger)"
      : "#fff";
  }

  /* ── Scroll Loop ─────────────────────────────────────────── */
  function onScroll() {
    if (!isReady) return;

    const containerRect = document.getElementById("scrolly-container").getBoundingClientRect();
    const stickyHeight = document.querySelector(".sticky-visual").clientHeight;
    
    const scrollableDistance = containerRect.height - stickyHeight;
    let scrolled = -containerRect.top;
    
    scrolled = Math.max(0, Math.min(scrolled, scrollableDistance));
    
    const progress = scrollableDistance > 0 ? scrolled / scrollableDistance : 0;
    
    const numSegments = STEPS.length - 1;
    const segmentProgress = progress * numSegments;
    const currentIdx = Math.min(Math.floor(segmentProgress), numSegments - 1);
    const t = segmentProgress - currentIdx; 

    const step1 = STEPS[currentIdx];
    const step2 = STEPS[currentIdx + 1] || STEPS[currentIdx];

    updateDisplayInterpolated(step1, step2, t);

    icePaths.forEach((pathNode, i) => {
      if (i === currentIdx) {
        pathNode.style("opacity", 1 - t);
      } else if (i === currentIdx + 1) {
        pathNode.style("opacity", t);
      } else {
        pathNode.style("opacity", 0);
      }
    });

    if (baselinePath) {
      if (currentIdx === 0) {
         baselinePath.style("opacity", Math.min(1, t * 2)); 
      } else {
         baselinePath.style("opacity", 1);
      }
    }

    const rotateBase = -90;
    const currentRotation = rotateBase + progress * 40; 
    projection.rotate([currentRotation, -90]);
    
    svg.selectAll(".graticule, .graticule-polar, .land, .ice, .baseline").attr("d", path);

    steps.forEach((s, i) => {
      if (i === (t > 0.5 ? currentIdx + 1 : currentIdx)) {
        s.classList.add("is-active");
      } else {
        s.classList.remove("is-active");
      }
    });
  }

  /* ── Initialization ──────────────────────────────────────── */
  Promise.all([
    d3.json("https://unpkg.com/world-atlas@2/countries-110m.json"),
    ...STEPS.map(s => d3.json(s.file).catch(() => null))
  ]).then(function (results) {
    const world = results[0];
    const iceData = results.slice(1);

    svg.append("path")
      .datum(topojson.feature(world, world.objects.countries))
      .attr("class", "land")
      .attr("d", path);

    STEPS.forEach((stepData, i) => {
      let merged = null;
      if (iceData[i]) {
        const projected = convert3413toWGS84(iceData[i]);
        merged = (projected.type === "FeatureCollection")
          ? featureCollectionToMultiPolygon(projected)
          : projected;

        if (merged.geometry && merged.geometry.type === "MultiPolygon") {
          merged.geometry.coordinates.forEach(poly => {
            const dummy = { type: "Polygon", coordinates: poly };
            if (d3.geoArea(dummy) > 2 * Math.PI) {
              poly.forEach(ring => ring.reverse());
            }
          });
        }
      } else {
        merged = circleGeoJSON(stepData.radius);
      }
      geoData[i] = merged;
    });

    baselinePath = svg.append("path")
      .attr("id", "baseline-path")
      .attr("class", "baseline")
      .datum(geoData[0])
      .attr("d", path)
      .style("opacity", 0);

    STEPS.forEach((stepData, i) => {
      const p = svg.append("path")
        .attr("class", "ice")
        .datum(geoData[i])
        .attr("d", path)
        .style("opacity", i === 0 ? 1 : 0);
      icePaths.push(p);
    });

    isReady = true;

    window.addEventListener("scroll", () => requestAnimationFrame(onScroll));
    onScroll();
  }).catch(err => console.error("Initialization failed:", err));

  /* ── Temperature Map Initialization ───────────────────────── */
  /* ── Temperature Choropleth Map ─────────────────────────── */
  function initTemperatureMap() {
    const container = document.getElementById("temp-map-container");
    if (!container) return;

    const w = container.clientWidth  || 900;
    const h = container.clientHeight || 720;

    // AzimuthalEquidistant: r = scale * θ_radians.
    // scale = ARCTIC_R / (π/2)  → full hemisphere (0–90°N) fills the circle.
    const ARCTIC_R = Math.min(w, h) * 0.46;

    const DEG_TO_SHOW = 32;

    const tempProj = d3.geoAzimuthalEquidistant()
      .scale(ARCTIC_R / (Math.PI / 2) * 2.75)   // full hemisphere fits in ARCTIC_R px
      .translate([w / 2, h / 2])
      .rotate([0, -90])                   // North Pole at centre
      .clipAngle(DEG_TO_SHOW);

    const tempPath = d3.geoPath().projection(tempProj);

    const tempSvg = d3.select("#temp-map-container")
      .append("svg")
      .attr("width",  w)
      .attr("height", h)
      .attr("viewBox", `0 0 ${w} ${h}`);

    // Ocean background circle
    tempSvg.append("circle")
      .attr("cx", w / 2).attr("cy", h / 2).attr("r", ARCTIC_R)
      .style("fill", "#071525")
      .style("filter", "drop-shadow(0 0 40px rgba(78,184,255,0.15))");

    // Clip path so nothing renders outside the circle
    const defs = tempSvg.append("defs");
    defs.append("clipPath").attr("id", "arctic-clip")
      .append("circle")
      .attr("cx", w / 2).attr("cy", h / 2).attr("r", ARCTIC_R);
    // defs.append("clipPath").attr("id", "ice-mask-clip")
    //   .append("path")
    //   .attr("id", "ice-mask-path");

    const mapGroup = tempSvg.append("g").attr("clip-path", "url(#arctic-clip)");

    // Use countries-110m.json — has both 'land' and 'countries' objects
    d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json")
      .then(world => {
        // Layer order (SVG bottom → top):
        // 1) Choropleth cells
        const cellGroup = mapGroup.append("g")
          .attr("id", "choropleth-cells")
          .attr("clip-path", "url(#arctic-clip)");

        // 2) Land outline only — do NOT cover temperature
        mapGroup.append("path")
          .datum(topojson.feature(world, world.objects.land))
          .style("fill", "none")
          .style("stroke", "rgba(5, 15, 25, 0.85)")
          .style("stroke-width", "1.3px")
          .attr("d", tempPath);

        // 3) Country borders — make clear
        mapGroup.append("path")
          .datum(topojson.mesh(world, world.objects.countries, (a, b) => a !== b))
          .style("fill", "none")
          .style("stroke", "rgba(5, 15, 25, 0.7)")
          .style("stroke-width", "0.9px")
          .attr("d", tempPath);

        // 4) Graticule
        const grat = d3.geoGraticule().step([30, 10]);
        mapGroup.append("path")
          .datum(grat())
          .attr("class", "graticule")
          .attr("d", tempPath);

          loadTemperatureData(cellGroup, tempProj, tempPath, w, h);
      })
      .catch(err => console.error("❌ World atlas failed:", err));
  }

  function loadTemperatureData(cellGroup, proj, pathGen, w, h) {
    d3.json("downsampled_arctic_data_1980_onwards.json")
      .then(data => {
        if (!data || data.length === 0) return;
        console.log("✅ Temperature data loaded:", data.length, "points");

        const colorScale = d3.scaleLinear()
          .domain([-20, -10, 0, 5, 10])
          .range(["#ffffff", "#c8e6ff", "#ffddaa", "#ff6b30", "#cc0000"])
          .clamp(true);

        const years = [...new Set(data.map(d => d.year))].sort((a, b) => a - b);
        const displayYears = years;
        let currentYear = displayYears[0];

        async function updateIceClip(year) {
          const maskYear = 1980;

          const ice = await d3.json(`${maskYear}.json`);
          const converted = convert3413toWGS84(ice);

          const merged = converted.type === "FeatureCollection"
            ? featureCollectionToMultiPolygon(converted)
            : converted;

          // 중요: D3가 polygon을 지구 반대쪽으로 해석하는 것 방지
          if (merged.geometry && merged.geometry.type === "MultiPolygon") {
            merged.geometry.coordinates.forEach(poly => {
              const dummy = { type: "Polygon", coordinates: poly };
              if (d3.geoArea(dummy) > 2 * Math.PI) {
                poly.forEach(ring => ring.reverse());
              }
            });
          }

          d3.select("#ice-mask-path")
            .datum(merged)
            .attr("d", pathGen);
        }

        // Project each lon/lat point to SVG pixel coords and draw circles.
        // Circles are rotation-agnostic so they look correct on any polar projection.
        function drawYear(year) {
          const yearData = data.filter(d => d.year === year);

          const pA = proj([0, 75]);
          const pB = proj([5, 75]);
          const pC = proj([0, 75]);
          const pD = proj([0, 78.77]);

          const cellW = pA && pB ? Math.abs(pB[0] - pA[0]) + 2 : 10;
          const cellH = pC && pD ? Math.abs(pD[1] - pC[1]) + 2 : 10;

          const projected = yearData.map(d => {
            const lon = d.lon > 180 ? d.lon - 360 : d.lon;
            const xy = proj([lon, d.lat]);
            if (!xy) return null;
            return { xy, temp: d.temp_absolute };
          }).filter(Boolean);

          cellGroup.selectAll(".temp-cell")
            .data(projected)
            .join("circle")
            .attr("class", "temp-cell")
            .attr("cx", d => d.xy[0])
            .attr("cy", d => d.xy[1])
            .attr("r", 28)
            .style("fill", d => colorScale(d.temp))
            .style("opacity", 0.55)
            .style("stroke", "none");
        }

        drawYear(currentYear);

        // const svgEl = d3.select("#temp-map-container svg");
        // svgEl.append("text")
        //   .attr("id", "temp-year-text")
        //   .attr("x", 44).attr("y", 66)
        //   .style("font-family", "var(--serif)")
        //   .style("font-size",   "3.2rem")
        //   .style("font-weight", "900")
        //   .style("fill", "#ffffff")
        //   .text(currentYear);

        const slider = document.getElementById("year-slider");
        const yearDisplay = document.getElementById("temp-year-display");
        if (slider) {
          slider.min   = 0;
          slider.max   = displayYears.length - 1;
          slider.step  = 1;
          slider.value = 0;
          slider.addEventListener("input", function () {
            currentYear = displayYears[+this.value];
            if (yearDisplay) yearDisplay.textContent = currentYear;
            // svgEl.select("#temp-year-text").text(currentYear);
            drawYear(currentYear);
          });
        }
        if (yearDisplay) yearDisplay.textContent = currentYear;

        const wrapper = d3.select("#temp-map-container");
        const legend  = wrapper.append("div").attr("class", "temp-legend");
        legend.html(`
          <div style="font-weight:bold;margin-bottom:6px;color:#fff;">
            Polar Bear Heat Comfort
          </div>
          <div class="stress-gradient"></div>
          <div class="stress-labels">
            <span>−20°C</span>
            <span>-10°C</span>
            <span>0°C</span>
            <span>5°C</span>
            <span>10°C</span>
          </div>
          <div class="stress-note">
            White = safe cold · Orange = stress · Red = danger
          </div>
        `);
      })
      .catch(err => console.error("❌ Could not load Arctic temperature data:", err));
  }

  initTemperatureMap();

  /* ── Seasonal Temperature Graphs ──────────────────────────── */
  function drawSeasonalGraph() {
    d3.json("wrangel_temps.json").then(data => {
      const container = document.getElementById("wrangel-graph");
      if (!container) return;

      const margin = { top: 20, right: 20, bottom: 30, left: 40 },
            width = container.clientWidth - margin.left - margin.right,
            height = container.clientHeight - margin.top - margin.bottom;

      const svg = d3.select("#wrangel-graph")
        .append("svg")
        .attr("width", width + margin.left + margin.right)
        .attr("height", height + margin.top + margin.bottom)
        .append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

      const x = d3.scaleLinear()
        .domain(d3.extent(data, d => d.Year))
        .range([0, width]);

      const y = d3.scaleLinear()
        .domain([
          d3.min(data, d => Math.min(d.July, d.August, d.September)) - 1,
          d3.max(data, d => Math.max(d.July, d.August, d.September)) + 1
        ])
        .range([height, 0]);

      // Axes
      const xAxis = d3.axisBottom(x).tickFormat(d3.format("d")).ticks(6);
      svg.append("g")
        .attr("class", "graph-axis")
        .attr("transform", `translate(0,${height})`)
        .call(xAxis);

      const yAxis = d3.axisLeft(y).ticks(5).tickFormat(d => d + "°C");
      svg.append("g")
        .attr("class", "graph-axis")
        .call(yAxis);

      // 0°C Reference line
      svg.append("line")
        .attr("x1", 0)
        .attr("x2", width)
        .attr("y1", y(0))
        .attr("y2", y(0))
        .style("stroke", "var(--text-muted)")
        .style("stroke-dasharray", "4,4")
        .style("opacity", 0.5);

      // Create tooltip div if it doesn't exist
      let tooltip = d3.select("#wrangel-graph-tooltip");
      if (tooltip.empty()) {
        tooltip = d3.select("body").append("div")
          .attr("id", "wrangel-graph-tooltip")
          .style("position", "absolute")
          .style("background", "var(--card-bg)")
          .style("color", "#fff")
          .style("padding", "8px 12px")
          .style("border-radius", "6px")
          .style("pointer-events", "none")
          .style("opacity", 0)
          .style("box-shadow", "0 4px 12px rgba(0,0,0,0.5)")
          .style("font-family", "var(--sans)")
          .style("font-size", "0.9rem")
          .style("z-index", "9999");
      }

      const drawLine = (key, color) => {
        const lineGen = d3.line()
          .x(d => x(d.Year))
          .y(d => y(d[key]))
          .curve(d3.curveMonotoneX);

        svg.append("path")
          .datum(data)
          .attr("class", "line-path")
          .style("stroke", color)
          .attr("d", lineGen);

        svg.selectAll(`.data-dot-${key}`)
          .data(data)
          .enter().append("circle")
          .attr("class", `data-dot data-dot-${key}`)
          .attr("cx", d => x(d.Year))
          .attr("cy", d => y(d[key]))
          .attr("r", 5) // Slightly larger radius for easier hovering
          .style("fill", color)
          .style("cursor", "pointer")
          .on("mouseover", function(event, d) {
             d3.select(this).transition().duration(100).attr("r", 8).style("fill", "var(--gold)");
             tooltip.transition().duration(100).style("opacity", 1);
             tooltip.html(`<strong style="color:${color}">${key} ${d.Year}</strong><br/>${d[key].toFixed(2)}°C`);
          })
          .on("mousemove", function(event) {
             tooltip.style("left", (event.pageX + 15) + "px")
                    .style("top", (event.pageY - 28) + "px");
          })
          .on("mouseout", function(event, d) {
             d3.select(this).transition().duration(200).attr("r", 5).style("fill", color);
             tooltip.transition().duration(200).style("opacity", 0);
          });
      };

      drawLine("July", "var(--orange)");
      drawLine("August", "var(--danger)");
      drawLine("September", "var(--blue)");

    }).catch(err => console.error("Error loading seasonal temps:", err));
  }

  // Draw chart after a slight delay to ensure layout is complete
  setTimeout(drawSeasonalGraph, 500);

})();
