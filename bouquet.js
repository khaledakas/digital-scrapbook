// Draws the pop-up peony bouquet. Each flower is built from ruffled paper petals,
// and each depth layer is hinged so the whole bouquet can fold out of the page.

const SVG_NS = "http://www.w3.org/2000/svg";
const ART_W = 700;
const ART_H = 800;

const PEONY_RINGS = [
  { radius: 1, petals: 10, width: 0.82, group: 0 },
  { radius: 0.87, petals: 10, width: 0.74, group: 0 },
  { radius: 0.71, petals: 9, width: 0.66, group: 1 },
  { radius: 0.56, petals: 8, width: 0.56, group: 1 },
  { radius: 0.42, petals: 7, width: 0.46, group: 2 },
  { radius: 0.29, petals: 6, width: 0.34, group: 2 },
  { radius: 0.16, petals: 5, width: 0.22, group: 2 },
];

const PETAL_COLOURS = {
  pink: { stroke: "#d88ca5", stops: [["#efb0c2", "#fce3ea"], ["#e89db4", "#f9d3de"], ["#db7f9c", "#f3bbcb"]] },
  white: { stroke: "#d8c3cc", stops: [["#eadbe0", "#ffffff"], ["#e3cfd6", "#fffdfc"], ["#d9bac6", "#fbf1f2"]] },
};

