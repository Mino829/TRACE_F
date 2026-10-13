"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect, useRef } from "react";

import type { Wgs84 } from "@/lib/geo/campus-georeference";
import type { MapLayer } from "@/lib/ping-log/record";

import { spriteMarkup, spriteSize } from "./pixel-sprite";

/**
 * A street map for pinning where you stand, anywhere the campus drawings do
 * not reach. Tiles are the Geospatial Information Authority of Japan's
 * (地理院タイル): free, no key, attribution required. The aerial photo layer
 * is the one to pin on; the plain map is there for finding your way.
 */

const LAYERS: Record<MapLayer, { label: string; url: string }> = {
  "gsi-std": { label: "地図", url: "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png" },
  "gsi-photo": { label: "航空写真", url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg" },
};
const ATTRIBUTION = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a>';
/** Both layers stop at 18; past it Leaflet enlarges the last tiles. */
const NATIVE_MAX_ZOOM = 18;
const MAX_ZOOM = 20;
/** Toyosu campus, for when there is no fix to start from. */
const FALLBACK_CENTRE: Wgs84 = { lat: 35.6605, lon: 139.7955 };

const PIN_SCALE = 3;
const PIN_SIZE = spriteSize("pin");
/** The pixel pin, its tip on the point; it drops in each time it is placed. */
const PIN_ICON = L.divIcon({
  // Leaflet places the marker by its transform, so the drop runs on an inner box.
  className: "",
  iconSize: [PIN_SIZE.width * PIN_SCALE, PIN_SIZE.height * PIN_SCALE],
  iconAnchor: [(PIN_SIZE.width * PIN_SCALE) / 2, PIN_SIZE.height * PIN_SCALE],
  html: `<div class="px-drop">${spriteMarkup("pin", PIN_SCALE)}</div>`,
});

type Props = {
  /** Sizes the map; the parent decides how much of the screen it gets. */
  className?: string;
  /** Where the map opens; the phone's first fix. */
  centre: Wgs84 | null;
  pin: Wgs84 | null;
  onPin: (pin: Wgs84, zoom: number, layer: MapLayer) => void;
  /** The phone's own fix, shown on the developer screen only. */
  me: (Wgs84 & { accuracy: number }) | null;
};

export function WorldMap({ className, centre, pin, onPin, me }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<MapLayer>("gsi-photo");
  const pinMarker = useRef<L.Marker | null>(null);
  const meLayer = useRef<L.LayerGroup | null>(null);
  const onPinRef = useRef(onPin);
  const initialCentre = useRef(centre);

  useEffect(() => {
    onPinRef.current = onPin;
  }, [onPin]);

  useEffect(() => {
    if (!element.current) return;
    const start = initialCentre.current ?? FALLBACK_CENTRE;
    const created = L.map(element.current, { maxZoom: MAX_ZOOM }).setView([start.lat, start.lon], initialCentre.current ? 18 : 16);
    const tiles = Object.fromEntries(
      (Object.keys(LAYERS) as MapLayer[]).map((key) => [
        key,
        L.tileLayer(LAYERS[key].url, { attribution: ATTRIBUTION, maxNativeZoom: NATIVE_MAX_ZOOM, maxZoom: MAX_ZOOM }),
      ]),
    ) as Record<MapLayer, L.TileLayer>;
    tiles[layer.current].addTo(created);
    L.control.layers(Object.fromEntries((Object.keys(LAYERS) as MapLayer[]).map((key) => [LAYERS[key].label, tiles[key]])), undefined, { collapsed: false }).addTo(created);
    created.on("baselayerchange", (event) => {
      const chosen = (Object.keys(tiles) as MapLayer[]).find((key) => tiles[key] === event.layer);
      if (chosen) layer.current = chosen;
    });
    created.on("click", (event) => onPinRef.current({ lat: event.latlng.lat, lon: event.latlng.lng }, created.getZoom(), layer.current));
    map.current = created;
    // Leaflet measures its box once; the flow resizes it as panels come and go.
    const observer = new ResizeObserver(() => created.invalidateSize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      created.remove();
      map.current = null;
      pinMarker.current = null;
      meLayer.current = null;
    };
  }, []);

  useEffect(() => {
    const current = map.current;
    if (!current) return;
    if (!pin) {
      pinMarker.current?.remove();
      pinMarker.current = null;
      return;
    }
    // A fresh marker each time, so the drop plays again where the finger landed.
    pinMarker.current?.remove();
    pinMarker.current = L.marker([pin.lat, pin.lon], { icon: PIN_ICON, interactive: false, keyboard: false }).addTo(current);
  }, [pin]);

  useEffect(() => {
    const current = map.current;
    if (!current) return;
    meLayer.current?.remove();
    meLayer.current = me
      ? L.layerGroup([
          L.circle([me.lat, me.lon], { radius: me.accuracy, color: "#1b2150", weight: 1.5, fillColor: "#67e8f9", fillOpacity: 0.22, interactive: false }),
          L.circleMarker([me.lat, me.lon], { radius: 6, color: "#0b0d1f", weight: 2, fillColor: "#67e8f9", fillOpacity: 1, interactive: false }),
        ]).addTo(current)
      : null;
  }, [me]);

  return <div ref={element} className={`overflow-hidden ${className ?? "h-[min(56vh,480px)]"}`} />;
}
