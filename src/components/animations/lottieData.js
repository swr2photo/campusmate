// Lightweight inline Lottie animation definitions to guarantee working animations immediately
// Developers can also override with any external Lottie JSON files from LottieFiles.com

export const HEART_MATCH_LOTTIE = {
  v: "5.5.7",
  fr: 60,
  ip: 0,
  op: 120,
  w: 300,
  h: 300,
  nm: "HeartMatch",
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: "Heart",
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [150, 150, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: {
          a: 1,
          k: [
            { i: { x: [0.2], y: [1] }, o: { x: [0.2], y: [0] }, t: 0, s: [0, 0, 100] },
            { i: { x: [0.2], y: [1] }, o: { x: [0.2], y: [0] }, t: 30, s: [120, 120, 100] },
            { i: { x: [0.2], y: [1] }, o: { x: [0.2], y: [0] }, t: 45, s: [95, 95, 100] },
            { i: { x: [0.2], y: [1] }, o: { x: [0.2], y: [0] }, t: 60, s: [105, 105, 100] },
            { t: 75, s: [100, 100, 100] }
          ]
        }
      },
      shapes: [
        {
          ty: "gr",
          it: [
            {
              ty: "sh",
              ks: {
                a: 0,
                k: {
                  c: true,
                  i: [[0, -25], [-20, 0], [0, 20], [0, 0], [0, 20], [20, 0]],
                  o: [[0, 20], [20, 0], [0, 0], [0, -25], [-20, 0], [0, -20]],
                  v: [[0, 35], [-35, 0], [-20, -30], [0, -15], [20, -30], [35, 0]]
                }
              }
            },
            {
              ty: "fl",
              c: { a: 0, k: [1, 0.22, 0.44, 1] }, // Pink/Red Heart (#FF385C)
              o: { a: 0, k: 100 }
            },
            {
              ty: "tr",
              p: { a: 0, k: [0, 0] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [150, 150] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 }
            }
          ]
        }
      ]
    },
    {
      ddd: 0,
      ind: 2,
      ty: 4,
      nm: "SparkleRing",
      sr: 1,
      ks: {
        o: {
          a: 1,
          k: [
            { t: 15, s: [0] },
            { t: 30, s: [100] },
            { t: 65, s: [0] }
          ]
        },
        r: {
          a: 1,
          k: [
            { t: 0, s: [0] },
            { t: 90, s: [45] }
          ]
        },
        p: { a: 0, k: [150, 150, 0] },
        a: { a: 0, k: [0, 0, 0] },
        s: {
          a: 1,
          k: [
            { t: 15, s: [40, 40, 100] },
            { t: 65, s: [140, 140, 100] }
          ]
        }
      },
      shapes: [
        {
          ty: "gr",
          it: [
            {
              ty: "el",
              p: { a: 0, k: [0, -70] },
              s: { a: 0, k: [8, 8] }
            },
            {
              ty: "el",
              p: { a: 0, k: [70, 0] },
              s: { a: 0, k: [8, 8] }
            },
            {
              ty: "el",
              p: { a: 0, k: [0, 70] },
              s: { a: 0, k: [8, 8] }
            },
            {
              ty: "el",
              p: { a: 0, k: [-70, 0] },
              s: { a: 0, k: [8, 8] }
            },
            {
              ty: "fl",
              c: { a: 0, k: [1, 0.78, 0.17, 1] }, // Gold sparkles (#FFC72C)
              o: { a: 0, k: 100 }
            },
            {
              ty: "tr",
              p: { a: 0, k: [0, 0] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 }
            }
          ]
        }
      ]
    }
  ]
};

export const RADAR_SEARCH_LOTTIE = {
  v: "5.5.7",
  fr: 60,
  ip: 0,
  op: 120,
  w: 200,
  h: 200,
  nm: "RadarSearch",
  ddd: 0,
  assets: [],
  layers: [
    {
      ddd: 0,
      ind: 1,
      ty: 4,
      nm: "Wave1",
      sr: 1,
      ks: {
        o: {
          a: 1,
          k: [
            { t: 0, s: [80] },
            { t: 100, s: [0] }
          ]
        },
        p: { a: 0, k: [100, 100, 0] },
        s: {
          a: 1,
          k: [
            { t: 0, s: [20, 20, 100] },
            { t: 100, s: [150, 150, 100] }
          ]
        }
      },
      shapes: [
        {
          ty: "gr",
          it: [
            {
              ty: "el",
              p: { a: 0, k: [0, 0] },
              s: { a: 0, k: [80, 80] }
            },
            {
              ty: "st",
              c: { a: 0, k: [0.23, 0.35, 0.99, 1] }, // Blue (#3B5AFE)
              w: { a: 0, k: 3 },
              o: { a: 0, k: 100 }
            },
            {
              ty: "tr",
              p: { a: 0, k: [0, 0] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 }
            }
          ]
        }
      ]
    },
    {
      ddd: 0,
      ind: 2,
      ty: 4,
      nm: "CenterDot",
      sr: 1,
      ks: {
        o: { a: 0, k: 100 },
        p: { a: 0, k: [100, 100, 0] },
        s: {
          a: 1,
          k: [
            { t: 0, s: [90, 90, 100] },
            { t: 60, s: [110, 110, 100] },
            { t: 120, s: [90, 90, 100] }
          ]
        }
      },
      shapes: [
        {
          ty: "gr",
          it: [
            {
              ty: "el",
              p: { a: 0, k: [0, 0] },
              s: { a: 0, k: [22, 22] }
            },
            {
              ty: "fl",
              c: { a: 0, k: [0.23, 0.35, 0.99, 1] },
              o: { a: 0, k: 100 }
            },
            {
              ty: "tr",
              p: { a: 0, k: [0, 0] },
              a: { a: 0, k: [0, 0] },
              s: { a: 0, k: [100, 100] },
              r: { a: 0, k: 0 },
              o: { a: 0, k: 100 }
            }
          ]
        }
      ]
    }
  ]
};