function seededRandom(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function divEl(className) {
  const node = document.createElement("div");
  node.className = className;
  return node;
}

function ruffledPetal(length, width, random) {
  const scallops = 5;
  const tips = [];
  for (let i = 0; i <= scallops; i += 1) {
    const across = -1 + (2 * i) / scallops;
    const dome = Math.sqrt(Math.max(0, 1 - across * across * 0.74));
    const jitter = (random() - 0.5) * length * 0.09;
    tips.push([across * width * 0.5, -(length * (0.6 + 0.4 * dome) + jitter)]);
  }
  const f = (n) => n.toFixed(1);
  let path = `M0 0Q${f(-width * 0.62)} ${f(-length * 0.3)} ${f(tips[0][0])} ${f(tips[0][1])}`;
  for (let i = 1; i < tips.length; i += 1) {
    const [x0, y0] = tips[i - 1];
    const [x1, y1] = tips[i];
    const bump = length * (0.07 + random() * 0.06);
    path += `Q${f((x0 + x1) / 2)} ${f((y0 + y1) / 2 - bump)} ${f(x1)} ${f(y1)}`;
  }
  return `${path}Q${f(width * 0.62)} ${f(-length * 0.3)} 0 0Z`;
}

function peonyLayers(colour, seed) {
  const random = seededRandom(seed);
  const stroke = PETAL_COLOURS[colour].stroke;
  const groups = [0, 1, 2].map(() => svgEl("g"));

  PEONY_RINGS.forEach((ring, ringIndex) => {
    const start = random() * 360;
    for (let i = 0; i < ring.petals; i += 1) {
      const angle = start + (360 * i) / ring.petals + (random() - 0.5) * 12;
      const length = 104 * ring.radius * (0.94 + random() * 0.1);
      groups[ring.group].append(svgEl("path", {
        d: ruffledPetal(length, 100 * ring.width * (0.92 + random() * 0.16), random),
        fill: `url(#petal-${colour}-${ring.group})`,
        stroke,
        "stroke-width": ringIndex > 3 ? 0.9 : 1.2,
        transform: `rotate(${angle.toFixed(1)})`,
      }));
    }
  });
  return groups;
}

// One flower, as three stacked sheets so its petals can unfurl in stages.
function makeBloom({ left, top, size, colour, seed, delay = 0 }) {
  const bloom = divEl("bloom");
  bloom.style.cssText = `left:${left}%;top:${top}%;width:${size}%`;
  peonyLayers(colour, seed).forEach((group, index) => {
    const sheet = svgEl("svg", { class: "petals", viewBox: "-130 -130 260 260" });
    sheet.style.setProperty("--bloom-delay", `${delay + (2 - index) * 110}ms`);
    sheet.style.setProperty("--twist", `${-34 - index * 18}deg`);
    if (index === 0) {
      sheet.append(svgEl("circle", { r: 126, cy: 7, fill: "url(#petal-shadow)" }));
    }
    sheet.append(group);
    bloom.append(sheet);
  });
  return bloom;
}

function petalDefs() {
  const svg = svgEl("svg", { width: 0, height: 0, class: "petal-defs" });
  const defs = svgEl("defs");
  for (const [name, { stops }] of Object.entries(PETAL_COLOURS)) {
    stops.forEach(([base, tip], index) => {
      const gradient = svgEl("linearGradient", { id: `petal-${name}-${index}`, x1: 0, y1: 1, x2: 0, y2: 0 });
      gradient.append(svgEl("stop", { offset: "0", "stop-color": base }), svgEl("stop", { offset: "1", "stop-color": tip }));
      defs.append(gradient);
    });
  }
  const shadow = svgEl("radialGradient", { id: "petal-shadow" });
  shadow.append(
    svgEl("stop", { offset: "0.72", "stop-color": "#0a014f", "stop-opacity": "0.42" }),
    svgEl("stop", { offset: "1", "stop-color": "#0a014f", "stop-opacity": "0" }),
  );
  defs.append(shadow);
  svg.append(defs);
  return svg;
}

function artSvg() {
  return svgEl("svg", { viewBox: `0 0 ${ART_W} ${ART_H}` });
}

function leaf(x, y, length, angle, fill) {
  const group = svgEl("g", { transform: `translate(${x} ${y}) rotate(${angle})` });
  const w = length * 0.3;
  group.append(
    svgEl("path", {
      d: `M0 0C${-w} ${-length * 0.25} ${-w * 0.8} ${-length * 0.7} 0 ${-length}C${w * 0.8} ${-length * 0.7} ${w} ${-length * 0.25} 0 0Z`,
      fill, stroke: "#2e3727", "stroke-width": 1.4,
    }),
    svgEl("path", { d: `M0 -4L0 ${-length * 0.9}`, stroke: "#2e3727", "stroke-width": 1.2, fill: "none" }),
  );
  return group;
}

function backArt() {
  const svg = artSvg();
  for (let x = 312; x <= 388; x += 19) {
    svg.append(svgEl("path", {
      d: `M350 640Q${(350 + x) / 2} 715 ${x} 792`,
      stroke: "#45503b", "stroke-width": 8, fill: "none", "stroke-linecap": "round",
    }));
  }
  svg.append(svgEl("path", { d: "M112 386Q350 482 588 386L372 716H328Z", fill: "#e5d0e3", stroke: "#0a014f", "stroke-width": 1.5 }));
  svg.append(svgEl("path", { d: "M214 432L340 712M486 432L360 712", stroke: "#b89bb6", "stroke-width": 1.5, fill: "none" }));

  const greens = ["#45503b", "#66745a", "#84926f"];
  const leaves = [
    [158, 332, 150, -82], [112, 262, 130, -66], [142, 170, 145, -42], [228, 78, 135, -20],
    [350, 48, 118, 0], [472, 78, 135, 20], [558, 170, 145, 42], [588, 262, 130, 66],
    [542, 332, 150, 82], [190, 402, 150, -112], [510, 402, 150, 112], [274, 56, 95, -9], [426, 56, 95, 9],
  ];
  leaves.forEach(([x, y, length, angle], index) => svg.append(leaf(x, y, length, angle, greens[index % 3])));
  return svg;
}

function frontArt() {
  const svg = artSvg();
  svg.append(svgEl("path", {
    d: "M168 468Q214 500 252 482Q300 520 350 494Q400 520 448 482Q486 500 532 468L368 716H332Z",
    fill: "#f6f5ae", stroke: "#0a014f", "stroke-width": 1.5,
  }));
  svg.append(svgEl("path", { d: "M255 490L342 712M445 490L358 712", stroke: "#c9c784", "stroke-width": 1.5, fill: "none" }));
  return svg;
}

function ribbonArt() {
  const svg = artSvg();
  const rose = { fill: "#8e3b46", stroke: "#0a014f", "stroke-width": 1.5 };
  svg.append(
    svgEl("path", { d: "M340 672C318 716 306 752 276 782L310 772L322 794C342 758 358 716 362 676Z", ...rose }),
    svgEl("path", { d: "M360 672C382 716 394 752 424 782L390 772L378 794C358 758 342 716 338 676Z", ...rose }),
    svgEl("path", { d: "M350 655C298 606 226 612 232 660C238 706 306 702 350 668Z", ...rose }),
    svgEl("path", { d: "M350 655C402 606 474 612 468 660C462 706 394 702 350 668Z", ...rose }),
    svgEl("path", { d: "M332 638H368Q378 660 368 682H332Q322 660 332 638Z", ...rose }),
    svgEl("path", { d: "M316 640C286 630 258 634 250 656M384 640C414 630 442 634 450 656", stroke: "#b86a74", "stroke-width": 2, fill: "none" }),
  );
  return svg;
}

const BOUQUET_LAYERS = [
  { className: "layer layer-back", delay: 0, art: backArt, flowers: [] },
  {
    className: "layer wing-left", delay: 130, flowers: [
      [132, 262, 80, "pink"], [204, 138, 84, "white"], [122, 392, 70, "white"],
    ],
  },
  {
    className: "layer wing-right", delay: 130, flowers: [
      [568, 262, 80, "white"], [496, 138, 84, "pink"], [578, 392, 70, "pink"],
    ],
  },
  {
    className: "layer layer-mid", delay: 280, flowers: [
      [350, 112, 96, "pink"], [250, 262, 96, "white"], [452, 262, 96, "pink"],
      [176, 372, 80, "pink"], [526, 372, 80, "white"],
    ],
  },
  {
    className: "layer layer-front", delay: 430, art: frontArt, ribbon: true, flowers: [
      [350, 316, 108, "white"], [250, 420, 90, "pink"], [452, 420, 90, "white"], [350, 462, 76, "pink"],
    ],
  },
];

function buildBouquet() {
  const bouquet = divEl("bouquet");
  bouquet.append(petalDefs());
  let seed = 11;
  for (const spec of BOUQUET_LAYERS) {
    const layer = divEl(spec.className);
    layer.style.setProperty("--delay", `${spec.delay}ms`);
    if (spec.art) layer.append(spec.art());
    spec.flowers.forEach(([cx, cy, r, colour], index) => {
      seed += 7;
      layer.append(makeBloom({
        left: ((cx - 1.3 * r) / ART_W) * 100,
        top: ((cy - 1.3 * r) / ART_H) * 100,
        size: ((2.6 * r) / ART_W) * 100,
        colour,
        seed,
        delay: spec.delay + 240 + index * 70,
      }));
    });
    if (spec.ribbon) layer.append(ribbonArt());
    bouquet.append(layer);
  }
  return bouquet;
}
