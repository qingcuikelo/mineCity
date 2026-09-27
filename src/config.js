/** Global constants for the game runtime. */

export const VIEW_W = 640;
export const VIEW_H = 400;

export const TILE_W = 64;
export const TILE_H = 32;
export const Z_UNIT = 16;

export const MAP_W = 128;
export const MAP_H = 128;
export const MAX_H = 6;

/** Layout of the fixed UI chrome (in logical pixels). */
export const LAYOUT = {
  statusH: 14,
  toolbarH: 62,
  tabH: 14,
  minimapW: 148,
};

export const ZONE = { NONE: 0, R: 1, C: 2, I: 3 };
export const SURF = { GRASS: 0, SAND: 1, ROCK: 2, DIRT: 3 };

export const TICKS_PER_SEC = 1 / 1.6;
