"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { useEffect, useRef } from "react";

import type { Wgs84 } from "@/lib/geo/campus-georeference";
import type { MapLayer } from "@/lib/ping-log/record";

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

const PIN_ICON = L.divIcon({
  className: "",
  iconSize: [46, 46],
  iconAnchor: [23, 23],
  // Pink on a white halo, so the cross reads on dark roofs and pale roads alike.
  html: '<svg width="46" height="46" viewBox="-23 -23 46 46" style="overflow:visible"><g stroke="#fff" stroke-width="4.5" fill="none"><line x1="0" y1="-21" x2="0" y2="21"/><line x1="-21" y1="0" x2="21" y2="0"/><circle r="6"/></g><g stroke="#ec1e8f" stroke-width="2" fill="none"><line x1="0" y1="-21" x2="0" y2="21"/><line x1="-21" y1="0" x2="21" y2="0"/><circle r="6"/></g></svg>',
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
    if (pinMarker.current) pinMarker.current.setLatLng([pin.lat, pin.lon]);
    else pinMarker.current = L.marker([pin.lat, pin.lon], { icon: PIN_ICON, interactive: false, keyboard: false }).addTo(current);
  }, [pin]);

  useEffect(() => {
    const current = map.current;
    if (!current) return;
    meLayer.current?.remove();
    meLayer.current = me
      ? L.layerGroup([
          L.circle([me.lat, me.lon], { radius: me.accuracy, color: "#2a5a56", weight: 1.5, fillColor: "#6fe3d9", fillOpacity: 0.2, interactive: false }),
          L.circleMarker([me.lat, me.lon], { radius: 6, color: "#111018", weight: 2, fillColor: "#6fe3d9", fillOpacity: 1, interactive: false }),
        ]).addTo(current)
      : null;
  }, [me]);

  return <div ref={element} className={`overflow-hidden border-2 border-(--px-teal) ${className ?? "h-[min(56vh,480px)]"}`} />;
}
