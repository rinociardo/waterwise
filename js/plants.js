// plants.js — the seed dataset: 34 plants installed 4 September 2026,
// plus a redbud and a 'Brandywine' viburnum added since.
//
// ballDiaIn / ballDepthIn follow ANSI Z60.1 nursery-stock conventions for the
// graded heights; container sizes use the pot's own dimensions.
// heightFt x spreadFt is the silhouette used to derive the establishment
// coefficient. interception is the share of rain the canopy keeps off the
// ground — high for dense evergreens.

import { SUN_SEED } from './model.js';

const PLANTED = '2026-09-04';

// One template per variety; individuals are expanded below so each plant
// carries its own learned kSite (the microsite is per-plant, not per-species).
const TEMPLATES = [
  {
    key: 'cryptomeria', photo: './photos/cryptomeria.jpg',
    blurb: 'Japanese cedar. The largest plant here and the slowest to establish — roughly three years. Bronzes in hard winters, which is normal, not distress.', name: 'Cryptomeria', botanical: 'Cryptomeria japonica',
    cultivar: "'Radicans'", sizeLabel: "12' B&B", qty: 1,
    ballDiaIn: 36, ballDepthIn: 22, bufferFactor: 1.3, rootAccess0: 0.45,
    heightFt: 12, spreadFt: 5, ringDiaFt: 4, interception: 0.22,
    nurseryGal: 20, sun: 'full', evergreen: true,
  },
  {
    key: 'thuja', photo: './photos/thuja.jpg',
    blurb: 'Fast, dense screening conifer. Vigorous once rooted; the first two summers decide it.', name: 'Green Giant', botanical: 'Thuja x',
    cultivar: "'Green Giant'", sizeLabel: "10' B&B", qty: 1,
    ballDiaIn: 32, ballDepthIn: 20, bufferFactor: 1.3, rootAccess0: 0.45,
    heightFt: 10, spreadFt: 4, ringDiaFt: 4, interception: 0.22,
    nurseryGal: 18, sun: 'full', evergreen: true,
  },
  {
    key: 'ilex-opaca', photo: './photos/ilex-opaca.jpg',
    blurb: 'Broadleaf evergreen holly, native to the mid-Atlantic. Slower than the conifers and worth the patience.', name: 'American Holly', botanical: 'Ilex opaca',
    cultivar: "'Satyr Hill'", sizeLabel: "8' B&B", qty: 1,
    ballDiaIn: 30, ballDepthIn: 20, bufferFactor: 1.3, rootAccess0: 0.45,
    heightFt: 8, spreadFt: 4, ringDiaFt: 3.5, interception: 0.20,
    nurseryGal: 15, sun: 'full', evergreen: true,
  },
  {
    key: 'chamaecyparis', photo: './photos/chamaecyparis.jpg',
    blurb: 'Weeping Alaskan cedar. The least drought-tolerant conifer in the yard — if anything browns first, expect it to be one of these.', name: 'Weeping Alaskan Cedar',
    botanical: 'Chamaecyparis nootkatensis', cultivar: "'Pendula'",
    sizeLabel: "7' B&B", qty: 2,
    ballDiaIn: 26, ballDepthIn: 18, bufferFactor: 1.3, rootAccess0: 0.45,
    heightFt: 7, spreadFt: 3, ringDiaFt: 3, interception: 0.20,
    nurseryGal: 12, sun: 'full', evergreen: true,
    note: 'Drought-sensitive — the least forgiving conifer here.',
  },
  {
    key: 'juniper', photo: './photos/juniper.jpg',
    blurb: 'Narrow columnar juniper, very upright. Small root ball for its height, so it dries faster than its size suggests.', name: 'Skyrocket Juniper', botanical: 'Juniperus scopulorum',
    cultivar: "'Skyrocket'", sizeLabel: "5' B&B", qty: 8,
    ballDiaIn: 20, ballDepthIn: 16, bufferFactor: 1.3, rootAccess0: 0.45,
    heightFt: 5, spreadFt: 1.5, ringDiaFt: 2.5, interception: 0.18,
    nurseryGal: 8, sun: 'full', evergreen: true,
    note: 'Scattered in groups of 1–3 — expect kSite to diverge between them.',
  },
  {
    key: 'hydrangea', photo: './photos/hydrangea.jpg',
    blurb: 'Your early-warning plant. Wilts visibly and dramatically before anything else, and recovers within hours of water.', name: 'Quick Fire Hydrangea',
    botanical: 'Hydrangea paniculata', cultivar: "'Quick Fire'",
    sizeLabel: '#7', qty: 3,
    ballDiaIn: 13, ballDepthIn: 11, bufferFactor: 1.4, rootAccess0: 0.90,
    heightFt: 2.5, spreadFt: 2.5, ringDiaFt: 2, interception: 0.10,
    nurseryGal: 4, sun: 'full', evergreen: false,
    note: 'Wilt indicator — droops visibly before anything else and recovers.',
  },
  {
    key: 'winterberry-f', photo: './photos/winterberry-f.jpg',
    blurb: 'Deciduous holly, wetland native. Drops its leaves and carries red berries on bare stems through winter.', name: 'Winterberry (female)',
    botanical: 'Ilex verticillata', cultivar: "'Winter Red'",
    sizeLabel: '#7', qty: 3,
    ballDiaIn: 13, ballDepthIn: 11, bufferFactor: 1.4, rootAccess0: 0.90,
    heightFt: 3, spreadFt: 2.5, ringDiaFt: 2, interception: 0.10,
    nurseryGal: 4, sun: 'full', evergreen: false,
    note: 'Wetland native — the most forgiving thing in the yard.',
  },
  {
    key: 'winterberry-m', photo: './photos/winterberry-m.jpg',
    blurb: 'The pollinator. No berries on any of the three females without it, and it produces none itself.', name: 'Winterberry (male)',
    botanical: 'Ilex verticillata', cultivar: "'Southern Gentleman'",
    sizeLabel: '#7', qty: 1,
    ballDiaIn: 13, ballDepthIn: 11, bufferFactor: 1.4, rootAccess0: 0.90,
    heightFt: 3, spreadFt: 2.5, ringDiaFt: 2, interception: 0.10,
    nurseryGal: 4, sun: 'full', evergreen: false,
    note: 'Pollinator for all three females — losing it costs the berries.',
  },
  {
    key: 'viburnum', photo: './photos/viburnum.jpg',
    blurb: 'Glossy summer foliage, pink-to-blue berries, strong red autumn colour. Tolerates wet ground well.', name: 'Winterthur Viburnum', botanical: 'Viburnum nudum',
    cultivar: "'Winterthur'", sizeLabel: '#10', qty: 2,
    ballDiaIn: 15, ballDepthIn: 12, bufferFactor: 1.4, rootAccess0: 0.90,
    heightFt: 3, spreadFt: 3, ringDiaFt: 2.5, interception: 0.12,
    nurseryGal: 6, sun: 'full', evergreen: false,
  },
  {
    key: 'viburnum-brandywine', photo: './photos/viburnum-brandywine.jpg',
    blurb: "Pollination partner for the two 'Winterthur'. Same species, same "
         + 'bloom time, but a different clone — which is the point, because '
         + "'Winterthur' sets very little fruit on its own pollen. Berries run "
         + 'green to pink to blue, often all three on one cluster.',
    name: 'Brandywine Viburnum', botanical: 'Viburnum nudum',
    cultivar: "'Brandywine'", sizeLabel: '#3 (3 gal)', qty: 1,
    planted: '2026-09-14',
    // Trade #3, not a true 3 US gallons — nursery pot grades run small. Top
    // diameter about 10.5 in, 9.5 deep, holding roughly 2.5 real gallons.
    ballDiaIn: 10.5, ballDepthIn: 9.5, bufferFactor: 1.4, rootAccess0: 0.90,
    heightFt: 2.5, spreadFt: 2, ringDiaFt: 2, interception: 0.10,
    nurseryGal: 2, sun: 'full', evergreen: false,
    note: 'Ten days behind the rest of the yard on the establishment curve, so '
        + 'it stays on the short watering interval after the others stretch out. '
        + 'No fertiliser before spring.',
  },
  {
    key: 'cornus', photo: './photos/cornus.jpg',
    blurb: "Variegated red-twig dogwood — white-margined leaves, not the plain green 'Baileyi' on the invoice. Coppice a third of the stems each late winter for colour.", name: 'Variegated Dogwood', botanical: 'Cornus sericea',
    cultivar: "'Baileyi' (supplied variegated)", sizeLabel: '#5', qty: 3,
    ballDiaIn: 11, ballDepthIn: 10, bufferFactor: 1.4, rootAccess0: 0.90,
    heightFt: 2.5, spreadFt: 3, ringDiaFt: 2, interception: 0.10,
    nurseryGal: 3, sun: 'full', evergreen: false,
    note: 'Variegated tissue scorches in afternoon sun — watch, do not overwater.',
  },
  {
    key: 'redbud', photo: './photos/redbud.jpg',
    blurb: "Eastern redbud — magenta flowers directly on bare branches in early "
         + "spring, before the leaves. Native understory tree. Resents root "
         + "disturbance more than anything else here, so the first two seasons "
         + "matter, and it wants drainage rather than a wet spot.",
    name: 'Redbud', botanical: 'Cercis canadensis',
    cultivar: '', sizeLabel: '#7', qty: 1,
    ballDiaIn: 13, ballDepthIn: 11, bufferFactor: 1.4, rootAccess0: 0.90,
    heightFt: 3.75, spreadFt: 2, ringDiaFt: 2, interception: 0.10,
    nurseryGal: 4, sun: 'full', evergreen: false,
    note: 'Does not tolerate wet soil — unlike the two Cornus either side of it, '
        + 'which are wetland natives. If that strip ever stays soggy, this is the '
        + 'plant that suffers. Mature spread is 20-35 ft.',
  },
  {
    key: 'panicum', photo: './photos/panicum.jpg',
    blurb: 'Upright switchgrass, blue-green turning gold. A prairie plant: established after one season, and it rots if kept moist.', name: 'North Wind Switchgrass',
    botanical: 'Panicum virgatum', cultivar: "'North Wind'",
    sizeLabel: '#1', qty: 9,
    ballDiaIn: 6, ballDepthIn: 6, bufferFactor: 1.4, rootAccess0: 0.90,
    heightFt: 1.5, spreadFt: 1, ringDiaFt: 0, interception: 0.05,
    nurseryGal: 0.75, sun: 'full', evergreen: false,
    // A #1 pot holds barely a sixth of a gallon, so on the global threshold
    // these come up due every day or so. That is arithmetically right and
    // horticulturally wrong: switchgrass is a prairie plant that tolerates
    // real drying, and kept moist it rots. Its own threshold, not the yard's.
    mad: 0.65,
    retireAfter: '2027-04-01',
    note: 'Prairie plant — established after one season. Held moist, it rots.',
  },
];


