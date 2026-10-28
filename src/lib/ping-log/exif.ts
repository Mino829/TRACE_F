/** Historical EXIF fields retained in already-saved accuracy records. */

export type ExifSummary = {
  make: string | null;
  model: string | null;
  software: string | null;
  orientation: number | null;
  dateTimeOriginal: string | null;
  offsetTimeOriginal: string | null;
  focalLength: number | null;
  focalLength35mm: number | null;
  lensModel: string | null;
  gps: {
    latitude: number | null;
    longitude: number | null;
    altitude: number | null;
    horizontalError: number | null;
    dop: number | null;
    imgDirection: number | null;
    imgDirectionRef: string | null;
    speed: number | null;
    speedRef: string | null;
    dateStamp: string | null;
    timeStamp: number[] | null;
    mapDatum: string | null;
  } | null;
};
