/** Save / load: localStorage slots plus JSON import/export. */

import { World } from './world.js';

const KEY = (slot) => 'minecity.slot' + slot;

export function saveToSlot(world, sim, slot) {
  const payload = {
    info: {
      date: sim.dateString(),
      stamp: Date.now(),
      city: `人口 ${sim.stats.pop}`,
    },
    world: world.serialize(),
    sim: {
      day: sim.day,
      demand: sim.demand,
      growthCount: sim.growthCount,
    },
  };
  try {
    localStorage.setItem(KEY(slot), JSON.stringify(payload));
    return true;
  } catch (err) {
    console.error('save failed', err);
    return false;
  }
}

export function readSlot(slot) {
  try {
    const raw = localStorage.getItem(KEY(slot));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

export function loadFromSlot(slot) {
  const payload = readSlot(slot);
  if (!payload) return null;
  const world = new World(payload.world.w, payload.world.h);
  world.deserialize(payload.world);
  return { world, sim: payload.sim || {} };
}

export function deleteSlot(slot) {
  localStorage.removeItem(KEY(slot));
}

export function exportToFile(world, sim) {
  const payload = {
    info: { date: sim.dateString(), stamp: Date.now() },
    world: world.serialize(),
    sim: { day: sim.day, demand: sim.demand, growthCount: sim.growthCount },
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `minecity-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function importFromFile(file) {
  return file.text().then((text) => {
    const payload = JSON.parse(text);
    const world = new World(payload.world.w, payload.world.h);
    world.deserialize(payload.world);
    return { world, sim: payload.sim || {} };
  });
}
