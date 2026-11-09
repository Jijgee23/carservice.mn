"use client";

import { useEffect, useRef, useState } from "react";
import type { GeocodeParts } from "./address-select";
import { GMAP_DEMO_MAP_ID, loadGoogleMaps } from "@/lib/gmaps";

// Анхдагч төв — Улаанбаатар
const DEFAULT_CENTER = { lat: 47.918873, lng: 106.917698 };
const DEFAULT_ZOOM = 12;
const PICKED_ZOOM = 16;

type Coords = { lat: number; lng: number };

function isLightTheme(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("light")
  );
}

// Geocoder-ийн address_components-аас засаг захиргааны түвшнүүдийг салгана.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractParts(result: any): GeocodeParts | null {
  if (!result?.address_components) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get = (type: string): string | undefined =>
    result.address_components.find((c: any) => c.types?.includes(type))
      ?.long_name;
  return {
    adminLevel1: get("administrative_area_level_1"),
    adminLevel2: get("administrative_area_level_2"),
    adminLevel3: get("administrative_area_level_3"),
    locality: get("locality"),
    sublocality: get("sublocality") || get("sublocality_level_1"),
    // Эхэнд ирдэг Plus Code-ийг ("WWGJ+GF7, ...") хасна — хүнд уншигдахгүй.
    formatted:
      result.formatted_address
        ?.replace(/^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3},?\s*/i, "")
        .trim() || undefined,
  };
}

