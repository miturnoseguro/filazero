#!/usr/bin/env python3
"""
osm_to_qooentum.py
==================
Convierte un extract .osm.pbf de Geofabrik en un JSON de POIs
listo para consumir desde Qooentum, sin depender de Overpass API.

Uso:
    python3 osm_to_qooentum.py --input uruguay-latest.osm.pbf --output pois.json
    python3 osm_to_qooentum.py --input uruguay-latest.osm.pbf --output pois.json --city "Montevideo"

Descargá el extract en:
    https://download.geofabrik.de/south-america/uruguay-latest.osm.pbf
    https://download.geofabrik.de/south-america/argentina-latest.osm.pbf
"""

import osmium
import json
import argparse
import sys
from math import radians, cos, sin, sqrt, atan2

# ─────────────────────────────────────────────
# CATEGORÍAS QUE LE INTERESAN A QOOENTUM
# Ajustá según tus necesidades.
# ─────────────────────────────────────────────

CATEGORIAS = {
    # Salud
    "hospital":          {"categoria": "salud",       "icono": "🏥", "label": "Hospital"},
    "clinic":            {"categoria": "salud",       "icono": "🏥", "label": "Clínica"},
    "doctors":           {"categoria": "salud",       "icono": "👨‍⚕️", "label": "Consultorio"},
    "pharmacy":          {"categoria": "salud",       "icono": "💊", "label": "Farmacia"},
    "dentist":           {"categoria": "salud",       "icono": "🦷", "label": "Dentista"},
    "veterinary":        {"categoria": "salud",       "icono": "🐾", "label": "Veterinaria"},

    # Gobierno / trámites
    "townhall":          {"categoria": "gobierno",    "icono": "🏛️", "label": "Municipalidad"},
    "courthouse":        {"categoria": "gobierno",    "icono": "⚖️", "label": "Juzgado"},
    "police":            {"categoria": "gobierno",    "icono": "🚔", "label": "Comisaría"},
    "post_office":       {"categoria": "gobierno",    "icono": "📮", "label": "Correo"},
    "bank":              {"categoria": "finanzas",    "icono": "🏦", "label": "Banco"},
    "atm":               {"categoria": "finanzas",    "icono": "💳", "label": "Cajero"},
    "bureau_de_change":  {"categoria": "finanzas",    "icono": "💱", "label": "Casa de cambio"},

    # Comercio
    "supermarket":       {"categoria": "comercio",    "icono": "🛒", "label": "Supermercado"},
    "marketplace":       {"categoria": "comercio",    "icono": "🏪", "label": "Mercado"},
    "convenience":       {"categoria": "comercio",    "icono": "🏪", "label": "Almacén"},
    "department_store":  {"categoria": "comercio",    "icono": "🏬", "label": "Tienda"},
    "mall":              {"categoria": "comercio",    "icono": "🏬", "label": "Shopping"},

    # Transporte
    "bus_station":       {"categoria": "transporte",  "icono": "🚌", "label": "Terminal de buses"},
    "ferry_terminal":    {"categoria": "transporte",  "icono": "⛴️", "label": "Terminal fluvial"},
    "taxi":              {"categoria": "transporte",  "icono": "🚕", "label": "Parada de taxi"},
    "fuel":              {"categoria": "transporte",  "icono": "⛽", "label": "Estación de servicio"},

    # Educación
    "school":            {"categoria": "educacion",   "icono": "🏫", "label": "Escuela"},
    "university":        {"categoria": "educacion",   "icono": "🎓", "label": "Universidad"},
    "college":           {"categoria": "educacion",   "icono": "🎓", "label": "Instituto"},
    "library":           {"categoria": "educacion",   "icono": "📚", "label": "Biblioteca"},

    # Ocio / gastronomía
    "restaurant":        {"categoria": "gastronomia", "icono": "🍽️", "label": "Restaurante"},
    "cafe":              {"categoria": "gastronomia", "icono": "☕", "label": "Café"},
    "bar":               {"categoria": "gastronomia", "icono": "🍺", "label": "Bar"},
    "fast_food":         {"categoria": "gastronomia", "icono": "🍔", "label": "Comida rápida"},
    "cinema":            {"categoria": "ocio",        "icono": "🎬", "label": "Cine"},
    "theatre":           {"categoria": "ocio",        "icono": "🎭", "label": "Teatro"},
    "gym":               {"categoria": "ocio",        "icono": "💪", "label": "Gimnasio"},
}

# También filtramos algunos tags de shop=
SHOPS = {
    "supermarket":   {"categoria": "comercio",  "icono": "🛒", "label": "Supermercado"},
    "mall":          {"categoria": "comercio",  "icono": "🏬", "label": "Shopping"},
    "hardware":      {"categoria": "comercio",  "icono": "🔧", "label": "Ferretería"},
    "electronics":   {"categoria": "comercio",  "icono": "📱", "label": "Electrónica"},
}

# ─────────────────────────────────────────────