// ── Layout ──────────────────────────────────────────────────────────────────
// Read off the nursery's planting plan, rotated so north is up. Metres on the
// local grid: x runs 0 (west) to 20 (east), y runs 0 (north) to 10 (south).
// The house is along the south edge; the planting is an L around the north and
// west boundaries, plus a separate bed at the south-east by the door.
//
// Sequence and grouping come from the plan and should be right. Exact spacing
// is eyeballed from a photograph taken at an angle — drag to correct.
export const LAYOUT = {
  // North boundary, running east to west. The three big specimens sit at the
  // north-east corner, as Rino described weeks before the plan turned up.
  'ilex-opaca':      [18.5, 1.5],
  'thuja':           [16.4, 1.4],
  'cryptomeria':     [14.3, 1.5],
  'cornus-1':        [12.0, 1.9],   // easternmost dogwood
  'cornus-2':        [ 8.5, 1.9],   // the middle one
  'cornus-3':        [ 6.4, 1.9],
  'chamaecyparis-1': [ 4.4, 1.6],

  // Redbud: apex of a shallow triangle between the two eastern dogwoods.
  'redbud':          [10.25, 3.2],

  // North-west corner bed.
  'chamaecyparis-2': [ 1.9, 1.7],
  'winterberry-m':   [ 1.5, 3.1],
  'viburnum-1':      [ 2.7, 3.5],
  'viburnum-2':      [ 1.4, 4.3],
  'hydrangea-1':     [ 2.6, 4.9],
  'hydrangea-2':     [ 1.5, 5.6],
  'juniper-1':       [ 2.7, 6.2],
  'juniper-2':       [ 1.5, 6.7],
  'juniper-3':       [ 2.6, 7.3],

  // West edge, continuing south.
  'juniper-4':       [ 1.4, 7.9],
  'juniper-5':       [ 2.5, 8.4],
  'winterberry-f-1': [ 1.4, 8.9],
  'winterberry-f-2': [ 2.3, 9.3],
  'winterberry-f-3': [ 3.3, 9.1],
  'panicum-1':       [ 4.2, 9.3],
  'panicum-2':       [ 4.9, 8.9],
  'panicum-3':       [ 5.6, 9.3],
  'panicum-4':       [ 6.3, 8.9],

  // South-east bed, by the door.
  'juniper-6':       [15.8, 7.2],
  'juniper-7':       [17.1, 7.6],
  'juniper-8':       [18.4, 7.2],
  'hydrangea-3':     [16.6, 8.4],
  'panicum-5':       [14.9, 8.9],
  'panicum-6':       [15.9, 9.3],
  'panicum-7':       [16.9, 8.9],
  'panicum-8':       [17.9, 9.3],
  'panicum-9':       [18.8, 8.9],
};

export function seedPlants() {
  const out = [];
  for (const t of TEMPLATES) {
    for (let i = 1; i <= t.qty; i++) {
      const { qty, ...rest } = t;
      const id = qty > 1 ? `${t.key}-${i}` : t.key;
      out.push({
        ...rest,
        id,
        name: qty > 1 ? `${t.name} ${i}` : t.name,
        // Most of the yard went in on one day, but later additions carry their
        // own date — the establishment curve is measured from the day the
        // roots were cut, so a plant added in October is not six weeks along.
        planted: t.planted || PLANTED,
        kSite: SUN_SEED[t.sun] ?? 1.0,
        depletionGal: 0,
        hasRing: false,
        drip: false,
        lastWatered: null,
        lastReading: null,
        x: LAYOUT[id] ? LAYOUT[id][0] : undefined,
        y: LAYOUT[id] ? LAYOUT[id][1] : undefined,
      });
    }
  }
  return out;
}

export const PLANT_TEMPLATES = TEMPLATES;