/** Google Maps дээр товшиж/чирж салбарын байршлыг сонгоно. */
export function LocationPicker({
  latitude,
  longitude,
  onChange,
  onGeocode,
  apiKey,
  mapId,
}: {
  latitude: number | null;
  longitude: number | null;
  onChange: (coords: Coords | null) => void;
  onGeocode?: (parts: GeocodeParts) => void;
  apiKey: string;
  mapId: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geocoderRef = useRef<any>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onGeocodeRef = useRef(onGeocode);
  onGeocodeRef.current = onGeocode;
  // init-ийг дахин ажиллуулахгүйгээр эхний төвд ашиглах хамгийн сүүлийн coords.
  const coordsRef = useRef({ latitude, longitude });
  coordsRef.current = { latitude, longitude };
  // Marker чирснээс үүдсэн өөрчлөлтөд газрыг дахин төвлүүлэхгүй.
  const skipPanRef = useRef(false);

  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [mapError, setMapError] = useState(false);
  const [light, setLight] = useState(false);

  // Theme ажиглах — өөрчлөгдвөл газрыг тохирох colorScheme-тэй дахин үүсгэнэ.
  useEffect(() => {
    setLight(isLightTheme());
    const obs = new MutationObserver(() => setLight(isLightTheme()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);

  // Газрыг үүсгэх / theme солигдоход дахин үүсгэх.
  useEffect(() => {
    if (!apiKey) {
      setMapError(true);
      return;
    }
    let cancelled = false;
    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled || !containerRef.current) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = (window as any).google;
        if (!g?.maps) return;
        const { latitude: lat, longitude: lng } = coordsRef.current;
        const hasPt = lat != null && lng != null;
        const map = new g.maps.Map(containerRef.current, {
          center: hasPt ? { lat, lng } : DEFAULT_CENTER,
          zoom: hasPt ? PICKED_ZOOM : DEFAULT_ZOOM,
          mapId: mapId || GMAP_DEMO_MAP_ID,
          colorScheme: light ? "LIGHT" : "DARK",
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          // Ctrl дарахгүйгээр шууд scroll-оор томруулна.
          gestureHandling: "greedy",
          tilt: 0,
          rotateControl: false,
          tiltInteractionEnabled: false,
          headingInteractionEnabled: false,
        });
        mapRef.current = map;
        markerRef.current = null;
        if (hasPt) placeMarker(lat as number, lng as number);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        map.addListener("click", (e: any) => {
          if (!e.latLng) return;
          pick(e.latLng.lat(), e.latLng.lng());
        });
      })
      .catch(() => {
        if (!cancelled) setMapError(true);
      });
    return () => {
      cancelled = true;
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, mapId, light]);

  // Гадаас (text input / geolocation)-аас lat/lng өөрчлөгдвөл marker-г шинэчилнэ.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (latitude == null || longitude == null) {
      if (markerRef.current) {
        markerRef.current.map = null;
        if (markerRef.current.setMap) markerRef.current.setMap(null);
        markerRef.current = null;
      }
      return;
    }
    placeMarker(latitude, longitude);
    if (!skipPanRef.current) {
      map.panTo({ lat: latitude, lng: longitude });
      if (map.getZoom && map.getZoom() < PICKED_ZOOM) map.setZoom(PICKED_ZOOM);
    }
    skipPanRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude]);

  // Сонгосон цэгийн аймаг/сум/хороог Google-ээс татаж эцэгт мэдэгдэнэ.
  function reverseGeocode(lat: number, lng: number) {
    if (!onGeocodeRef.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).google;
    if (!g?.maps?.Geocoder) return;
    if (!geocoderRef.current) geocoderRef.current = new g.maps.Geocoder();
    geocoderRef.current.geocode(
      { location: { lat, lng }, language: "mn" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (results: any[], status: string) => {
        if (status !== "OK" || !results?.length) return;
        const parts = extractParts(results[0]);
        if (parts) onGeocodeRef.current?.(parts);
      },
    );
  }

  // Цэг сонгох — coords тогтоож, аймаг/сумыг урвуу geocode-оор бөглөнө.
  function pick(lat: number, lng: number, fromDrag = false) {
    if (fromDrag) skipPanRef.current = true;
    onChangeRef.current({ lat, lng });
    reverseGeocode(lat, lng);
  }

  function placeMarker(lat: number, lng: number) {
    const map = mapRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).google;
    if (!map || !g?.maps) return;
    const pos = { lat, lng };
    if (markerRef.current) {
      if ("position" in markerRef.current) markerRef.current.position = pos;
      else if (markerRef.current.setPosition) markerRef.current.setPosition(pos);
      return;
    }
    const Advanced = g.maps.marker?.AdvancedMarkerElement;
    if (Advanced) {
      const pin = new g.maps.marker.PinElement({
        background: "#F5A524",
        borderColor: "#14120C",
        glyphColor: "#14120C",
      });
      const marker = new Advanced({
        map,
        position: pos,
        content: pin.element,
        gmpDraggable: true,
      });
      marker.addListener("dragend", () => {
        const p = marker.position;
        const la = typeof p.lat === "function" ? p.lat() : p.lat;
        const ln = typeof p.lng === "function" ? p.lng() : p.lng;
        pick(la, ln, true);
      });
      markerRef.current = marker;
    } else {
      const marker = new g.maps.Marker({ map, position: pos, draggable: true });
      marker.addListener("dragend", () => {
        const p = marker.getPosition();
        pick(p.lat(), p.lng(), true);
      });
      markerRef.current = marker;
    }
  }

  function pickMyLocation() {
    if (!navigator.geolocation) {
      setGeoError("Энэ хөтөч geolocation дэмждэггүй.");
      return;
    }
    setGeoLoading(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        pick(lat, lng);
        setGeoLoading(false);
      },
      (err) => {
        setGeoError(err.message || "Байршил тогтоож чадсангүй.");
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function clear() {
    onChangeRef.current(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-72 w-full rounded-[10px] overflow-hidden border border-[var(--oc-line)] bg-[var(--oc-panel)]">
        <div ref={containerRef} className="h-full w-full" />
        {mapError ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-[var(--oc-muted3)] bg-[var(--oc-panel)]">
            Газрын зураг ачаалж чадсангүй.
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <button
          type="button"
          onClick={pickMyLocation}
          disabled={geoLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--oc-accent)] hover:bg-[var(--oc-accent-hi)] disabled:opacity-50 font-medium text-[var(--oc-on-accent)] transition-colors"
        >
          {geoLoading ? "Тогтоож байна..." : "📍 Миний байршлыг авах"}
        </button>
        {latitude != null && longitude != null ? (
          <>
            <span className="font-plex-mono text-[var(--oc-muted3)]">
              {latitude.toFixed(6)}, {longitude.toFixed(6)}
            </span>
            <button
              type="button"
              onClick={clear}
              className="text-red-300/80 hover:text-red-300 light:text-red-600 light:hover:text-red-700 px-2 py-1 rounded hover:bg-red-500/10"
            >
              ✕ Цэвэрлэх
            </button>
          </>
        ) : (
          <span className="text-[var(--oc-muted3)]">
            Газрын зураг дээр товшиж байршлыг сонгоно уу
          </span>
        )}
        {geoError ? (
          <span className="text-red-400 light:text-red-600">{geoError}</span>
        ) : null}
      </div>
    </div>
  );
}
