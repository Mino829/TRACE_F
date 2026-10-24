"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BlobImage } from "@/components/ping-log/blob-image";
import { Icon, NoteBar, Phrases, Screen, useRay } from "@/components/ping-log/ray/stage";
import { buildingName, buildingsWithPlaces, checkpointsOn, findCheckpoint, floorsOf, placeOf } from "@/lib/places/select";
import type { BuildingId, Checkpoint, PhotoPlace, PlacesData } from "@/lib/places/types";

import "./place-picker.css";

/**
 * "Where was this photo taken?", answered on the map.
 *
 * The map is most of the screen. It opens on the whole campus, every building
 * drawn as a wire model of its floors, so a building is recognised by its
 * shape rather than its name: tap one, the map comes close and offers its
 * floors; on a floor its checkpoints light up, and one tap picks one. The
 * checkpoints outside are on the ground of the whole view. Under the map a
 * thin bar says what was picked and saves it.
 *
 * Without the map (no WebGL, or the participant would rather) the same choice
 * is a list: building, floor, checkpoint. A place has to be chosen; the same
 * one may be chosen for any number of photos.
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
  /** The place of the photo before this one: "さっきと同じ" picks it in one tap. */
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
  if (point.building === "outdoor") return point.name;
  const building = buildingName(data, point.building);
  return point.name.includes(building) ? point.name : `${building} ${point.floor} ・ ${point.name}`;
}

function tick(): void {
  // A short tick on each choice, where the phone has a motor.
  navigator.vibrate?.(8);
}

export function PlacePicker({ data, photo, last, number, maxPhotos, saving, error, inert = false, onBack, onConfirm }: Props) {
  const { go } = useRay();
  // The map: null is the whole campus. Outside checkpoints are picked there, so "outdoor" is never a building on the map.
  const [building, setBuilding] = useState<BuildingId | null>(null);
  const [floor, setFloor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapOff, setMapOff] = useState(false);
  const [listMode, setListMode] = useState(false);

  const selected = selectedId ? findCheckpoint(data, selectedId) : undefined;
  const lastPoint = useMemo(() => (last && last.graphVersion === data.graphVersion ? findCheckpoint(data, last.checkpointId) : undefined), [data, last]);
  const showList = mapOff || listMode;

  /** Opens a floor; when it has one checkpoint only, that is the choice. */
  const openFloor = useCallback(
    (nextBuilding: BuildingId, label: string) => {
      setFloor(label);
      const only = checkpointsOn(data, nextBuilding, label);
      if (only.length === 1) setSelectedId(only[0].id);
    },
    [data],
  );

  const chooseBuilding = useCallback(
    (id: BuildingId | null) => {
      tick();
      if (id === null || id === "outdoor") {
        setBuilding(null);
        setFloor(null);
        return;
      }
      setBuilding(id);
      // Open on the floor of what is already chosen in this building, else its lowest floor.
      const here = selected && (selected.building === id || selected.joins === id) ? selected.floor : floorsOf(data, id)[0]?.label;
      if (here) openFloor(id, here);
      else setFloor(null);
    },
    [data, selected, openFloor],
  );

  const chooseFloor = useCallback(
    (label: string) => {
      if (building === null || label === floor) return;
      tick();
      openFloor(building, label);
    },
    [building, floor, openFloor],
  );

  const choosePoint = useCallback(
    (id: string) => {
      const point = findCheckpoint(data, id);
      if (!point) return;
      tick();
      setSelectedId(id);
      if (point.building === "outdoor") {
        setBuilding(null);
        setFloor(null);
      } else if (!(point.building === building || point.joins === building) || point.floor !== floor) {
        setBuilding(point.building);
        setFloor(point.floor);
      }
    },
    [data, building, floor],
  );

  const confirm = () => {
    if (selected && !saving) onConfirm(placeOf(data, selected));
  };

  const hint = selected
    ? placeLabel(data, selected)
    : building === null
      ? "建物をタップ。外で撮ったときは地面の点を選ぶ"
      : `${buildingName(data, building)}：階を選んで、場所の点をタップ`;

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

      {showList ? (
        <ListPicker data={data} selectedId={selectedId} onPick={choosePoint} note={mapOff ? "地図を表示できないので、一覧から選びます。" : null} />
      ) : (
        <div className="pp-map">
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
        </div>
      )}

      <div className="pp-foot">
        <NoteBar text={error} alert />
        <div className="pp-foot__row">
          <p className="pp-summary" aria-live="polite" data-picked={selected ? "" : undefined}>
            {hint}
          </p>
          {!mapOff && (
            <button type="button" className="pp-mode mono" onClick={() => setListMode((value) => !value)}>
              {listMode ? "地図で選ぶ" : "一覧で選ぶ"}
            </button>
          )}
        </div>
        {lastPoint && lastPoint.id !== selectedId && (
          <button type="button" className="pp-again" onClick={() => choosePoint(lastPoint.id)}>
            <span className="mono">さっきと同じ</span>
            <span className="pp-again__name">{placeLabel(data, lastPoint)}</span>
          </button>
        )}
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
    </Screen>
  );
}

/** The same choice without the map: building, floor, checkpoint. */
function ListPicker({ data, selectedId, onPick, note }: { data: PlacesData; selectedId: string | null; onPick: (id: string) => void; note: string | null }) {
  const start = selectedId ? findCheckpoint(data, selectedId) : undefined;
  const [building, setBuilding] = useState<BuildingId>(start?.building ?? "outdoor");
  const [floor, setFloor] = useState(start?.floor ?? floorsOf(data, start?.building ?? "outdoor")[0]?.label ?? "");
  const buildings = useMemo(() => buildingsWithPlaces(data), [data]);
  const floors = useMemo(() => floorsOf(data, building), [data, building]);
  const points = useMemo(() => checkpointsOn(data, building, floor), [data, building, floor]);

  const chooseBuilding = (id: BuildingId) => {
    setBuilding(id);
    const options = floorsOf(data, id);
    setFloor(options.some((option) => option.label === floor) ? floor : (options[0]?.label ?? ""));
  };

  return (
    <div className="pp-list">
      {note && <p className="pp-list__note small">{note}</p>}
      <Rail label="建物">
        {buildings.map((item) => (
          <Chip key={item.id} active={item.id === building} onPick={() => chooseBuilding(item.id)}>
            {item.name}
          </Chip>
        ))}
      </Rail>
      <Rail label="階">
        {floors.map((item) => (
          <Chip key={item.label} active={item.label === floor} onPick={() => setFloor(item.label)} mono>
            {item.label}
          </Chip>
        ))}
      </Rail>
      <ul className="pp-points" role="radiogroup" aria-label="場所">
        {points.map((point) => (
          <PointRow key={point.id} point={point} data={data} active={point.id === selectedId} onPick={() => onPick(point.id)} />
        ))}
      </ul>
    </div>
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
  return (
    <li>
      <button type="button" role="radio" aria-checked={active} className="pp-point" onClick={onPick}>
        <span className="pp-point__mark" aria-hidden="true" />
        <span className="pp-point__name">{point.name}</span>
        {point.joins && <span className="pp-point__tag mono">{buildingName(data, point.joins)}へ</span>}
      </button>
    </li>
  );
}
