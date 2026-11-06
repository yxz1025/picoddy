import { s as styles_default, c as classRenderer_v3_unified_default, a as classDiagram_default, C as ClassDB } from "./chunk-TICWLB2K-CzwLaHzI.js";
import { _ as __name } from "./mermaid.core-BWDLE81Z.js";
import "./chunk-5VM5RSS4-DKIzoHaE.js";
import "./chunk-XXDRQBXY-D0E3sHrE.js";
import "./chunk-POPQ4Y6H-CI8F4x9m.js";
import "./chunk-F27PBJKO-Bm7HcyLY.js";
import "./index-jGEBGuXa.js";
var diagram = {
  parser: classDiagram_default,
  get db() {
    return new ClassDB();
  },
  renderer: classRenderer_v3_unified_default,
  styles: styles_default,
  init: /* @__PURE__ */ __name((cnf) => {
    if (!cnf.class) {
      cnf.class = {};
    }
    cnf.class.arrowMarkerAbsolute = cnf.arrowMarkerAbsolute;
  }, "init")
};
export {
  diagram
};
