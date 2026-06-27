/**
 * qooentum-pois.js
 * ================
 * Carga el JSON de POIs generado por osm_to_qooentum.py
 * y expone funciones para buscar por radio y por categoría.
 *
 * Reemplaza completamente las llamadas a Overpass API.
 *
 * Uso:
 *   const pois = new QooentumPOIs("https://tu-cdn.com/pois.json");
 *   await pois.cargar();
 *   const cercanos = pois.buscarCercanos(lat, lon, radioMetros);
 */

class QooentumPOIs {
  constructor(urlJson) {
    this.urlJson = urlJson;
    this.datos = null;
    this.pois = [];
    this._grid = {};       // índice lat/lon para búsqueda rápida
    this._gridSize = 0.01; // ~1 km por celda
  }

  // ─── Carga inicial ────────────────────────────────────────────
  async cargar() {
    if (this.datos) return this; // ya cargado

    const cache = localStorage.getItem("qooentum_pois_cache");
    const cacheTs = localStorage.getItem("qooentum_pois_ts");
    const HOY = Date.now();
    const UN_DIA = 24 * 60 * 60 * 1000;

    // Usar cache si tiene menos de 24h
    if (cache && cacheTs && (HOY - Number(cacheTs)) < UN_DIA) {
      this.datos = JSON.parse(cache);
    } else {
      const res = await fetch(this.urlJson);
      if (!res.ok) throw new Error(`No se pudo cargar ${this.urlJson}`);
      this.datos = await res.json();
      try {
        localStorage.setItem("qooentum_pois_cache", JSON.stringify(this.datos));
        localStorage.setItem("qooentum_pois_ts", String(HOY));
      } catch (e) {
        // localStorage lleno — no importa, seguimos sin cache
      }
    }

    this.pois = this.datos.pois || [];
    this._construirIndice();
    console.log(`✅ Qooentum POIs: ${this.pois.length} lugares cargados`);
    return this;
  }

  // ─── Índice espacial simple por celda de grilla ───────────────
  _construirIndice() {
    this._grid = {};
    for (const poi of this.pois) {
      const clave = this._celdaClave(poi.lat, poi.lon);
      if (!this._grid[clave]) this._grid[clave] = [];
      this._grid[clave].push(poi);
    }
  }

  _celdaClave(lat, lon) {
    const r = this._gridSize;
    return `${Math.floor(lat / r)}_${Math.floor(lon / r)}`;
  }

  // ─── Distancia Haversine en metros ────────────────────────────
  _distancia(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ─── Búsqueda por radio ───────────────────────────────────────
  /**
   * @param {number} lat
   * @param {number} lon
   * @param {number} radioMetros  (default: 1000)
   * @param {string} [categoria]  filtro opcional: "salud", "gobierno", etc.
   * @returns {Array} POIs ordenados por distancia, con campo `distancia`
   */
  buscarCercanos(lat, lon, radioMetros = 1000, categoria = null) {
    if (!this.pois.length) {
      console.warn("POIs no cargados. Llamá a cargar() primero.");
      return [];
    }

    // Celdas a revisar según el radio
    const celdas = Math.ceil(radioMetros / (this._gridSize * 111000)) + 1;
    const r = this._gridSize;
    const baseLat = Math.floor(lat / r);
    const baseLon = Math.floor(lon / r);

    const candidatos = new Set();
    for (let dLat = -celdas; dLat <= celdas; dLat++) {
      for (let dLon = -celdas; dLon <= celdas; dLon++) {
        const clave = `${baseLat + dLat}_${baseLon + dLon}`;
        const celda = this._grid[clave] || [];
        celda.forEach(p => candidatos.add(p));
      }
    }

    const resultados = [];
    for (const poi of candidatos) {
      if (categoria && poi.categoria !== categoria) continue;
      const dist = this._distancia(lat, lon, poi.lat, poi.lon);
      if (dist <= radioMetros) {
        resultados.push({ ...poi, distancia: Math.round(dist) });
      }
    }

    return resultados.sort((a, b) => a.distancia - b.distancia);
  }

  // ─── Búsqueda por texto ───────────────────────────────────────
  buscarPorNombre(texto) {
    const q = texto.toLowerCase().trim();
    return this.pois.filter(p =>
      p.nombre.toLowerCase().includes(q) ||
      p.label.toLowerCase().includes(q)
    );
  }

  // ─── Listar categorías disponibles ───────────────────────────
  categorias() {
    return [...new Set(this.pois.map(p => p.categoria))].sort();
  }

  // ─── Info del dataset ─────────────────────────────────────────
  info() {
    return {
      total:   this.pois.length,
      ciudad:  this.datos?.ciudad,
      fuente:  this.datos?.fuente,
      version: this.datos?.version,
    };
  }
}


// ─── Ejemplo de integración con Leaflet ──────────────────────────────────────
/*

const POIS_URL = "https://tu-cdn.com/pois.json"; // o URL de GitHub Pages

const pois = new QooentumPOIs(POIS_URL);

// Al init del mapa:
await pois.cargar();

// Al mover el mapa o cambiar de posición:
function actualizarMarcadores(centerLat, centerLon) {
  const cercanos = pois.buscarCercanos(centerLat, centerLon, 1500);

  // Limpiar markers anteriores
  markersLayer.clearLayers();

  for (const poi of cercanos) {
    const marker = L.marker([poi.lat, poi.lon])
      .bindPopup(`
        <b>${poi.icono} ${poi.nombre}</b><br>
        ${poi.label}<br>
        ${poi.direccion || ""}
        ${poi.horario ? `<br>🕐 ${poi.horario}` : ""}
      `);
    markersLayer.addLayer(marker);
  }
}

// Mostrás los datos de ocupación de tu app encima de cada POI:
function agregarOcupacion(poi, nivel) {
  // nivel = "lleno" | "moderado" | "vacio"
  // Esto viene de tu Google Sheets / Apps Script, no de OSM
  return { ...poi, ocupacion: nivel };
}

*/
