"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BlobImage } from "@/components/ping-log/blob-image";
import { Icon, NoteBar, Phrases, Screen, useRay } from "@/components/ping-log/ray/stage";
import { buildingName, buildingsWithPlaces, checkpointsOn, findCheckpoint, floorsOf, placeOf, startAt } from "@/lib/places/select";
import type { BuildingId, Checkpoint, PhotoPlace, PlacesData } from "@/lib/places/types";

import "./place-picker.css";

/**
 * "Where was this photo taken?": building, then floor, then one checkpoint.
 *
 * The screen never scrolls as a page. The map fills what is left on top, so
 * what was chosen is always in view; under it a sheet holds the three steps,
 * all reachable with the thumb: two rails of chips (building, floor), the
 * checkpoints of that floor, and the save button. The same three steps are
 * all there is when the map cannot run.
 *
 * Fewer taps: it opens on the last photo's building and floor, "さっきと同じ"
 * picks the last photo's place in one tap, and a floor with a single
 * checkpoint selects it. A place has to be chosen; the same one may be chosen
 * for any number of photos.
 */

const CampusMap = dynamic(() => import("./campus-map").then((module) => module.CampusMap), {
  ssr: false,
  loading: () => (
    <p className="pp-map__wait mono mono--dim" role="status">
      Loading
    </p>
  ),
});

type Props = {
  data: PlacesData;
  /** The photo, for the thumbnail that says which one this is. */
  photo: Blob | null;
  /** The place of the photo before this one, where the picker opens. */
  last: PhotoPlace | null;
  /** Which photo of the day this is. */
  number: number;
  maxPhotos: number;
  saving: boolean;
  error: string;
  inert?: boolean;
  onBack: () => void;
  onConfirm: (place: PhotoPlace) => void;
};

/** "研究棟9F" already says where it is; "大階段の下" needs the building and floor in front of it. */
function placeLabel(data: PlacesData, point: Checkpoint): string {
  const building = buildingName(data, point.building);
  return point.name.includes(building) ? point.name : `${building} ${point.floor} ・ ${point.name}`;
}

function tick(): void {
  // A short tick on each choice, where the phone has a motor.
  navigator.vibrate?.(8);
}

