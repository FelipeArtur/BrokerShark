(function () {

function IconLock({ size = 16, open = false }) {
  return React.createElement("svg", {
    width: size, height: size, viewBox: "0 0 16 16", fill: "none",
    stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round",
    style: { display: "block", flexShrink: 0 }
  },
    React.createElement("rect", { x: 3.5, y: 7, width: 9, height: 6.5, rx: 1.2 }),
    React.createElement("path", { d: open ? "M5.5 7 V5 a2.5 2.5 0 0 1 4.8 -1" : "M5.5 7 V5 a2.5 2.5 0 0 1 5 0 V7" })
  );
}

function IconImport({ size = 17 }) {
  return React.createElement("svg", {
    width: size, height: size, viewBox: "0 0 16 16", fill: "none",
    stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round",
  },
    React.createElement("path", { d: "M8 11 L8 2" }),
    React.createElement("path", { d: "M4 6 L8 2 L12 6" }),
    React.createElement("path", { d: "M2 14 L14 14" })
  );
}

window.BS = window.BS || {};
window.BS.IconLock = IconLock;
window.BS.IconImport = IconImport;

})();