class POIHandler(osmium.SimpleHandler):
    def __init__(self, bbox=None):
        super().__init__()
        self.pois = []
        self.bbox = bbox  # (minlat, minlon, maxlat, maxlon)
        self.seen_ids = set()

    def _dentro_bbox(self, lat, lon):
        if not self.bbox:
            return True
        minlat, minlon, maxlat, maxlon = self.bbox
        return minlat <= lat <= maxlat and minlon <= lon <= maxlon

    def _procesar_tags(self, tags, lat, lon, osm_id, osm_type):
        if not self._dentro_bbox(lat, lon):
            return

        uid = f"{osm_type}{osm_id}"
        if uid in self.seen_ids:
            return

        amenity = tags.get("amenity", "")
        shop    = tags.get("shop", "")

        info = CATEGORIAS.get(amenity) or SHOPS.get(shop)
        if not info:
            return

        nombre = (
            tags.get("name:es") or
            tags.get("name") or
            tags.get("brand") or
            info["label"]
        )

        poi = {
            "id":        uid,
            "nombre":    nombre,
            "categoria": info["categoria"],
            "icono":     info["icono"],
            "label":     info["label"],
            "lat":       round(lat, 6),
            "lon":       round(lon, 6),
            "direccion": tags.get("addr:street", "") + (
                " " + tags.get("addr:housenumber", "") if tags.get("addr:housenumber") else ""
            ).strip(),
            "horario":   tags.get("opening_hours", ""),
            "telefono":  tags.get("phone", "") or tags.get("contact:phone", ""),
            "web":       tags.get("website", "") or tags.get("contact:website", ""),
        }

        self.seen_ids.add(uid)
        self.pois.append(poi)

    def node(self, n):
        if not n.location.valid():
            return
        self._procesar_tags(n.tags, n.location.lat, n.location.lon, n.id, "n")

    def area(self, a):
        try:
            centroid = a.envelope().midpoint()
            self._procesar_tags(a.tags, centroid.y, centroid.x, a.orig_id(), "w")
        except Exception:
            pass


def bbox_para_ciudad(ciudad):
    """Bounding boxes predefinidas para ciudades comunes."""
    ciudades = {
        "montevideo":        (-34.95, -56.35, -34.80, -56.05),
        "buenos aires":      (-34.75, -58.55, -34.52, -58.33),
        "rosario":           (-32.98, -60.74, -32.85, -60.62),
        "cordoba":           (-31.48, -64.26, -31.32, -64.12),
        "mendoza":           (-32.92, -68.90, -32.84, -68.80),
        "mar del plata":     (-38.06, -57.60, -37.95, -57.50),
        "la plata":          (-34.96, -57.98, -34.88, -57.90),
        "gonzalez catan":    (-34.78, -58.66, -34.73, -58.60),
        "merlo":             (-34.69, -58.74, -34.64, -58.69),
        "moreno":            (-34.65, -58.80, -34.60, -58.75),
    }
    return ciudades.get(ciudad.lower().strip())


def main():
    parser = argparse.ArgumentParser(description="OSM → JSON de POIs para Qooentum")
    parser.add_argument("--input",  required=True, help="Archivo .osm.pbf de Geofabrik")
    parser.add_argument("--output", required=True, help="Archivo JSON de salida")
    parser.add_argument("--city",   default="",    help="Ciudad para filtrar (opcional)")
    parser.add_argument("--bbox",   default="",    help="BBox manual: minlat,minlon,maxlat,maxlon")
    parser.add_argument("--pretty", action="store_true", help="JSON formateado (más legible)")
    args = parser.parse_args()

    # Resolver bbox
    bbox = None
    if args.bbox:
        try:
            bbox = tuple(float(x) for x in args.bbox.split(","))
            print(f"📍 Usando bbox manual: {bbox}")
        except Exception:
            print("❌ bbox inválido. Formato: minlat,minlon,maxlat,maxlon")
            sys.exit(1)
    elif args.city:
        bbox = bbox_para_ciudad(args.city)
        if bbox:
            print(f"📍 Ciudad '{args.city}': bbox {bbox}")
        else:
            print(f"⚠️  Ciudad '{args.city}' no encontrada. Procesando todo el archivo.")

    print(f"⏳ Procesando {args.input}...")
    handler = POIHandler(bbox=bbox)

    try:
        handler.apply_file(args.input, locations=True)
    except Exception as e:
        print(f"❌ Error leyendo el archivo: {e}")
        sys.exit(1)

    pois = handler.pois
    print(f"✅ {len(pois)} POIs encontrados")

    # Estadísticas por categoría
    from collections import Counter
    conteo = Counter(p["categoria"] for p in pois)
    for cat, n in sorted(conteo.items(), key=lambda x: -x[1]):
        print(f"   {cat}: {n}")

    # Output
    output = {
        "version":   "1.0",
        "fuente":    "OpenStreetMap / Geofabrik",
        "ciudad":    args.city or "todo el extract",
        "bbox":      list(bbox) if bbox else None,
        "total":     len(pois),
        "pois":      pois,
    }

    indent = 2 if args.pretty else None
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=indent)

    size_kb = len(json.dumps(output, ensure_ascii=False)) / 1024
    print(f"💾 Guardado en {args.output} ({size_kb:.0f} KB)")
    print(f"\n🚀 Siguiente paso:")
    print(f"   Subí {args.output} a GitHub Pages o Google Drive y hacé fetch() desde Qooentum.")


if __name__ == "__main__":
    main()