export function PlacePicker({ data, photo, last, number, maxPhotos, saving, error, inert = false, onBack, onConfirm }: Props) {
  const { go } = useRay();
  const initial = useMemo(() => startAt(data, last), [data, last]);
  const [building, setBuilding] = useState<BuildingId>(initial.building);
  const [floor, setFloor] = useState(initial.floor);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapOff, setMapOff] = useState(false);

  const buildings = useMemo(() => buildingsWithPlaces(data), [data]);
  const floors = useMemo(() => floorsOf(data, building), [data, building]);
  const points = useMemo(() => checkpointsOn(data, building, floor), [data, building, floor]);
  const selected = selectedId ? findCheckpoint(data, selectedId) : undefined;
  const sameAsLast = useMemo(() => {
    const point = last && last.graphVersion === data.graphVersion ? findCheckpoint(data, last.checkpointId) : undefined;
    return point && point.id !== selectedId ? point : undefined;
  }, [data, last, selectedId]);

  /** Shows a floor; when it has one checkpoint only, that is the choice. */
  const show = useCallback(
    (nextBuilding: BuildingId, nextFloor: string) => {
      setBuilding(nextBuilding);
      setFloor(nextFloor);
      const only = checkpointsOn(data, nextBuilding, nextFloor);
      if (only.length === 1) setSelectedId(only[0].id);
    },
    [data],
  );

  const chooseBuilding = useCallback(
    (id: BuildingId | null) => {
      if (id === null || id === building) return;
      tick();
      const options = floorsOf(data, id);
      // Stay on the same floor label when the next building has it: a run of photos is usually on one level.
      show(id, options.some((option) => option.label === floor) ? floor : (options[0]?.label ?? ""));
    },
    [data, building, floor, show],
  );

  const chooseFloor = useCallback(
    (label: string) => {
      if (label === floor) return;
      tick();
      show(building, label);
    },
    [building, floor, show],
  );

  const choosePoint = useCallback(
    (id: string) => {
      const point = findCheckpoint(data, id);
      if (!point) return;
      tick();
      setSelectedId(id);
      // A point picked on the map, or "same as last", is shown in its own building and floor.
      if (!(point.building === building || point.joins === building) || point.floor !== floor) {
        setBuilding(point.building);
        setFloor(point.floor);
      }
    },
    [data, building, floor],
  );

  const confirm = () => {
    if (selected && !saving) onConfirm(placeOf(data, selected));
  };

  return (
    <Screen key="place" className="screen--flex pp" inert={inert}>
      <div className="topbar">
        <span>
          <button type="button" className="link" disabled={saving} onClick={() => void go(onBack)}>
            <Icon name="close" />
            写真にもどる
          </button>
        </span>
        <span className="mono">
          {String(number).padStart(2, "0")} / {String(maxPhotos).padStart(2, "0")}
        </span>
        <span />
      </div>

      <header className="pp-head">
        <h1 className="h2">
          <Phrases text="どこで撮りましたか？" />
        </h1>
        {photo && <BlobImage blob={photo} alt="選ぶ写真" className="pp-thumb" />}
      </header>

      <div className="pp-map" data-off={mapOff || undefined}>
        {!mapOff && (
          <CampusMap
            data={data}
            building={building}
            floor={floor}
            selectedId={selectedId}
            onBuilding={chooseBuilding}
            onFloor={chooseFloor}
            onSelect={choosePoint}
            onUnavailable={() => setMapOff(true)}
            className="pp-map__canvas"
          />
        )}
        {mapOff && <p className="pp-map__note small">地図を表示できないので、一覧から選びます。</p>}
      </div>

      <div className="pp-sheet">
        {sameAsLast && (
          <button type="button" className="pp-again" onClick={() => choosePoint(sameAsLast.id)}>
            <span className="mono">さっきと同じ</span>
            <span className="pp-again__name">{placeLabel(data, sameAsLast)}</span>
            <Icon name="arrow" />
          </button>
        )}

        <Rail label="建物">
          {buildings.map((item) => (
            <Chip key={item.id} active={item.id === building} onPick={() => chooseBuilding(item.id)}>
              {item.name}
            </Chip>
          ))}
        </Rail>

        <Rail label="階">
          {floors.map((item) => (
            <Chip key={item.label} active={item.label === floor} onPick={() => chooseFloor(item.label)} mono>
              {item.label}
            </Chip>
          ))}
        </Rail>

        <ul className="pp-points" role="radiogroup" aria-label="場所">
          {points.map((point) => (
            <PointRow key={point.id} point={point} data={data} active={point.id === selectedId} onPick={() => choosePoint(point.id)} />
          ))}
        </ul>

        <div className="pp-foot">
          <NoteBar text={error} alert />
          <p className="pp-summary mono" aria-live="polite">
            {selected ? placeLabel(data, selected) : "場所を選んでください"}
          </p>
          <button type="button" className="btn" disabled={!selected || saving} onClick={confirm}>
            {saving ? (
              "保存しています…"
            ) : (
              <>
                <Icon name="check" />
                ここで保存
              </>
            )}
          </button>
        </div>
      </div>
    </Screen>
  );
}

/** A row of chips that scrolls sideways, fading at the edges; the chosen chip is kept in view. */
function Rail({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const active = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  });
  return (
    <nav className="pp-rail" aria-label={label}>
      <ul ref={ref} className="pp-chips" role="radiogroup" aria-label={label}>
        {children}
      </ul>
    </nav>
  );
}

function Chip({ active, onPick, mono = false, children }: { active: boolean; onPick: () => void; mono?: boolean; children: React.ReactNode }) {
  return (
    <li>
      <button type="button" role="radio" aria-checked={active} className={`pp-chip${mono ? " pp-chip--mono" : ""}`} onClick={onPick}>
        {children}
      </button>
    </li>
  );
}

function PointRow({ point, data, active, onPick }: { point: Checkpoint; data: PlacesData; active: boolean; onPick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // A point chosen on the map comes into the list's view.
    if (active) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);
  return (
    <li>
      <button ref={ref} type="button" role="radio" aria-checked={active} className="pp-point" onClick={onPick}>
        <span className="pp-point__mark" aria-hidden="true" />
        <span className="pp-point__name">{point.name}</span>
        {point.joins && <span className="pp-point__tag mono">{buildingName(data, point.joins)}へ</span>}
      </button>
    </li>
  );
}
